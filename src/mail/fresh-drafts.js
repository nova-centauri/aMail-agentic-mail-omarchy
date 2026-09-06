import { formatListDate } from './dates.js';
import { normalizePerson, recipientArray } from './people.js';

export const FRESH_DRAFTS_LIMIT = 12;

export function normalizeFreshDraft(raw = {}) {
  const draftId = String(raw.draftId || raw.draft_id || String(raw.id || '').replace(/^draft:/, ''));
  const id = draftId;
  const subject = raw.subject === '(no subject)' ? '' : (raw.subject || '');
  const latest = Array.isArray(raw.messages) ? raw.messages.at(-1) : null;
  return {
    id,
    draftId,
    accountId: raw.accountId || raw.account_id || latest?.accountId || null,
    threadId: raw.threadId || raw.thread_id || null,
    to: raw.to || latest?.to || [],
    cc: raw.cc || latest?.cc || [],
    bcc: raw.bcc || latest?.bcc || [],
    subject,
    htmlBody: raw.htmlBody || raw.bodyHtml || latest?.bodyHtml || latest?.htmlBody || '',
    textBody: raw.textBody || raw.body || raw.snippet || latest?.body || latest?.textBody || '',
    attachments: raw.attachments || latest?.attachments || [],
    updatedAt: raw.updatedAt || raw.timestamp || latest?.timestamp || new Date().toISOString(),
    createdAt: raw.createdAt || raw.updatedAt || raw.timestamp || latest?.timestamp,
  };
}

export function draftRecipientLabel(draft) {
  const recipients = recipientArray(draft?.to);
  if (!recipients.length) return 'No recipient';
  const first = normalizePerson(recipients[0]);
  const label = first.name && first.name !== first.email ? first.name : (first.email || 'No recipient');
  if (recipients.length === 1) return label;
  return `${label} +${recipients.length - 1}`;
}

export function draftSubjectLabel(draft) {
  const subject = String(draft?.subject || '').trim();
  return subject || '(no subject)';
}

export function draftSavedLabel(draft) {
  return formatListDate(draft?.updatedAt || draft?.createdAt || draft?.timestamp);
}

export function isFreshDraft(draft, dismissedAtById = {}) {
  const id = String(draft?.id || draft?.draftId || '');
  if (!id) return false;
  const dismissedAt = dismissedAtById[id];
  if (!dismissedAt) return true;
  const updated = Date.parse(draft.updatedAt || draft.createdAt || draft.timestamp || 0);
  const dismissed = Date.parse(dismissedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(dismissed)) return true;
  return updated > dismissed;
}

export function visibleFreshDrafts(drafts, dismissedAtById = {}, { limit = FRESH_DRAFTS_LIMIT } = {}) {
  return (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => isFreshDraft(draft, dismissedAtById))
    .sort((left, right) => String(right.updatedAt || right.timestamp || '').localeCompare(String(left.updatedAt || left.timestamp || '')))
    .slice(0, Math.max(0, limit));
}

export function pruneDismissedFreshDrafts(dismissedAtById, drafts) {
  const current = dismissedAtById && typeof dismissedAtById === 'object' ? dismissedAtById : {};
  const ids = new Set((Array.isArray(drafts) ? drafts : []).map((draft) => String(draft?.id || draft?.draftId || '')).filter(Boolean));
  const next = {};
  let changed = false;
  for (const [id, at] of Object.entries(current)) {
    if (ids.has(id)) next[id] = at;
    else changed = true;
  }
  return changed ? next : current;
}
