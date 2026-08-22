import { SHORTCUTS } from '../shortcuts.js';
import { Icon } from './Icon.jsx';
import { IconButton } from './ui.jsx';

export function ShortcutCheatsheet({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-layer shortcut-layer" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" className="modal-scrim" onClick={onClose} aria-label="Close shortcuts" />
      <section className="shortcut-modal">
        <div className="shortcut-header">
          <h2>Keyboard shortcuts</h2>
          <IconButton label="Close shortcuts" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <ul className="shortcut-list">
          {SHORTCUTS.map((item) => (
            <li key={item.action}>
              <span>{item.label}</span>
              <kbd>{item.keys[0] === 'Escape' ? 'Esc' : item.keys[0]}</kbd>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
