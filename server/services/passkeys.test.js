import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDatabase, createRepositories } from '../db.js';
import { createPasskeyService } from './passkeys.js';

test('passkey registration and login persist credentials without echoing public keys', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigamail-passkey-'));
  const config = {
    dataDir,
    dbPath: path.join(dataDir, 'mail.sqlite'),
    webauthnRpName: 'GigaMail',
    webauthnRpId: 'localhost',
    webauthnOrigins: ['http://localhost:3080'],
  };
  const database = createDatabase(config);
  const repos = createRepositories(database);
  t.after(() => {
    repos.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const service = createPasskeyService({
    config,
    repos,
    generateRegistration: async () => ({ challenge: 'reg-challenge', rp: { id: 'localhost' } }),
    verifyRegistration: async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    }),
    generateAuthentication: async () => ({ challenge: 'login-challenge' }),
    verifyAuthentication: async () => ({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    }),
  });

  const request = {
    get(name) {
      if (name === 'host') return 'localhost:3080';
      return '';
    },
  };

  const options = await service.registrationOptions(request);
  assert.ok(options.challengeId);
  assert.equal(options.options.challenge, 'reg-challenge');

  const registered = await service.register(request, {
    challengeId: options.challengeId,
    name: 'Laptop',
    response: { id: 'cred-1' },
  });
  assert.equal(registered.verified, true);
  assert.equal(registered.passkey.name, 'Laptop');
  assert.equal(registered.passkey.id, 'cred-1');
  assert.equal(Object.hasOwn(registered.passkey, 'publicKey'), false);
  assert.equal(service.count(), 1);

  const login = await service.loginOptions(request);
  const verified = await service.login(request, {
    challengeId: login.challengeId,
    response: { id: 'cred-1' },
  });
  assert.equal(verified.verified, true);
  assert.equal(repos.passkeys.getRaw('cred-1').counter, 1);
  assert.equal(service.remove('cred-1'), true);
  assert.equal(service.count(), 0);
});
