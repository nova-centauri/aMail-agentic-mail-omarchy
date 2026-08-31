import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchOptions } from './SearchOptions.jsx';

describe('SearchOptions', () => {
  it('writes Gmail operators into the search box', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<SearchOptions open query="" onApply={onApply} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('From'), 'ada@example.com');
    await user.click(screen.getByLabelText('Has attachment'));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(onApply).toHaveBeenCalledWith('from:ada@example.com has:attachment');
  });
});
