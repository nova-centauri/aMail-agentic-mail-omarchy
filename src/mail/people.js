export function normalizePerson(value, fallback = {}) {
  if (typeof value === 'string') {
    const match = value.match(/^(.*)\s+<([^>]+)>$/);
    return { name: match?.[1]?.replace(/['"]/g, '').trim() || value, email: match?.[2] || value, ...fallback };
  }
  const source = value || {};
  return {
    name: source.name || source.displayName || source.email || source.address || fallback.name || 'Unknown sender',
    email: source.email || source.address || source.mailbox || fallback.email || '',
    avatarUrl: source.avatarUrl || source.avatar || source.photoUrl || fallback.avatarUrl,
    color: source.color || fallback.color,
  };
}

export function recipientArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  return value ? [value] : [];
}

export function formatRecipients(value) {
  const recipients = recipientArray(value);
  return recipients.map((recipient) => {
    const person = normalizePerson(recipient);
    if (person.name && person.email && person.name !== person.email) return `${person.name} <${person.email}>`;
    return person.email || person.name;
  }).filter(Boolean).join(', ');
}

const RECIPIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isRecipientEmail(value) {
  return RECIPIENT_EMAIL.test(String(value || '').trim());
}

export function parseRecipientToken(value) {
  const raw = String(value || '').trim().replace(/[;,]+$/, '');
  if (!raw) return null;
  const angled = raw.match(/^(?:"?([^<"]+)"?\s*)?<([^>]+)>$/);
  if (angled) {
    const email = String(angled[2] || '').trim();
    const name = String(angled[1] || '').trim();
    return {
      name: name && name !== email ? name : '',
      email,
      valid: isRecipientEmail(email),
    };
  }
  if (isRecipientEmail(raw)) return { name: '', email: raw, valid: true };
  return { name: raw, email: raw, valid: false };
}

export function parseRecipientList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const email = String(item.email || item.address || '').trim();
        const name = String(item.name || '').trim();
        if (!email && !name) return null;
        return {
          name: name && name !== email ? name : '',
          email: email || name,
          valid: isRecipientEmail(email),
        };
      }
      return parseRecipientToken(item);
    }).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;]+/)
    .map((part) => parseRecipientToken(part))
    .filter(Boolean);
}

export function formatRecipientToken(person) {
  const name = String(person?.name || '').trim();
  const email = String(person?.email || '').trim();
  if (name && email && name !== email) return `${name} <${email}>`;
  return email || name;
}

export function suggestRecipients(contacts = [], query = '', selected = []) {
  const needle = String(query || '').trim().toLowerCase();
  const taken = new Set(
    selected.map((item) => String(item?.email || '').trim().toLowerCase()).filter(Boolean),
  );
  return contacts.filter((person) => {
    const email = String(person?.email || '').trim().toLowerCase();
    if (!email || taken.has(email) || !isRecipientEmail(email)) return false;
    if (!needle) return true;
    const name = String(person?.name || '').toLowerCase();
    return name.includes(needle) || email.includes(needle);
  }).slice(0, 8);
}

export function collectKnownPeople(...sources) {
  const seen = new Map();
  const add = (value) => {
    const person = normalizePerson(value);
    const email = String(person.email || '').trim();
    const key = email.toLowerCase();
    if (!isRecipientEmail(email)) return;
    const name = person.name && person.name !== email ? person.name : '';
    const existing = seen.get(key);
    if (!existing || (name && !existing.name)) {
      seen.set(key, { name, email, color: person.color || existing?.color });
    }
  };
  const walk = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach(walk);
      return;
    }
    if (typeof source === 'string' || source.email || source.address) add(source);
    add(source.from);
    recipientArray(source.to).forEach(add);
    recipientArray(source.cc).forEach(add);
    recipientArray(source.bcc).forEach(add);
    (source.messages || []).forEach(walk);
    (source.participants || []).forEach(add);
  };
  sources.forEach(walk);
  return [...seen.values()].sort((left, right) => (left.name || left.email).localeCompare(right.name || right.email));
}

export function normalizePersonFlagEmail(value = '') {
  const match = String(value).trim().toLowerCase().match(/<([^>]+)>/);
  const email = (match?.[1] || String(value)).trim().toLowerCase();
  return email
    .replace(/@midstaelitho\.com$/, '@midstatelitho.com')
    .replace(/@midstaetlitho\.com$/, '@midstatelitho.com');
}
