import { randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { decryptJson } from './crypto.js';
import { sanitizeEmailHtml, textSnippet, toSafeHtmlFromText } from './message-html.js';
import {
  addressList,
  appendSignature,
  buildAuth,
  folderForMailbox,
  normalizeMessageIds,
  normalizeSubject,
  recipientList,
  recipientsToHeader,
} from '../utils/mail.js';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../errors.js';
import { stringify } from '../db.js';

const asIso = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : new Date().toISOString();
};

const cleanupError = (error) => String(error?.message || error || 'Unknown mail error').replace(/(?:pass(?:word)?|token)\s*[:=]\s*\S+/ig, '[redacted]').slice(0, 500);

function setValues(value) {
  return value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
}

function serializeAddresses(value) {
  return stringify(addressList(value));
}

function sender(value) {
  return addressList(value)[0] || { name: '', email: '' };
}

function attachmentMetadata(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename || 'attachment',
    contentType: attachment.contentType || 'application/octet-stream',
    size: Number(attachment.size || attachment.content?.length || 0),
    contentId: attachment.cid || null,
  }));
}

function buildImapOptions(account, credentials, config) {
  return {
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.imap_secure),
    auth: buildAuth(credentials, account.email),
    logger: false,
    socketTimeout: config.syncTimeoutMs,
    tls: { rejectUnauthorized: !config.allowInsecureTls },
  };
}

function buildSmtpTransport(account, credentials, config) {
  return nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: Boolean(account.smtp_secure),
    auth: buildAuth(credentials, account.email),
    tls: { rejectUnauthorized: !config.allowInsecureTls },
    connectionTimeout: config.syncTimeoutMs,
    greetingTimeout: config.syncTimeoutMs,
    socketTimeout: config.syncTimeoutMs,
  });
}

const MOVE_SPECIAL_USE = {
  archive: ['\\Archive', '\\All'],
  trash: ['\\Trash'],
  spam: ['\\Junk'],
};

function remoteMoveAction(state) {
  // Trash and Junk take precedence because the spam endpoint also marks the
  // message archived locally for list filtering.
  if (state.isTrashed === true) return 'trash';
  if (state.isSpam === true) return 'spam';
  if (state.isArchived === true) return 'archive';
  return null;
}

function specialUseDestination(folders, action) {
  const choices = MOVE_SPECIAL_USE[action] || [];
  return folders.find((folder) => choices.includes(String(folder.specialUse || '')))?.path || null;
}

function mappedUid(moveResult, sourceUid) {
  const value = moveResult?.uidMap instanceof Map ? moveResult.uidMap.get(sourceUid) : null;
  const uid = Number(value);
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

const SYNC_FOLDER_FALLBACKS = {
  inbox: ['inbox'],
  sent: ['sent', 'sent mail', 'sent items', 'sent messages'],
  archive: ['archive', 'archives'],
  all: ['all mail', 'all messages'],
  trash: ['trash', 'bin', 'deleted items', 'deleted messages'],
  spam: ['spam', 'junk', 'junk email', 'bulk mail'],
};

function normalizedFolderName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasSpecialUse(folder, values) {
  return values.includes(String(folder?.specialUse || ''));
}

function conventionalFolder(folders, names) {
  return folders.find((folder) => {
    const name = normalizedFolderName(folder.name);
    const path = normalizedFolderName(folder.path);
    return names.includes(name) || names.includes(path);
  }) || null;
}

/**
 * Pick only portable/special-use folders. The `\\All` fallback lets Gmail
 * installations surface archived mail when no separate `\\Archive` exists.
 */
export function discoverSyncMailboxes(folders) {
  const inbox = folders.find((folder) => hasSpecialUse(folder, ['\\Inbox']))
    || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.inbox);
  const sent = folders.find((folder) => hasSpecialUse(folder, ['\\Sent']))
    || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.sent);
  let archive = folders.find((folder) => hasSpecialUse(folder, ['\\Archive']))
    || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.archive);
  let allMailMirror = false;
  if (!archive) {
    archive = folders.find((folder) => hasSpecialUse(folder, ['\\All']))
      || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.all);
    allMailMirror = Boolean(archive);
  }
  const trash = folders.find((folder) => hasSpecialUse(folder, ['\\Trash']))
    || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.trash);
  const spam = folders.find((folder) => hasSpecialUse(folder, ['\\Junk']))
    || conventionalFolder(folders, SYNC_FOLDER_FALLBACKS.spam);

  const candidates = [
    { role: 'inbox', mailbox: inbox?.path || 'INBOX', allMailMirror: false },
    sent && { role: 'sent', mailbox: sent.path, allMailMirror: false },
    archive && { role: 'archive', mailbox: archive.path, allMailMirror },
    trash && { role: 'trash', mailbox: trash.path, allMailMirror: false },
    spam && { role: 'spam', mailbox: spam.path, allMailMirror: false },
  ].filter(Boolean);

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.mailbox)) return false;
    seen.add(candidate.mailbox);
    return true;
  });
}

export function createMailService({ config, repos, logger }) {
  function accountAndCredentials(accountId) {
    const account = repos.accounts.getRaw(accountId);
    if (!account) throw new NotFoundError('Mail account not found.');
    return { account, credentials: decryptJson(account.credential_ciphertext, config.credentialKey) };
  }

  function resolveThread({ accountId, subject, inReplyTo, references, threadId }) {
    if (threadId) {
      const direct = repos.threads.get(threadId);
      if (direct?.accountId === accountId) return direct;
    }
    const candidates = [inReplyTo, ...[...references].reverse()].filter(Boolean);
    for (const messageId of candidates) {
      const parent = repos.messages.findByRfcId(accountId, messageId);
      if (parent?.threadId) return repos.threads.get(parent.threadId);
    }
    const normalizedSubject = normalizeSubject(subject);
    if (normalizedSubject) {
      const existing = repos.threads.findBySubject(accountId, normalizedSubject);
      if (existing) return existing;
    }
    return repos.threads.create({
      account_id: accountId,
      subject: subject || '(no subject)',
      normalized_subject: normalizedSubject,
      latest_at: new Date().toISOString(),
    });
  }

  async function ingestImapMessage({ account, mailbox, role, allMailMirror = false, message }) {
    if (!message.source) return null;
    const parsed = await simpleParser(message.source);
    const envelope = message.envelope || {};
    const messageId = parsed.messageId || envelope.messageId || null;
    const references = normalizeMessageIds(parsed.references || envelope.references);
    const inReplyTo = normalizeMessageIds(parsed.inReplyTo || envelope.inReplyTo)[0] || null;
    const subject = parsed.subject || envelope.subject || '(no subject)';
    const parsedFrom = parsed.from || envelope.from;
    const parsedTo = parsed.to || envelope.to;
    const parsedCc = parsed.cc || envelope.cc;
    const parsedBcc = parsed.bcc || envelope.bcc;
    const flags = new Set(setValues(message.flags));
    const labels = setValues(message.labels).map(String);
    const mailboxRole = role || folderForMailbox(mailbox);
    const isSent = mailboxRole === 'sent';
    const sanitized = parsed.html
      ? sanitizeEmailHtml(parsed.html)
      : sanitizeEmailHtml(toSafeHtmlFromText(parsed.text || ''));
    const plainText = parsed.text || textSnippet(parsed.html || '');
    // Gmail's \All mirror contains copies of inbox/sent messages. Inbox and Sent
    // are synchronized first, so retain their canonical local placement instead
    // of turning those copies into duplicate archived conversations.
    if (allMailMirror && messageId) {
      const existing = repos.messages.findByRfcId(account.id, messageId);
      if (existing && existing.mailbox !== mailbox) return existing;
    }
    const thread = resolveThread({ accountId: account.id, subject, inReplyTo, references });
    const receivedAt = asIso(message.internalDate || parsed.date || envelope.date);

    return repos.messages.upsert({
      account_id: account.id,
      thread_id: thread.id,
      mailbox,
      uid: Number.isInteger(message.uid) ? message.uid : null,
      rfc_message_id: messageId,
      in_reply_to: inReplyTo,
      references_json: stringify(references),
      subject,
      from_name: sender(parsedFrom).name,
      from_email: sender(parsedFrom).email,
      to_json: serializeAddresses(parsedTo),
      cc_json: serializeAddresses(parsedCc),
      bcc_json: serializeAddresses(parsedBcc),
      reply_to_json: stringify(addressList(parsed.replyTo || envelope.replyTo), null),
      sent_at: asIso(parsed.date || envelope.date || message.internalDate),
      received_at: receivedAt,
      html_body: sanitized.html,
      text_body: plainText,
      snippet: textSnippet(plainText || parsed.html),
      attachments_json: stringify(attachmentMetadata(parsed.attachments)),
      labels_json: stringify(labels),
      is_read: flags.has('\\Seen') ? 1 : 0,
      is_starred: flags.has('\\Flagged') ? 1 : 0,
      is_archived: mailboxRole === 'archive' ? 1 : 0,
      is_trashed: mailboxRole === 'trash' ? 1 : 0,
      is_spam: mailboxRole === 'spam' ? 1 : 0,
      snoozed_until: null,
      is_sent: isSent ? 1 : 0,
    });
  }

  async function syncMailbox({ account, client, descriptor, limit }) {
    const { mailbox, role, allMailMirror = false } = descriptor;
    let lock;
    let imported = 0;
    const previousSync = repos.sync.get(account.id, mailbox);
    let lastUid = previousSync?.last_uid || 0;
    let uidValidity = null;
    try {
      lock = await client.getMailboxLock(mailbox);
      uidValidity = Number(client.mailbox?.uidValidity) || null;
      if (previousSync?.uid_validity && uidValidity && previousSync.uid_validity !== uidValidity) {
        logger.info({ accountId: account.id, mailbox }, 'IMAP UIDVALIDITY changed; resynchronizing mailbox window');
        lastUid = 0;
      }
      const uidNext = Number(client.mailbox?.uidNext || 0);
      const latestUid = Math.max(0, uidNext - 1);
      if (latestUid > lastUid) {
        const firstUid = Math.max(lastUid + 1, latestUid - limit + 1, 1);
        for await (const message of client.fetch(`${firstUid}:*`, {
          uid: true,
          envelope: true,
          flags: true,
          labels: true,
          internalDate: true,
          source: true,
        }, { uid: true })) {
          const saved = await ingestImapMessage({ account, mailbox, role, allMailMirror, message });
          if (saved) imported += 1;
          lastUid = Math.max(lastUid, Number(message.uid || 0));
        }
      }
      repos.sync.save({
        account_id: account.id,
        mailbox,
        last_uid: lastUid,
        uid_validity: uidValidity,
        last_error: null,
        synced_at: new Date().toISOString(),
      });
      repos.accounts.markSynced(account.id);
      return { mailbox, role, status: 'ok', imported, lastUid };
    } catch (error) {
      repos.sync.save({
        account_id: account.id,
        mailbox,
        last_uid: lastUid,
        uid_validity: uidValidity || Number(client.mailbox?.uidValidity) || null,
        last_error: cleanupError(error),
        synced_at: new Date().toISOString(),
      });
      logger.warn({ accountId: account.id, mailbox, err: cleanupError(error) }, 'IMAP mailbox synchronization failed');
      throw error;
    } finally {
      lock?.release();
    }
  }

  async function syncAccount(accountId, { mailbox, limit = config.syncBatchSize } = {}) {
    const { account, credentials } = accountAndCredentials(accountId);
    const explicitMailbox = typeof mailbox === 'string' && mailbox.trim() ? mailbox.trim() : null;
    // Existing UI clients ask to sync "INBOX". Treat that as the normal account
    // bundle so Sent/Archive/Trash/Spam arrive too; another mailbox is an
    // intentional targeted synchronization request.
    const singleMailbox = explicitMailbox && explicitMailbox.toLowerCase() !== 'inbox';
    if (!account.sync_enabled) {
      return {
        accountId,
        ...(singleMailbox ? { mailbox: explicitMailbox } : {}),
        skipped: true,
        reason: 'Sync is disabled for this account.',
        mailboxes: [],
      };
    }
    const client = new ImapFlow(buildImapOptions(account, credentials, config));
    try {
      await client.connect();
    } catch (error) {
      logger.warn({ accountId, err: cleanupError(error) }, 'IMAP connection for synchronization failed');
      await client.logout().catch(() => {});
      throw new ServiceUnavailableError('Could not synchronize this account. Check its IMAP settings and app password.', 'IMAP_SYNC_FAILED');
    }

    try {
      const descriptors = singleMailbox
        ? [{ mailbox: explicitMailbox, role: folderForMailbox(explicitMailbox), allMailMirror: false }]
        : discoverSyncMailboxes(await client.list());
      const mailboxes = [];
      for (const descriptor of descriptors) {
        try {
          mailboxes.push(await syncMailbox({ account, client, descriptor, limit }));
        } catch {
          const failed = { mailbox: descriptor.mailbox, role: descriptor.role, status: 'failed', imported: 0, error: 'IMAP_SYNC_FAILED' };
          mailboxes.push(failed);
          if (singleMailbox) {
            throw new ServiceUnavailableError('Could not synchronize this mailbox. Check its IMAP settings and app password.', 'IMAP_SYNC_FAILED');
          }
        }
      }
      const imported = mailboxes.reduce((sum, item) => sum + (item.imported || 0), 0);
      const status = mailboxes.some((item) => item.status === 'failed')
        ? (mailboxes.some((item) => item.status === 'ok') ? 'partial' : 'failed')
        : 'ok';
      if (singleMailbox) {
        const summary = mailboxes[0] || { mailbox: explicitMailbox, imported: 0, lastUid: 0, status };
        return { accountId, mailbox: explicitMailbox, imported: summary.imported || 0, lastUid: summary.lastUid || 0, status, mailboxes };
      }
      return { accountId, imported, status, mailboxes };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async function syncAll({ mailbox = null, limit } = {}) {
    const accounts = repos.accounts.list().filter((account) => account.syncEnabled);
    const singleMailbox = typeof mailbox === 'string' && mailbox.trim() && mailbox.trim().toLowerCase() !== 'inbox';
    const results = [];
    for (const account of accounts) {
      try {
        results.push(await syncAccount(account.id, { mailbox, limit }));
      } catch (error) {
        results.push({ accountId: account.id, ...(singleMailbox ? { mailbox } : {}), status: 'failed', mailboxes: [], error: error.code || 'IMAP_SYNC_FAILED' });
      }
    }
    return results;
  }

  async function testAccount(accountId) {
    const { account, credentials } = accountAndCredentials(accountId);
    const client = new ImapFlow(buildImapOptions(account, credentials, config));
    try {
      await client.connect();
      return { imap: true };
    } catch {
      throw new ServiceUnavailableError('IMAP connection test failed. Check the account settings.', 'IMAP_TEST_FAILED');
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async function sendMessage(input) {
    const { account, credentials } = accountAndCredentials(input.accountId);
    const to = recipientList(input.to, 'To');
    const cc = recipientList(input.cc, 'Cc');
    const bcc = recipientList(input.bcc, 'Bcc');
    if (!to.length && !cc.length && !bcc.length) throw new ValidationError('At least one recipient is required.');

    const parent = input.replyToMessageId ? repos.messages.findByRfcId(account.id, input.replyToMessageId) : null;
    const subject = String(input.subject || parent?.subject || '').trim() || '(no subject)';
    const references = [...new Set([...(parent?.references || []), parent?.messageId].filter(Boolean))];
    const thread = resolveThread({
      accountId: account.id,
      subject,
      inReplyTo: parent?.messageId || input.inReplyTo,
      references,
      threadId: input.threadId,
    });
    const signed = appendSignature({
      html: String(input.htmlBody || ''),
      text: String(input.textBody || textSnippet(input.htmlBody || '')),
      signature: account.signature,
      includeSignature: input.includeSignature !== false,
    });
    const transport = buildSmtpTransport(account, credentials, config);
    let result;
    try {
      result = await transport.sendMail({
        from: { name: account.display_name, address: account.email },
        to: recipientsToHeader(to),
        cc: recipientsToHeader(cc) || undefined,
        bcc: recipientsToHeader(bcc) || undefined,
        subject,
        text: signed.text,
        html: signed.html || undefined,
        inReplyTo: parent?.messageId || input.inReplyTo || undefined,
        references: references.length ? references.join(' ') : undefined,
        headers: { 'X-Mailer': 'GigaMail' },
      });
    } catch (error) {
      logger.warn({ accountId: account.id, err: cleanupError(error) }, 'SMTP send failed');
      throw new ServiceUnavailableError('Message could not be sent. Check SMTP settings and app password.', 'SMTP_SEND_FAILED');
    } finally {
      transport.close?.();
    }

    const messageId = result.messageId || `<${randomUUID()}@gigamail.local>`;
    const sanitized = sanitizeEmailHtml(signed.html || toSafeHtmlFromText(signed.text));
    const saved = repos.messages.upsert({
      account_id: account.id,
      thread_id: thread.id,
      mailbox: 'Sent',
      uid: null,
      rfc_message_id: messageId,
      in_reply_to: parent?.messageId || input.inReplyTo || null,
      references_json: stringify(references),
      subject,
      from_name: account.display_name,
      from_email: account.email,
      to_json: stringify(to),
      cc_json: stringify(cc),
      bcc_json: stringify(bcc),
      reply_to_json: null,
      sent_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      html_body: sanitized.html,
      text_body: signed.text,
      snippet: textSnippet(signed.text),
      attachments_json: '[]',
      labels_json: '[]',
      is_read: 1,
      is_starred: 0,
      is_archived: 0,
      is_trashed: 0,
      is_spam: 0,
      snoozed_until: null,
      is_sent: 1,
    });
    if (input.draftId) repos.drafts.remove(input.draftId);
    return saved;
  }

  async function syncMessageStateToImap(message, state) {
    // IMAP has no portable Snooze command or special-use flag. Keep the local
    // snooze timestamp authoritative rather than pretending it was synced.
    if (state.snoozedUntil !== undefined) {
      return {
        message,
        remoteSync: { attempted: false, status: 'local-only', reason: 'snooze-is-not-portable-imap' },
      };
    }
    if (!Number.isInteger(message.uid) || message.uid < 1) {
      return {
        message,
        remoteSync: { attempted: false, status: 'local-only', reason: 'message-has-no-imap-uid' },
      };
    }
    const { account, credentials } = accountAndCredentials(message.accountId);
    const client = new ImapFlow(buildImapOptions(account, credentials, config));
    let lock;
    const action = remoteMoveAction(state);
    try {
      await client.connect();
      let destination = null;
      if (action) {
        destination = specialUseDestination(await client.list(), action);
        if (!destination) {
          return {
            message,
            remoteSync: { attempted: false, status: 'skipped', action, reason: 'special-use-mailbox-not-found' },
          };
        }
        if (destination === message.mailbox) {
          return {
            message,
            remoteSync: { attempted: false, status: 'skipped', action, reason: 'already-in-destination', destination },
          };
        }
      }
      lock = await client.getMailboxLock(message.mailbox || 'INBOX');
      if (state.isRead !== undefined) {
        const method = state.isRead ? 'messageFlagsAdd' : 'messageFlagsRemove';
        await client[method](message.uid, ['\\Seen'], { uid: true });
      }
      if (state.isStarred !== undefined) {
        const method = state.isStarred ? 'messageFlagsAdd' : 'messageFlagsRemove';
        await client[method](message.uid, ['\\Flagged'], { uid: true });
      }
      if (!action) {
        return { message, remoteSync: { attempted: true, status: 'synced', action: 'flags' } };
      }
      // ImapFlow uses MOVE when available and safely falls back to COPY +
      // EXPUNGE for servers lacking RFC 6851 support.
      const moveResult = await client.messageMove(message.uid, destination, { uid: true });
      if (!moveResult) throw new Error(`IMAP ${action} move was rejected`);

      let movedMessage = message;
      let tracking = 'awaiting-mailbox-sync';
      try {
        movedMessage = repos.messages.relocate(message.id, {
          mailbox: destination,
          // UIDPLUS gives us the destination UID. Without it, null prevents a
          // later flag mutation from accidentally targeting a stale source UID.
          uid: mappedUid(moveResult, message.uid),
        }) || message;
        tracking = movedMessage.uid ? 'updated' : 'awaiting-mailbox-sync';
      } catch (error) {
        logger.warn({ messageId: message.id, err: cleanupError(error) }, 'IMAP move succeeded but local UID tracking could not be updated');
        tracking = 'untracked';
      }
      return {
        message: movedMessage,
        remoteSync: { attempted: true, status: 'moved', action, destination, tracking },
      };
    } finally {
      lock?.release();
      await client.logout().catch(() => {});
    }
  }

  async function updateMessageState(id, state) {
    const existing = repos.messages.get(id);
    if (!existing) throw new NotFoundError('Message not found.');
    const updated = repos.messages.setState(id, state);
    // Mail mutations are intentionally best-effort so offline local state stays
    // usable. The API response says whether IMAP accepted, skipped, or failed it.
    try {
      const { message, remoteSync } = await syncMessageStateToImap(updated, state);
      return { ...message, remoteSync };
    } catch (error) {
      logger.warn({ messageId: id, err: cleanupError(error) }, 'Could not synchronize message mutation to IMAP');
      return {
        ...updated,
        remoteSync: { attempted: true, status: 'failed', reason: 'imap-operation-failed' },
      };
    }
  }

  return { syncAccount, syncAll, testAccount, sendMessage, updateMessageState };
}
