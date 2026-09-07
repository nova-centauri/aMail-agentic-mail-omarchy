import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MailList, SmartFilterBar } from './MailList.jsx';

describe('SmartFilterBar', () => {
  it('renders explainable smart-view chips with counts', () => {
    render(
      <SmartFilterBar
        activeCategory="github_ci"
        onChange={vi.fn()}
        visibleCount={4}
        categoryCounts={{ primary: 2, github_ci: 1, logs: 1, status: 0, ops_error: 0 }}
        loading={false}
      />,
    );
    expect(screen.getByRole('tab', { name: /github ci/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ops errors/i })).toBeInTheDocument();
  });
});

describe('MailList', () => {
  const thread = {
    id: 't1',
    subject: 'Hello',
    snippet: 'Hi there',
    from: { name: 'Ada', email: 'ada@example.com' },
    timestamp: '2026-08-30T12:00:00.000Z',
    unread: true,
    starred: false,
    messageCount: 1,
    folder: 'inbox',
    category: 'primary',
  };

  const defaults = {
    threads: [thread],
    totalCount: 1,
    categoryCounts: { primary: 1, github_ci: 0, logs: 0, status: 0, ops_error: 0 },
    cursorThreadId: null,
    loading: false,
    folder: 'inbox',
    query: '',
    activeCategory: 'all',
    setActiveCategory: vi.fn(),
    selectedIds: [],
    setSelectedIds: vi.fn(),
    onOpenThread: vi.fn(),
    onToggleStar: vi.fn(),
    onRefresh: vi.fn(),
    onBulkAction: vi.fn(),
    onCompose: vi.fn(),
    onClearSearch: vi.fn(),
  };

  it('leaves the list unmarked when no conversation is open', () => {
    render(<MailList {...defaults} selectedThread={null} />);
    expect(screen.getByLabelText('Conversation list')).not.toHaveClass('has-selected-thread');
  });

  it('marks the list when a conversation is open', () => {
    render(<MailList {...defaults} selectedThread={thread} />);
    expect(screen.getByLabelText('Conversation list')).toHaveClass('has-selected-thread');
  });

  it('shows Fresh Drafts on the inbox and hides them in other folders', () => {
    const draft = {
      id: 'd1',
      to: [{ name: 'Priya', email: 'priya@printworks.example' }],
      subject: 'Press window',
      updatedAt: '2026-09-06T12:00:00.000Z',
    };
    const { rerender } = render(<MailList {...defaults} freshDrafts={[draft]} />);
    expect(screen.getByRole('region', { name: 'Fresh drafts' })).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    rerender(<MailList {...defaults} folder="drafts" freshDrafts={[draft]} />);
    expect(screen.queryByRole('region', { name: 'Fresh drafts' })).not.toBeInTheDocument();
  });

  it('opens a context menu on a row and routes actions through the list callbacks', async () => {
    const user = userEvent.setup();
    const onBulkAction = vi.fn();
    const onReply = vi.fn();
    render(<MailList {...defaults} selectedThread={null} onBulkAction={onBulkAction} onReply={onReply} onNotice={vi.fn()} />);
    const row = screen.getByRole('button', { name: /hello/i });
    fireEvent.contextMenu(row, { clientX: 30, clientY: 40, button: 2 });
    const menu = screen.getByRole('menu', { name: 'Actions for Hello' });
    expect(menu).toBeInTheDocument();
    expect(row).toHaveClass('is-menu-target');
    expect(screen.getByRole('menuitem', { name: /mark as read/i })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /^archive/i }));
    expect(onBulkAction).toHaveBeenCalledWith('archive', ['t1']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(row, { clientX: 30, clientY: 40, button: 2 });
    await user.click(screen.getByRole('menuitem', { name: /^reply/i }));
    expect(onReply).toHaveBeenCalledWith(thread);
  });

  it('acts on the whole checked selection when the row is part of it', async () => {
    const user = userEvent.setup();
    const onBulkAction = vi.fn();
    const second = { ...thread, id: 't2', subject: 'Second' };
    render(<MailList {...defaults} threads={[thread, second]} selectedIds={['t1', 't2']} selectedThread={null} onBulkAction={onBulkAction} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /hello/i }), { clientX: 30, clientY: 40, button: 2 });
    expect(screen.getByRole('menu', { name: 'Actions for 2 conversations selected' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /move to trash/i }));
    expect(onBulkAction).toHaveBeenCalledWith('trash', ['t1', 't2']);
  });
});
