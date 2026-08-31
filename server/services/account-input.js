import { decryptJson, encryptJson } from './crypto.js';
import {
  accountConnection,
  DEFAULT_ACCOUNT_COLOR,
  isEmail,
} from '../utils/mail.js';
import { normalizeStoredSignature } from '../utils/signature.js';
import { ValidationError } from '../errors.js';

export const booleanField = (value, fallback, fieldName) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  throw new ValidationError(`${fieldName} must be true or false.`);
};

export function parseAvatar(dataUrl) {
  if (dataUrl === null) return { avatar_blob: null, avatar_mime: null };
  if (typeof dataUrl !== 'string') throw new ValidationError('Avatar must be an image data URL.');
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new ValidationError('Avatar must be a PNG, JPEG, GIF, or WebP data URL.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 1_000_000) throw new ValidationError('Avatar must be smaller than 1 MB.');
  return { avatar_blob: buffer, avatar_mime: match[1].toLowerCase() };
}

export function serializeAccountInput(body, existing, config) {
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
    signature: normalizeStoredSignature(body.signature ?? existing?.signature ?? ''),
    sync_enabled: Number(booleanField(body.syncEnabled, existing ? Boolean(existing.sync_enabled) : true, 'Sync enabled')),
  };
}

export function accountTestInput(body, existing, config) {
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
