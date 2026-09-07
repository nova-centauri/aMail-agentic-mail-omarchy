export const ACCESS_TOKEN_KEY = 'amail-access-token';
export const PREFS_KEY = 'amail-ui-prefs';

export function getAccessToken() {
  try {
    return window.sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function persistAccessToken(token) {
  try {
    if (token) window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Private browsing can deny session storage. The token still works for this page request.
  }
}

export function readUiPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeUiPrefs(partial) {
  try {
    const next = { ...readUiPrefs(), ...partial };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return partial;
  }
}

export function readDismissedFreshDrafts() {
  const value = readUiPrefs().dismissedFreshDrafts;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function writeDismissedFreshDrafts(dismissedAtById) {
  const next = dismissedAtById && typeof dismissedAtById === 'object' && !Array.isArray(dismissedAtById)
    ? dismissedAtById
    : {};
  writeUiPrefs({ dismissedFreshDrafts: next });
  return next;
}
