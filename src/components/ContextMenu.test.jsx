import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, useContextMenu } from './ContextMenu.jsx';

function Harness({ definition, onOpened }) {
  const { menu, openMenu, closeMenu } = useContextMenu();
  return (
    <div>
      <article
        data-testid="target"
        onContextMenu={(event) => { const opened = openMenu(event, definition); onOpened?.(opened); }}
      >
        <span>plain text</span>
        <a href="https://example.com">a link</a>
      </article>
      <button type="button">elsewhere</button>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

const definition = {
  title: 'Deploy window',
  items: [
    { id: 'open', label: 'Open conversation', icon: 'mail', shortcut: 'Enter', onSelect: vi.fn() },
    { type: 'separator' },
    { id: 'archive', label: 'Archive', icon: 'archive', shortcut: 'e', onSelect: vi.fn() },
    { id: 'blocked', label: 'Blocked', disabled: true, onSelect: vi.fn() },
    { id: 'trash', label: 'Move to Trash', icon: 'trash', danger: true, onSelect: vi.fn() },
  ],
};

const rightClick = (element, point = { clientX: 40, clientY: 50 }) => fireEvent.contextMenu(element, { ...point, button: 2 });

describe('ContextMenu', () => {
  it('opens at the pointer with the items, title, and shortcut hints', () => {
    render(<Harness definition={definition} />);
    rightClick(screen.getByText('plain text'));
    const menu = screen.getByRole('menu', { name: 'Actions for Deploy window' });
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe('50px');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open conversationEnter', 'Archivee', 'Blocked', 'Move to Trash']);
    expect(screen.getByRole('menuitem', { name: /blocked/i })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /trash/i })).toHaveClass('is-danger');
    expect(screen.getByRole('menuitem', { name: /open conversation/i })).toHaveFocus();
  });

  it('runs the item action and closes when an item is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness definition={definition} />);
    rightClick(screen.getByText('plain text'));
    await user.click(screen.getByRole('menuitem', { name: /archive/i }));
    expect(definition.items[2].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('supports arrow-key navigation, skips disabled items, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness definition={definition} />);
    rightClick(screen.getByText('plain text'));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /archive/i })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /trash/i })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /open conversation/i })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /trash/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(definition.items[4].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    rightClick(screen.getByText('plain text'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when the pointer goes down outside the menu', () => {
    render(<Harness definition={definition} />);
    rightClick(screen.getByText('plain text'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves the browser menu alone on links and reports that it did not open', () => {
    const onOpened = vi.fn();
    render(<Harness definition={definition} onOpened={onOpened} />);
    const event = rightClick(screen.getByText('a link'));
    expect(event).toBe(true); // default was not prevented
    expect(onOpened).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('anchors to the element when opened from the keyboard', () => {
    render(<Harness definition={definition} />);
    const target = screen.getByTestId('target');
    target.getBoundingClientRect = () => ({ left: 100, top: 200, width: 300, height: 40, right: 400, bottom: 240 });
    rightClick(target, { clientX: 0, clientY: 0 });
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('124px');
    expect(menu.style.top).toBe('220px');
  });

  it('renders nothing without a menu', () => {
    const { container } = render(<ContextMenu menu={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
