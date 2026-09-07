import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createIdleWatcher } from './idle.js';
import { createEventBus } from './events.js';
import { encryptJson } from './crypto.js';

const credentialKey = Buffer.alloc(32, 7);
const account = {
  id: 'acc-1',
  email: 'me@example.test',
  sync_enabled: 1,
  imap_host: 'imap.example.test',
  imap_port: 993,
  imap_secure: 1,
  credential_ciphertext: encryptJson({ username: 'me@example.test', password: 'pw' }, credentialKey),
};
const config = { credentialKey, imapIdle: true, imapIdleMaxMs: 60_000, syncTimeoutMs: 10_000, allowInsecureTls: false };
const logger = { info() {}, warn() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeImap() {
  const instances = [];
  class FakeImap extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.opened = null;
      instances.push(this);
    }
    async connect() {}
    async mailboxOpen(name) { this.opened = name; }
    async logout() {}
    close() {}
  }
  return { FakeImap, instances };
}

test('IDLE watcher parks on INBOX and runs an inbox-only sync when mail arrives', async () => {
  const { FakeImap, instances } = fakeImap();
  const syncs = [];
  const repos = { accounts: { getRaw: () => account, list: () => [{ id: account.id, syncEnabled: true }] } };
  const mailService = { async syncAccount(id, options) { syncs.push({ id, options }); return { imported: 1 }; } };
  const watcher = createIdleWatcher({ config, repos, mailService, logger, events: createEventBus(), ImapClient: FakeImap });
  watcher.start();
  await sleep(20);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].opened, 'INBOX');
  assert.equal(instances[0].options.maxIdleTime, 60_000);
  assert.equal(instances[0].options.auth.pass, 'pw');
  // The connect itself schedules a catch-up sync.
  await sleep(500);
  assert.equal(syncs.length, 1);
  assert.deepEqual(syncs[0], { id: 'acc-1', options: { inboxOnly: true } });

  instances[0].emit('exists', { count: 11, prevCount: 10 });
  instances[0].emit('exists', { count: 12, prevCount: 11 });
  await sleep(500);
  assert.equal(syncs.length, 2, 'two signals inside the debounce window coalesce into one sync');

  instances[0].emit('exists', { count: 5, prevCount: 12 });
  await sleep(500);
  assert.equal(syncs.length, 2, 'a shrinking EXISTS (expunge) does not trigger a sync');

  const status = watcher.status();
  assert.equal(status.accounts[0].state, 'idle');
  await watcher.stop();
});

test('IDLE watcher reconnects after the connection closes', async () => {
  const { FakeImap, instances } = fakeImap();
  const repos = { accounts: { getRaw: () => account, list: () => [{ id: account.id, syncEnabled: true }] } };
  const mailService = { async syncAccount() { return { imported: 0 }; } };
  const watcher = createIdleWatcher({ config, repos, mailService, logger, events: createEventBus(), ImapClient: FakeImap });
  watcher.start();
  await sleep(20);
  instances[0].emit('close');
  assert.equal(watcher.status().accounts[0].state, 'reconnecting');
  assert.equal(watcher.status().accounts[0].reconnects, 1);
  await watcher.stop();
  assert.equal(watcher.status().accounts.length, 0);
});

test('IDLE watcher follows account lifecycle events', async () => {
  const { FakeImap, instances } = fakeImap();
  const accounts = [{ id: account.id, syncEnabled: true }];
  const repos = { accounts: { getRaw: (id) => (accounts.some((item) => item.id === id) ? account : null), list: () => accounts } };
  const mailService = { async syncAccount() { return { imported: 0 }; } };
  const events = createEventBus();
  const watcher = createIdleWatcher({ config, repos, mailService, logger, events, ImapClient: FakeImap });
  watcher.start();
  await sleep(20);
  assert.equal(instances.length, 1);
  accounts.length = 0;
  events.emit('account.removed', { accountId: account.id });
  await sleep(20);
  assert.equal(watcher.status().accounts.length, 0);
  await watcher.stop();
});
