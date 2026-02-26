/**
 * Top Users List Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopUsersList } from '../TopUsersList';
import type { UserUsageRank } from '../TopUsersList';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('TopUsersList', () => {
  const mockUsers: UserUsageRank[] = [
    {
      end_user_id: 'user_1',
      user_name: 'Alice Johnson',
      requests: 8450,
      tokens: 4500000,
      errors: 12,
      cost_usd: 6.20,
    },
    {
      end_user_id: 'user_2',
      user_name: 'Bob Smith',
      requests: 5200,
      tokens: 2800000,
      errors: 8,
      cost_usd: 3.80,
    },
  ];

  it('renders table with sorted users', () => {
    render(<TopUsersList users={mockUsers} onUserClick={vi.fn()} />);

    expect(screen.getByTestId('dashboard-top-users')).toBeInTheDocument();
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });

  it('handles empty state', () => {
    render(<TopUsersList users={[]} onUserClick={vi.fn()} />);

    expect(screen.getByText(/no_users/i)).toBeInTheDocument();
  });

  it('handles loading state', () => {
    render(<TopUsersList users={[]} onUserClick={vi.fn()} loading />);

    expect(screen.getByTestId('dashboard-top-users__loading')).toBeInTheDocument();
  });
});
