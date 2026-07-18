import express from 'express';
import rateLimit from 'express-rate-limit';
import { decryptJson, encryptJson, timingSafeMatch } from '../services/crypto.js';
import { hydrateRemoteContent } from '../services/message-html.js';
import { isSmartCategory, SMART_CATEGORY_SLUGS } from '../services/smart-filter.js';
import {
  accountConnection,
  DEFAULT_ACCOUNT_COLOR,
  discoverAccountProvider,
  isEmail,
  mailProviderCatalog,
} from '../utils/mail.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { accessGate, requestHasAccess, sessionCookieOptions } from '../middleware/auth.js';

const parseNumber = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

const normalizeFolder = (value) => {
  const folder = String(value || 'inbox').toLowerCase();
  return ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'all', 'trash', 'spam', 'archive'].includes(folder) ? folder : 'inbox';
};

const normalizeCategory = (value) => {
  const category = String(value || '').trim().toLowerCase();
  if (!category || category === 'all') return '';
  if (!isSmartCategory(category)) {
    throw new ValidationError(`Unknown smart filter. Choose one of: ${SMART_CATEGORY_SLUGS.join(', ')}.`);
  }
  return category;
};

const emptyCategoryCounts = () => Object.fromEntries(SMART_CATEGORY_SLUGS.map((category) => [category, 0]));

const emptyFolderCounts = () => ({ inbox: 0, starred: 0, snoozed: 0, drafts: 0 });

const sumFolderCounts = (accounts, repos) => accounts.reduce((totals, account) => {
  const counts = repos.messages.folderCounts(account.id);
  return {
    inbox: totals.inbox + counts.inbox,
    starred: totals.starred + counts.starred,
    snoozed: totals.snoozed + counts.snoozed,
    drafts: totals.drafts + counts.drafts,
  };
}, emptyFolderCounts());

const booleanField = (value, fallback, fieldName) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  throw new ValidationError(`${fieldName} must be true or false.`);
};

function initials(value) {
  return String(value || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function initialAvatar(name, color = DEFAULT_ACCOUNT_COLOR) {
  const label = initials(name).replace(/[&<>"']/g, '');
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCOUNT_COLOR;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${label}"><rect width="96" height="96" rx="48" fill="${safeColor}"/><text x="48" y="59" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="600" fill="#fff">${label}</text></svg>`);
}

function parseAvatar(dataUrl) {
  if (dataUrl === null) return { avatar_blob: null, avatar_mime: null };
  if (typeof dataUrl !== 'string') throw new ValidationError('Avatar must be an image data URL.');
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new ValidationError('Avatar must be a PNG, JPEG, GIF, or WebP data URL.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 1_000_000) throw new ValidationError('Avatar must be smaller than 1 MB.');
  return { avatar_blob: buffer, avatar_mime: match[1].toLowerCase() };
}

function serializeAccountInput(body, existing, config) {
  const email = String(body.email ?? existing?.email ?? '').trim().toLowerCase();
  if (!isEmail(email)) throw new ValidationError('A valid account email is required.');
  if (existing && email !== existing.email.toLowerCase()) {
    throw new ValidationError('Account email cannot be changed. Remove and re-add the account instead.');
  }
  const currentConnection = existing ? {
    provider: existing.provider,
    imap: { host: existing.imap_host, port: existing.imap_port, secure: Boolean(existing.imap_secure) },
    smtp: { host: existing.smtp_host, port: existing.smtp_port, secure: Boolean(existing.smtp_secure) },
  } : {};
  const connection = accountConnection({
    ...currentConnection,
    ...body,
    imap: { ...currentConnection.imap, ...(body.imap || {}) },
    smtp: { ...currentConnection.smtp, ...(body.smtp || {}) },
  });
  let credentials;
  if (body.credentials !== undefined) {
    if (!body.credentials || typeof body.credentials !== 'object') throw new ValidationError('Account credentials are required.');
    credentials = encryptJson(body.credentials, config.credentialKey);
  } else if (existing) {
    credentials = existing.credential_ciphertext;
  } else {
    throw new ValidationError('Account credentials are required.');
  }
  const avatar = body.avatarDataUrl === undefined
    ? { avatar_blob: existing?.avatar_blob || null, avatar_mime: existing?.avatar_mime || null }
    : parseAvatar(body.avatarDataUrl);
  const color = String(body.color ?? existing?.color ?? DEFAULT_ACCOUNT_COLOR);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ValidationError('Account color must be a six-digit hex color.');
  return {
    email,
    display_name: String(body.displayName ?? existing?.display_name ?? email.split('@')[0]).trim().slice(0, 120) || email,
    ...avatar,
    color,
    provider: connection.provider,
    imap_host: connection.imap.host,
    imap_port: connection.imap.port,
    imap_secure: Number(connection.imap.secure),
    smtp_host: connection.smtp.host,
    smtp_port: connection.smtp.port,
    smtp_secure: Number(connection.smtp.secure),
    credential_ciphertext: credentials,
    signature: String(body.signature ?? existing?.signature ?? '').slice(0, 20_000),
    sync_enabled: Number(booleanField(body.syncEnabled, existing ? Boolean(existing.sync_enabled) : true, 'Sync enabled')),
  };
}

function accountTestInput(body, existing, config) {
  return {
    email: existing.email,
    provider: body.provider ?? existing.provider,
    serverHost: body.serverHost,
    imap: {
      host: existing.imap_host,
      port: existing.imap_port,
      secure: Boolean(existing.imap_secure),
      ...(body.imap || {}),
    },
    smtp: {
      host: existing.smtp_host,
      port: existing.smtp_port,
      secure: Boolean(existing.smtp_secure),
      ...(body.smtp || {}),
    },
    credentials: body.credentials ?? decryptJson(existing.credential_ciphertext, config.credentialKey),
  };
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

function draftListItem(draft, account) {
  const id = `draft:${draft.id}`;
  return {
    id,
    threadId: id,
    latestMessageId: id,
    draftId: draft.id,
    isDraft: true,
    accountId: draft.accountId,
    mailbox: 'Drafts',
    folder: 'drafts',
    subject: draft.subject || '(no subject)',
    from: { name: account?.displayName || account?.email || '', email: account?.email || '' },
    to: draft.to || [],
    cc: draft.cc || [],
    bcc: draft.bcc || [],
    participants: draft.to || [],
    htmlBody: draft.htmlBody || '',
    textBody: draft.textBody || '',
    snippet: String(draft.textBody || draft.htmlBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sentAt: draft.updatedAt,
    receivedAt: draft.updatedAt,
    latestAt: draft.updatedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    isSpam: false,
    isSent: false,
    messageCount: 1,
    unreadCount: 0,
    labels: ['Draft'],
    attachments: draft.attachments || [],
  };
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

  router.get('/messages', (request, response) => {
    const accountId = request.query.accountId ? String(request.query.accountId) : null;
    const folder = normalizeFolder(request.query.folder);
    const category = normalizeCategory(request.query.category);
    const page = parseNumber(request.query.page, 1, 1, 100_000);
    const pageSize = parseNumber(request.query.pageSize || request.query.limit, 50, 1, 200);
    const query = String(request.query.q || '').trim().slice(0, 200);
    const accounts = accountId ? [repos.accounts.get(accountId)].filter(Boolean) : repos.accounts.list();
    if (accountId && !accounts.length) throw new NotFoundError('Mail account not found.');
    if (folder === 'drafts') {
      const drafts = accounts.flatMap((account) => repos.drafts.list(account.id)
        .map((draft) => draftListItem(draft, account))
        .filter((draft) => !query || [draft.subject, draft.snippet, draft.from.name, draft.from.email, ...draft.to.map((recipient) => `${recipient.name || ''} ${recipient.email || ''}`)]
          .join(' ').toLowerCase().includes(query.toLowerCase()))
      ).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      const start = (page - 1) * pageSize;
      return response.json({
        messages: category ? [] : drafts.slice(start, start + pageSize),
        total: category ? 0 : drafts.length,
        page,
        pageSize,
        categoryCounts: emptyCategoryCounts(),
        folderCounts: sumFolderCounts(accounts, repos),
      });
    }
    const mailbox = String(request.query.mailbox || 'INBOX');
    const normalizedQuery = query.toLocaleLowerCase();
    const results = accounts.map((account) => repos.messages.list({
      accountId: account.id,
      folder,
      mailbox,
      // Search and smart filters are conversation-level operations. Load the
      // scoped messages first so an older matching message can surface its
      // conversation without borrowing that message's category or summary.
      query: '',
      category: '',
      limit: 1000,
      offset: 0,
    }));
    const byThread = new Map();
    for (const message of results.flatMap((result) => result.items)) {
      const key = `${message.accountId}:${message.threadId}`;
      const existing = byThread.get(key);
      const messageTime = String(message.sentAt || message.receivedAt || message.createdAt);
      const existingTime = String(existing?.latest?.sentAt || existing?.latest?.receivedAt || existing?.latest?.createdAt || '');
      if (!existing) {
        byThread.set(key, { latest: message, messages: [message] });
      } else {
        existing.messages.push(message);
        if (messageTime > existingTime) existing.latest = message;
      }
    }
    const conversations = [...byThread.values()]
      .filter(({ messages }) => !normalizedQuery || messages.some((message) => [
        message.subject,
        message.from?.name,
        message.from?.email,
        message.snippet,
        ...(message.to || []).flatMap((recipient) => [recipient.name, recipient.email]),
        ...(message.cc || []).flatMap((recipient) => [recipient.name, recipient.email]),
      ].join(' ').toLocaleLowerCase().includes(normalizedQuery)))
      .map(({ latest: latestMessage }) => {
      const thread = repos.threads.get(latestMessage.threadId);
      const latestAt = latestMessage.sentAt || latestMessage.receivedAt || latestMessage.createdAt;
      return {
        ...latestMessage,
        // Gmail's list is made of conversations. The thread id is intentionally
        // the row id so every toolbar action can target all messages in it.
        id: latestMessage.threadId,
        threadId: latestMessage.threadId,
        latestMessageId: latestMessage.id,
        messageCount: thread?.messageCount || 1,
        unreadCount: thread?.unreadCount || 0,
        participants: thread?.participants || [latestMessage.from],
        latestAt,
        snippet: latestMessage.snippet,
        isRead: (thread?.unreadCount || 0) === 0,
        isStarred: thread?.isStarred ?? latestMessage.isStarred,
        ...(folder === 'snoozed' ? { folder: 'snoozed' } : {}),
      };
    }).sort((left, right) =>
      String(right.latestAt || right.sentAt || right.receivedAt || right.createdAt).localeCompare(String(left.latestAt || left.sentAt || left.receivedAt || left.createdAt)));
    const categoryCounts = emptyCategoryCounts();
    for (const conversation of conversations) categoryCounts[conversation.category] += 1;
    const all = category
      ? conversations.filter((conversation) => conversation.category === category)
      : conversations;
    const start = (page - 1) * pageSize;
    response.json({
      messages: all.slice(start, start + pageSize),
      total: all.length,
      page,
      pageSize,
      categoryCounts,
      folderCounts: sumFolderCounts(accounts, repos),
    });
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
