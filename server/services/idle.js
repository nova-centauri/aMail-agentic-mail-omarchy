import { ImapFlow } from 'imapflow';
import { decryptJson } from './crypto.js';
import { buildImapOptions } from './mail-service.js';

const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const DEBOUNCE_MS = 400;
const DEFAULT_MAX_IDLE_MS = 4 * 60_000;

const cleanupError = (error) => String(error?.message || error || 'Unknown IMAP error').replace(/(?:pass(?:word)?|token)\s*[:=]\s*\S+/ig, '[redacted]').slice(0, 300);

/**
 * Keeps one IMAP connection per enabled account parked in IDLE on INBOX and
 * runs an inbox-only sync the instant the server announces new mail. This is
 * what turns "new mail within five minutes" into "new mail within a second".
 *
 * The watcher never ingests mail itself. It only nudges `mailService`, so the
 * ingest path stays single and well-tested. Concurrent nudges for one account
 * coalesce: while a sync is running, further signals mark it dirty and one
 * more pass runs afterwards.
 */
export function createIdleWatcher({ config, repos, mailService, logger, events, ImapClient = ImapFlow }) {
  const watchers = new Map(); // accountId -> watcher state
  let running = false;
  let reconcileTimer = null;
  let unsubscribe = null;
  const maxIdleMs = Number(config.imapIdleMaxMs) || DEFAULT_MAX_IDLE_MS;

  function status() {
    return {
      enabled: Boolean(config.imapIdle),
      running,
      accounts: [...watchers.values()].map((watcher) => ({
        accountId: watcher.accountId,
        email: watcher.email,
        state: watcher.state,
        since: watcher.since,
        lastSignalAt: watcher.lastSignalAt,
        lastSyncAt: watcher.lastSyncAt,
        lastError: watcher.lastError,
        reconnects: watcher.reconnects,
      })),
    };
  }

  function scheduleSync(watcher, reason) {
    watcher.lastSignalAt = new Date().toISOString();
    if (watcher.debounce) clearTimeout(watcher.debounce);
    watcher.debounce = setTimeout(() => {
      watcher.debounce = null;
      void runSync(watcher, reason);
    }, DEBOUNCE_MS);
  }

  async function runSync(watcher, reason) {
    if (watcher.syncing) {
      watcher.dirty = true;
      return;
    }
    watcher.syncing = true;
    do {
      watcher.dirty = false;
      try {
        const started = Date.now();
        const result = await mailService.syncAccount(watcher.accountId, { inboxOnly: true });
        watcher.lastSyncAt = new Date().toISOString();
        logger.info({ accountId: watcher.accountId, reason, imported: result?.imported || 0, ms: Date.now() - started }, 'IDLE-triggered inbox sync finished');
      } catch (error) {
        watcher.lastError = cleanupError(error);
        logger.warn({ accountId: watcher.accountId, err: watcher.lastError }, 'IDLE-triggered inbox sync failed');
      }
    } while (watcher.dirty && running && watchers.get(watcher.accountId) === watcher);
    watcher.syncing = false;
  }

  async function connect(watcher) {
    if (!running || watchers.get(watcher.accountId) !== watcher) return;
    const account = repos.accounts.getRaw(watcher.accountId);
    if (!account || !account.sync_enabled) return stop(watcher.accountId);
    let credentials;
    try {
      credentials = decryptJson(account.credential_ciphertext, config.credentialKey);
    } catch (error) {
      watcher.state = 'error';
      watcher.lastError = cleanupError(error);
      return;
    }
    watcher.state = 'connecting';
    const client = new ImapClient({
      ...buildImapOptions(account, credentials, config),
      maxIdleTime: maxIdleMs,
      // A watcher must not hold the mail-service connection budget hostage
      // on a slow server; the sync path has its own timeouts.
      socketTimeout: Math.max(config.syncTimeoutMs || 60_000, maxIdleMs + 60_000),
    });
    watcher.client = client;

    client.on('exists', (data) => {
      // `count` is the new EXISTS value; `prevCount` the previous one. Only a
      // growth means new mail; expunges also fire this with a smaller count.
      if (data && Number.isInteger(data.count) && Number.isInteger(data.prevCount) && data.count <= data.prevCount) return;
      scheduleSync(watcher, 'exists');
    });
    client.on('error', (error) => {
      watcher.lastError = cleanupError(error);
    });
    client.on('close', () => {
      if (watcher.client !== client) return;
      watcher.client = null;
      if (!running || watchers.get(watcher.accountId) !== watcher) return;
      watcher.state = 'reconnecting';
      watcher.reconnects += 1;
      const delay = watcher.backoff;
      watcher.backoff = Math.min(MAX_BACKOFF_MS, watcher.backoff * 2);
      watcher.timer = setTimeout(() => void connect(watcher), delay);
      watcher.timer.unref?.();
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      watcher.state = 'idle';
      watcher.since = new Date().toISOString();
      watcher.lastError = null;
      watcher.backoff = MIN_BACKOFF_MS;
      logger.info({ accountId: watcher.accountId, email: watcher.email }, 'IMAP IDLE watcher connected');
      // Catch anything that arrived while this watcher was down.
      scheduleSync(watcher, 'connected');
    } catch (error) {
      watcher.lastError = cleanupError(error);
      watcher.state = 'error';
      logger.warn({ accountId: watcher.accountId, err: watcher.lastError }, 'IMAP IDLE watcher could not connect');
      await client.logout().catch(() => {});
      client.close?.();
      if (watcher.client === client) {
        watcher.client = null;
        const delay = watcher.backoff;
        watcher.backoff = Math.min(MAX_BACKOFF_MS, watcher.backoff * 2);
        watcher.timer = setTimeout(() => void connect(watcher), delay);
        watcher.timer.unref?.();
      }
    }
  }

  function start(accountId) {
    if (watchers.has(accountId)) return;
    const account = repos.accounts.getRaw(accountId);
    if (!account || !account.sync_enabled) return;
    const watcher = {
      accountId,
      email: account.email,
      state: 'starting',
      since: null,
      lastSignalAt: null,
      lastSyncAt: null,
      lastError: null,
      reconnects: 0,
      backoff: MIN_BACKOFF_MS,
      client: null,
      timer: null,
      debounce: null,
      syncing: false,
      dirty: false,
    };
    watchers.set(accountId, watcher);
    void connect(watcher);
  }

  function stop(accountId) {
    const watcher = watchers.get(accountId);
    if (!watcher) return;
    watchers.delete(accountId);
    if (watcher.timer) clearTimeout(watcher.timer);
    if (watcher.debounce) clearTimeout(watcher.debounce);
    const { client } = watcher;
    watcher.client = null;
    if (client) {
      client.logout().catch(() => {}).finally(() => client.close?.());
    }
  }

  /** Match the watcher set to the accounts that exist and have sync enabled. */
  function reconcile() {
    if (!running) return;
    const wanted = new Set(repos.accounts.list().filter((account) => account.syncEnabled).map((account) => account.id));
    for (const accountId of [...watchers.keys()]) if (!wanted.has(accountId)) stop(accountId);
    for (const accountId of wanted) start(accountId);
  }

  function startAll() {
    if (running) return;
    running = true;
    reconcile();
    reconcileTimer = setInterval(reconcile, 60_000);
    reconcileTimer.unref?.();
    if (events?.subscribe) {
      unsubscribe = events.subscribe((event) => {
        if (event.type === 'account.added' || event.type === 'account.removed' || event.type === 'account.updated') {
          // Restart a changed account's watcher so new credentials take effect.
          if (event.accountId) stop(event.accountId);
          reconcile();
        }
      });
    }
  }

  async function stopAll() {
    running = false;
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (unsubscribe) unsubscribe();
    for (const accountId of [...watchers.keys()]) stop(accountId);
  }

  /** Force an inbox-only sync for one or every account (used by API nudges). */
  function nudge(accountId = null) {
    for (const watcher of watchers.values()) {
      if (!accountId || watcher.accountId === accountId) scheduleSync(watcher, 'nudge');
    }
  }

  return { start: startAll, stop: stopAll, reconcile, status, nudge };
}
