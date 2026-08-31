import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar.jsx';

describe('Sidebar', () => {
  it('folder clicks set that folder and only clear the person flag', async () => {
    const user = userEvent.setup();
    const setActiveFolder = vi.fn();
    const onSelectPersonFlag = vi.fn();
    render(
      <Sidebar
        compact={false}
        mobileOpen={false}
        onCloseMobile={vi.fn()}
        activeFolder="inbox"
        setActiveFolder={setActiveFolder}
        counts={{ inbox: 1, starred: 0, snoozed: 0, drafts: 1 }}
        onCompose={vi.fn()}
        accounts={[]}
        activeAccount={null}
        setActiveAccount={vi.fn()}
        onSelectUnified={vi.fn()}
        onOpenSettings={vi.fn()}
        isDemo
        onAddAccount={vi.fn()}
        activePersonFlag={null}
        onSelectPersonFlag={onSelectPersonFlag}
      />,
    );
    await user.click(screen.getByRole('button', { name: /drafts/i }));
    expect(setActiveFolder).toHaveBeenCalledWith('drafts');
    expect(onSelectPersonFlag).toHaveBeenCalledWith(null);
  });
});
