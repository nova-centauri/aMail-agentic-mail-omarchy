import { describe, expect, it } from 'vitest';
import {
  draftRecipientLabel,
  draftSubjectLabel,
  isFreshDraft,
  normalizeFreshDraft,
  pruneDismissedFreshDrafts,
  visibleFreshDrafts,
} from './fresh-drafts.js';

describe('fresh drafts', () => {
  it('labels the first recipient and remaining count', () => {
    expect(draftRecipientLabel({ to: [] })).toBe('No recipient');
    expect(draftRecipientLabel({ to: [{ name: 'Phil', email: 'phil@midstaelitho.com' }] })).toBe('Phil');
    expect(draftRecipientLabel({
      to: [
        { name: 'Maya Chen', email: 'maya@studio.com' },
        { email: 'jordan@example.com' },
      ],
    })).toBe('Maya Chen +1');
  });

  it('falls back to (no subject) when the draft has no title', () => {
    expect(draftSubjectLabel({ subject: '' })).toBe('(no subject)');
    expect(draftSubjectLabel({ subject: '  Press reply  ' })).toBe('Press reply');
  });

  it('treats dismissed drafts as stale until they are saved again', () => {
    const draft = { id: 'd1', updatedAt: '2026-09-06T12:00:00.000Z' };
    expect(isFreshDraft(draft, {})).toBe(true);
    expect(isFreshDraft(draft, { d1: '2026-09-06T12:30:00.000Z' })).toBe(false);
    expect(isFreshDraft({ ...draft, updatedAt: '2026-09-06T13:00:00.000Z' }, { d1: '2026-09-06T12:30:00.000Z' })).toBe(true);
  });

  it('keeps the newest undismissed drafts and prunes leftover dismissals', () => {
    const drafts = [
      normalizeFreshDraft({ id: 'old', subject: 'Old', updatedAt: '2026-09-01T00:00:00.000Z' }),
      normalizeFreshDraft({ id: 'new', subject: 'New', to: ['ada@example.com'], updatedAt: '2026-09-06T00:00:00.000Z' }),
      normalizeFreshDraft({ id: 'gone', subject: 'Gone', updatedAt: '2026-09-05T00:00:00.000Z' }),
    ];
    const visible = visibleFreshDrafts(drafts, { gone: '2026-09-06T00:00:00.000Z' }, { limit: 1 });
    expect(visible.map((draft) => draft.id)).toEqual(['new']);
    expect(pruneDismissedFreshDrafts({ gone: '2026-09-06T00:00:00.000Z', extra: '2026-01-01T00:00:00.000Z' }, drafts)).toEqual({
      gone: '2026-09-06T00:00:00.000Z',
    });
  });
});
