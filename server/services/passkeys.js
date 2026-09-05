import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ValidationError } from '../errors.js';

const CHALLENGE_TTL_MS = 2 * 60_000;
const USER_SETTING = 'webauthnUserId';

function publicPasskey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || 'Passkey',
    deviceType: row.device_type || null,
    backedUp: Boolean(row.backed_up),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function webauthnContext(request, config) {
  const forwardedHost = String(request.get('x-forwarded-host') || '').split(',')[0].trim();
  const hostHeader = forwardedHost || String(request.get('host') || '');
  const hostname = hostHeader.split(':')[0] || 'localhost';
  const rpID = config.webauthnRpId || hostname;
  const forwardedProto = String(request.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto
    || (hostname === 'localhost' || hostname === '127.0.0.1' ? 'http' : 'https');
  const derivedOrigin = `${proto}://${hostHeader || hostname}`;
  const origins = config.webauthnOrigins.length ? config.webauthnOrigins : [derivedOrigin];
  return { rpID, rpName: config.webauthnRpName, origin: origins[0], origins };
}

function userHandle(repos) {
  let stored = repos.settings.get(USER_SETTING);
  if (typeof stored !== 'string' || stored.length < 16) {
    stored = crypto.randomBytes(32).toString('base64url');
    repos.settings.set(USER_SETTING, stored);
  }
  return Buffer.from(stored, 'base64url');
}

export function createPasskeyService({
  config,
  repos,
  generateRegistration = generateRegistrationOptions,
  verifyRegistration = verifyRegistrationResponse,
  generateAuthentication = generateAuthenticationOptions,
  verifyAuthentication = verifyAuthenticationResponse,
} = {}) {
  const challenges = new Map();

  function rememberChallenge(kind, challenge, extra = {}) {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    challenges.set(id, { kind, challenge, expiresAt, ...extra });
    for (const [key, value] of challenges) {
      if (value.expiresAt < Date.now()) challenges.delete(key);
    }
    return id;
  }

  function takeChallenge(id, kind) {
    const entry = challenges.get(id);
    challenges.delete(id);
    if (!entry || entry.kind !== kind || entry.expiresAt < Date.now()) {
      throw new ValidationError('Passkey challenge expired. Try again.');
    }
    return entry;
  }

  async function registrationOptions(request) {
    const { rpID, rpName } = webauthnContext(request, config);
    const existing = repos.passkeys.listRaw();
    const options = await generateRegistration({
      rpName,
      rpID,
      userName: 'gigamail',
      userDisplayName: 'aMail',
      userID: userHandle(repos),
      attestationType: 'none',
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.id,
        transports: JSON.parse(passkey.transports_json || '[]'),
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });
    const challengeId = rememberChallenge('register', options.challenge);
    return { challengeId, options };
  }

  async function register(request, { challengeId, name, response }) {
    const pending = takeChallenge(challengeId, 'register');
    const { rpID, origins } = webauthnContext(request, config);
    let verification;
    try {
      verification = await verifyRegistration({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch {
      throw new ValidationError('Passkey registration could not be verified.');
    }
    if (!verification?.verified || !verification.registrationInfo?.credential) {
      throw new ValidationError('Passkey registration could not be verified.');
    }
    const credential = verification.registrationInfo.credential;
    const passkey = repos.passkeys.create({
      id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: Number(credential.counter) || 0,
      device_type: verification.registrationInfo.credentialDeviceType || null,
      backed_up: verification.registrationInfo.credentialBackedUp ? 1 : 0,
      transports_json: JSON.stringify(credential.transports || response?.response?.transports || []),
      name: String(name || 'Passkey').slice(0, 80),
    });
    return { verified: true, passkey: publicPasskey(passkey) };
  }

  async function loginOptions(request) {
    const { rpID } = webauthnContext(request, config);
    const options = await generateAuthentication({
      rpID,
      userVerification: 'preferred',
      // Empty allowCredentials lets the browser pick a discoverable passkey.
      allowCredentials: [],
    });
    const challengeId = rememberChallenge('login', options.challenge);
    return { challengeId, options };
  }

  async function login(request, { challengeId, response }) {
    const pending = takeChallenge(challengeId, 'login');
    const { rpID, origins } = webauthnContext(request, config);
    const credentialId = String(response?.id || '');
    const stored = repos.passkeys.getRaw(credentialId);
    if (!stored) throw new ValidationError('That passkey is not registered on this aMail server.');
    let verification;
    try {
      verification = await verifyAuthentication({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: stored.id,
          publicKey: stored.public_key,
          counter: stored.counter,
          transports: JSON.parse(stored.transports_json || '[]'),
        },
      });
    } catch {
      throw new ValidationError('Passkey sign-in could not be verified.');
    }
    if (!verification?.verified) {
      throw new ValidationError('Passkey sign-in could not be verified.');
    }
    const nextCounter = Number(verification.authenticationInfo?.newCounter);
    repos.passkeys.touch(stored.id, Number.isFinite(nextCounter) ? nextCounter : stored.counter);
    return { verified: true, passkey: publicPasskey(repos.passkeys.getRaw(stored.id)) };
  }

  return {
    registrationOptions,
    register,
    loginOptions,
    login,
    list: () => repos.passkeys.listRaw().map(publicPasskey),
    remove: (id) => repos.passkeys.remove(id),
    count: () => repos.passkeys.count(),
  };
}
