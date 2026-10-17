// Shared helpers for the Omarchy plugin runtime (daemon + one-shot CLI).
// Dependency-free on purpose: runs under `node` or `bun` straight from the
// plugin checkout, no install step needed for client mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMailDeepLink, parseMailDeepLink, parseMailto, stripMailDeepLink } from '../src/mail/deep-link.js';

export const HOME = os.homedir();
export const CONFIG_DIR = process.env.AMAIL_PLUGIN_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'amail');
export const STATE_DIR = process.env.AMAIL_PLUGIN_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(HOME, '.local', 'state'), 'amail');
export const DATA_DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'amail');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'plugin.json');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
export const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
export const LOG_FILE = path.join(STATE_DIR, 'daemon.log');

export const POLL_SECONDS_FLOOR = 60;
export const SYNC_SECONDS_FLOOR = 300;
export const SAFETY_POLL_SECONDS_FLOOR = 60;
export const BADGE_PAGE_SIZE = 5;
export const BADGE_PAGE_SIZE_MAX = 20;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'client',            // "client" (remote aMail) or "server" (local aMail managed by the plugin)
  url: '',                   // base URL of the aMail instance, e.g. https://mail.example.com
  tokenFile: TOKEN_FILE,     // 0600 file holding AMAIL_ACCESS_TOKEN
  badge: 'both',             // bar badge: "both" (unread + not yet analyzed) | "unread" | "unanalyzed"
  toasts: true,              // desktop notification for new unread mail
  toastSnippet: false,       // include a body snippet in the toast (lands in notification history)
  listSize: 20,              // conversations kept after a user refresh or a push event
  badgePageSize: BADGE_PAGE_SIZE, // conversations fetched on the timer / badge poll
  pollSeconds: POLL_SECONDS_FLOOR, // list poll cadence when the server has no event stream
  syncSeconds: SYNC_SECONDS_FLOOR, // POST /api/sync cadence; unused unless syncEnabled
  syncEnabled: false,        // timer POST /api/sync; off because the server syncs itself
  safetyPollSeconds: 300,    // list refresh cadence even while the event stream is healthy
  markReadOnOpen: true,      // opening a conversation in the panel marks it read
  agentName: 'omarchy',      // recorded as analyzedBy when you mark from the panel
});

export function readPluginVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    return String(manifest.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export const PLUGIN_VERSION = readPluginVersion();

export function pluginUserAgent({ version = PLUGIN_VERSION, hostname = os.hostname() } = {}) {
  const safeVersion = String(version || '0.0.0').replace(/[\r\n]/g, '');
  const safeHost = String(hostname || 'unknown').replace(/[\r\n]/g, '');
  return `amail-omarchy/${safeVersion} (${safeHost})`;
}

export function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function applyConfigFloors(config, { configured = {}, warn } = {}) {
  const next = { ...config };
  const floors = {
    pollSeconds: POLL_SECONDS_FLOOR,
    syncSeconds: SYNC_SECONDS_FLOOR,
    safetyPollSeconds: SAFETY_POLL_SECONDS_FLOOR,
  };
  for (const [key, floor] of Object.entries(floors)) {
    const value = Number(next[key]);
    const userSet = Object.hasOwn(configured, key);
    const source = userSet ? Number(configured[key]) : value;
    if (!Number.isFinite(value) || value < floor) {
      if (userSet && Number.isFinite(source) && source < floor) {
        const message = `${key}=${source} is below the ${floor}s floor; clamping to ${floor}s`;
        warn?.(message);
      }
      next[key] = floor;
    } else {
      next[key] = Math.trunc(value);
    }
  }
  next.listSize = clampInt(next.listSize, DEFAULT_CONFIG.listSize, 1, 200);
  next.badgePageSize = clampInt(next.badgePageSize, BADGE_PAGE_SIZE, 1, BADGE_PAGE_SIZE_MAX);
  const flag = String(next.syncEnabled).toLowerCase();
  next.syncEnabled = next.syncEnabled === true || next.syncEnabled === 1 || ['true', '1', 'yes', 'on'].includes(flag);
  return next;
}

export function computeBackoffMs(attempt, {
  baseMs = BACKOFF_BASE_MS,
  maxMs = BACKOFF_MAX_MS,
  random = Math.random,
} = {}) {
  const step = Math.max(0, Number(attempt) || 0);
  const cap = Math.min(maxMs, baseMs * (2 ** step));
  // Equal jitter: never below half the exponential cap, never above it.
  return Math.round(cap * (0.5 + random() * 0.5));
}

export function retryAfterMs(retryAfter, now = Date.now()) {
  if (retryAfter == null || retryAfter === '') return null;
  const text = String(retryAfter).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text) * 1000));
  const when = Date.parse(text);
  if (Number.isFinite(when)) return Math.max(0, when - now);
  return null;
}

export function nextRetryDelayMs({
  attempt = 0,
  status = 0,
  retryAfter = null,
  now = Date.now(),
  random = Math.random,
  baseMs = BACKOFF_BASE_MS,
  maxMs = BACKOFF_MAX_MS,
} = {}) {
  if (Number(status) === 429) {
    const hinted = retryAfterMs(retryAfter, now);
    if (hinted != null) return hinted;
  }
  return computeBackoffMs(attempt, { baseMs, maxMs, random });
}

export function isAuthFailure(status) {
  return Number(status) === 401 || Number(status) === 403;
}

export function authFailureMessage(status) {
  return `aMail rejected the access token (${Number(status) || 'auth'}). Re-authenticate: amail-plugin connect <url>`;
}

export function isTimeoutError(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out/i.test(message);
}

/**
 * Decide what the daemon should do after an HTTP failure.
 * 401/403 stop the loop. A 404 on /api/events is a permanent poll fallback.
 * 429 honours Retry-After. Everything else (including timeouts) backs off.
 */
export function applyHttpFailure(state, {
  status = 0,
  retryAfter = null,
  path = '',
  attempt = 0,
  timeout = false,
  now = Date.now(),
  random = Math.random,
} = {}) {
  if (isAuthFailure(status)) {
    return {
      ...state,
      transport: 'reauth',
      stopped: true,
      fallback: null,
      delayMs: null,
      error: authFailureMessage(status),
    };
  }
  if (String(path).startsWith('/api/events') && Number(status) === 404) {
    return {
      ...state,
      transport: 'poll',
      stopped: false,
      fallback: 'events-missing',
      delayMs: null,
      error: 'GET /api/events is not available; falling back to slow polling',
    };
  }
  const delayMs = nextRetryDelayMs({ attempt, status, retryAfter, now, random });
  return {
    ...state,
    transport: state.transport === 'push' ? 'reconnecting' : (state.transport || 'offline'),
    stopped: false,
    fallback: null,
    delayMs,
    error: timeout ? 'request timed out' : (state.error || `HTTP ${status || 'error'}`),
  };
}

export function decideAfterEventsResponse(status, extras = {}) {
  if (Number(status) >= 200 && Number(status) < 300) {
    return { transport: 'push', stopped: false, fallback: null, delayMs: null, error: '' };
  }
  return applyHttpFailure({ transport: 'starting' }, { ...extras, status, path: '/api/events' });
}

export function messagesListPath({ folder = 'inbox', pageSize = BADGE_PAGE_SIZE } = {}) {
  const size = clampInt(pageSize, BADGE_PAGE_SIZE, 1, 200);
  return `/api/messages?folder=${encodeURIComponent(folder)}&pageSize=${size}`;
}

export function createRequestGate() {
  let pending = Promise.resolve();
  let busy = false;
  return {
    get busy() { return busy; },
    run(fn) {
      const task = pending.then(async () => {
        busy = true;
        try {
          return await fn();
        } finally {
          busy = false;
        }
      });
      pending = task.then(() => {}, () => {});
      return task;
    },
  };
}

export function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, value, mode = 0o600) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode });
  fs.renameSync(tmp, file);
}

export function expandHome(value) {
  const text = String(value || '');
  return text.startsWith('~/') ? path.join(HOME, text.slice(2)) : text;
}

export function loadConfig({ warn } = {}) {
  const raw = readJson(CONFIG_FILE, {}) || {};
  const config = { ...DEFAULT_CONFIG, ...raw };
  config.url = String(config.url || '').replace(/\/+$/, '');
  config.tokenFile = expandHome(config.tokenFile || TOKEN_FILE);
  return applyConfigFloors(config, { configured: raw, warn });
}

export function saveConfig(config) {
  ensureDir(CONFIG_DIR);
  writeJsonAtomic(CONFIG_FILE, config, 0o600);
}

export function loadToken(config = loadConfig()) {
  if (process.env.AMAIL_ACCESS_TOKEN) return process.env.AMAIL_ACCESS_TOKEN.trim();
  if (config.token) return String(config.token).trim();
  try {
    return fs.readFileSync(config.tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

export function saveToken(token) {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(TOKEN_FILE, `${String(token).trim()}\n`, { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
}

export class ApiError extends Error {
  constructor(status, message, code = null, { retryAfter = null, path = null, headers = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.path = path;
    this.headers = headers;
  }
}

/** Minimal aMail REST client over global fetch. */
export function createApi({
  url,
  token,
  timeoutMs = 15_000,
  userAgent = pluginUserAgent(),
  serial = true,
} = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base) throw new Error('aMail URL is not configured. Run: amail-plugin connect <url>');
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  if (token) headers.Authorization = `Bearer ${token}`;
  const gate = createRequestGate();

  async function request(method, pathname, { body, timeout = timeoutMs, signal, headers: extra, ifNoneMatch } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`aMail request timed out after ${timeout}ms`)), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    const reqHeaders = { ...headers, ...extra };
    if (ifNoneMatch) reqHeaders['If-None-Match'] = ifNoneMatch;
    if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
    try {
      let response;
      try {
        response = await fetch(`${base}${pathname}`, {
          method,
          headers: reqHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (isTimeoutError(error) || /timed out/i.test(String(error?.cause?.message || ''))) {
          throw new Error(`aMail request timed out after ${timeout}ms`);
        }
        // undici's "fetch failed" hides the useful part in `cause`.
        const cause = error?.cause;
        const detail = cause?.code || cause?.message || error?.message || String(error);
        throw new Error(`Could not reach ${base}: ${detail}`);
      }
      const etag = response.headers.get('etag');
      const retryAfter = response.headers.get('retry-after');
      if (response.status === 304) {
        return { status: 304, notModified: true, etag, data: null, retryAfter, headers: response.headers };
      }
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!response.ok) {
        throw new ApiError(
          response.status,
          data?.error?.message || `${method} ${pathname} failed with ${response.status}`,
          data?.error?.code || null,
          { retryAfter, path: pathname, headers: response.headers },
        );
      }
      return { status: response.status, notModified: false, etag, data, retryAfter, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  }

  const send = (method, pathname, options) => (
    serial ? gate.run(() => request(method, pathname, options)) : request(method, pathname, options)
  );

  return {
    base,
    headers,
    gate,
    request: send,
    get: async (pathname, options) => {
      const result = await send('GET', pathname, options);
      return result.notModified ? result : result.data;
    },
    post: async (pathname, body, options) => (await send('POST', pathname, { ...options, body: body ?? {} })).data,
    put: async (pathname, body, options) => (await send('PUT', pathname, { ...options, body })).data,
    delete: async (pathname, options) => (await send('DELETE', pathname, options)).data,
  };
}

/** Compact conversation record: everything the bar and panel render, nothing more. */
export function compactConversation(conversation, accountsById) {
  const account = accountsById.get(conversation.accountId) || {};
  return {
    id: conversation.id,
    threadId: conversation.threadId,
    latestMessageId: conversation.latestMessageId,
    accountId: conversation.accountId,
    accountEmail: account.email || '',
    accountName: account.displayName || account.email || '',
    accountColor: account.color || '#5b8def',
    from: { name: conversation.from?.name || '', email: conversation.from?.email || '' },
    subject: conversation.subject || '(no subject)',
    snippet: String(conversation.snippet || '').slice(0, 160),
    latestAt: conversation.latestAt || conversation.receivedAt || conversation.sentAt || '',
    isRead: Boolean(conversation.isRead),
    unreadCount: Number(conversation.unreadCount) || 0,
    isAnalyzed: Boolean(conversation.isAnalyzed),
    unanalyzedCount: Number(conversation.unanalyzedCount) || 0,
    isStarred: Boolean(conversation.isStarred),
    isSent: Boolean(conversation.isSent),
    hasAttachments: Boolean(conversation.hasAttachments),
    messageCount: Number(conversation.messageCount) || 1,
    category: conversation.category || 'primary',
    categoryLabel: conversation.categoryLabel || '',
  };
}

export function compactAccount(account) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName || account.email,
    color: account.color || '#5b8def',
    provider: account.provider || '',
    syncEnabled: account.syncEnabled !== false,
    lastSyncedAt: account.lastSyncedAt || null,
  };
}

export function readDaemonPid() {
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Ask a running daemon to refresh right now (no-op when it is not running). */
export function pokeDaemon() {
  try {
    const pid = readDaemonPid();
    if (pid) process.kill(pid, 'SIGUSR1');
    return Boolean(pid);
  } catch {
    return false;
  }
}

export function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}\n`;
  process.stderr.write(line);
}

export { buildMailDeepLink, parseMailDeepLink, parseMailto, stripMailDeepLink };

/** Turn a plugin "open" argument into the web-client URL and whether to focus an existing window. */
export function resolveOpenTarget(config, target = '') {
  const base = String(config?.url || '').replace(/\/+$/, '');
  if (!base) {
    return { ok: false, error: 'aMail is not configured. Run: amail-plugin connect <url>' };
  }
  const raw = String(target || '').trim();
  if (/^mailto:/i.test(raw)) {
    const intent = parseMailto(raw) || { compose: true };
    return { ok: true, url: buildMailDeepLink(base, intent), focus: false, intent };
  }
  if (/^https?:\/\//i.test(raw)) {
    const intent = parseMailDeepLink(raw);
    const needsNew = Boolean(intent && (intent.compose || intent.thread || intent.reply || intent.forward));
    return { ok: true, url: raw, focus: !needsNew, intent };
  }
  if (raw.startsWith('?') || raw.startsWith('/')) {
    const url = `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
    const intent = parseMailDeepLink(url);
    const needsNew = Boolean(intent && (intent.compose || intent.thread || intent.reply || intent.forward));
    return { ok: true, url, focus: !needsNew, intent };
  }
  if (raw) {
    const intent = { thread: raw };
    return { ok: true, url: buildMailDeepLink(base, intent), focus: false, intent };
  }
  return { ok: true, url: base, focus: true, intent: null };
}

export function recipientsFrom(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        return { name: String(item.name || ''), email: String(item.email || item.address || '').trim() };
      }
      return { name: '', email: String(item || '').trim() };
    }).filter((item) => item.email);
  }
  return String(value || '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((email) => ({ name: '', email }));
}
