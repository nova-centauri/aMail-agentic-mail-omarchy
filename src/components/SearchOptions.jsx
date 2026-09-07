import { useEffect, useMemo, useState } from 'react';
import { parseMailboxQuery, serializeMailboxQuery } from '../mail/search-query.js';

function fieldsFromQuery(query) {
  const parsed = parseMailboxQuery(query);
  const after = parsed.after ? parsed.after.slice(0, 10) : '';
  const before = parsed.before ? parsed.before.slice(0, 10) : '';
  return {
    from: parsed.from[0] || '',
    to: parsed.to[0] || '',
    subject: parsed.subject[0] || '',
    text: parsed.text || '',
    hasAttachment: parsed.hasAttachment === true,
    after,
    before,
    unread: parsed.isUnread === true,
    starred: parsed.isStarred === true,
    unanalyzed: parsed.isAnalyzed === false,
  };
}

function queryFromFields(fields) {
  return serializeMailboxQuery({
    text: fields.text.trim(),
    from: fields.from.trim() ? [fields.from.trim()] : [],
    to: fields.to.trim() ? [fields.to.trim()] : [],
    subject: fields.subject.trim() ? [fields.subject.trim()] : [],
    notFrom: [],
    notTo: [],
    notSubject: [],
    hasAttachment: fields.hasAttachment ? true : null,
    after: fields.after ? `${fields.after}T00:00:00.000Z` : null,
    before: fields.before ? `${fields.before}T00:00:00.000Z` : null,
    isUnread: fields.unread ? true : null,
    isStarred: fields.starred ? true : null,
    isAnalyzed: fields.unanalyzed ? false : null,
    folder: null,
  });
}

export function SearchOptions({ open, query, onApply, onClose }) {
  const snapshot = useMemo(() => fieldsFromQuery(query), [query]);
  const [fields, setFields] = useState(snapshot);
  useEffect(() => {
    if (open) setFields(fieldsFromQuery(query));
  }, [open, query]);
  if (!open) return null;
  const update = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFields((current) => ({ ...current, [key]: value }));
  };
  return (
    <form
      className="search-options"
      aria-label="Search options"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(queryFromFields(fields));
        onClose();
      }}
    >
      <div className="search-options-grid">
        <label>
          <span>From</span>
          <input value={fields.from} onChange={update('from')} placeholder="name or address" aria-label="From" />
        </label>
        <label>
          <span>To</span>
          <input value={fields.to} onChange={update('to')} placeholder="name or address" aria-label="To" />
        </label>
        <label>
          <span>Subject</span>
          <input value={fields.subject} onChange={update('subject')} placeholder="subject words" aria-label="Subject" />
        </label>
        <label>
          <span>Has the words</span>
          <input value={fields.text} onChange={update('text')} placeholder="invoice" aria-label="Has the words" />
        </label>
        <label>
          <span>After</span>
          <input type="date" value={fields.after} onChange={update('after')} aria-label="After date" />
        </label>
        <label>
          <span>Before</span>
          <input type="date" value={fields.before} onChange={update('before')} aria-label="Before date" />
        </label>
      </div>
      <div className="search-options-toggles">
        <label>
          <input type="checkbox" checked={fields.hasAttachment} onChange={update('hasAttachment')} />
          Has attachment
        </label>
        <label>
          <input type="checkbox" checked={fields.unread} onChange={update('unread')} />
          Unread
        </label>
        <label>
          <input type="checkbox" checked={fields.starred} onChange={update('starred')} />
          Starred
        </label>
        <label>
          <input type="checkbox" checked={fields.unanalyzed} onChange={update('unanalyzed')} />
          Not yet analyzed by an agent
        </label>
      </div>
      <div className="search-options-actions">
        <button type="submit" className="primary-button">Search</button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onApply('');
            onClose();
          }}
        >
          Clear
        </button>
      </div>
    </form>
  );
}
