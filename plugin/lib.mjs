// Shared helpers for the Omarchy plugin runtime (daemon + one-shot CLI).
// Dependency-free on purpose: runs under `node` or `bun` straight from the
// plugin checkout, no install step needed for client mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const CONFIG_DIR = process.env.AMAIL_PLUGIN_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'amail');
export const STATE_DIR = process.env.AMAIL_PLUGIN_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(HOME, '.local', 'state'), 'amail');
export const DATA_DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'amail');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'plugin.json');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
export const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
export const LOG_FILE = path.join(STATE_DIR, 'daemon.log');

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'client',            // "client" (remote aMail) or "server" (local aMail managed by the plugin)
  url: '',                   // base URL of the aMail instance, e.g. https://mail.example.com
  tokenFile: TOKEN_FILE,     // 0600 file holding AMAIL_ACCESS_TOKEN
  badge: 'both',             // bar badge: "both" (unread + not yet analyzed) | "unread" | "unanalyzed"
  toasts: true,              // desktop notification for new unread mail
  toastSnippet: false,       // include a body snippet in the toast (lands in notification history)
  listSize: 60,              // conversations kept in the panel
  pollSeconds: 10,           // list poll cadence when the server has no event stream
  syncSeconds: 45,           // POST /api/sync cadence when the server has no IMAP IDLE
  safetyPollSeconds: 120,    // list refresh cadence even while the event stream is healthy
  markReadOnOpen: true,      // opening a conversation in the panel marks it read
  agentName: 'omarchy',      // recorded as analyzedBy when you mark from the panel
});

export const MODES = Object.freeze(['client', 'server']);
export const BADGES = Object.freeze(['both', 'unread', 'unanalyzed']);

// Bounds for the numeric settings. Anything outside (or not a number at all,
// e.g. a hand-edited plugin.json) snaps back to the default so a bad value
// can never turn the poll loop into a hammer or leak into a query string.
export const NUMERIC_LIMITS = Object.freeze({
  listSize: { min: 1, max: 500 },
  pollSeconds: { min: 3, max: 3600 },
  syncSeconds: { min: 20, max: 86_400 },
  safetyPollSeconds: { min: 30, max: 86_400 },
});

// Largest response body the plugin will read from the server (the inbox list
// at listSize=500 is well under 1 MiB). Anything bigger is treated as an error
// rather than buffered into the desktop session.
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Identifiers that travel from the server into command lines, IPC calls, URL
// paths and notification hints. aMail ids are UUIDs / Message-ID-derived
// tokens; anything outside this alphabet is refused rather than forwarded.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+=-]{0,254}$/;
export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}
export function assertSafeId(value, what = 'id') {
  if (!isSafeId(value)) throw new Error(`Refusing ${what} with unexpected characters`);
  return value;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const DEFAULT_COLOR = '#5b8def';
export function safeColor(value, fallback = DEFAULT_COLOR) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function clampInt(value, { min, max }, fallback) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function parseBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/** Coerce one setting to its declared type and range; returns undefined when it cannot be accepted. */
export function coerceSetting(key, value) {
  if (!Object.hasOwn(DEFAULT_CONFIG, key)) return undefined;
  const fallback = DEFAULT_CONFIG[key];
  switch (key) {
    case 'mode': return MODES.includes(value) ? value : undefined;
    case 'badge': return BADGES.includes(value) ? value : undefined;
    case 'url': {
      const url = normalizeUrl(value);
      return url === '' || isHttpUrl(url) ? url : undefined;
    }
    case 'tokenFile': return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    case 'agentName': {
      const name = String(value ?? '').trim().slice(0, 64);
      return /^[A-Za-z0-9 ._-]+$/.test(name) ? name : undefined;
    }
    default:
      if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : parseBool(value);
      if (typeof fallback === 'number') {
        const limits = NUMERIC_LIMITS[key] || { min: 0, max: Number.MAX_SAFE_INTEGER };
        const n = clampInt(value, limits, NaN);
        return Number.isNaN(n) ? undefined : n;
      }
      return String(value);
  }
}

/** Apply the declared types and bounds to a raw config object; unknown keys are dropped. */
export function sanitizeConfig(raw) {
  const config = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== 'object') return config;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!(key in raw)) continue;
    const value = coerceSetting(key, raw[key]);
    if (value !== undefined) config[key] = value;
  }
  // A token inline in plugin.json is accepted for compatibility but never written back.
  if (typeof raw.token === 'string' && raw.token.trim() !== '') config.token = raw.token.trim();
  return config;
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

export function loadConfig() {
  const config = sanitizeConfig(readJson(CONFIG_FILE, {}));
  config.tokenFile = expandHome(config.tokenFile || TOKEN_FILE);
  return config;
}

export function saveConfig(config) {
  ensureDir(CONFIG_DIR);
  writeJsonAtomic(CONFIG_FILE, sanitizeConfig(config), 0o600);
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
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Read a response body, refusing anything over `limit` bytes. */
export async function readBodyCapped(response, limit = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`aMail response too large (${declared} bytes)`);
  }
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`aMail response too large (over ${limit} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Minimal aMail REST client over global fetch. */
export function createApi({ url, token, timeoutMs = 15_000 }) {
  const base = normalizeUrl(url);
  if (!base) throw new Error('aMail URL is not configured. Run: amail-plugin connect <url>');
  if (!isHttpUrl(base)) throw new Error('aMail URL must start with http:// or https://');
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(method, pathname, { body, timeout = timeoutMs, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`aMail request timed out after ${timeout}ms`)), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    try {
      let response;
      try {
        response = await fetch(`${base}${pathname}`, {
          method,
          headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          // Never follow a redirect: the bearer token goes to the configured
          // origin and nowhere else. The user is told what to configure instead.
          redirect: 'manual',
        });
      } catch (error) {
        // undici's "fetch failed" hides the useful part in `cause`.
        const cause = error?.cause;
        const detail = cause?.code || cause?.message || error?.message || String(error);
        throw new Error(`Could not reach ${base}: ${detail}`);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || '(no Location header)';
        throw new ApiError(response.status, `${base} redirects to ${location}; connect to that URL instead`);
      }
      const text = await readBodyCapped(response);
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!response.ok) {
        throw new ApiError(response.status, data?.error?.message || `${method} ${pathname} failed with ${response.status}`, data?.error?.code || null);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    base,
    headers,
    get: (pathname, options) => request('GET', pathname, options),
    post: (pathname, body, options) => request('POST', pathname, { ...options, body: body ?? {} }),
    put: (pathname, body, options) => request('PUT', pathname, { ...options, body }),
    delete: (pathname, options) => request('DELETE', pathname, options),
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
    accountColor: safeColor(account.color),
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
    color: safeColor(account.color),
    provider: account.provider || '',
    syncEnabled: account.syncEnabled !== false,
    lastSyncedAt: account.lastSyncedAt || null,
  };
}

export function readDaemonPid() {
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/**
 * True only when `pid` is alive and is actually our daemon. A stale pid file
 * after a crash or reboot may point at an unrelated process that has since
 * reused the number; signalling that would at best kill someone's editor.
 */
export function isDaemonPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    const stat = fs.statSync(`/proc/${pid}`);
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return false;
    return cmdline.some((arg) => arg.endsWith(`${path.sep}daemon.mjs`) || arg === 'daemon.mjs');
  } catch {
    return false;
  }
}

/** Send a signal to the daemon, but only after verifying the pid really is the daemon. */
export function signalDaemon(signal) {
  try {
    const pid = readDaemonPid();
    if (!pid || !isDaemonPid(pid)) return false;
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Ask a running daemon to refresh right now (no-op when it is not running). */
export function pokeDaemon() {
  return signalDaemon('SIGUSR1');
}

export function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}\n`;
  process.stderr.write(line);
}
