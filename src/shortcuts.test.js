import { describe, expect, it } from 'vitest';
import { shortcutAction } from './shortcuts.js';

function keyEvent(key, target = { tagName: 'BODY', closest: () => null }) {
  return { key, metaKey: false, ctrlKey: false, altKey: false, target };
}

describe('shortcutAction', () => {
  it('maps Gmail-style mailbox keys', () => {
    expect(shortcutAction(keyEvent('j'))).toBe('next');
    expect(shortcutAction(keyEvent('k'))).toBe('previous');
    expect(shortcutAction(keyEvent('e'))).toBe('archive');
    expect(shortcutAction(keyEvent('#'))).toBe('trash');
    expect(shortcutAction(keyEvent('r'))).toBe('reply');
    expect(shortcutAction(keyEvent('s'))).toBe('star');
    expect(shortcutAction(keyEvent('/'))).toBe('search');
    expect(shortcutAction(keyEvent('c'))).toBe('compose');
    expect(shortcutAction(keyEvent('Enter'))).toBe('open');
    expect(shortcutAction(keyEvent('u'))).toBe('back');
    expect(shortcutAction(keyEvent('x'))).toBe('select');
    expect(shortcutAction(keyEvent('?'))).toBe('help');
    expect(shortcutAction(keyEvent('Escape'))).toBe('escape');
  });

  it('ignores keys while typing in a field', () => {
    expect(shortcutAction(keyEvent('j', { tagName: 'INPUT', closest: () => null }))).toBeNull();
    expect(shortcutAction(keyEvent('e', { tagName: 'TEXTAREA', closest: () => null }))).toBeNull();
  });

  it('ignores modified keys', () => {
    expect(shortcutAction({ ...keyEvent('c'), metaKey: true })).toBeNull();
    expect(shortcutAction({ ...keyEvent('c'), ctrlKey: true })).toBeNull();
  });
});
