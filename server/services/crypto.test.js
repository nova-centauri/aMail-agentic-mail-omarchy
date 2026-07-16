import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptJson, encryptJson, readSignedToken } from './crypto.js';

const key = Buffer.alloc(32, 7);

test('encrypted credentials round-trip and reject tampering', () => {
  const encrypted = encryptJson({ username: 'mail@example.test', password: 'not-in-logs' }, key);
  assert.doesNotMatch(encrypted, /not-in-logs/);
  assert.deepEqual(decryptJson(encrypted, key), { username: 'mail@example.test', password: 'not-in-logs' });
  const tampered = encrypted.split('.');
  const last = tampered.at(-1);
  tampered[tampered.length - 1] = `${last.slice(0, -1)}${last.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptJson(tampered.join('.'), key), { code: 'CREDENTIAL_DECRYPTION_FAILED' });
});

test('signed remote-content tokens reject a changed signature', () => {
  assert.throws(() => readSignedToken('payload.invalid', key), { code: 'VALIDATION_ERROR' });
});
