import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const json = (value, fallback = []) => {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const stringify = (value, fallback = []) => JSON.stringify(value ?? fallback);
const now = () => new Date().toISOString();

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_blob ? `/api/accounts/${row.id}/avatar` : null,
    color: row.color,
    provider: row.provider,
    imap: { host: row.imap_host, port: row.imap_port, secure: Boolean(row.imap_secure) },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: Boolean(row.smtp_secure) },
    signature: row.signature || '',
    syncEnabled: Boolean(row.sync_enabled),
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    mailbox: row.mailbox,
    uid: row.uid,
    messageId: row.rfc_message_id,
    inReplyTo: row.in_reply_to,
    references: json(row.references_json),
    subject: row.subject || '(no subject)',
    from: { name: row.from_name || '', email: row.from_email || '' },
    to: json(row.to_json),
    cc: json(row.cc_json),
    bcc: json(row.bcc_json),
    replyTo: json(row.reply_to_json, null),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    htmlBody: row.html_body || '',
    textBody: row.text_body || '',
    snippet: row.snippet || '',
    attachments: json(row.attachments_json),
    labels: json(row.labels_json),
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    isArchived: Boolean(row.is_archived),
    isTrashed: Boolean(row.is_trashed),
    isSpam: Boolean(row.is_spam),
    snoozedUntil: row.snoozed_until,
    isSent: Boolean(row.is_sent),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    subject: row.subject || '(no subject)',
    participants: json(row.participants_json),
    snippet: row.snippet || '',
    latestAt: row.latest_at,
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    isStarred: Boolean(row.is_starred),
    labels: json(row.labels_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    to: json(row.to_json),
    cc: json(row.cc_json),
    bcc: json(row.bcc_json),
    subject: row.subject || '',
    htmlBody: row.html_body || '',
    textBody: row.text_body || '',
    attachments: json(row.attachments_json),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      avatar_blob BLOB,
      avatar_mime TEXT,
      color TEXT NOT NULL DEFAULT '#1a73e8',
      provider TEXT NOT NULL DEFAULT 'custom',
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      imap_secure INTEGER NOT NULL DEFAULT 1,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      smtp_secure INTEGER NOT NULL DEFAULT 1,
      credential_ciphertext TEXT NOT NULL,
      signature TEXT NOT NULL DEFAULT '',
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      subject TEXT NOT NULL DEFAULT '',
      normalized_subject TEXT NOT NULL DEFAULT '',
      participants_json TEXT NOT NULL DEFAULT '[]',
      snippet TEXT NOT NULL DEFAULT '',
      latest_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      labels_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_threads_folder ON threads(account_id, latest_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      mailbox TEXT NOT NULL DEFAULT 'INBOX',
      uid INTEGER,
      rfc_message_id TEXT,
      in_reply_to TEXT,
      references_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      bcc_json TEXT NOT NULL DEFAULT '[]',
      reply_to_json TEXT,
      sent_at TEXT,
      received_at TEXT,
      html_body TEXT NOT NULL DEFAULT '',
      text_body TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      labels_json TEXT NOT NULL DEFAULT '[]',
      is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_trashed INTEGER NOT NULL DEFAULT 0,
      is_spam INTEGER NOT NULL DEFAULT 0,
      snoozed_until TEXT,
      is_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, mailbox, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, sent_at);
    CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(account_id, mailbox, is_archived, is_trashed, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_rfc_id ON messages(account_id, rfc_message_id);

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      bcc_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      text_body TEXT NOT NULL DEFAULT '',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mailbox TEXT NOT NULL,
      last_uid INTEGER NOT NULL DEFAULT 0,
      uid_validity INTEGER,
      last_error TEXT,
      synced_at TEXT,
      PRIMARY KEY (account_id, mailbox)
    );
  `);
  const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
  if (!messageColumns.has('is_spam')) db.exec('ALTER TABLE messages ADD COLUMN is_spam INTEGER NOT NULL DEFAULT 0');
  if (!messageColumns.has('snoozed_until')) db.exec('ALTER TABLE messages ADD COLUMN snoozed_until TEXT');
}

export function createDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initSchema(db);
  return db;
}

export function createRepositories(db) {
  const queries = {
    accountById: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    accountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ? COLLATE NOCASE'),
    accountList: db.prepare('SELECT * FROM accounts ORDER BY display_name COLLATE NOCASE, email COLLATE NOCASE'),
    accountInsert: db.prepare(`INSERT INTO accounts (
      id, email, display_name, avatar_blob, avatar_mime, color, provider,
      imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
      credential_ciphertext, signature, sync_enabled, created_at, updated_at
    ) VALUES (
      @id, @email, @display_name, @avatar_blob, @avatar_mime, @color, @provider,
      @imap_host, @imap_port, @imap_secure, @smtp_host, @smtp_port, @smtp_secure,
      @credential_ciphertext, @signature, @sync_enabled, @created_at, @updated_at
    )`),
    accountUpdate: db.prepare(`UPDATE accounts SET
      display_name = @display_name, avatar_blob = @avatar_blob, avatar_mime = @avatar_mime,
      color = @color, provider = @provider, imap_host = @imap_host, imap_port = @imap_port,
      imap_secure = @imap_secure, smtp_host = @smtp_host, smtp_port = @smtp_port,
      smtp_secure = @smtp_secure, credential_ciphertext = @credential_ciphertext,
      signature = @signature, sync_enabled = @sync_enabled, updated_at = @updated_at
      WHERE id = @id`),
    accountDelete: db.prepare('DELETE FROM accounts WHERE id = ?'),
    accountSynced: db.prepare('UPDATE accounts SET last_synced_at = ?, updated_at = ? WHERE id = ?'),
    accountAvatar: db.prepare('SELECT avatar_blob, avatar_mime, display_name, email FROM accounts WHERE id = ?'),

    threadById: db.prepare('SELECT * FROM threads WHERE id = ?'),
    threadBySubject: db.prepare('SELECT * FROM threads WHERE account_id = ? AND normalized_subject = ? ORDER BY latest_at DESC LIMIT 1'),
    threadList: db.prepare(`SELECT * FROM threads WHERE account_id = @accountId
      ORDER BY latest_at DESC LIMIT @limit OFFSET @offset`),
    threadInsert: db.prepare(`INSERT INTO threads (
      id, account_id, subject, normalized_subject, participants_json, snippet, latest_at,
      message_count, unread_count, is_starred, labels_json, created_at, updated_at
    ) VALUES (
      @id, @account_id, @subject, @normalized_subject, @participants_json, @snippet, @latest_at,
      @message_count, @unread_count, @is_starred, @labels_json, @created_at, @updated_at
    )`),
    threadUpdateSummary: db.prepare(`UPDATE threads SET
      subject = @subject, participants_json = @participants_json, snippet = @snippet,
      latest_at = @latest_at, message_count = @message_count, unread_count = @unread_count,
      is_starred = @is_starred, labels_json = @labels_json, updated_at = @updated_at
      WHERE id = @id`),
    messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    messageByRfcId: db.prepare('SELECT * FROM messages WHERE account_id = ? AND rfc_message_id = ? ORDER BY sent_at DESC LIMIT 1'),
    messagesByThread: db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(sent_at, received_at, created_at) ASC'),
    messageList: db.prepare(`SELECT m.* FROM messages m
      WHERE m.account_id = @accountId AND
        CASE @folder
          WHEN 'inbox' THEN m.mailbox = 'INBOX' AND m.is_archived = 0 AND m.is_trashed = 0 AND m.is_spam = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= @now)
          WHEN 'starred' THEN m.is_starred = 1 AND m.is_trashed = 0
          WHEN 'sent' THEN m.is_sent = 1 AND m.is_trashed = 0
          WHEN 'drafts' THEN 0
          WHEN 'snoozed' THEN m.snoozed_until > @now AND m.is_trashed = 0 AND m.is_spam = 0
          WHEN 'all' THEN m.is_trashed = 0 AND m.is_spam = 0
          WHEN 'trash' THEN m.is_trashed = 1
          WHEN 'spam' THEN m.is_spam = 1 AND m.is_trashed = 0
          WHEN 'archive' THEN m.is_archived = 1 AND m.is_trashed = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= @now)
          ELSE m.mailbox = @mailbox AND m.is_trashed = 0 AND m.is_spam = 0
        END
        AND (@query = '' OR m.subject LIKE @likeQuery OR m.from_name LIKE @likeQuery OR m.from_email LIKE @likeQuery OR m.snippet LIKE @likeQuery)
      ORDER BY COALESCE(m.sent_at, m.received_at, m.created_at) DESC LIMIT @limit OFFSET @offset`),
    messageCount: db.prepare(`SELECT COUNT(*) AS count FROM messages m
      WHERE m.account_id = @accountId AND
        CASE @folder
          WHEN 'inbox' THEN m.mailbox = 'INBOX' AND m.is_archived = 0 AND m.is_trashed = 0 AND m.is_spam = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= @now)
          WHEN 'starred' THEN m.is_starred = 1 AND m.is_trashed = 0
          WHEN 'sent' THEN m.is_sent = 1 AND m.is_trashed = 0
          WHEN 'drafts' THEN 0
          WHEN 'snoozed' THEN m.snoozed_until > @now AND m.is_trashed = 0 AND m.is_spam = 0
          WHEN 'all' THEN m.is_trashed = 0 AND m.is_spam = 0
          WHEN 'trash' THEN m.is_trashed = 1
          WHEN 'spam' THEN m.is_spam = 1 AND m.is_trashed = 0
          WHEN 'archive' THEN m.is_archived = 1 AND m.is_trashed = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= @now)
          ELSE m.mailbox = @mailbox AND m.is_trashed = 0 AND m.is_spam = 0
        END
        AND (@query = '' OR m.subject LIKE @likeQuery OR m.from_name LIKE @likeQuery OR m.from_email LIKE @likeQuery OR m.snippet LIKE @likeQuery)`),
    messageInsert: db.prepare(`INSERT INTO messages (
      id, account_id, thread_id, mailbox, uid, rfc_message_id, in_reply_to, references_json,
      subject, from_name, from_email, to_json, cc_json, bcc_json, reply_to_json,
      sent_at, received_at, html_body, text_body, snippet, attachments_json, labels_json,
      is_read, is_starred, is_archived, is_trashed, is_spam, snoozed_until, is_sent, created_at, updated_at
    ) VALUES (
      @id, @account_id, @thread_id, @mailbox, @uid, @rfc_message_id, @in_reply_to, @references_json,
      @subject, @from_name, @from_email, @to_json, @cc_json, @bcc_json, @reply_to_json,
      @sent_at, @received_at, @html_body, @text_body, @snippet, @attachments_json, @labels_json,
      @is_read, @is_starred, @is_archived, @is_trashed, @is_spam, @snoozed_until, @is_sent, @created_at, @updated_at
    )`),
    messageUpdate: db.prepare(`UPDATE messages SET
      thread_id = @thread_id, mailbox = @mailbox, uid = @uid, rfc_message_id = @rfc_message_id,
      in_reply_to = @in_reply_to, references_json = @references_json, subject = @subject,
      from_name = @from_name, from_email = @from_email, to_json = @to_json, cc_json = @cc_json,
      bcc_json = @bcc_json, reply_to_json = @reply_to_json, sent_at = @sent_at,
      received_at = @received_at, html_body = @html_body, text_body = @text_body, snippet = @snippet,
      attachments_json = @attachments_json, labels_json = @labels_json, is_read = @is_read,
      is_starred = @is_starred, is_archived = @is_archived, is_trashed = @is_trashed,
      is_spam = @is_spam, snoozed_until = @snoozed_until,
      is_sent = @is_sent, updated_at = @updated_at
      WHERE id = @id`),
    messageRelocate: db.prepare(`UPDATE messages SET mailbox = @mailbox, uid = @uid, updated_at = @updated_at WHERE id = @id`),
    messageState: db.prepare(`UPDATE messages SET
      is_read = COALESCE(@is_read, is_read),
      is_starred = COALESCE(@is_starred, is_starred),
      is_archived = COALESCE(@is_archived, is_archived),
      is_trashed = COALESCE(@is_trashed, is_trashed),
      is_spam = COALESCE(@is_spam, is_spam),
      snoozed_until = COALESCE(@snoozed_until, snoozed_until),
      updated_at = @updated_at
      WHERE id = @id`),
    syncState: db.prepare('SELECT * FROM sync_state WHERE account_id = ? AND mailbox = ?'),
    syncStateUpsert: db.prepare(`INSERT INTO sync_state (account_id, mailbox, last_uid, uid_validity, last_error, synced_at)
      VALUES (@account_id, @mailbox, @last_uid, @uid_validity, @last_error, @synced_at)
      ON CONFLICT(account_id, mailbox) DO UPDATE SET
        last_uid = excluded.last_uid, uid_validity = excluded.uid_validity,
        last_error = excluded.last_error, synced_at = excluded.synced_at`),
    draftById: db.prepare('SELECT * FROM drafts WHERE id = ?'),
    draftList: db.prepare('SELECT * FROM drafts WHERE account_id = ? ORDER BY updated_at DESC'),
    draftInsert: db.prepare(`INSERT INTO drafts (
      id, account_id, thread_id, to_json, cc_json, bcc_json, subject, html_body,
      text_body, attachments_json, created_at, updated_at
    ) VALUES (
      @id, @account_id, @thread_id, @to_json, @cc_json, @bcc_json, @subject, @html_body,
      @text_body, @attachments_json, @created_at, @updated_at
    )`),
    draftUpdate: db.prepare(`UPDATE drafts SET thread_id = @thread_id, to_json = @to_json,
      cc_json = @cc_json, bcc_json = @bcc_json, subject = @subject, html_body = @html_body,
      text_body = @text_body, attachments_json = @attachments_json, updated_at = @updated_at WHERE id = @id`),
    draftDelete: db.prepare('DELETE FROM drafts WHERE id = ?'),
    settingList: db.prepare('SELECT * FROM settings ORDER BY key'),
    settingByKey: db.prepare('SELECT * FROM settings WHERE key = ?'),
    settingUpsert: db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`),
  };

  const recomputeThread = db.transaction((threadId) => {
    const thread = queries.threadById.get(threadId);
    if (!thread) return null;
    const messages = queries.messagesByThread.all(threadId);
    if (!messages.length) return null;
    const newest = messages.at(-1);
    const participants = [...new Map(messages.flatMap((message) => {
      const from = message.from_email ? [{ name: message.from_name, email: message.from_email }] : [];
      return [...from, ...json(message.to_json)];
    }).filter((item) => item?.email).map((item) => [item.email.toLowerCase(), item])).values()];
    const labels = [...new Set(messages.flatMap((message) => json(message.labels_json)))];
    queries.threadUpdateSummary.run({
      id: threadId,
      subject: newest.subject || thread.subject,
      participants_json: stringify(participants),
      snippet: newest.snippet || '',
      latest_at: newest.sent_at || newest.received_at || newest.created_at,
      message_count: messages.length,
      unread_count: messages.filter((message) => !message.is_read).length,
      is_starred: messages.some((message) => message.is_starred) ? 1 : 0,
      labels_json: stringify(labels),
      updated_at: now(),
    });
    return queries.threadById.get(threadId);
  });

  return {
    accounts: {
      list: () => queries.accountList.all().map(publicAccount),
      get: (id) => publicAccount(queries.accountById.get(id)),
      getRaw: (id) => queries.accountById.get(id) || null,
      getByEmailRaw: (email) => queries.accountByEmail.get(email) || null,
      create(input) {
        const id = randomUUID();
        const timestamp = now();
        queries.accountInsert.run({ id, created_at: timestamp, updated_at: timestamp, ...input });
        return publicAccount(queries.accountById.get(id));
      },
      update(id, input) {
        const existing = queries.accountById.get(id);
        if (!existing) return null;
        queries.accountUpdate.run({ ...existing, ...input, id, updated_at: now() });
        return publicAccount(queries.accountById.get(id));
      },
      remove: (id) => queries.accountDelete.run(id).changes > 0,
      markSynced(id) {
        const timestamp = now();
        queries.accountSynced.run(timestamp, timestamp, id);
      },
      avatar: (id) => queries.accountAvatar.get(id) || null,
    },
    messages: {
      get: (id) => publicMessage(queries.messageById.get(id)),
      getRaw: (id) => queries.messageById.get(id) || null,
      list({ accountId, folder = 'inbox', mailbox = 'INBOX', query = '', limit = 50, offset = 0 }) {
        const params = { accountId, folder, mailbox, query, likeQuery: `%${query}%`, limit, offset, now: now() };
        const items = queries.messageList.all(params).map(publicMessage);
        return { items, total: queries.messageCount.get(params).count };
      },
      forThread: (threadId) => queries.messagesByThread.all(threadId).map(publicMessage),
      findByRfcId: (accountId, messageId) => publicMessage(queries.messageByRfcId.get(accountId, messageId)),
      upsert(input) {
        const byUid = input.uid === null || input.uid === undefined
          ? null
          : db.prepare('SELECT * FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?').get(input.account_id, input.mailbox, input.uid);
        // A MOVE without UIDPLUS cannot tell us the destination UID. Reusing an
        // RFC Message-ID here prevents a later mailbox sync from duplicating it.
        const existing = byUid || (input.rfc_message_id
          ? queries.messageByRfcId.get(input.account_id, input.rfc_message_id)
          : null);
        const timestamp = now();
        const row = { ...input, updated_at: timestamp };
        if (existing) {
          row.id = existing.id;
          queries.messageUpdate.run(row);
          recomputeThread(existing.thread_id);
          if (existing.thread_id !== row.thread_id) recomputeThread(row.thread_id);
          return publicMessage(queries.messageById.get(existing.id));
        }
        row.id ||= randomUUID();
        row.created_at ||= timestamp;
        queries.messageInsert.run(row);
        recomputeThread(row.thread_id);
        return publicMessage(queries.messageById.get(row.id));
      },
      setState(id, state) {
        const row = queries.messageById.get(id);
        if (!row) return null;
        queries.messageState.run({
          id,
          updated_at: now(),
          is_read: state.isRead === undefined ? null : Number(Boolean(state.isRead)),
          is_starred: state.isStarred === undefined ? null : Number(Boolean(state.isStarred)),
          is_archived: state.isArchived === undefined ? null : Number(Boolean(state.isArchived)),
          is_trashed: state.isTrashed === undefined ? null : Number(Boolean(state.isTrashed)),
          is_spam: state.isSpam === undefined ? null : Number(Boolean(state.isSpam)),
          snoozed_until: state.snoozedUntil === undefined ? null : state.snoozedUntil,
        });
        recomputeThread(row.thread_id);
        return publicMessage(queries.messageById.get(id));
      },
      relocate(id, { mailbox, uid }) {
        const row = queries.messageById.get(id);
        if (!row) return null;
        queries.messageRelocate.run({ id, mailbox, uid, updated_at: now() });
        return publicMessage(queries.messageById.get(id));
      },
    },
    threads: {
      get: (id) => publicThread(queries.threadById.get(id)),
      findBySubject: (accountId, subject) => publicThread(queries.threadBySubject.get(accountId, subject)),
      list: ({ accountId, limit = 50, offset = 0 }) => queries.threadList.all({ accountId, limit, offset }).map(publicThread),
      create(input) {
        const id = randomUUID();
        const timestamp = now();
        queries.threadInsert.run({
          id,
          participants_json: '[]',
          snippet: '',
          message_count: 0,
          unread_count: 0,
          is_starred: 0,
          labels_json: '[]',
          created_at: timestamp,
          updated_at: timestamp,
          ...input,
        });
        return publicThread(queries.threadById.get(id));
      },
      recompute: (id) => publicThread(recomputeThread(id)),
    },
    sync: {
      get: (accountId, mailbox) => queries.syncState.get(accountId, mailbox) || null,
      save: (state) => queries.syncStateUpsert.run(state),
    },
    drafts: {
      get: (id) => publicDraft(queries.draftById.get(id)),
      list: (accountId) => queries.draftList.all(accountId).map(publicDraft),
      create(input) {
        const id = randomUUID();
        const timestamp = now();
        queries.draftInsert.run({ id, created_at: timestamp, updated_at: timestamp, ...input });
        return publicDraft(queries.draftById.get(id));
      },
      update(id, input) {
        const existing = queries.draftById.get(id);
        if (!existing) return null;
        queries.draftUpdate.run({ ...existing, ...input, id, updated_at: now() });
        return publicDraft(queries.draftById.get(id));
      },
      remove: (id) => queries.draftDelete.run(id).changes > 0,
    },
    settings: {
      list: () => Object.fromEntries(queries.settingList.all().map((row) => [row.key, json(row.value_json, null)])),
      get: (key) => {
        const row = queries.settingByKey.get(key);
        return row ? json(row.value_json, null) : undefined;
      },
      set: (key, value) => queries.settingUpsert.run(key, JSON.stringify(value), now()),
    },
    close: () => db.close(),
  };
}

export { json, stringify, now, publicAccount, publicMessage, publicThread, publicDraft };
