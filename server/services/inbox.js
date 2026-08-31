import {
  getPersonFlag,
  HIDDEN_DEFAULT_CATEGORIES,
  isHiddenDefaultCategory,
  isPersonFlag,
  isSmartCategory,
  messageMatchesPersonFlag,
  PERSON_FLAGS,
  SMART_CATEGORY_SLUGS,
} from './smart-filter.js';
import { toFtsMatchQuery } from './fts.js';
import {
  conversationMatchesMailboxQuery,
  mailboxQueryIsActive,
  parseMailboxQuery,
} from '../mail/search-query.js';
import { publicAttachmentMeta } from './compose-attachments.js';
import { NotFoundError, ValidationError } from '../errors.js';

export const parseNumber = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export const normalizeFolder = (value) => {
  const folder = String(value || 'inbox').toLowerCase();
  return ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'all', 'trash', 'spam', 'archive'].includes(folder) ? folder : 'inbox';
};

export const normalizeCategory = (value) => {
  const category = String(value || '').trim().toLowerCase();
  if (!category || category === 'all') return '';
  // ops_quiet is intentionally not selectable as a smart-view chip; it only
  // exists so routine digests can be excluded from the default inbox.
  if (category === 'ops_quiet') {
    throw new ValidationError('Ops digests without errors are hidden. Use Ops errors for failures.');
  }
  if (!isSmartCategory(category) || isHiddenDefaultCategory(category)) {
    throw new ValidationError(`Unknown smart filter. Choose one of: ${SMART_CATEGORY_SLUGS.filter((slug) => !isHiddenDefaultCategory(slug)).join(', ')}.`);
  }
  return category;
};

export const normalizePersonFlag = (value) => {
  const flag = String(value || '').trim().toLowerCase();
  if (!flag) return '';
  if (!isPersonFlag(flag)) {
    throw new ValidationError(`Unknown person flag. Choose one of: ${PERSON_FLAGS.map((item) => item.id).join(', ')}.`);
  }
  return flag;
};

const emptyCategoryCounts = () => Object.fromEntries(
  SMART_CATEGORY_SLUGS
    .filter((category) => !isHiddenDefaultCategory(category))
    .map((category) => [category, 0]),
);

const conversationTouchesPersonFlag = (conversationMessages, flagId) => conversationMessages.some((message) => messageMatchesPersonFlag(message, flagId));

const emptyFolderCounts = () => ({ inbox: 0, starred: 0, snoozed: 0, drafts: 0 });

export const sumFolderCounts = (accounts, repos) => accounts.reduce((totals, account) => {
  const counts = repos.messages.folderCounts(account.id);
  return {
    inbox: totals.inbox + counts.inbox,
    starred: totals.starred + counts.starred,
    snoozed: totals.snoozed + counts.snoozed,
    drafts: totals.drafts + counts.drafts,
  };
}, emptyFolderCounts());

export function draftListItem(draft, account) {
  const id = `draft:${draft.id}`;
  return {
    id,
    threadId: id,
    latestMessageId: id,
    draftId: draft.id,
    isDraft: true,
    accountId: draft.accountId,
    mailbox: 'Drafts',
    folder: 'drafts',
    subject: draft.subject || '(no subject)',
    from: { name: account?.displayName || account?.email || '', email: account?.email || '' },
    to: draft.to || [],
    cc: draft.cc || [],
    bcc: draft.bcc || [],
    participants: draft.to || [],
    htmlBody: draft.htmlBody || '',
    textBody: draft.textBody || '',
    snippet: String(draft.textBody || draft.htmlBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sentAt: draft.updatedAt,
    receivedAt: draft.updatedAt,
    latestAt: draft.updatedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    isSpam: false,
    isSent: false,
    messageCount: 1,
    unreadCount: 0,
    labels: ['Draft'],
    attachments: (draft.attachments || []).map((attachment, index) => publicAttachmentMeta(attachment, index)),
    hasAttachments: Boolean((draft.attachments || []).length),
  };
}

/**
 * Unified conversation listing used by the REST API and MCP tools.
 * Returns the same shape as GET /api/messages.
 */
export function listConversations(repos, {
  accountId = null,
  folder: folderInput = 'inbox',
  category: categoryInput = '',
  personFlag: personFlagInput = '',
  page: pageInput = 1,
  pageSize: pageSizeInput = 50,
  query: queryInput = '',
  mailbox = 'INBOX',
} = {}) {
  const parsedQuery = parseMailboxQuery(String(queryInput || '').trim().slice(0, 800));
  const folder = normalizeFolder(parsedQuery.folder || folderInput);
  const category = normalizeCategory(categoryInput);
  const personFlag = normalizePersonFlag(personFlagInput);
  const page = parseNumber(pageInput, 1, 1, 100_000);
  const pageSize = parseNumber(pageSizeInput, 50, 1, 200);
  const query = parsedQuery.raw;
  const searchActive = mailboxQueryIsActive(parsedQuery);
  const ftsQuery = parsedQuery.text ? toFtsMatchQuery(parsedQuery.text) : '';
  const accounts = accountId ? [repos.accounts.get(accountId)].filter(Boolean) : repos.accounts.list();
  if (accountId && !accounts.length) throw new NotFoundError('Mail account not found.');

  if (folder === 'drafts') {
    const drafts = accounts.flatMap((account) => repos.drafts.list(account.id)
      .map((draft) => draftListItem(draft, account))
      .filter((draft) => {
        if (personFlag && !messageMatchesPersonFlag(draft, personFlag)) return false;
        if (!searchActive) return true;
        return conversationMatchesMailboxQuery(draft, parsedQuery);
      })
    ).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const start = (page - 1) * pageSize;
    return {
      messages: category ? [] : drafts.slice(start, start + pageSize),
      total: category ? 0 : drafts.length,
      page,
      pageSize,
      categoryCounts: emptyCategoryCounts(),
      folderCounts: sumFolderCounts(accounts, repos),
      personFlag: personFlag || null,
      personFlagMeta: personFlag ? getPersonFlag(personFlag) : null,
    };
  }

  const results = accounts.map((account) => {
    if (ftsQuery) {
      const threadIds = repos.messages.searchThreadIds({
        accountId: account.id,
        folder,
        mailbox: String(mailbox || 'INBOX'),
        ftsQuery,
        limit: Math.min(500, page * pageSize + pageSize),
      });
      return { items: repos.messages.forThreads(threadIds, { folder, mailbox: String(mailbox || 'INBOX') }) };
    }
    return repos.messages.list({
      accountId: account.id,
      folder,
      mailbox: String(mailbox || 'INBOX'),
      query: '',
      category: '',
      limit: 1000,
      offset: 0,
    });
  });
  const byThread = new Map();
  for (const message of results.flatMap((result) => result.items)) {
    const key = `${message.accountId}:${message.threadId}`;
    const existing = byThread.get(key);
    const messageTime = String(message.sentAt || message.receivedAt || message.createdAt);
    const existingTime = String(existing?.latest?.sentAt || existing?.latest?.receivedAt || existing?.latest?.createdAt || '');
    if (!existing) {
      byThread.set(key, { latest: message, messages: [message] });
    } else {
      existing.messages.push(message);
      if (messageTime > existingTime) existing.latest = message;
    }
  }
  const conversations = [...byThread.values()]
    .filter(({ messages }) => !personFlag || conversationTouchesPersonFlag(messages, personFlag))
    .filter(({ messages, latest }) => {
      // Explicit search can still find quiet digests. Unscoped browsing and
      // smart-category chips hide routine ops noise even when unread.
      if (searchActive) {
        return conversationMatchesMailboxQuery({ latest, messages }, parsedQuery, { skipText: Boolean(ftsQuery) });
      }
      if (category) return true;
      if (personFlag) return true;
      return !isHiddenDefaultCategory(latest.category);
    })
    .map(({ latest: latestMessage, messages }) => {
      const thread = repos.threads.get(latestMessage.threadId);
      const latestAt = latestMessage.sentAt || latestMessage.receivedAt || latestMessage.createdAt;
      return {
        ...latestMessage,
        // Gmail's list is made of conversations. The thread id is intentionally
        // the row id so every toolbar action can target all messages in it.
        id: latestMessage.threadId,
        threadId: latestMessage.threadId,
        latestMessageId: latestMessage.id,
        messageCount: thread?.messageCount || 1,
        unreadCount: thread?.unreadCount || 0,
        participants: thread?.participants || [latestMessage.from],
        latestAt,
        snippet: latestMessage.snippet,
        hasAttachments: Boolean(latestMessage.attachments?.length) || messages.some((message) => message.attachments?.length),
        isRead: (thread?.unreadCount || 0) === 0,
        isStarred: thread?.isStarred ?? latestMessage.isStarred,
        _threadMessages: messages,
        ...(folder === 'snoozed' ? { folder: 'snoozed' } : {}),
      };
    }).sort((left, right) =>
      String(right.latestAt || right.sentAt || right.receivedAt || right.createdAt).localeCompare(String(left.latestAt || left.sentAt || left.receivedAt || left.createdAt)));
  const categoryCounts = emptyCategoryCounts();
  for (const conversation of conversations) {
    if (isHiddenDefaultCategory(conversation.category)) continue;
    if (Object.hasOwn(categoryCounts, conversation.category)) categoryCounts[conversation.category] += 1;
  }
  const all = category
    ? conversations.filter((conversation) => conversation.category === category)
    : conversations;
  const start = (page - 1) * pageSize;
  const pageItems = all.slice(start, start + pageSize).map(({ _threadMessages, ...conversation }) => conversation);
  return {
    messages: pageItems,
    total: all.length,
    page,
    pageSize,
    categoryCounts,
    folderCounts: sumFolderCounts(accounts, repos),
    personFlag: personFlag || null,
    personFlagMeta: personFlag ? getPersonFlag(personFlag) : null,
  };
}
