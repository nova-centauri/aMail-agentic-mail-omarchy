import express from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeMatch } from '../services/crypto.js';
import { hydrateRemoteContent } from '../services/message-html.js';
import {
  accountTestInput,
  parseAvatar,
  serializeAccountInput,
} from '../services/account-input.js';
import { listConversations, parseNumber } from '../services/inbox.js';
import {
  HIDDEN_DEFAULT_CATEGORIES,
  PERSON_FLAGS,
} from '../services/smart-filter.js';
import {
  DEFAULT_ACCOUNT_COLOR,
  discoverAccountProvider,
  mailProviderCatalog,
} from '../utils/mail.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { accessGate, requestHasAccess, sessionCookieOptions } from '../middleware/auth.js';

function initials(value) {
  return String(value || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function initialAvatar(name, color = DEFAULT_ACCOUNT_COLOR) {
  const label = initials(name).replace(/[&<>"']/g, '');
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCOUNT_COLOR;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${label}"><rect width="96" height="96" rx="48" fill="${safeColor}"/><text x="48" y="59" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="600" fill="#fff">${label}</text></svg>`);
}

function hydrateMessage(message, remoteContent) {
  if (!message || !remoteContent.canIssueTokens) return message;
  const hydrated = hydrateRemoteContent(message.htmlBody, {
    issueToken: (url) => remoteContent.issueToken(message.id, url),
  });
  return { ...message, htmlBody: hydrated.html, remoteImageCount: hydrated.remoteImageCount };
}

function serveAvatar(response, account) {
  if (account?.avatar_blob) {
    response.set('Content-Type', account.avatar_mime || 'image/png');
    response.set('Cache-Control', 'private, max-age=86400');
    return response.send(account.avatar_blob);
  }
  response.set('Content-Type', 'image/svg+xml; charset=utf-8');
  response.set('Cache-Control', 'private, max-age=86400');
  return response.send(initialAvatar(account?.display_name || account?.email, account?.color));
}

function updateTargets(repos, mailService, id, state) {
  const message = repos.messages.get(id);
  if (message) return Promise.all([mailService.updateMessageState(message.id, state)]);
  const thread = repos.threads.get(id);
  if (!thread) throw new NotFoundError('Message or thread not found.');
  return Promise.all(repos.messages.forThread(thread.id).map((item) => mailService.updateMessageState(item.id, state)));
}

export function registerApi(app, { config, repos, mailService, remoteContent }) {
  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      version: '0.1.0',
      releaseSha: config.releaseSha || null,
      accounts: repos.accounts.list().length,
      authProtected: Boolean(config.accessToken),
      credentialsConfigured: Boolean(config.credentialKey),
      remoteContentProxyConfigured: Boolean(config.remoteContentProxyUrl),
      remoteContentDirectDevelopmentOnly: Boolean(config.allowDirectRemoteContent),
    });
  });

  app.get('/api/session', (request, response) => {
    response.json({ protected: Boolean(config.accessToken), authenticated: requestHasAccess(request, config) });
  });

  app.post('/api/session', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), (request, response) => {
    if (!config.accessToken) return response.status(204).end();
    if (!timingSafeMatch(request.body?.accessToken, config.accessToken)) {
      return response.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Invalid access token.' } });
    }
    response.cookie('gigamail_session', config.accessToken, sessionCookieOptions(config));
    return response.status(204).end();
  });

  app.delete('/api/session', (_request, response) => {
    response.clearCookie('gigamail_session', { path: '/' });
    response.status(204).end();
  });

  // Account ids are random UUIDs and avatar bytes contain no mailbox data. This
  // is public solely so native <img> rendering works when the rest of the API
  // uses Bearer auth (which image requests cannot attach).
  app.get('/api/accounts/:id/avatar', (request, response) => {
    const account = repos.accounts.getRaw(request.params.id);
    if (!account) throw new NotFoundError('Mail account not found.');
    serveAvatar(response, account);
  });

  // This endpoint is deliberately outside the Bearer gate: browser <img> tags
  // cannot attach Authorization headers. The short-lived HMAC token, issued only
  // for a persisted message's inert remote-image placeholder, is its authority.
  app.get('/api/content/remote', async (request, response) => {
    const result = await remoteContent.fetchToken(String(request.query.token || ''));
    response.set('Content-Type', result.contentType);
    response.set('Content-Length', String(result.body.length));
    response.set('Cache-Control', 'private, no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Cross-Origin-Resource-Policy', 'same-origin');
    response.send(result.body);
  });

  const router = express.Router();
  router.use(accessGate(config));

  // Custom account probes can target operator-supplied hosts. Keep this behind
  // the access gate and tightly rate-limited so it cannot become a LAN scanner.
  const accountProbeLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/accounts', (_request, response) => response.json({ accounts: repos.accounts.list() }));
  router.get('/accounts/providers', (request, response) => {
    const discoveryInput = {
      email: String(request.query.email || '').trim(),
      serverHost: String(request.query.serverHost || request.query.host || '').trim(),
    };
    response.json({
      providers: mailProviderCatalog(),
      discovery: discoverAccountProvider(discoveryInput),
    });
  });
  // This accepts the same connection/credential fields as POST /accounts, but
  // uses them only in memory and never encrypts or persists them.
  router.post('/accounts/test', accountProbeLimiter, async (request, response) => {
    response.json({ result: await mailService.testSettings(request.body || {}) });
  });
  router.post('/accounts', accountProbeLimiter, async (request, response) => {
    const body = request.body || {};
    const input = serializeAccountInput(body, null, config);
    if (repos.accounts.getByEmailRaw(input.email)) throw new ConflictError('An account with this email already exists.');
    // Creation is atomic from the API's perspective: bad credentials or an
    // unreachable receiving/sending server never leave a broken saved account.
    const connection = await mailService.testSettings(body);
    const account = repos.accounts.create(input);
    response.status(201).json({ account, connection });
  });
  router.patch('/accounts/:id', accountProbeLimiter, async (request, response) => {
    const existing = repos.accounts.getRaw(request.params.id);
    if (!existing) throw new NotFoundError('Mail account not found.');
    const body = request.body || {};
    const input = serializeAccountInput(body, existing, config);
    const connectionChanged = ['credentials', 'provider', 'serverHost', 'imap', 'smtp']
      .some((field) => Object.hasOwn(body, field));
    const connection = connectionChanged
      ? await mailService.testSettings(accountTestInput(body, existing, config))
      : undefined;
    const account = repos.accounts.update(existing.id, input);
    response.json({ account, ...(connection ? { connection } : {}) });
  });
  router.delete('/accounts/:id', (request, response) => {
    if (!repos.accounts.remove(request.params.id)) throw new NotFoundError('Mail account not found.');
    response.status(204).end();
  });
  router.put('/accounts/:id/avatar', (request, response) => {
    const existing = repos.accounts.getRaw(request.params.id);
    if (!existing) throw new NotFoundError('Mail account not found.');
    const account = repos.accounts.update(existing.id, {
      ...existing,
      ...parseAvatar(request.body?.avatarDataUrl),
    });
    response.json({ account });
  });
  router.get('/profile/:email/avatar', (request, response) => {
    const account = repos.accounts.getByEmailRaw(decodeURIComponent(request.params.email));
    serveAvatar(response, account || { display_name: request.params.email, email: request.params.email });
  });
  router.post('/accounts/:id/test', async (request, response) => response.json({ result: await mailService.testAccount(request.params.id) }));
  router.post('/accounts/:id/sync', async (request, response) => {
    const result = await mailService.syncAccount(request.params.id, {
      mailbox: request.body?.mailbox ? String(request.body.mailbox) : undefined,
      limit: parseNumber(request.body?.limit, config.syncBatchSize, 1, 1000),
    });
    response.json({ result });
  });
  router.post('/sync', async (request, response) => {
    const results = await mailService.syncAll({
      mailbox: request.body?.mailbox ? String(request.body.mailbox) : undefined,
      limit: parseNumber(request.body?.limit, config.syncBatchSize, 1, 1000),
    });
    response.json({ results });
  });

  router.get('/flags', (_request, response) => {
    response.json({
      flags: PERSON_FLAGS.map((flag) => ({
        id: flag.id,
        label: flag.label,
        shortLabel: flag.shortLabel,
        description: flag.description,
        emails: [...flag.emails],
      })),
      hiddenDefaultCategories: [...HIDDEN_DEFAULT_CATEGORIES],
    });
  });

  router.get('/messages', (request, response) => {
    response.json(listConversations(repos, {
      accountId: request.query.accountId ? String(request.query.accountId) : null,
      folder: request.query.folder,
      category: request.query.category,
      personFlag: request.query.flag || request.query.personFlag,
      page: request.query.page,
      pageSize: request.query.pageSize || request.query.limit,
      query: request.query.q,
      mailbox: request.query.mailbox,
    }));
  });
  router.get('/messages/:id', (request, response) => {
    const message = repos.messages.get(request.params.id);
    if (!message) throw new NotFoundError('Message not found.');
    response.json({ message: hydrateMessage(message, remoteContent) });
  });
  router.post('/messages', async (request, response) => {
    const message = await mailService.sendMessage(request.body || {});
    response.status(201).json({ message });
  });
  router.post('/messages/:id/read', async (request, response) => {
    const messages = await updateTargets(repos, mailService, request.params.id, { isRead: request.body?.read !== false });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/unread', async (request, response) => {
    const messages = await updateTargets(repos, mailService, request.params.id, { isRead: false });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/star', async (request, response) => {
    const existing = repos.messages.get(request.params.id);
    const requested = request.body?.star ?? request.body?.starred;
    const desired = requested ?? (existing ? !existing.isStarred : true);
    const messages = await updateTargets(repos, mailService, request.params.id, { isStarred: Boolean(desired) });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/archive', async (request, response) => {
    const messages = await updateTargets(repos, mailService, request.params.id, { isArchived: request.body?.archived !== false });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/trash', async (request, response) => {
    const messages = await updateTargets(repos, mailService, request.params.id, { isTrashed: request.body?.trashed !== false });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/spam', async (request, response) => {
    const messages = await updateTargets(repos, mailService, request.params.id, { isSpam: request.body?.spam !== false, isArchived: true });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/snooze', async (request, response) => {
    const until = request.body?.until ? new Date(request.body.until) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(until.valueOf()) || until <= new Date()) throw new ValidationError('Snooze time must be in the future.');
    const messages = await updateTargets(repos, mailService, request.params.id, { snoozedUntil: until.toISOString(), isArchived: true });
    response.json({ message: messages[0], messages });
  });
  router.post('/messages/:id/remote-content', (request, response) => {
    const message = repos.messages.get(request.params.id);
    if (message) {
      const hydrated = hydrateMessage(message, remoteContent);
      return response.json({ message: hydrated, htmlBody: hydrated.htmlBody });
    }
    const thread = repos.threads.get(request.params.id);
    if (!thread) throw new NotFoundError('Message or thread not found.');
    const messages = repos.messages.forThread(thread.id).map((item) => hydrateMessage(item, remoteContent));
    return response.json({ thread: { ...thread, messages }, messages, htmlBody: messages.at(-1)?.htmlBody || '' });
  });

  router.get('/threads/:id', (request, response) => {
    const thread = repos.threads.get(request.params.id);
    if (!thread) throw new NotFoundError('Thread not found.');
    const messages = repos.messages.forThread(thread.id).map((message) => hydrateMessage(message, remoteContent));
    response.json({ thread: { ...thread, messages }, messages });
  });

  router.get('/drafts', (request, response) => {
    const accountId = String(request.query.accountId || '');
    if (!accountId) throw new ValidationError('accountId is required.');
    response.json({ drafts: repos.drafts.list(accountId) });
  });
  router.post('/drafts', (request, response) => {
    const body = request.body || {};
    if (!repos.accounts.get(body.accountId)) throw new NotFoundError('Mail account not found.');
    const draft = repos.drafts.create({
      account_id: body.accountId,
      thread_id: body.threadId || null,
      to_json: JSON.stringify(body.to || []),
      cc_json: JSON.stringify(body.cc || []),
      bcc_json: JSON.stringify(body.bcc || []),
      subject: String(body.subject || '').slice(0, 998),
      html_body: String(body.htmlBody || '').slice(0, 1_000_000),
      text_body: String(body.textBody || '').slice(0, 1_000_000),
      attachments_json: JSON.stringify([]),
    });
    response.status(201).json({ draft });
  });
  router.patch('/drafts/:id', (request, response) => {
    const existing = repos.drafts.get(request.params.id);
    if (!existing) throw new NotFoundError('Draft not found.');
    const body = request.body || {};
    const draft = repos.drafts.update(existing.id, {
      thread_id: body.threadId ?? existing.threadId,
      to_json: JSON.stringify(body.to ?? existing.to),
      cc_json: JSON.stringify(body.cc ?? existing.cc),
      bcc_json: JSON.stringify(body.bcc ?? existing.bcc),
      subject: String(body.subject ?? existing.subject).slice(0, 998),
      html_body: String(body.htmlBody ?? existing.htmlBody).slice(0, 1_000_000),
      text_body: String(body.textBody ?? existing.textBody).slice(0, 1_000_000),
      attachments_json: JSON.stringify([]),
    });
    response.json({ draft });
  });
  router.delete('/drafts/:id', (request, response) => {
    if (!repos.drafts.remove(request.params.id)) throw new NotFoundError('Draft not found.');
    response.status(204).end();
  });

  router.get('/settings', (_request, response) => response.json({ settings: repos.settings.list() }));
  router.put('/settings', (request, response) => {
    const settings = request.body?.settings ?? request.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new ValidationError('Settings must be an object.');
    for (const [key, value] of Object.entries(settings)) {
      if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(key)) throw new ValidationError('Settings key is invalid.');
      repos.settings.set(key, value);
    }
    response.json({ settings: repos.settings.list() });
  });

  app.use('/api', router);
}
