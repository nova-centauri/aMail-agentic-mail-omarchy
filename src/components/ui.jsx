import { useEffect, useState } from 'react';
import { initials } from '../mail/dates.js';
import { Icon } from './Icon.jsx';

export function IconButton({ label, onClick, active = false, disabled = false, children, className = '', type = 'button' }) {
  return (
    <button
      type={type}
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Avatar({ person, size = 'md', className = '' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = person || {};
  const image = source.avatarUrl || source.avatar;
  useEffect(() => { setImageFailed(false); }, [image]);
  const style = source.color ? { '--avatar-color': source.color } : undefined;
  return (
    <div className={`avatar avatar-${size} ${className}`} style={style} role="img" aria-label={source.name || source.email || 'Profile'}>
      {source.isUnified ? (
        <Icon name="inbox" size={size === 'hero' ? 32 : size === 'top' ? 17 : 18} />
      ) : image && !imageFailed ? (
        <img src={image} alt="" onError={() => setImageFailed(true)} />
      ) : (
        initials(source.name || source.email)
      )}
    </div>
  );
}

export function Checkbox({ checked, onChange, label = 'Select' }) {
  return (
    <label className="check-wrap" aria-label={label} onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="custom-check"><Icon name="check" size={14} /></span>
    </label>
  );
}

export function Tooltip({ children, text, placement }) {
  return <span className={`tooltip-wrap ${placement ? `tooltip-${placement}` : ''}`.trim()} data-tooltip={text}>{children}</span>;
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="settings-toggle">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function Toast({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  return <div className="toast" role="status"><span>{notice}</span><button type="button" onClick={onClose}>Dismiss</button></div>;
}
