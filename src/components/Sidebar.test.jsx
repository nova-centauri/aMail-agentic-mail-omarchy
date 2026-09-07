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

describe('Sidebar agentic sections', () => {
  it('renders server-provided person flags and the unanalyzed queue', async () => {
    const user = userEvent.setup();
    const onSelectPersonFlag = vi.fn();
    const onSelectAgentQueue = vi.fn();
    const onManageFlags = vi.fn();
    render(
      <Sidebar
        compact={false}
        mobileOpen={false}
        onCloseMobile={vi.fn()}
        activeFolder="inbox"
        setActiveFolder={vi.fn()}
        counts={{ inbox: 3, starred: 0, snoozed: 0, drafts: 0, unanalyzed: 2 }}
        onCompose={vi.fn()}
        accounts={[]}
        activeAccount={null}
        setActiveAccount={vi.fn()}
        onSelectUnified={vi.fn()}
        onOpenSettings={vi.fn()}
        onAddAccount={vi.fn()}
        activePersonFlag={null}
        onSelectPersonFlag={onSelectPersonFlag}
        personFlags={[{ id: 'ops-team', label: 'Ops team', shortLabel: 'Ops', color: '#c2185b', description: 'Mail involving the ops team', emails: ['ops@example.com'] }]}
        onManageFlags={onManageFlags}
        onSelectAgentQueue={onSelectAgentQueue}
      />,
    );
    const queue = screen.getByRole('button', { name: /not yet analyzed/i });
    expect(queue).toHaveTextContent('2');
    await user.click(queue);
    expect(onSelectAgentQueue).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Ops$/ }));
    expect(onSelectPersonFlag).toHaveBeenCalledWith('ops-team');
    await user.click(screen.getByRole('button', { name: /manage flagged people/i }));
    expect(onManageFlags).toHaveBeenCalled();
  });

  it('offers to create the first flag when none are configured', () => {
    render(
      <Sidebar
        compact={false}
        mobileOpen={false}
        onCloseMobile={vi.fn()}
        activeFolder="inbox"
        setActiveFolder={vi.fn()}
        counts={{ inbox: 0, starred: 0, snoozed: 0, drafts: 0 }}
        onCompose={vi.fn()}
        accounts={[]}
        activeAccount={null}
        setActiveAccount={vi.fn()}
        onSelectUnified={vi.fn()}
        onOpenSettings={vi.fn()}
        onAddAccount={vi.fn()}
        personFlags={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /flag a person/i })).toBeInTheDocument();
  });
});
