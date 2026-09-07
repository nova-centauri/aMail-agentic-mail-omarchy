// aMail Omarchy plugin daemon.
//
// One long-lived process per desktop session. It keeps the bar and panel
// fed through ~/.local/state/amail/state.json and fires desktop toasts for
// new mail. New mail reaches it two ways:
//
//   push  — the aMail server's /api/events SSE stream (servers running this
//           fork, which also park an IMAP IDLE connection per account). New
//           mail lands here about a second after the provider receives it.
//   poll  — for servers without /api/events: list polling every
//           `pollSeconds` plus a POST /api/sync nudge every `syncSeconds`,
//           which is exactly what a focused aMail browser tab does.
//
// Either way the daemon never holds message bodies; the state file carries
// subjects, senders, snippets, counts and ids only.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  ApiError, PID_FILE, STATE_DIR, STATE_FILE, compactAccount, compactConversation,
  createApi, ensureDir, loadConfig, loadToken, log, readJson, writeJsonAtomic,
} from './lib.mjs';

const config = loadConfig();
const token = loadToken(config);
const startedAt = new Date().toISOString();
const SEEN_LIMIT = 800;
const SELF = process.env.AMAIL_PLUGIN_ID || 'io.github.nova-centauri.amail';

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
let sseAbort = null;
let syncInFlight = false;
let health = null;

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

async function refresh(reason = 'timer') {
  if (refreshing) { refreshQueued = true; return; }
  refreshing = true;
  try {
    const [accountsPayload, listPayload] = await Promise.all([
      api.get('/api/accounts'),
      api.get(`/api/messages?folder=inbox&pageSize=${config.listSize}`),
    ]);
    const accounts = (accountsPayload.accounts || []).map(compactAccount);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const accountEmails = new Set(accounts.map((account) => String(account.email).toLowerCase()));
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
    const fresh = detectNew(conversations, accountEmails);
    writeState();
    for (const conversation of fresh) toast(conversation);
    if (fresh.length) log('new mail', { reason, count: fresh.length });
  } catch (error) {
    online = false;
    lastError = error instanceof ApiError && error.status === 401
      ? 'aMail rejected the access token (401). Run: amail-plugin connect <url>'
      : String(error?.message || error);
    writeState();
    log('refresh failed', lastError);
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh('queued', 50);
    }
  }
}

function scheduleRefresh(reason, delayMs = 150) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh(reason);
  }, delayMs);
}

async function probeHealth() {
  try {
    health = await api.get('/api/health', { timeout: 10_000 });
    features = Array.isArray(health.features) ? health.features : [];
    return true;
  } catch (error) {
    online = false;
    lastError = String(error?.message || error);
    writeState();
    return false;
  }
}

// ---------------------------------------------------------------- push (SSE)
async function runEventStream() {
  let backoff = 2_000;
  while (!stopping) {
    sseAbort = new AbortController();
    const { signal } = sseAbort;
    let heartbeatTimer = null;
    const armHeartbeat = (ms) => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => sseAbort?.abort(new Error('event stream went quiet')), ms);
    };
    try {
      const headers = { ...api.headers, Accept: 'text/event-stream' };
      if (eventSeq) headers['Last-Event-ID'] = String(eventSeq);
      const response = await fetch(`${api.base}/api/events`, { headers, signal });
      if (!response.ok || !response.body) throw new ApiError(response.status, `event stream returned ${response.status}`);
      transport = 'push';
      online = true;
      backoff = 2_000;
      armHeartbeat(60_000);
      writeState();
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
      throw new Error('event stream ended');
    } catch (error) {
      if (stopping) break;
      transport = 'reconnecting';
      lastError = String(error?.message || error);
      writeState();
      log('event stream dropped', lastError, `retry in ${backoff}ms`);
      await sleep(backoff);
      backoff = Math.min(60_000, backoff * 2);
      // The gap may have hidden mail; a refresh is cheap.
      scheduleRefresh('reconnect');
    } finally {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    }
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

// ---------------------------------------------------------------- poll
async function nudgeSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    // A full sync over many accounts can take a while; do not let it block
    // the list poll, and never overlap two of them.
    await api.post('/api/sync', {}, { timeout: 10 * 60_000 });
    scheduleRefresh('sync', 50);
  } catch (error) {
    log('sync nudge failed', String(error?.message || error));
  } finally {
    syncInFlight = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- main
async function main() {
  if (!config.url) {
    lastError = 'aMail is not configured. Run: amail-plugin connect <url>';
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
    lastError = 'No access token. Run: amail-plugin connect <url>';
    transport = 'unconfigured';
    writeState();
    setInterval(() => { if (loadToken(loadConfig())) process.exit(75); }, 5_000);
    return;
  }
  api = createApi({ url: config.url, token });

  let healthy = await probeHealth();
  while (!healthy && !stopping) {
    transport = 'offline';
    await sleep(15_000);
    healthy = await probeHealth();
  }
  await refresh('startup');

  const hasEvents = features.includes('events');
  const hasIdle = features.includes('idle') && health?.idle?.enabled !== false;
  log('connected', { url: config.url, transport: hasEvents ? 'push' : 'poll', idle: hasIdle, accounts: current.accounts.length });

  if (hasEvents) {
    void runEventStream();
    // Even with push, a periodic list refresh guards against a missed event.
    setInterval(() => scheduleRefresh('safety'), Math.max(30, config.safetyPollSeconds) * 1000).unref();
    if (!hasIdle) {
      setInterval(() => void nudgeSync(), Math.max(20, config.syncSeconds) * 1000).unref();
    }
  } else {
    transport = 'poll';
    writeState();
    setInterval(() => scheduleRefresh('poll'), Math.max(3, config.pollSeconds) * 1000).unref();
    setInterval(() => void nudgeSync(), Math.max(20, config.syncSeconds) * 1000).unref();
    setInterval(() => void probeHealth(), 5 * 60_000).unref();
  }
  // Keep the event loop alive regardless of the branch above.
  setInterval(() => {}, 60_000);
}

process.on('SIGUSR1', () => scheduleRefresh('signal', 0));
process.on('SIGUSR2', () => { void nudgeSync(); scheduleRefresh('signal', 0); });
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
