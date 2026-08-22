import { api } from './api.js';

export function passkeysSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.PublicKeyCredential)
    && typeof window.PublicKeyCredential === 'function';
}

export async function authenticateWithPasskey() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const payload = await api('/session/passkey/login/options', { method: 'POST', body: '{}' });
  const assertion = await startAuthentication({ optionsJSON: payload.options });
  await api('/session/passkey/login', {
    method: 'POST',
    body: JSON.stringify({ challengeId: payload.challengeId, response: assertion }),
  });
}

export async function registerPasskey(name = 'Passkey') {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const payload = await api('/session/passkey/register/options', { method: 'POST', body: '{}' });
  const attestation = await startRegistration({ optionsJSON: payload.options });
  return api('/session/passkey/register', {
    method: 'POST',
    body: JSON.stringify({ challengeId: payload.challengeId, name, response: attestation }),
  });
}
