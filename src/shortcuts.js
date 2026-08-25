const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export const SHORTCUTS = [
  { keys: ['c'], action: 'compose', label: 'Compose' },
  { keys: ['/'], action: 'search', label: 'Search mail' },
  { keys: ['j'], action: 'next', label: 'Older conversation' },
  { keys: ['k'], action: 'previous', label: 'Newer conversation' },
  { keys: ['Enter'], action: 'open', label: 'Open conversation' },
  { keys: ['u'], action: 'back', label: 'Back to list' },
  { keys: ['x'], action: 'select', label: 'Select conversation' },
  { keys: ['e'], action: 'archive', label: 'Archive' },
  { keys: ['#'], action: 'trash', label: 'Move to Trash' },
  { keys: ['r'], action: 'reply', label: 'Reply' },
  { keys: ['s'], action: 'star', label: 'Star / unstar' },
  { keys: ['?'], action: 'help', label: 'Keyboard shortcuts' },
  { keys: ['Escape'], action: 'escape', label: 'Close / go back' },
];

export function isTypingTarget(target) {
  if (!target) return false;
  const element = target.nodeType === 3 ? target.parentElement : target;
  if (!element || typeof element.closest !== 'function') return false;
  if (TYPING_TAGS.has(element.tagName)) return true;
  if (element.isContentEditable) return true;
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

export function shortcutAction(event) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  const key = event.key;
  if (key === 'c' || key === 'C') return 'compose';
  if (key === '/') return 'search';
  if (key === 'j' || key === 'J') return 'next';
  if (key === 'k' || key === 'K') return 'previous';
  if (key === 'Enter') return 'open';
  if (key === 'u' || key === 'U') return 'back';
  if (key === 'x' || key === 'X') return 'select';
  if (key === 'e' || key === 'E') return 'archive';
  if (key === '#') return 'trash';
  if (key === 'r' || key === 'R') return 'reply';
  if (key === 's' || key === 'S') return 'star';
  if (key === '?') return 'help';
  if (key === 'Escape') return 'escape';
  return null;
}

export function clampIndex(index, length) {
  if (!length) return -1;
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, length - 1);
}
