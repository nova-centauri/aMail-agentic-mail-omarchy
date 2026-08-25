import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PROVIDER_PRESETS } from '../mail/constants.js';
import { normalizeAccount } from '../mail/normalize.js';
import { Icon } from './Icon.jsx';
import { Avatar, IconButton } from './ui.jsx';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The profile image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function accountConnectionError(error) {
  if (error?.status === 401 || error?.status === 403) return 'Unlock GigaMail before adding an account.';
  if (error?.status === 409) return error.message || 'An account with this email is already connected.';
  if (error?.code === 'CREDENTIAL_ENCRYPTION_UNAVAILABLE') {
    return error.message || 'Credential encryption is not configured on this GigaMail server.';
  }
  const safeMessage = String(error?.message || '').trim();
  if (safeMessage && !safeMessage.startsWith('<') && safeMessage.length <= 360 && error?.status >= 400 && error?.status < 600) return safeMessage;
  return 'Could not verify this account. Check the email, server settings, and app password, then try again.';
}

export function AddAccountModal({ onClose, onAdded }) {
  const initialProvider = PROVIDER_PRESETS.gmail;
  const [step, setStep] = useState('provider');
  const [form, setForm] = useState({
    name: '',
    email: '',
    username: '',
    imapUsername: '',
    providerKey: initialProvider.id,
    appPassword: '',
    signature: '',
    color: initialProvider.color,
    imapHost: initialProvider.imapHost,
    imapPort: initialProvider.imapPort,
    smtpHost: initialProvider.smtpHost,
    smtpPort: initialProvider.smtpPort,
    avatarUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [savingPhase, setSavingPhase] = useState('');
  const [protocolStatus, setProtocolStatus] = useState({ imap: 'idle', smtp: 'idle' });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const firstProviderRef = useRef(null);
  const emailRef = useRef(null);
  const savingRef = useRef(false);
  const selectedProvider = PROVIDER_PRESETS[form.providerKey] || PROVIDER_PRESETS.custom;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateEmail = (event) => {
    const value = event.target.value;
    setForm((current) => {
      const previousLocalPart = current.email.split('@')[0];
      return {
        ...current,
        email: value,
        username: !current.username || current.username === current.email ? value : current.username,
        imapUsername: current.providerKey === 'icloud' && (!current.imapUsername || current.imapUsername === previousLocalPart) ? value.split('@')[0] : current.imapUsername,
      };
    });
  };
  const chooseProvider = (providerKey) => {
    const provider = PROVIDER_PRESETS[providerKey];
    setForm((current) => ({
      ...current,
      providerKey,
      username: current.email,
      imapUsername: providerKey === 'icloud' ? current.email.split('@')[0] : '',
      appPassword: '',
      color: provider.color,
      imapHost: provider.imapHost,
      imapPort: provider.imapPort,
      smtpHost: provider.smtpHost,
      smtpPort: provider.smtpPort,
    }));
    setError('');
    setPasswordVisible(false);
    setProtocolStatus({ imap: 'idle', smtp: 'idle' });
    setStep('details');
    window.requestAnimationFrame(() => emailRef.current?.focus());
  };
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    firstProviderRef.current?.focus();
    const handleDialogKeys = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      previousFocus?.focus?.();
    };
  }, []); // The modal is mounted for one onboarding session.
  const chooseAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file for the profile photo.'); return; }
    if (file.size > 1_000_000) { setError('Choose a profile photo smaller than 1 MB.'); return; }
    try {
      const avatarUrl = await readFileAsDataUrl(file);
      setForm((current) => ({ ...current, avatarUrl }));
      setError('');
    } catch (readError) { setError(readError.message); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (step !== 'details') return;
    const email = form.email.trim().toLowerCase();
    const password = form.providerKey === 'gmail' ? form.appPassword.replace(/\s/g, '') : form.appPassword.trim();
    if (!email || !password) { setError(`Email address and ${form.providerKey === 'mailinabox' ? 'a mailbox password' : 'an app password'} are required.`); return; }
    if (!form.imapHost.trim() || !form.smtpHost.trim()) { setError('Add both IMAP and SMTP server hosts.'); return; }
    if (![form.imapPort, form.smtpPort].every((port) => Number(port) > 0 && Number(port) <= 65535)) { setError('Enter valid IMAP and SMTP ports.'); return; }
    savingRef.current = true;
    setSaving(true);
    setSavingPhase('Checking IMAP & SMTP…');
    setProtocolStatus({ imap: 'checking', smtp: 'checking' });
    setError('');
    const displayName = form.name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const payload = {
      name: displayName,
      displayName,
      email,
      provider: selectedProvider.provider,
      credentials: {
        username: form.username.trim() || email,
        email,
        password,
        ...(form.providerKey === 'icloud' ? { imapUsername: form.imapUsername.trim() || email.split('@')[0], smtpUsername: email } : {}),
      },
      signature: form.signature,
      color: form.color,
      avatarDataUrl: form.avatarUrl || undefined,
      imap: { host: form.imapHost.trim(), port: Number(form.imapPort) || 993, secure: Number(form.imapPort) === 993 },
      smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort) || 465, secure: Number(form.smtpPort) === 465 },
    };
    let savingPhaseTimer;
    try {
      savingPhaseTimer = window.setTimeout(() => setSavingPhase('Verifying & saving securely…'), 1200);
      const result = await api('/accounts', { method: 'POST', body: JSON.stringify(payload) });
      setProtocolStatus({ imap: 'passed', smtp: 'passed' });
      onAdded(normalizeAccount(result?.account || result || payload));
      onClose();
    } catch (requestError) {
      const protocols = requestError.details?.protocols || {};
      const hasProtocolDetails = Object.keys(protocols).length > 0;
      const outcome = (value, fallback) => {
        if (value === true || value?.ok === true || ['ok', 'passed', 'connected', 'success'].includes(String(value?.status || value || '').toLowerCase())) return 'passed';
        if (value === false || value?.ok === false || ['failed', 'error', 'rejected', 'timeout'].includes(String(value?.status || value || '').toLowerCase())) return 'failed';
        return fallback;
      };
      setProtocolStatus((current) => requestError.code === 'CREDENTIAL_ENCRYPTION_UNAVAILABLE' ? { imap: 'idle', smtp: 'idle' } : ({
        imap: outcome(protocols.imap, requestError.code?.startsWith('IMAP_') || (!hasProtocolDetails && current.imap === 'checking') ? 'failed' : current.imap),
        smtp: outcome(protocols.smtp, requestError.code?.startsWith('SMTP_') || (!hasProtocolDetails && current.smtp === 'checking') ? 'failed' : current.smtp),
      }));
      setError(accountConnectionError(requestError));
    } finally {
      window.clearTimeout(savingPhaseTimer);
      savingRef.current = false;
      setSaving(false);
      setSavingPhase('');
    }
  };
  return (
    <div className="modal-layer">
      <button type="button" className="modal-scrim" onClick={saving ? undefined : onClose} aria-label="Close add account" disabled={saving} />
      <form ref={dialogRef} className="account-modal account-onboarding" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="add-account-title" aria-describedby="add-account-subtitle">
        <div className="account-modal-header">
          <div className="account-modal-title">
            {step === 'details' && <IconButton label="Choose a different provider" onClick={() => { setStep('provider'); setError(''); }} disabled={saving} className="modal-back"><Icon name="back" /></IconButton>}
            <div><h2 id="add-account-title">{step === 'provider' ? 'Add an email account' : selectedProvider.title}</h2><p id="add-account-subtitle">{step === 'provider' ? 'Choose a provider. Every inbox lands in one private workspace.' : `Step 2 of 2 · ${selectedProvider.caption}`}</p></div>
          </div>
          <IconButton label="Close" onClick={onClose} disabled={saving}><Icon name="close" /></IconButton>
        </div>
        <div className="account-step-track" aria-hidden="true"><i className="is-complete" /><i className={step === 'details' ? 'is-complete' : ''} /></div>
        {step === 'provider' ? (
          <div className="account-modal-scroll provider-picker-step">
            <div className="provider-picker-heading"><span className="provider-picker-icon"><Icon name="mail" size={22} /></span><div><strong>Where is your email hosted?</strong><p>Connection settings are filled in automatically for common providers.</p></div></div>
            <div className="provider-card-grid">
              {Object.values(PROVIDER_PRESETS).map((provider, index) => (
                <button type="button" ref={index === 0 ? firstProviderRef : undefined} className="provider-card" key={provider.id} onClick={() => chooseProvider(provider.id)} style={{ '--provider-color': provider.color }}>
                  <span className="provider-card-mark">{provider.mark}</span>
                  <span className="provider-card-copy"><strong>{provider.label}</strong><small>{provider.caption}</small></span>
                  <Icon name="chevronRight" size={18} />
                </button>
              ))}
            </div>
            <div className="provider-picker-security"><Icon name="shield" size={19} /><span><strong>Private by design</strong><small>Mailbox credentials are sent only to your GigaMail server. The server refuses to save them unless encrypted-at-rest storage is configured.</small></span></div>
          </div>
        ) : (
          <div className="account-modal-scroll account-details-step">
            <div className="selected-provider-card" style={{ '--provider-color': selectedProvider.color }}>
              <span className="provider-card-mark">{selectedProvider.mark}</span>
              <span><strong>{selectedProvider.label}</strong><small>{selectedProvider.caption}</small></span>
              <button type="button" onClick={() => { setStep('provider'); setError(''); }} disabled={saving}>Change</button>
            </div>

            <aside className="provider-guidance">
              <span className="guidance-icon"><Icon name="lock" size={18} /></span>
              <div><strong>{selectedProvider.passwordTitle}</strong><p>{selectedProvider.passwordHint}</p>{selectedProvider.helpUrl && <a href={selectedProvider.helpUrl} target="_blank" rel="noreferrer">{selectedProvider.helpLabel} <span aria-hidden="true">↗</span></a>}</div>
            </aside>

            <div className="account-fields-grid">
              <label className="form-field"><span>Email address</span><input ref={emailRef} type="email" required value={form.email} onChange={updateEmail} placeholder={form.providerKey === 'icloud' ? 'you@icloud.com' : 'you@example.com'} autoComplete="email" spellCheck="false" autoCapitalize="none" /></label>
              <label className="form-field"><span>Display name <em>optional</em></span><input value={form.name} onChange={update('name')} placeholder="Name recipients will see" autoComplete="name" /></label>
            </div>

            <label className="form-field password-field">
              <span>{form.providerKey === 'mailinabox' ? 'Mailbox password' : 'App password'}</span>
              <span className="password-input"><input type={passwordVisible ? 'text' : 'password'} required value={form.appPassword} onChange={update('appPassword')} placeholder="Not saved in this browser" autoComplete="off" spellCheck="false" autoCapitalize="none" /><IconButton label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((value) => !value)}><Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={18} /></IconButton></span>
              <small>Used only to verify IMAP and SMTP, then encrypted by the server before storage.</small>
            </label>

            {form.providerKey === 'mailinabox' && (
              <label className="form-field"><span>Mail server hostname</span><input value={form.imapHost} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, imapHost: value, smtpHost: current.smtpHost === current.imapHost ? value : current.smtpHost })); }} placeholder="box.yourdomain.com" spellCheck="false" autoCapitalize="none" /><small>Verified as box.xer5.com so TLS certificates validate correctly. The LAN address remains private to the server.</small></label>
            )}

            {['custom', 'mailinabox'].includes(form.providerKey) ? (
              <details className="advanced-connection" open={form.providerKey === 'custom'}>
                <summary>{form.providerKey === 'custom' ? 'IMAP and SMTP settings' : 'Advanced connection settings'}</summary>
                <label className="form-field connection-username"><span>Mailbox username <em>usually the full email address</em></span><input value={form.username} onChange={update('username')} placeholder={form.email || 'you@example.com'} spellCheck="false" autoCapitalize="none" /></label>
                <div className="provider-grid">
                  <label className="form-field"><span>IMAP host</span><input value={form.imapHost} onChange={update('imapHost')} placeholder="imap.example.com" spellCheck="false" autoCapitalize="none" /></label>
                  <label className="form-field"><span>Port</span><input type="number" min="1" max="65535" inputMode="numeric" value={form.imapPort} onChange={update('imapPort')} /></label>
                  <label className="form-field"><span>SMTP host</span><input value={form.smtpHost} onChange={update('smtpHost')} placeholder="smtp.example.com" spellCheck="false" autoCapitalize="none" /></label>
                  <label className="form-field"><span>Port</span><input type="number" min="1" max="65535" inputMode="numeric" value={form.smtpPort} onChange={update('smtpPort')} /></label>
                </div>
              </details>
            ) : (
              <div className="connection-summary" aria-label="Provider connection settings"><span><Icon name="lock" size={14} /> IMAP {form.imapHost}:{form.imapPort}</span><span><Icon name="send" size={14} /> SMTP {form.smtpHost}:{form.smtpPort}</span></div>
            )}

            {form.providerKey === 'icloud' && (
              <details className="advanced-connection icloud-connection">
                <summary>Advanced iCloud sign-in</summary>
                <label className="form-field connection-username"><span>IMAP username</span><input value={form.imapUsername} onChange={update('imapUsername')} placeholder={form.email.split('@')[0] || 'yourname'} spellCheck="false" autoCapitalize="none" /><small>Apple usually accepts the part before @icloud.com. If sign-in fails, try the full iCloud email address here. SMTP always uses the full address.</small></label>
              </details>
            )}

            <details className="identity-details">
              <summary>Sending identity and appearance</summary>
              <div className="account-profile-row"><Avatar person={{ name: form.name || form.email || selectedProvider.label, color: form.color, avatarUrl: form.avatarUrl }} size="hero" /><label className="photo-upload"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={chooseAvatar} />{form.avatarUrl ? 'Replace profile photo' : 'Upload profile photo'}</label></div>
              <label className="form-field"><span>Signature <em>optional</em></span><textarea value={form.signature} onChange={update('signature')} placeholder="Kind regards," /></label>
              <div className="color-picker"><span>Profile color</span><div>{['#0b57d0', '#8e24aa', '#e8710a', '#00897b', '#c2185b', '#455a64'].map((color) => <button type="button" key={color} onClick={() => setForm((current) => ({ ...current, color }))} className={form.color === color ? 'is-selected' : ''} style={{ '--swatch': color }} aria-label={`Choose ${color}`} />)}</div></div>
            </details>

            <div className="credential-security-note"><Icon name="shield" size={19} /><span><strong>Encrypted, never browser-stored</strong><small>This form keeps the password only in memory. GigaMail verifies both connections before persisting anything, then encrypts the credential on the server.</small></span></div>
            {Object.values(protocolStatus).some((status) => status !== 'idle') && (
              <div className="protocol-status-row" aria-live="polite">
                {['imap', 'smtp'].map((protocol) => <span key={protocol} className={`protocol-status is-${protocolStatus[protocol]}`}><i>{protocolStatus[protocol] === 'passed' ? '✓' : protocolStatus[protocol] === 'failed' ? '!' : ''}</i><strong>{protocol.toUpperCase()}</strong><small>{protocolStatus[protocol] === 'passed' ? 'Verified' : protocolStatus[protocol] === 'failed' ? 'Failed' : protocolStatus[protocol] === 'checking' ? 'Checking…' : 'Waiting'}</small></span>)}
              </div>
            )}
            {error && <p className="form-error account-form-error" role="alert">{error}</p>}
          </div>
        )}
        <div className="account-modal-footer">
          {step === 'provider' ? <><span className="modal-footer-hint">Select a provider to continue</span><button type="button" className="text-button" onClick={onClose}>Cancel</button></> : <><button type="button" className="text-button" onClick={() => setStep('provider')} disabled={saving}>Back</button><button type="submit" className="primary-button connect-account-button" disabled={saving || !form.email.trim() || !form.appPassword}>{saving ? savingPhase || 'Connecting…' : 'Test & add account'}</button></>}
        </div>
      </form>
    </div>
  );
}
