import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { IconButton } from './ui.jsx';

const MAX_FLAGS = 24;

function draftFromFlag(flag, index, colors) {
  return {
    key: flag.id || `flag-${index}-${Math.random().toString(36).slice(2, 8)}`,
    id: flag.id || '',
    label: flag.label || '',
    emails: Array.isArray(flag.emails) ? flag.emails.join(', ') : String(flag.emails || ''),
    color: flag.color || colors[index % colors.length],
  };
}

export function flagsToPayload(drafts) {
  return drafts
    .map((draft) => ({
      ...(draft.id ? { id: draft.id } : {}),
      label: draft.label.trim(),
      emails: draft.emails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean),
      color: draft.color,
    }))
    .filter((flag) => flag.label || flag.emails.length);
}

export function validateFlagDrafts(drafts) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const flag of flagsToPayload(drafts)) {
    if (!flag.label) return 'Every flag needs a name.';
    if (!flag.emails.length) return `Add at least one email address for "${flag.label}".`;
    const invalid = flag.emails.find((email) => !emailPattern.test(email));
    if (invalid) return `"${invalid}" is not a valid email address.`;
  }
  return '';
}

/**
 * Inline editor for the operator-defined "people folders". The whole list is
 * saved at once so the UI and agents (set_flags) share one canonical ordering.
 */
export function PersonFlagsEditor({ flags = [], colors = ['#0b57d0'], onSave, disabled = false }) {
  const [drafts, setDrafts] = useState(() => flags.map((flag, index) => draftFromFlag(flag, index, colors)));
  const [colorMenu, setColorMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setDrafts(flags.map((flag, index) => draftFromFlag(flag, index, colors)));
  }, [flags, colors, dirty]);

  const edit = (key, patch) => {
    setDirty(true);
    setError('');
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch } : draft));
  };
  const add = () => {
    setDirty(true);
    setDrafts((current) => [...current, draftFromFlag({}, current.length, colors)]);
  };
  const remove = (key) => {
    setDirty(true);
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  };
  const save = async () => {
    const problem = validateFlagDrafts(drafts);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(flagsToPayload(drafts));
      setDirty(false);
    } catch (saveError) {
      setError(saveError?.message || 'The flags could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setDirty(false);
    setError('');
    setDrafts(flags.map((flag, index) => draftFromFlag(flag, index, colors)));
  };

  return (
    <div className="flag-editor">
      {drafts.length === 0 && <p className="settings-description">No flagged people yet. {disabled ? 'Connect an account to configure flags.' : 'Add a person or team to give their mail its own folder.'}</p>}
      {drafts.map((draft) => (
        <div className="flag-editor-row" key={draft.key}>
          <button
            type="button"
            className="flag-color-swatch"
            style={{ '--swatch': draft.color }}
            aria-label={`Change color for ${draft.label || 'this flag'}`}
            onClick={() => setColorMenu((current) => current === draft.key ? null : draft.key)}
            disabled={disabled}
          />
          <div className="flag-editor-fields">
            <label className="form-field"><span>Name</span><input value={draft.label} onChange={(event) => edit(draft.key, { label: event.target.value })} placeholder="Priya, Support team, Landlord…" maxLength={60} disabled={disabled} /></label>
            <label className="form-field"><span>Email addresses <em>comma or newline separated</em></span><textarea value={draft.emails} onChange={(event) => edit(draft.key, { emails: event.target.value })} placeholder="priya@example.com, priya.work@example.com" spellCheck="false" autoCapitalize="none" disabled={disabled} /></label>
          </div>
          <IconButton label={`Remove ${draft.label || 'flag'}`} className="flag-editor-remove" onClick={() => remove(draft.key)} disabled={disabled}><Icon name="trash" size={17} /></IconButton>
          {colorMenu === draft.key && (
            <div className="flag-color-menu" role="radiogroup" aria-label="Flag color">
              {colors.map((color) => (
                <button type="button" key={color} role="radio" aria-checked={draft.color === color} className={draft.color === color ? 'is-selected' : ''} style={{ '--swatch': color }} aria-label={`Use ${color}`} onClick={() => { edit(draft.key, { color }); setColorMenu(null); }} />
              ))}
            </div>
          )}
        </div>
      ))}
      {error && <p className="flag-editor-error" role="alert">{error}</p>}
      <div className="flag-editor-actions">
        <button type="button" className="secondary-button" onClick={add} disabled={disabled || drafts.length >= MAX_FLAGS}><Icon name="plus" size={16} /> Add a person</button>
        {dirty && <button type="button" className="text-button" onClick={discard} disabled={saving}>Discard</button>}
        <button type="button" className="primary-button" onClick={save} disabled={disabled || saving || !dirty}>{saving ? 'Saving…' : 'Save flags'}</button>
      </div>
    </div>
  );
}
