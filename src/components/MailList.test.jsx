import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SmartFilterBar } from './MailList.jsx';

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
