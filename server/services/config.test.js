import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../config.js';

const MIB = 1024 * 1024;

test('IMAP message download cap has a safe default and bounded configuration range', () => {
  assert.equal(loadConfig({}).syncMaxMessageBytes, 10 * MIB);
  assert.equal(loadConfig({ GIGAMAIL_SYNC_MAX_MESSAGE_BYTES: String(64 * 1024) }).syncMaxMessageBytes, 64 * 1024);
  assert.equal(loadConfig({ GIGAMAIL_SYNC_MAX_MESSAGE_BYTES: String(50 * MIB) }).syncMaxMessageBytes, 50 * MIB);

  for (const invalid of ['not-a-number', String(64 * 1024 - 1), String(50 * MIB + 1)]) {
    assert.equal(loadConfig({ GIGAMAIL_SYNC_MAX_MESSAGE_BYTES: invalid }).syncMaxMessageBytes, 10 * MIB);
  }
});

test('release SHA is exposed only when it is a full commit identifier', () => {
  const release = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
  assert.equal(loadConfig({}).releaseSha, null);
  assert.equal(loadConfig({ GIGAMAIL_RELEASE_SHA: 'abc123' }).releaseSha, null);
  assert.equal(loadConfig({ GIGAMAIL_RELEASE_SHA: release }).releaseSha, release.toLowerCase());
});

test('WebAuthn origin and RP ID are read from explicit configuration', () => {
  assert.equal(loadConfig({}).webauthnRpId, '');
  assert.deepEqual(loadConfig({}).webauthnOrigins, []);
  assert.equal(loadConfig({ NODE_ENV: 'production' }).webauthnRpId, 'mail.xer0.io');
  assert.deepEqual(loadConfig({ NODE_ENV: 'production' }).webauthnOrigins, ['https://mail.xer0.io']);
  assert.equal(loadConfig({ NODE_ENV: 'production', GIGAMAIL_RP_ID: '', GIGAMAIL_ORIGIN: '' }).webauthnRpId, 'mail.xer0.io');
  assert.equal(loadConfig({ GIGAMAIL_RP_ID: 'mail.xer0.io', GIGAMAIL_ORIGIN: 'https://mail.xer0.io' }).webauthnRpId, 'mail.xer0.io');
  assert.equal(
    loadConfig({ NODE_ENV: 'production', GIGAMAIL_RP_ID: 'mail.example.test', GIGAMAIL_ORIGIN: 'https://mail.example.test' }).webauthnRpId,
    'mail.example.test',
  );
  assert.deepEqual(
    loadConfig({ GIGAMAIL_ORIGIN: 'https://mail.xer0.io,http://localhost:5173' }).webauthnOrigins,
    ['https://mail.xer0.io', 'http://localhost:5173'],
  );
});
