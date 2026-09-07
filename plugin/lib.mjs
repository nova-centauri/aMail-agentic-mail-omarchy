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
  badge: 'unread',           // bar badge: "unread" | "unanalyzed" | "both"
  toasts: true,              // desktop notification for new unread mail
  toastSnippet: false,       // include a body snippet in the toast (lands in notification history)
  listSize: 60,              // conversations kept in the panel
  pollSeconds: 10,           // list poll cadence when the server has no event stream
  syncSeconds: 45,           // POST /api/sync cadence when the server has no IMAP IDLE
  safetyPollSeconds: 120,    // list refresh cadence even while the event stream is healthy
  markReadOnOpen: true,      // opening a conversation in the panel marks it read
  agentName: 'omarchy',      // recorded as analyzedBy when you mark from the panel
});

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
  const raw = readJson(CONFIG_FILE, {}) || {};
  const config = { ...DEFAULT_CONFIG, ...raw };
  config.url = String(config.url || '').replace(/\/+$/, '');
  config.tokenFile = expandHome(config.tokenFile || TOKEN_FILE);
  return config;
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
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Minimal aMail REST client over global fetch. */
export function createApi({ url, token, timeoutMs = 15_000 }) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base) throw new Error('aMail URL is not configured. Run: amail-plugin connect <url>');
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(method, pathname, { body, timeout = timeoutMs, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`aMail request timed out after ${timeout}ms`)), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    try {
      const response = await fetch(`${base}${pathname}`, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
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
