import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { flagsToPayload, PersonFlagsEditor, validateFlagDrafts } from './PersonFlagsEditor.jsx';

describe('PersonFlagsEditor', () => {
  it('turns comma, space, and newline separated addresses into a canonical payload', () => {
    const drafts = [{ key: 'a', id: 'ada', label: ' Ada ', emails: 'Ada@Example.com, ada.work@example.com\nADA@example.com', color: '#0b57d0' }];
    expect(flagsToPayload(drafts)).toEqual([
      { id: 'ada', label: 'Ada', emails: ['ada@example.com', 'ada.work@example.com', 'ada@example.com'], color: '#0b57d0' },
    ]);
    expect(validateFlagDrafts(drafts)).toBe('');
    expect(validateFlagDrafts([{ key: 'b', label: 'Nobody', emails: '', color: '#000000' }])).toMatch(/at least one email/i);
    expect(validateFlagDrafts([{ key: 'c', label: 'Typo', emails: 'not-an-email', color: '#000000' }])).toMatch(/not a valid email/i);
  });

  it('adds a flag, saves the whole list, and disables Save until something changes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue([]);
    render(<PersonFlagsEditor flags={[{ id: 'ops', label: 'Ops', emails: ['ops@example.com'], color: '#c2185b' }]} colors={['#0b57d0', '#c2185b']} onSave={onSave} />);
    expect(screen.getByRole('button', { name: /save flags/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /add a person/i }));
    const names = screen.getAllByLabelText(/^name$/i);
    await user.type(names[1], 'Priya');
    await user.type(screen.getAllByLabelText(/email addresses/i)[1], 'priya@example.com');
    await user.click(screen.getByRole('button', { name: /save flags/i }));
    expect(onSave).toHaveBeenCalledWith([
      { id: 'ops', label: 'Ops', emails: ['ops@example.com'], color: '#c2185b' },
      { label: 'Priya', emails: ['priya@example.com'], color: '#c2185b' },
    ]);
  });

  it('reports validation problems instead of saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<PersonFlagsEditor flags={[]} colors={['#0b57d0']} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /add a person/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Broken');
    await user.type(screen.getByLabelText(/email addresses/i), 'nope');
    await user.click(screen.getByRole('button', { name: /save flags/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/not a valid email/i);
    expect(onSave).not.toHaveBeenCalled();
  });
});
