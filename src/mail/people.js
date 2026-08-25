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

export function normalizePersonFlagEmail(value = '') {
  const match = String(value).trim().toLowerCase().match(/<([^>]+)>/);
  const email = (match?.[1] || String(value)).trim().toLowerCase();
  return email
    .replace(/@midstaelitho\.com$/, '@midstatelitho.com')
    .replace(/@midstaetlitho\.com$/, '@midstatelitho.com');
}
