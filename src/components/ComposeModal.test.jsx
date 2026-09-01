import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComposeModal } from './ComposeModal.jsx';

const account = { id: 'acc-1', name: 'Owner', email: 'owner@example.test' };
const contacts = [
  { name: 'Maya Chen', email: 'maya@studio.com' },
  { name: 'Avery Thompson', email: 'avery@ops.example' },
];

describe('ComposeModal', () => {
  it('attaches a file and writes formatted HTML in the message body', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    render(
      <ComposeModal
        account={account}
        accounts={[account]}
        contacts={contacts}
        isDemo
        onClose={vi.fn()}
        onSent={onSent}
        onDraftSaved={vi.fn()}
        onDraftRemoved={vi.fn()}
      />,
    );

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Choose files to attach'), file);
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /html/i }));
    const source = screen.getByRole('textbox', { name: 'Message HTML' });
    await user.click(source);
    await user.clear(source);
    await user.paste('<p>See <strong>docs</strong> and <a href="https://mail.xer0.io">mail.xer0.io</a></p>');
    expect(source.value).toMatch(/docs/);

    await user.type(screen.getByLabelText('Recipients'), 'friend@example.test{enter}');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSent).toHaveBeenCalled();
    const payload = onSent.mock.calls[0][0];
    expect(payload.to[0].email).toBe('friend@example.test');
    expect(payload.htmlBody).toMatch(/<strong>docs<\/strong>/);
    expect(payload.htmlBody).toContain('https://mail.xer0.io');
    expect(payload.textBody).toMatch(/docs/);
  });

  it('turns known people into recipient chips', async () => {
    const user = userEvent.setup();
    render(
      <ComposeModal
        account={account}
        accounts={[account]}
        contacts={contacts}
        isDemo
        onClose={vi.fn()}
        onSent={vi.fn()}
        onDraftSaved={vi.fn()}
        onDraftRemoved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Recipients'), 'may');
    expect(await screen.findByRole('option', { name: /Maya Chen/i })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Maya Chen/i }));
    expect(screen.getByTitle('maya@studio.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Maya Chen <maya@studio.com>' })).toBeInTheDocument();
  });
});
