import { getAccessToken } from './storage.js';

export const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const hasBody = options.body !== undefined;
  const accessToken = getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let detail = null;
    try {
      detail = contentType.includes('application/json') ? await response.json() : await response.text();
    } catch {
      detail = null;
    }
    const errorBody = detail && typeof detail === 'object' ? (detail.error || detail) : null;
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : typeof detail === 'string' && detail.trim()
        ? detail.trim()
        : `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = errorBody?.code || detail?.code || null;
    error.details = errorBody?.details || detail?.details || null;
    throw error;
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}
