import { useEffect, useRef, useState } from 'react';
import { AccountConnectForm } from './AccountConnectForm.jsx';
import { Icon } from './Icon.jsx';
import { IconButton } from './ui.jsx';

export { accountConnectionError } from './AccountConnectForm.jsx';

export function AddAccountModal({ onClose, onAdded }) {
  const [step, setStep] = useState('provider');
  const [provider, setProvider] = useState(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const handleDialogKeys = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [contenteditable="true"]')];
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
  }, []); // The modal is mounted for one add-account session.
  return (
    <div className="modal-layer">
      <button type="button" className="modal-scrim" onClick={saving ? undefined : onClose} aria-label="Close add account" disabled={saving} />
      <div ref={dialogRef} className="account-modal account-onboarding" role="dialog" aria-modal="true" aria-labelledby="add-account-title" aria-describedby="add-account-subtitle">
        <div className="account-modal-header">
          <div className="account-modal-title">
            <div>
              <h2 id="add-account-title">{step === 'provider' || !provider ? 'Add an email account' : provider.title}</h2>
              <p id="add-account-subtitle">{step === 'provider' || !provider ? 'Choose a provider. Every inbox lands in one private workspace.' : `Step 2 of 2 · ${provider.caption}`}</p>
            </div>
          </div>
          <IconButton label="Close" onClick={onClose} disabled={saving}><Icon name="close" /></IconButton>
        </div>
        <AccountConnectForm
          titleId="add-account-title"
          subtitleId="add-account-subtitle"
          onStepChange={(nextStep, nextProvider) => { setStep(nextStep); setProvider(nextProvider); }}
          onSavingChange={setSaving}
          onCancel={onClose}
          onAdded={(account) => { onAdded(account); onClose(); }}
        />
      </div>
    </div>
  );
}
