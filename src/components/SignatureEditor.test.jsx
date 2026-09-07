import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignatureEditor } from './SignatureEditor.jsx';

describe('SignatureEditor', () => {
  it('lets the user paste HTML in the HTML tab and save it', async () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<SignatureEditor value="" savedValue="" onChange={onChange} onSave={onSave} />);
    await userEvent.click(screen.getByRole('tab', { name: /html/i }));
    const source = screen.getByRole('textbox', { name: 'Signature HTML' });
    await userEvent.click(source);
    await userEvent.clear(source);
    await userEvent.paste('<p><strong>Rivera Labs</strong></p>');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)[0]).toContain('Rivera Labs');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalled();
  });

  it('loads an uploaded HTML file into the visual editor', async () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<SignatureEditor value="" onChange={onChange} onSave={onSave} />);
    const file = new File(['<p>Uploaded <em>signature</em></p>'], 'office.html', { type: 'text/html' });
    await userEvent.upload(screen.getByLabelText(/upload signature html/i), file);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)[0]).toMatch(/Uploaded/);
    expect(onSave).toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /visual/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('uses the clipboard for Paste HTML when available', async () => {
    const onChange = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('<div>Clipboard sig</div>') },
    });
    render(<SignatureEditor value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /paste html/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)[0]).toMatch(/Clipboard sig/);
  });

  it('stays inert until an account is selected', () => {
    render(<SignatureEditor value="" disabled />);
    expect(screen.getByRole('tab', { name: /visual/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /upload html/i })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveAttribute('aria-disabled', 'true');
  });
});
