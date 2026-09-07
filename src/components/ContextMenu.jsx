import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampMenuPosition, menuAnchorPoint, shouldDeferToNativeMenu } from '../mail/context-menu.js';
import { Icon } from './Icon.jsx';

let menuSequence = 0;

/**
 * State for one right-click menu. `openMenu(event, definition)` takes the
 * `contextmenu` event and a `{ title, items, context }` definition from
 * `src/mail/context-menu.js`; it returns false (and leaves the browser menu
 * alone) when the click landed on a link, image, field, or text selection.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((event, definition) => {
    const items = definition?.items?.filter((entry) => entry && entry.type !== 'separator') || [];
    if (!items.length) return false;
    if (shouldDeferToNativeMenu(event.target, { scope: event.currentTarget })) return false;
    event.preventDefault();
    event.stopPropagation();
    const point = menuAnchorPoint(event);
    menuSequence += 1;
    setMenu({ key: menuSequence, x: point.x, y: point.y, title: definition.title, items: definition.items, context: definition.context ?? null });
    return true;
  }, []);
  return { menu, openMenu, closeMenu };
}

export function ContextMenu({ menu, onClose }) {
  if (!menu || typeof document === 'undefined') return null;
  return createPortal(<ContextMenuSurface key={menu.key} menu={menu} onClose={onClose} />, document.body);
}

function ContextMenuSurface({ menu, onClose }) {
  const surfaceRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const enabledItems = () => Array.from(surfaceRef.current?.querySelectorAll('[role^="menuitem"]:not(:disabled)') || []);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    setPosition(clampMenuPosition({
      x: menu.x,
      y: menu.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, [menu.x, menu.y]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = enabledItems()[0] || surfaceRef.current;
    first?.focus({ preventScroll: true });
    return () => {
      const previous = restoreFocusRef.current;
      if (previous && previous.isConnected && document.body.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const isInside = (target) => surfaceRef.current?.contains(target);
    const onPointerDown = (event) => { if (!isInside(event.target)) onClose(); };
    // Another element opening its own menu prevents default; leave that state
    // change alone so the new menu is not immediately closed by this one.
    const onContextMenu = (event) => { if (!event.defaultPrevented && !isInside(event.target)) onClose(); };
    const onScroll = (event) => { if (!isInside(event.target)) onClose(); };
    const onKeyDown = (event) => { if (event.key === 'Escape' && !isInside(event.target)) { event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const moveFocus = (delta) => {
    const items = enabledItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  };

  const handleKeyDown = (event) => {
    // Keep menu keys away from the app-level shortcut handler (e.g. Escape
    // closing the open conversation, `e` archiving it).
    event.stopPropagation();
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        return;
      case 'Home':
        event.preventDefault();
        enabledItems()[0]?.focus({ preventScroll: true });
        return;
      case 'End':
        event.preventDefault();
        enabledItems().at(-1)?.focus({ preventScroll: true });
        return;
      default:
        break;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.trim()) {
      const items = enabledItems();
      const current = items.indexOf(document.activeElement);
      const lower = event.key.toLowerCase();
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((element) => (element.dataset.label || '').toLowerCase().startsWith(lower));
      if (match) {
        event.preventDefault();
        match.focus({ preventScroll: true });
      }
    }
  };

  const select = (entry) => {
    if (entry.disabled) return;
    onClose();
    entry.onSelect?.();
  };

  return (
    <div
      ref={surfaceRef}
      className="context-menu"
      role="menu"
      aria-label={menu.title ? `Actions for ${menu.title}` : 'Actions'}
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.title ? <div className="context-menu-title" title={menu.title}>{menu.title}</div> : null}
      {menu.items.map((entry, index) => {
        if (!entry) return null;
        if (entry.type === 'separator') {
          const previous = menu.items[index - 1];
          const next = menu.items[index + 1];
          if (!previous || previous.type === 'separator' || !next || next.type === 'separator') return null;
          return <hr key={`separator-${index}`} role="separator" />;
        }
        const checkable = typeof entry.checked === 'boolean';
        return (
          <button
            key={entry.id || index}
            type="button"
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? entry.checked : undefined}
            className={`context-menu-item ${entry.danger ? 'is-danger' : ''} ${checkable && entry.checked ? 'is-checked' : ''}`.trim()}
            tabIndex={-1}
            disabled={entry.disabled}
            data-label={entry.label}
            onClick={() => select(entry)}
            onPointerEnter={(event) => { if (!entry.disabled) event.currentTarget.focus({ preventScroll: true }); }}
          >
            <span className="context-menu-icon" aria-hidden="true">
              {checkable && entry.checked ? <Icon name="check" size={16} /> : entry.icon ? <Icon name={entry.icon} size={16} /> : null}
            </span>
            <span className="context-menu-label">{entry.label}</span>
            {entry.shortcut ? <kbd>{entry.shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
