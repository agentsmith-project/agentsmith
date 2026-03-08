/**
 * Top Resources List Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopResourcesList } from '../TopResourcesList';
import type { ResourceUsageRank } from '../TopResourcesList';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('TopResourcesList', () => {
  const mockResources: ResourceUsageRank[] = [
    {
      resource_id: 'ep_1',
      resource_type: 'endpoint',
      resource_name: 'GPT-4',
      requests: 15000,
      tokens: 8500000,
      errors: 45,
      cost_usd: 12.50,
    },
    {
      resource_id: 'agent_1',
      resource_type: 'agent',
      resource_name: 'Research Agent',
      requests: 8500,
      tokens: 4200000,
      errors: 12,
      cost_usd: 6.20,
    },
  ];

  it('renders table with sorted resources', () => {
    render(<TopResourcesList resources={mockResources} onResourceClick={vi.fn()} />);

    expect(screen.getByTestId('dashboard-top-resources')).toBeInTheDocument();
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
    expect(screen.getByText('Research Agent')).toBeInTheDocument();
  });

  it('displays resource type badge', () => {
    render(<TopResourcesList resources={mockResources} onResourceClick={vi.fn()} />);

    // Check for resource type badges by looking for the icon containers
    const badges = screen.getAllByTestId(/resource-type-badge/i);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty state', () => {
    render(<TopResourcesList resources={[]} onResourceClick={vi.fn()} />);

    expect(screen.getByText(/no_resources/i)).toBeInTheDocument();
  });

  it('handles loading state', () => {
    render(<TopResourcesList resources={[]} onResourceClick={vi.fn()} loading />);

    expect(screen.getByTestId('dashboard-top-resources__loading')).toBeInTheDocument();
  });

  it('displays limit progress bar', () => {
    render(<TopResourcesList resources={mockResources} onResourceClick={vi.fn()} />);

    // Should have progress bars for each resource
    const progressBars = screen.getAllByTestId(/limit-progress/i);
    expect(progressBars.length).toBe(2);
  });
});
