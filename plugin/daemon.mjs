// aMail Omarchy plugin daemon.
//
// One long-lived process per desktop session. It keeps the bar and panel
// fed through ~/.local/state/amail/state.json and fires desktop toasts for
// new mail. New mail reaches it two ways:
//
//   push  — GET /api/events (SSE). Tried first. Reconnects with backoff.
//           A 404 is the only signal that falls back to polling.
//   poll  — slow list polling (at least 60s) for servers without events.
//           POST /api/sync is not on a timer; the server syncs itself
//           unless the user sets syncEnabled=true.
//
// Either way the daemon never holds message bodies; the state file carries
// subjects, senders, snippets, counts and ids only. One REST request is in
// flight at a time. 401/403 stop the loop and surface a re-auth state.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  ApiError, PID_FILE, STATE_DIR, STATE_FILE, compactAccount, compactConversation,
  createApi, ensureDir, loadConfig, loadToken, log, readJson, writeJsonAtomic,
  PLUGIN_VERSION, applyHttpFailure, authFailureMessage, computeBackoffMs,
  decideAfterEventsResponse, isAuthFailure, isTimeoutError, messagesListPath,
  nextRetryDelayMs, pluginUserAgent,
} from './lib.mjs';

const config = loadConfig({ warn: (message) => log('config', message) });
const token = loadToken(config);
const startedAt = new Date().toISOString();
const SEEN_LIMIT = 800;
const SELF = process.env.AMAIL_PLUGIN_ID || 'io.github.nova-centauri.amail';
const userAgent = pluginUserAgent({ version: PLUGIN_VERSION });

let api = null;
let features = [];
let transport = 'starting';
let online = false;
let lastError = '';
let lastEventAt = null;
let lastRefreshAt = null;
let eventSeq = 0;
let refreshing = false;
let refreshQueued = false;
let refreshTimer = null;
let stopping = false;
let authStopped = false;
let sseAbort = null;
let syncInFlight = false;
let health = null;
let messagesEtag = null;
let pollAttempt = 0;

const previous = readJson(STATE_FILE, null);
let seen = new Set(Array.isArray(previous?.seen) ? previous.seen : []);
let firstRun = !previous || !Array.isArray(previous.seen);
let lastPayloadKey = '';

ensureDir(STATE_DIR);
fs.writeFileSync(PID_FILE, `${process.pid}\n`, { mode: 0o600 });

function writeState(extra = {}) {
  const payload = {
    ok: online,
    online,
    transport,
    mode: config.mode,
    url: config.url,
    badge: config.badge,
    pid: process.pid,
    startedAt,
    ts: new Date().toISOString(),
    lastEventAt,
    lastRefreshAt,
    eventSeq,
    features,
    error: lastError,
    userAgent,
    idle: health?.idle ? { enabled: health.idle.enabled, connected: (health.idle.accounts || []).filter((a) => a.state === 'idle').length, total: (health.idle.accounts || []).length } : null,
    ...current,
    ...extra,
    seen: [...seen].slice(-SEEN_LIMIT),
  };
  // Skip the write when only the timestamp moved: every write wakes the QML
  // FileView on every screen.
  const { ts, seen: _seen, ...comparable } = payload;
  const key = JSON.stringify(comparable);
  if (key === lastPayloadKey) return;
  lastPayloadKey = key;
  writeJsonAtomic(STATE_FILE, payload);
  process.stdout.write(`${JSON.stringify({ type: 'state', unread: payload.unread, unanalyzed: payload.unanalyzed, online, transport })}\n`);
}

let current = {
  unread: 0,
  unanalyzed: 0,
  inboxTotal: 0,
  starred: 0,
  drafts: 0,
  accounts: [],
  conversations: [],
};

function toast(conversation) {
  if (!config.toasts) return;
  const who = conversation.from.name || conversation.from.email || 'Unknown sender';
  const summary = `${who}  ·  ${conversation.accountName}`;
  const body = config.toastSnippet && conversation.snippet
    ? `${conversation.subject}\n${conversation.snippet}`
    : conversation.subject;
  const args = [
    '--app-name=aMail',
    // Normal urgency uses the theme's notification color. Critical is the
    // alarm color and is reserved for errors.
    '--urgency=normal',
    '--icon=mail-unread',
    '--category=email.arrived',
    '--hint=string:x-omarchy-plugin:amail',
    `--hint=string:x-amail-thread:${conversation.id}`,
    '--action=default=Open',
    '--',
    summary,
    body,
  ];
  try {
    const child = spawn('notify-send', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('exit', () => {
      if (out.trim() === 'default') {
        spawn('qs', ['-p', '/usr/share/omarchy/shell', 'ipc', 'call', SELF, 'goto', conversation.id], { stdio: 'ignore', detached: true }).unref();
      }
    });
    child.unref();
  } catch (error) {
    log('toast failed', String(error?.message || error));
  }
}

function detectNew(conversations, accountEmails) {
  const fresh = [];
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const conversation of conversations) {
    const key = conversation.latestMessageId || conversation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (firstRun) continue;
    if (conversation.isRead || conversation.isSent) continue;
    if (accountEmails.has(String(conversation.from.email || '').toLowerCase())) continue;
    const when = Date.parse(conversation.latestAt || '') || 0;
    if (when && when < cutoff) continue;
    fresh.push(conversation);
  }
  if (seen.size > SEEN_LIMIT * 2) seen = new Set([...seen].slice(-SEEN_LIMIT));
  firstRun = false;
  return fresh;
}

function enterReauth(status) {
  authStopped = true;
  sseAbort?.abort(new Error('reauth'));
  online = false;
  transport = 'reauth';
  lastError = authFailureMessage(status);
  writeState();
  log('auth', lastError);
}

function pageSizeFor(reason) {
  // Timer / safety polls ask only for what the badge needs. A user refresh
  // or a push event may pull the larger panel snapshot.
  const full = reason === 'signal' || reason === 'hello' || reason === 'startup'
    || String(reason).startsWith('message.') || String(reason).startsWith('account.')
    || String(reason).startsWith('sync.');
  return full ? config.listSize : config.badgePageSize;
}

async function refresh(reason = 'timer') {
  if (!api || authStopped) return;
  if (refreshing) { refreshQueued = true; return; }
  refreshing = true;
  try {
    const needAccounts = current.accounts.length === 0
      || reason === 'startup'
      || String(reason).startsWith('account.');
    let accounts = current.accounts;
    if (needAccounts) {
      const accountsPayload = await api.get('/api/accounts');
      accounts = (accountsPayload.accounts || []).map(compactAccount);
    }
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const accountEmails = new Set(accounts.map((account) => String(account.email).toLowerCase()));
    const result = await api.request('GET', messagesListPath({ pageSize: pageSizeFor(reason) }), {
      ifNoneMatch: messagesEtag,
    });
    if (result.notModified) {
      online = true;
      lastError = '';
      lastRefreshAt = new Date().toISOString();
      pollAttempt = 0;
      writeState();
      return;
    }
    if (result.etag) messagesEtag = result.etag;
    const listPayload = result.data || {};
    const conversations = (listPayload.messages || []).map((conversation) => compactConversation(conversation, accountsById));
    const counts = listPayload.folderCounts || {};
    current = {
      unread: Number(counts.inbox) || 0,
      unanalyzed: Number(counts.unanalyzed) || 0,
      inboxTotal: Number(listPayload.total) || conversations.length,
      starred: Number(counts.starred) || 0,
      drafts: Number(counts.drafts) || 0,
      accounts,
      conversations,
    };
    online = true;
    lastError = '';
    lastRefreshAt = new Date().toISOString();
    pollAttempt = 0;
    const fresh = detectNew(conversations, accountEmails);
    writeState();
    for (const conversation of fresh) toast(conversation);
    if (fresh.length) log('new mail', { reason, count: fresh.length });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (isAuthFailure(status)) {
      enterReauth(status);
      return;
    }
    const decision = applyHttpFailure({ transport, error: lastError }, {
      status,
      retryAfter: error instanceof ApiError ? error.retryAfter : null,
      path: error instanceof ApiError ? error.path : '',
      attempt: pollAttempt,
      timeout: isTimeoutError(error),
    });
    pollAttempt += 1;
    online = false;
    lastError = error instanceof ApiError
      ? (decision.error || String(error.message || error))
      : String(error?.message || error);
    writeState();
    log('refresh failed', lastError);
    if (decision.delayMs) await sleep(decision.delayMs);
  } finally {
    refreshing = false;
    if (refreshQueued && !authStopped) {
      refreshQueued = false;
      scheduleRefresh('queued', 50);
    }
  }
}

// Throttle: a bulk job (mark all read, an agent sweeping a thousand
// messages) produces a firehose of state events. Coalesce them so the daemon
// re-fetches at most about once every 1.5 s while that is going on, and
// immediately again once it goes quiet.
const MIN_REFRESH_GAP_MS = 1_500;
let lastRefreshStartedAt = 0;
function scheduleRefresh(reason, delayMs = 150) {
  if (authStopped) return;
  if (refreshTimer) return;
  const sinceLast = Date.now() - lastRefreshStartedAt;
  const delay = Math.max(delayMs, MIN_REFRESH_GAP_MS - sinceLast);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    lastRefreshStartedAt = Date.now();
    void refresh(reason);
  }, delay);
}

async function probeHealth() {
  if (!api || authStopped) return false;
  try {
    health = await api.get('/api/health', { timeout: 10_000 });
    features = Array.isArray(health.features) ? health.features : [];
    return true;
  } catch (error) {
    if (isAuthFailure(error?.status)) {
      enterReauth(error.status);
      return false;
    }
    online = false;
    lastError = String(error?.message || error);
    writeState();
    return false;
  }
}

function handleEventBlock(block, armHeartbeat) {
  if (!block.trim() || block.startsWith(':')) { armHeartbeat(60_000); return; }
  let type = 'message';
  let id = 0;
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('id:')) id = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  let event = null;
  try { event = data ? JSON.parse(data) : null; } catch { event = null; }
  if (id) eventSeq = id;
  lastEventAt = new Date().toISOString();
  if (type === 'hello') {
    armHeartbeat(Math.max(30_000, (Number(event?.heartbeatMs) || 20_000) * 3));
    if (event?.gap || !lastRefreshAt) scheduleRefresh('hello');
    writeState();
    return;
  }
  armHeartbeat(75_000);
  switch (type) {
    case 'message.new':
    case 'message.state':
    case 'message.sent':
    case 'sync.mailbox':
    case 'account.added':
    case 'account.removed':
    case 'account.updated':
      scheduleRefresh(type, type === 'message.new' ? 60 : 250);
      break;
    default:
      break;
  }
}

async function consumeEventStream(response, armHeartbeat) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      handleEventBlock(block, armHeartbeat);
    }
  }
}

// ---------------------------------------------------------------- push (SSE)
async function runEventStream() {
  let attempt = 0;
  while (!stopping && !authStopped) {
    sseAbort = new AbortController();
    const { signal } = sseAbort;
    let heartbeatTimer = null;
    const armHeartbeat = (ms) => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => sseAbort?.abort(new Error('event stream went quiet')), ms);
    };
    try {
      const headers = { ...api.headers, Accept: 'text/event-stream', 'User-Agent': userAgent };
      if (eventSeq) headers['Last-Event-ID'] = String(eventSeq);
      const response = await fetch(`${api.base}/api/events`, { headers, signal });
      const decision = decideAfterEventsResponse(response.status, {
        retryAfter: response.headers.get('retry-after'),
        attempt,
      });
      if (decision.stopped) {
        await response.body?.cancel?.().catch(() => {});
        enterReauth(response.status);
        return;
      }
      if (decision.fallback === 'events-missing') {
        await response.body?.cancel?.().catch(() => {});
        log('events', decision.error);
        transport = 'poll';
        writeState();
        await pollLoop();
        return;
      }
      if (response.status === 429) {
        await response.body?.cancel?.().catch(() => {});
        const delay = decision.delayMs ?? nextRetryDelayMs({ attempt, status: 429, retryAfter: response.headers.get('retry-after') });
        log('events', `429, retry in ${delay}ms`);
        await sleep(delay);
        attempt += 1;
        continue;
      }
      if (!response.ok || !response.body) {
        throw new ApiError(response.status, `event stream returned ${response.status}`, null, {
          retryAfter: response.headers.get('retry-after'),
          path: '/api/events',
        });
      }
      transport = 'push';
      online = true;
      lastError = '';
      attempt = 0;
      armHeartbeat(60_000);
      writeState();
      await consumeEventStream(response, armHeartbeat);
      throw new Error('event stream ended');
    } catch (error) {
      if (stopping || authStopped) break;
      if (isAuthFailure(error?.status)) {
        enterReauth(error.status);
        return;
      }
      const decision = applyHttpFailure({ transport: 'push' }, {
        status: error instanceof ApiError ? error.status : 0,
        retryAfter: error instanceof ApiError ? error.retryAfter : null,
        path: error instanceof ApiError ? error.path : '/api/events',
        attempt,
        timeout: isTimeoutError(error),
      });
      if (decision.fallback === 'events-missing') {
        log('events', decision.error);
        transport = 'poll';
        writeState();
        await pollLoop();
        return;
      }
      transport = 'reconnecting';
      lastError = String(error?.message || error);
      writeState();
      const delay = decision.delayMs ?? computeBackoffMs(attempt);
      log('event stream dropped', lastError, `retry in ${delay}ms`);
      attempt += 1;
      await sleep(delay);
      scheduleRefresh('reconnect');
    } finally {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    }
  }
}

// ---------------------------------------------------------------- poll
async function nudgeSync() {
  if (!api || authStopped || syncInFlight) return;
  syncInFlight = true;
  try {
    await api.post('/api/sync', {}, { timeout: 10 * 60_000 });
    scheduleRefresh('sync', 50);
  } catch (error) {
    if (isAuthFailure(error?.status)) {
      enterReauth(error.status);
      return;
    }
    log('sync nudge failed', String(error?.message || error));
  } finally {
    syncInFlight = false;
  }
}

async function pollLoop() {
  transport = 'poll';
  writeState();
  let lastSyncAt = 0;
  while (!stopping && !authStopped) {
    const started = Date.now();
    await refresh('poll');
    if (stopping || authStopped) break;
    if (config.syncEnabled && Date.now() - lastSyncAt >= config.syncSeconds * 1000) {
      await nudgeSync();
      lastSyncAt = Date.now();
    }
    const wait = Math.max(0, config.pollSeconds * 1000 - (Date.now() - started));
    await sleep(wait);
  }
}

async function safetyPollLoop() {
  while (!stopping && !authStopped) {
    await sleep(config.safetyPollSeconds * 1000);
    if (stopping || authStopped || transport !== 'push') continue;
    await refresh('safety');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- main
async function main() {
  if (!config.url) {
    lastError = 'Not set up yet — click the aMail icon to begin (or run: amail-plugin connect <url>)';
    transport = 'unconfigured';
    writeState();
    // Stay alive but idle; the widget shows the hint. Re-check occasionally so
    // finishing setup does not require a shell restart.
    setInterval(() => {
      const fresh = loadConfig();
      if (fresh.url) process.exit(75); // EX_TEMPFAIL: the widget restarts us with the new config
    }, 5_000);
    return;
  }
  if (!token) {
    lastError = 'No access token yet — click the aMail icon to finish setup';
    transport = 'unconfigured';
    writeState();
    setInterval(() => { if (loadToken(loadConfig())) process.exit(75); }, 5_000);
    return;
  }
  api = createApi({ url: config.url, token, userAgent, serial: true });

  await probeHealth();
  if (authStopped) return;
  log('connected', {
    url: config.url,
    userAgent,
    pollSeconds: config.pollSeconds,
    syncEnabled: config.syncEnabled,
    syncSeconds: config.syncSeconds,
    badgePageSize: config.badgePageSize,
  });

  // Prefer SSE. Health "features" is advisory only; a 404 is the fallback.
  void safetyPollLoop();
  await runEventStream();
  // Re-auth and other terminal states must keep the process alive so the bar
  // keeps showing the last state instead of the widget restarting us.
  setInterval(() => {}, 60_000);
}

process.on('SIGUSR1', () => scheduleRefresh('signal', 50));
process.on('SIGUSR2', () => {
  if (!config.syncEnabled) {
    log('sync', 'SIGUSR2 ignored: syncEnabled is false');
    scheduleRefresh('signal', 0);
    return;
  }
  void nudgeSync();
  scheduleRefresh('signal', 0);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopping = true;
    sseAbort?.abort(new Error('shutdown'));
    try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  });
}
process.on('uncaughtException', (error) => {
  log('uncaught', String(error?.stack || error));
});
process.on('unhandledRejection', (error) => {
  log('unhandled', String(error?.stack || error));
});

main().catch((error) => {
  log('fatal', String(error?.stack || error));
  process.exit(1);
});
