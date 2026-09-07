import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDatabase, createRepositories } from '../db.js';

function messageInput({ accountId, threadId, uid, subject, textBody, timestamp }) {
  return {
    account_id: accountId,
    thread_id: threadId,
    mailbox: 'INBOX',
    uid,
    rfc_message_id: `<fts-${uid}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    subject,
    from_name: 'Sender',
    from_email: 'sender@example.test',
    to_json: JSON.stringify([{ name: 'Owner', email: 'owner@example.test' }]),
    cc_json: '[]',
    bcc_json: '[]',
    reply_to_json: null,
    sent_at: timestamp,
    received_at: timestamp,
    html_body: '',
    text_body: textBody,
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

test('reopening a pre-FTS mailbox indexes search in batches and keeps SQLite temp on the data volume', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amail-fts-migrate-'));
  const config = { dataDir, dbPath: path.join(dataDir, 'amail.sqlite') };
  const seed = createDatabase(config);
  const repos = createRepositories(seed);
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
  const thread = repos.threads.create({
    account_id: account.id,
    subject: 'Workflow failed',
    normalized_subject: 'workflow failed',
    latest_at: '2026-08-01T00:00:00.000Z',
  });

  const body = `${'lorem ipsum '.repeat(400)} unique-token-42`;
  for (let uid = 1; uid <= 120; uid += 1) {
    const timestamp = new Date(Date.UTC(2026, 7, 1, 0, uid)).toISOString();
    repos.messages.upsert(messageInput({
      accountId: account.id,
      threadId: thread.id,
      uid,
      subject: uid === 42 ? 'Invoice for unique-token-42' : `Message ${uid}`,
      textBody: uid === 42 ? body : `ordinary body ${uid} ${'x'.repeat(2048)}`,
      timestamp,
    }));
  }

  seed.exec('DROP TRIGGER IF EXISTS messages_ad_fts');
  seed.exec('DROP TABLE IF EXISTS messages_fts');
  repos.close();

  const db = createDatabase(config);
  t.after(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 120);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages_fts').get().count, 120);
  assert.ok(fs.statSync(path.join(dataDir, 'tmp')).isDirectory());
  assert.equal(process.env.SQLITE_TMPDIR, path.join(dataDir, 'tmp'));
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS count FROM messages_fts WHERE messages_fts MATCH '"unique-token-42"'`).get().count >= 1,
  );
});
