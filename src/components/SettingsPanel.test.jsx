import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel.jsx';

const account = {
  id: 'me',
  name: 'Sam Rivera',
  email: 'sam@rivera.example',
  signature: 'Best,\nSam',
  connected: true,
};

describe('SettingsPanel signature editor', () => {
  it('opens the HTML and visual editors for the selected account', async () => {
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        accounts={[account]}
        activeAccount={account}
        setActiveAccount={vi.fn()}
        privacy={{ privateImages: true }}
        setPrivacy={vi.fn()}
        density="Default"
        setDensity={vi.fn()}
        onAddAccount={vi.fn()}
        onUnlock={vi.fn()}
        onSaveSignature={vi.fn()}
        showUnified={false}
      />,
    );
    expect(screen.getByRole('heading', { name: /signature/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /visual/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /upload html/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('tab', { name: /html/i }));
    expect(screen.getByRole('textbox', { name: 'Signature HTML' })).toHaveValue('Best,\nSam');
  });
});
