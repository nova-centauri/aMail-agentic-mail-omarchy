import crypto from 'node:crypto';
import path from 'node:path';

const boolean = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const integer = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

function deriveKey(value) {
  if (!value) return null;

  // Accepting a passphrase rather than exposing a base64-only requirement makes
  // deployment secrets easier to manage. SHA-256 gives AES-256 a stable 32-byte key.
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.GIGAMAIL_DATA_DIR || path.join(process.cwd(), 'data'));
  const credentialKey = deriveKey(env.GIGAMAIL_ENCRYPTION_KEY);
  const remoteTokenKey = deriveKey(env.GIGAMAIL_REMOTE_TOKEN_KEY || env.GIGAMAIL_ENCRYPTION_KEY);

  return Object.freeze({
    env: env.NODE_ENV || 'development',
    // A local default makes a fresh install safe. The container explicitly sets
    // HOST=0.0.0.0 while Compose binds the published port to loopback.
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 3000, { min: 1, max: 65535 }),
    dataDir,
    dbPath: path.join(dataDir, 'gigamail.sqlite'),
    staticDir: path.resolve(env.GIGAMAIL_STATIC_DIR || path.join(process.cwd(), 'dist')),
    releaseSha: /^[0-9a-f]{40}$/i.test(String(env.GIGAMAIL_RELEASE_SHA || ''))
      ? String(env.GIGAMAIL_RELEASE_SHA).toLowerCase()
      : null,
    credentialKey,
    remoteTokenKey,
    accessToken: env.GIGAMAIL_ACCESS_TOKEN || null,
    // This intentionally stays false unless a reverse proxy has been selected by
    // the operator. Trusting arbitrary forwarded headers is unsafe by default.
    trustProxy: boolean(env.GIGAMAIL_TRUST_PROXY),
    allowInsecureTls: boolean(env.GIGAMAIL_ALLOW_INSECURE_TLS),
    syncBatchSize: integer(env.GIGAMAIL_SYNC_BATCH_SIZE, 200, { min: 1, max: 1000 }),
    syncTimeoutMs: integer(env.GIGAMAIL_SYNC_TIMEOUT_MS, 60_000, { min: 5_000, max: 300_000 }),
    // The raw RFC822 source includes attachments. Keep each parse bounded so a
    // single unexpectedly large message cannot consume unrestricted memory.
    syncMaxMessageBytes: integer(env.GIGAMAIL_SYNC_MAX_MESSAGE_BYTES, 10 * 1024 * 1024, {
      min: 64 * 1024,
      max: 50 * 1024 * 1024,
    }),
    // 0 disables background polling. Sync calls open short-lived connections;
    // GigaMail intentionally does not maintain an IDLE socket per account.
    syncIntervalMinutes: integer(env.SYNC_INTERVAL_MINUTES, 0, { min: 0, max: 1440 }),
    remoteContentMaxBytes: integer(env.GIGAMAIL_REMOTE_CONTENT_MAX_BYTES, 5 * 1024 * 1024, {
      min: 16 * 1024,
      max: 25 * 1024 * 1024,
    }),
    remoteContentTimeoutMs: integer(env.GIGAMAIL_REMOTE_CONTENT_TIMEOUT_MS, 12_000, {
      min: 1_000,
      max: 60_000,
    }),
    // Capability URLs can be used by an unauthenticated <img> request, so keep
    // them deliberately short-lived. Reading a message reissues fresh tokens.
    remoteContentTokenTtlSeconds: integer(env.GIGAMAIL_REMOTE_CONTENT_TOKEN_TTL, 5 * 60, {
      min: 30,
      max: 60 * 60,
    }),
    // REMOTE_CONTENT_PROXY_URL is deliberately not read from the conventional
    // HTTP_PROXY variables: only privacy image requests should use Tor/Privoxy.
    remoteContentProxyUrl: env.REMOTE_CONTENT_PROXY_URL || env.GIGAMAIL_REMOTE_CONTENT_PROXY_URL || null,
    // Direct fetches reveal the server IP. They are intentionally available only
    // as an explicit non-production development escape hatch.
    allowDirectRemoteContent: (env.NODE_ENV || 'development') !== 'production'
      && boolean(env.GIGAMAIL_ALLOW_DIRECT_REMOTE_CONTENT),
    logLevel: env.LOG_LEVEL || 'info',
    webauthnRpName: env.GIGAMAIL_RP_NAME || 'GigaMail',
    webauthnRpId: String(env.GIGAMAIL_RP_ID || '').trim(),
    webauthnOrigins: String(env.GIGAMAIL_ORIGIN || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  });
}
