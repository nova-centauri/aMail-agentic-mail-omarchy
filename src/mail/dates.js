export function initials(value = '') {
  return String(value)
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

export function dateValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

export function formatListDate(value) {
  const date = dateValue(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatMessageDate(value) {
  return dateValue(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatAttachmentSize(size) {
  if (size == null || size === '') return '';
  if (typeof size === 'string' && /[a-z]/i.test(size)) return size;
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return String(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
