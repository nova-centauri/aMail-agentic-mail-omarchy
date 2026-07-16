import { ValidationError } from '../errors.js';

const PROVIDERS = {
  gmail: {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  },
  outlook: {
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
  },
  yahoo: {
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  },
  icloud: {
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
  },
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_ACCOUNT_COLOR = '#1a73e8';

export function isEmail(value) {
  return typeof value === 'string' && emailPattern.test(value.trim());
}

export function normalizeSubject(value) {
  let subject = String(value || '').trim();
  // Collapse common repeated reply/forward prefixes but leave the actual subject
  // intact. This is only a fallback; RFC Message-ID references take precedence.
  while (/^(?:(?:re|fw|fwd|aw|sv|antw)\s*:\s*)/i.test(subject)) {
    subject = subject.replace(/^(?:(?:re|fw|fwd|aw|sv|antw)\s*:\s*)/i, '').trim();
  }
  return subject.toLocaleLowerCase();
}

export function normalizeMessageIds(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeMessageIds);
  if (!value) return [];
  const matches = String(value).match(/<[^>]+>/g);
  return matches ? matches.map((item) => item.trim()) : [String(value).trim()].filter(Boolean);
}

export function addressList(value) {
  const list = Array.isArray(value) ? value : value?.value || [];
  return list
    .map((item) => ({ name: String(item?.name || ''), email: String(item?.address || item?.email || '').trim() }))
    .filter((item) => isEmail(item.email));
}

export function recipientList(value, fieldName = 'recipient') {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const recipients = values.map((item) => {
    if (typeof item === 'object' && item) {
      return { name: String(item.name || ''), email: String(item.email || item.address || '').trim() };
    }
    const raw = String(item).trim();
    const match = raw.match(/^(?:"?([^<"]+)"?\s*)?<([^>]+)>$/);
    return match ? { name: match[1]?.trim() || '', email: match[2].trim() } : { name: '', email: raw };
  }).filter((item) => item.email);
  if (recipients.some((item) => !isEmail(item.email))) {
    throw new ValidationError(`A ${fieldName} address is invalid.`);
  }
  return recipients;
}

export function recipientsToHeader(recipients) {
  return recipients.map(({ name, email }) => name ? `"${name.replaceAll('"', '')}" <${email}>` : email).join(', ');
}

export function accountConnection(input) {
  const provider = String(input.provider || 'custom').toLowerCase();
  const defaults = PROVIDERS[provider] || {};
  const imap = { ...defaults.imap, ...(input.imap || {}) };
  const smtp = { ...defaults.smtp, ...(input.smtp || {}) };
  const positivePort = (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 65535;
  if (!imap.host || !positivePort(imap.port) || !smtp.host || !positivePort(smtp.port)) {
    throw new ValidationError('A valid IMAP and SMTP host and port are required.');
  }
  return {
    provider: PROVIDERS[provider] ? provider : 'custom',
    imap: { host: String(imap.host).trim(), port: Number(imap.port), secure: Boolean(imap.secure) },
    smtp: { host: String(smtp.host).trim(), port: Number(smtp.port), secure: Boolean(smtp.secure) },
  };
}

export function buildAuth(credentials, fallbackEmail) {
  const user = String(credentials?.username || credentials?.user || fallbackEmail || '').trim();
  if (!isEmail(user)) throw new ValidationError('Account credentials need a valid username/email.');
  if (credentials?.accessToken) {
    return { type: 'OAuth2', user, accessToken: String(credentials.accessToken) };
  }
  if (!credentials?.password || typeof credentials.password !== 'string') {
    throw new ValidationError('Account credentials need an app password or OAuth access token.');
  }
  return { user, pass: credentials.password };
}

export function appendSignature({ html = '', text = '', signature = '', includeSignature = true }) {
  if (!includeSignature || !signature.trim()) return { html, text };
  const safeSignature = signature.trim();
  const signatureHtml = safeSignature
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  return {
    html: `${html || ''}<br><br><div data-gigamail-signature="true">-- <br>${signatureHtml}</div>`,
    text: `${text || ''}${text ? '\n\n' : ''}-- \n${safeSignature}`,
  };
}

export function folderForMailbox(mailbox, isSent = false) {
  const value = String(mailbox || '').toLowerCase();
  if (isSent || /(?:^|\/|\\)(sent|sent items)(?:$|\/|\\)/i.test(value)) return 'sent';
  if (/(?:trash|deleted)/i.test(value)) return 'trash';
  if (/(?:spam|junk|bulk mail)/i.test(value)) return 'spam';
  if (/(?:draft)/i.test(value)) return 'drafts';
  if (/(?:archive|all mail)/i.test(value)) return 'archive';
  return 'inbox';
}
