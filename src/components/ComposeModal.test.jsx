import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComposeModal } from './ComposeModal.jsx';

const account = { id: 'acc-1', name: 'Owner', email: 'owner@example.test' };

describe('ComposeModal', () => {
  it('attaches a file and inserts a markdown link', async () => {
    const user = userEvent.setup();
    render(
      <ComposeModal
        account={account}
        accounts={[account]}
        isDemo
        onClose={vi.fn()}
        onSent={vi.fn()}
        onDraftSaved={vi.fn()}
        onDraftRemoved={vi.fn()}
      />,
    );

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Insert link' }));
    await user.type(screen.getByLabelText('Link text'), 'Docs');
    await user.type(screen.getByLabelText('Link URL'), 'https://mail.xer0.io');
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.getByLabelText('Message body')).toHaveValue('[Docs](https://mail.xer0.io)');
  });
});
