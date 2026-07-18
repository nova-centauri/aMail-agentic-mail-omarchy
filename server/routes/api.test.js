import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createDatabase, createRepositories } from '../db.js';
import { ServiceUnavailableError } from '../errors.js';
import { errorHandler } from '../middleware/errors.js';
import { registerApi } from './api.js';

function messageInput({ accountId, threadId, uid, subject, fromEmail, timestamp }) {
  return {
    account_id: accountId,
    thread_id: threadId,
    mailbox: 'INBOX',
    uid,
    rfc_message_id: `<api-${uid}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    subject,
    from_name: '',
    from_email: fromEmail,
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    reply_to_json: null,
    sent_at: timestamp,
    received_at: timestamp,
    html_body: '',
    text_body: '',
    snippet: subject,
    attachments_json: '[]',
    labels_json: '[]',
    is_read: 0,
    is_starred: 0,
    is_archived: 0,
    is_trashed: 0,
    is_spam: 0,
    snoozed_until: null,
    is_sent: 0,
  };
}

test('message API filters unified mail by smart category and account creation is connection-atomic', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigamail-api-'));
  const config = {
    dataDir,
    dbPath: path.join(dataDir, 'mail.sqlite'),
    credentialKey: Buffer.alloc(32, 4),
    accessToken: null,
    syncBatchSize: 50,
    remoteContentProxyUrl: null,
    allowDirectRemoteContent: false,
    releaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  const database = createDatabase(config);
  const repos = createRepositories(database);
  let rejectConnection = false;
  const mailService = {
    async testSettings() {
      if (rejectConnection) throw new ServiceUnavailableError('Sanitized connection failure.', 'IMAP_AUTH_FAILED');
      return { imap: true, smtp: true };
    },
  };
  const remoteContent = {
    canIssueTokens: false,
    async fetchToken() {
      throw new Error('not used');
    },
  };
  const logger = { error() {} };
  const app = express();
  app.use(express.json());
  registerApi(app, { config, repos, mailService, remoteContent });
  app.use(errorHandler(logger));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    repos.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const healthResponse = await fetch(`${origin}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).releaseSha, config.releaseSha);

  const account = repos.accounts.create({
    email: 'owner@example.test',
    display_name: 'Owner',
    avatar_blob: null,
    avatar_mime: null,
    color: '#1a73e8',
    provider: 'custom',
    imap_host: 'imap.example.test',
    imap_port: 993,
    imap_secure: 1,
    smtp_host: 'smtp.example.test',
    smtp_port: 465,
    smtp_secure: 1,
    credential_ciphertext: 'test-only',
    signature: '',
    sync_enabled: 1,
  });
  const threadIds = [];
  for (const [index, sample] of [
    ['A human note', 'friend@example.test'],
    ['[acme/api] Workflow failed', 'notifications@github.com'],
    ['[FIRING:1] API latency', 'alerts@example.test'],
    ['Scheduled maintenance completed', 'updates@statuspage.io'],
  ].entries()) {
    const timestamp = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
    const thread = repos.threads.create({
      account_id: account.id,
      subject: sample[0],
      normalized_subject: sample[0].toLowerCase(),
      latest_at: timestamp,
    });
    threadIds.push(thread.id);
    repos.messages.upsert(messageInput({
      accountId: account.id,
      threadId: thread.id,
      uid: index + 1,
      subject: sample[0],
      fromEmail: sample[1],
      timestamp,
    }));
  }

  // A conversation belongs to the category of its latest scoped message. An
  // older CI notification must not make a newer human reply look like CI mail.
  repos.messages.upsert(messageInput({
    accountId: account.id,
    threadId: threadIds[1],
    uid: 5,
    subject: 'Re: Workflow failure — I can help',
    fromEmail: 'teammate@example.test',
    timestamp: '2026-01-06T00:00:00.000Z',
  }));
  const githubOnlyThread = repos.threads.create({
    account_id: account.id,
    subject: '[acme/web] Deploy check failed',
    normalized_subject: '[acme/web] deploy check failed',
    latest_at: '2026-01-07T00:00:00.000Z',
  });
  repos.messages.upsert(messageInput({
    accountId: account.id,
    threadId: githubOnlyThread.id,
    uid: 6,
    subject: '[acme/web] Deploy check failed',
    fromEmail: 'notifications@github.com',
    timestamp: '2026-01-07T00:00:00.000Z',
  }));

  const filteredResponse = await fetch(`${origin}/api/messages?folder=inbox&category=github_ci`);
  assert.equal(filteredResponse.status, 200);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.messages[0].category, 'github_ci');
  assert.equal(filtered.messages[0].subject, '[acme/web] Deploy check failed');
  assert.deepEqual(filtered.categoryCounts, { primary: 2, github_ci: 1, logs: 1, status: 1 });

  const searchedResponse = await fetch(`${origin}/api/messages?folder=inbox&q=Workflow%20failed`);
  assert.equal(searchedResponse.status, 200);
  const searched = await searchedResponse.json();
  assert.equal(searched.total, 1);
  assert.equal(searched.messages[0].subject, 'Re: Workflow failure — I can help');
  assert.equal(searched.messages[0].category, 'primary');
  assert.deepEqual(searched.categoryCounts, { primary: 1, github_ci: 0, logs: 0, status: 0 });

  const allResponse = await fetch(`${origin}/api/messages?folder=inbox`);
  const all = await allResponse.json();
  assert.equal(all.total, 5);
  assert.equal(Object.values(all.categoryCounts).reduce((sum, count) => sum + count, 0), all.total);
  // Sidebar badges are conversation-level and stay available regardless of the
  // active folder view. All five seeded messages are unread inbox mail.
  assert.equal(all.folderCounts.inbox, 5);
  assert.equal(all.folderCounts.starred, 0);
  assert.equal(all.folderCounts.drafts, 0);

  const invalidResponse = await fetch(`${origin}/api/messages?category=unknown`);
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, 'VALIDATION_ERROR');

  const accountPayload = {
    email: 'new-account@gmail.com',
    displayName: 'New account',
    provider: 'gmail',
    credentials: { username: 'new-account@gmail.com', password: 'test-app-password' },
  };
  rejectConnection = true;
  const rejected = await fetch(`${origin}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(accountPayload),
  });
  assert.equal(rejected.status, 503);
  assert.equal(repos.accounts.getByEmailRaw(accountPayload.email), null);

  rejectConnection = false;
  const createdResponse = await fetch(`${origin}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(accountPayload),
  });
  assert.equal(createdResponse.status, 201);
  const createdText = await createdResponse.text();
  assert.doesNotMatch(createdText, /test-app-password/);
  const created = JSON.parse(createdText);
  assert.equal(created.account.provider, 'gmail');
  assert.deepEqual(created.connection, { imap: true, smtp: true });

  const disabledSync = await fetch(`${origin}/api/accounts/${created.account.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ syncEnabled: 'false' }),
  });
  assert.equal(disabledSync.status, 200);
  assert.equal((await disabledSync.json()).account.syncEnabled, false);

  const beforeRejectedUpdate = repos.accounts.getRaw(created.account.id).credential_ciphertext;
  rejectConnection = true;
  const rejectedUpdate = await fetch(`${origin}/api/accounts/${created.account.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials: { username: accountPayload.email, password: 'bad-replacement' } }),
  });
  assert.equal(rejectedUpdate.status, 503);
  assert.equal(repos.accounts.getRaw(created.account.id).credential_ciphertext, beforeRejectedUpdate);
});
