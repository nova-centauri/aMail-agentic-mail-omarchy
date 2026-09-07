import { draftRecipientLabel, draftSavedLabel, draftSubjectLabel } from '../mail/fresh-drafts.js';
import { Icon } from './Icon.jsx';
import { IconButton } from './ui.jsx';

export function FreshDraftsCard({ drafts, onOpen, onDismiss, onDelete, onViewAll, onContextMenu }) {
  if (!drafts?.length) return null;
  return (
    <section className="fresh-drafts-card" aria-label="Fresh drafts">
      <div className="fresh-drafts-intro">
        <span className="fresh-drafts-mark"><Icon name="draft" size={16} /></span>
        <span>
          <strong>Fresh Drafts</strong>
          <small>Review, edit, then send</small>
        </span>
        {onViewAll ? (
          <button type="button" className="fresh-drafts-all" onClick={onViewAll}>
            View all
          </button>
        ) : null}
      </div>
      <div className="fresh-drafts-scroll" role="list">
        {drafts.map((draft) => {
          const recipient = draftRecipientLabel(draft);
          const subject = draftSubjectLabel(draft);
          const saved = draftSavedLabel(draft);
          return (
            <article key={draft.id} className="fresh-draft-pill" role="listitem" onContextMenu={onContextMenu ? (event) => onContextMenu(event, draft) : undefined}>
              <button
                type="button"
                className="fresh-draft-open"
                onClick={() => onOpen(draft)}
                aria-label={`Open draft to ${recipient}: ${subject}, saved ${saved}`}
              >
                <span className="fresh-draft-to">{recipient}</span>
                <span className="fresh-draft-meta">
                  <span className="fresh-draft-subject">{subject}</span>
                  <time dateTime={draft.updatedAt || draft.createdAt}>{saved}</time>
                </span>
              </button>
              <IconButton className="fresh-draft-action" label={`Dismiss draft to ${recipient}`} onClick={() => onDismiss(draft)}>
                <Icon name="close" size={14} />
              </IconButton>
              <IconButton className="fresh-draft-action" label={`Delete draft to ${recipient}`} onClick={() => onDelete(draft)}>
                <Icon name="trash" size={14} />
              </IconButton>
            </article>
          );
        })}
      </div>
    </section>
  );
}
