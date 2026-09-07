import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FreshDraftsCard } from './FreshDraftsCard.jsx';

const drafts = [
  {
    id: 'd1',
    draftId: 'd1',
    to: [{ name: 'Priya', email: 'priya@printworks.example' }],
    subject: 'Press window',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'd2',
    draftId: 'd2',
    to: [{ name: 'Maya Chen', email: 'maya@studio.com' }],
    subject: 'Design follow-up',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
];

describe('FreshDraftsCard', () => {
  it('renders recipient, subject, and saved date as openable pills', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    const onDelete = vi.fn();
    const onViewAll = vi.fn();
    render(
      <FreshDraftsCard
        drafts={drafts}
        onOpen={onOpen}
        onDismiss={onDismiss}
        onDelete={onDelete}
        onViewAll={onViewAll}
      />,
    );

    expect(screen.getByRole('region', { name: 'Fresh drafts' })).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    expect(screen.getByText('Press window')).toBeInTheDocument();
    expect(screen.getByText('Maya Chen')).toBeInTheDocument();
    expect(screen.getByText('Design follow-up')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open draft to priya/i }));
    expect(onOpen).toHaveBeenCalledWith(drafts[0]);

    await user.click(screen.getByRole('button', { name: /dismiss draft to priya/i }));
    expect(onDismiss).toHaveBeenCalledWith(drafts[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /delete draft to maya chen/i }));
    expect(onDelete).toHaveBeenCalledWith(drafts[1]);

    await user.click(screen.getByRole('button', { name: /view all/i }));
    expect(onViewAll).toHaveBeenCalled();
  });

  it('hides when there are no drafts', () => {
    const { container } = render(<FreshDraftsCard drafts={[]} onOpen={vi.fn()} onDismiss={vi.fn()} onDelete={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
