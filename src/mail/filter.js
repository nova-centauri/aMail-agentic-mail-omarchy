import { SMART_CATEGORIES } from './constants.js';
import { smartCategoryMetadata } from './classify.js';
import { conversationMatchesMailboxQuery, mailboxQueryIsActive, parseMailboxQuery } from './search-query.js';
import { normalizePersonFlagEmail, recipientArray } from './people.js';

export function findPersonFlag(flags = [], flagId) {
  if (!flagId) return null;
  if (typeof flagId === 'object') return flagId;
  return flags.find((item) => item.id === flagId) || null;
}

export function conversationMatchesPersonFlag(thread, flagOrId, flags = []) {
  const flag = findPersonFlag(flags, flagOrId);
  if (!flag) return false;
  const wanted = new Set((flag.emails || []).map(normalizePersonFlagEmail));
  const people = [
    thread.from,
    ...(thread.participants || []),
    ...recipientArray(thread.to),
    ...recipientArray(thread.cc),
    ...recipientArray(thread.replyTo),
    ...(thread.messages || []).flatMap((message) => [
      message.from,
      ...recipientArray(message.to),
      ...recipientArray(message.cc),
      ...recipientArray(message.replyTo),
    ]),
  ];
  return people.some((person) => {
    const email = normalizePersonFlagEmail(person?.email || person?.address || person || '');
    return email && wanted.has(email);
  });
}

export function countSmartCategories(threads = []) {
  const counts = Object.fromEntries(SMART_CATEGORIES.filter((item) => item.id !== 'all').map((item) => [item.id, 0]));
  threads.forEach((thread) => {
    const category = smartCategoryMetadata(thread).category;
    if (Object.hasOwn(counts, category)) counts[category] += 1;
  });
  return counts;
}

export function filterVisibleThreads(threads, {
  activeFolder = 'inbox',
  activeCategory = 'all',
  activePersonFlag = null,
  personFlags = [],
  query = '',
} = {}) {
  const parsed = parseMailboxQuery(query);
  const searchActive = mailboxQueryIsActive(parsed);
  const folder = parsed.folder || activeFolder;
  const flag = findPersonFlag(personFlags, activePersonFlag);
  return threads.filter((thread) => {
    const inFolder = folder === 'all' || thread.folder === folder || (folder === 'starred' && thread.starred) || (folder === 'drafts' && thread.folder === 'drafts');
    if (!inFolder) return false;
    if (activePersonFlag && !conversationMatchesPersonFlag(thread, flag)) return false;
    if (!activePersonFlag && folder === 'inbox' && activeCategory !== 'all' && smartCategoryMetadata(thread).category !== activeCategory) return false;
    if (!searchActive && !activePersonFlag && (activeCategory === 'all' || activeCategory === 'primary') && smartCategoryMetadata(thread).category === 'ops_quiet') return false;
    if (!searchActive) return true;
    return conversationMatchesMailboxQuery(thread, parsed);
  });
}
