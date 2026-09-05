import { useEffect, useState } from 'react';
import { UNIFIED_ACCOUNT } from '../mail/constants.js';
import { writeUiPrefs } from '../storage.js';
import { Icon } from './Icon.jsx';
import { SignatureEditor } from './SignatureEditor.jsx';
import { Avatar, IconButton, Toggle } from './ui.jsx';

export function SettingsPanel({
  open,
  onClose,
  accounts,
  activeAccount,
  setActiveAccount,
  privacy,
  setPrivacy,
  density,
  setDensity,
  onAddAccount,
  onUnlock,
  onSaveSignature,
  showUnified,
  passkeys = [],
  passkeysSupported = false,
  onAddPasskey,
  onDeletePasskey,
}) {
  const [signature, setSignature] = useState('');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  useEffect(() => setSignature(activeAccount?.signature || ''), [activeAccount?.id, activeAccount?.signature]);
  if (!open) return null;
  return (
    <>
      <button type="button" className="settings-scrim" onClick={onClose} aria-label="Close settings" />
      <aside className="settings-panel" aria-label="Quick settings">
        <div className="settings-header">
          <div className="settings-header-copy">
            <h2>Quick settings</h2>
            <p>Switch accounts and tune this mailbox.</p>
          </div>
          <IconButton label="Close settings" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="settings-scroll">
          <section className="settings-section">
            <h3>Accounts</h3>
            <p className="settings-description">Choose which identity you are reading and sending as.</p>
            <div className="settings-accounts">
              {showUnified && (
                <button type="button" className={`settings-account ${!activeAccount ? 'is-active' : ''}`} onClick={() => setActiveAccount(null)}>
                  <Avatar person={UNIFIED_ACCOUNT} size="md" />
                  <span className="settings-account-copy"><strong>All inboxes</strong><small>Unified inbox</small></span>
                  <span className="settings-account-meta">
                    <em className="status-pill">Unified</em>
                    <Icon name={!activeAccount ? 'check' : 'chevronRight'} size={18} />
                  </span>
                </button>
              )}
              {accounts.map((account) => (
                <button type="button" className={`settings-account ${activeAccount?.id === account.id ? 'is-active' : ''}`} key={account.id} onClick={() => setActiveAccount(account)}>
                  <Avatar person={account} size="md" />
                  <span className="settings-account-copy"><strong>{account.name}</strong><small>{account.email}</small></span>
                  <span className="settings-account-meta">
                    <em className={`status-pill ${account.connected ? 'is-connected' : 'is-attention'}`}>{account.connected ? 'Connected' : 'Needs attention'}</em>
                    <Icon name={activeAccount?.id === account.id ? 'check' : 'chevronRight'} size={18} />
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="add-account-button" onClick={onAddAccount}><Icon name="plus" size={18} /> Add another account</button>
          </section>
          <section className="settings-section">
            <h3>Density</h3>
            <p className="settings-description">How much space each conversation uses in the list.</p>
            <div className="density-options" role="radiogroup" aria-label="Mailbox density">
              {['Default', 'Comfortable', 'Compact'].map((option) => (
                <button
                  type="button"
                  key={option}
                  role="radio"
                  aria-checked={density === option}
                  onClick={() => setDensity(option)}
                  className={density === option ? 'is-selected' : ''}
                >
                  <span className={`density-preview density-${option.toLowerCase()}`}><i /><i /><i /></span>
                  {option}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section privacy-section">
            <div className="settings-section-title"><h3>Privacy</h3><Icon name="shield" size={20} /></div>
            <p className="settings-description">Keep email content from identifying you.</p>
            <div className="privacy-enforced">
              <span><strong>Block email trackers</strong><small>Always on for known tracking pixels, even when images are allowed.</small></span>
              <em><Icon name="shield" size={15} /> Locked on</em>
            </div>
            <Toggle
              checked={privacy.privateImages}
              onChange={(value) => setPrivacy((current) => {
                const next = { ...current, privateImages: value };
                writeUiPrefs({ privateImages: value });
                return next;
              })}
              label="Offer private image loading"
              hint="Show a per-message option to load non-tracking images through the aMail relay."
            />
          </section>
          <section className="settings-section signature-section">
            <h3>Signature</h3>
            <p className="settings-description">{activeAccount ? `Sent from ${activeAccount.email}. Upload HTML, paste HTML, or edit visually.` : 'Choose an account above to edit its sending signature.'}</p>
            <SignatureEditor
              value={signature}
              savedValue={activeAccount?.signature || ''}
              disabled={!activeAccount}
              onChange={setSignature}
              onSave={(next) => {
                if (activeAccount && next !== (activeAccount.signature || '')) onSaveSignature(activeAccount.id, next);
              }}
            />
          </section>
          <section className="settings-section server-access-section">
            <div className="settings-section-title"><h3>Passkeys</h3><Icon name="key" size={20} /></div>
            <p className="settings-description">One-tap unlock on this device. The access token remains a fallback.</p>
            {passkeys.length ? (
              <ul className="passkey-list">
                {passkeys.map((passkey) => (
                  <li key={passkey.id}>
                    <span>
                      <strong>{passkey.name || 'Passkey'}</strong>
                      <small>{passkey.lastUsedAt ? `Last used ${new Date(passkey.lastUsedAt).toLocaleString()}` : `Added ${new Date(passkey.createdAt).toLocaleDateString()}`}</small>
                    </span>
                    <button type="button" className="text-button" onClick={() => onDeletePasskey(passkey.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-description">No passkeys yet.</p>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={!passkeysSupported || passkeyBusy}
              onClick={async () => {
                setPasskeyBusy(true);
                try { await onAddPasskey(); } finally { setPasskeyBusy(false); }
              }}
            >
              {passkeyBusy ? 'Waiting for authenticator…' : 'Add a passkey'}
            </button>
          </section>
          <section className="settings-section server-access-section">
            <div className="settings-section-title"><h3>Server access</h3><Icon name="shield" size={20} /></div>
            <p className="settings-description">Set a session-only access token if this aMail server is protected.</p>
            <button type="button" className="secondary-button" onClick={onUnlock}>Unlock server</button>
          </section>
        </div>
      </aside>
    </>
  );
}
