import { LEGACY_SESSION_COOKIE, SESSION_COOKIE } from '../config.js';
import { timingSafeMatch } from '../services/crypto.js';

function readCookie(request, name) {
  const pairs = String(request.headers.cookie || '').split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return null;
}

export function requestHasAccess(request, config) {
  if (!config.accessToken) return true;
  const authorization = request.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return timingSafeMatch(bearer, config.accessToken)
    || timingSafeMatch(readCookie(request, SESSION_COOKIE), config.accessToken)
    || timingSafeMatch(readCookie(request, LEGACY_SESSION_COOKIE), config.accessToken);
}

export function accessGate(config) {
  return (request, response, next) => {
    if (requestHasAccess(request, config)) return next();
    response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'aMail access token required.' } });
  };
}
export function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production' && config.cookieSecure !== false,
    maxAge: 1000 * 60 * 60 * 12,
    path: '/',
  };
}

export function sessionCookieClearOptions(config) {
  const options = sessionCookieOptions(config);
  return {
    path: options.path,
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
  };
}
