/**
 * Dashboard KPI Cards Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardKPICards } from '../DashboardKPICards';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('DashboardKPICards', () => {
  it('renders loading skeleton when loading=true', () => {
    render(<DashboardKPICards kpi={undefined} loading={true} />);

    // Should have 3 skeleton cards
    const skeletons = screen.getAllByTestId(/skeleton/i);
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('renders all KPI cards with data', () => {
    const kpi = {
      total_requests: 4500,
      total_tokens: 2400000,
      total_errors: 23,
      total_cost_usd: 12.50,
      requests_change_percent: 5.2,
      tokens_change_percent: 3.1,
      errors_change_percent: -2.5,
    };

    render(<DashboardKPICards kpi={kpi} loading={false} />);

    // Check for main metrics
    expect(screen.getByText(/4.5K/)).toBeInTheDocument(); // requests
    expect(screen.getByText(/2.4M/)).toBeInTheDocument(); // tokens
    expect(screen.getByText(/23/)).toBeInTheDocument(); // errors
  });

  it('displays trend indicator for requests', () => {
    const kpi = {
      total_requests: 4500,
      total_tokens: 2400000,
      total_errors: 23,
      requests_change_percent: 5.2,
    };

    render(<DashboardKPICards kpi={kpi} loading={false} />);

    // Should show the trend percentage
    expect(screen.getByText(/5.2%/)).toBeInTheDocument();
  });

  it('applies error color for error trend increase', () => {
    const kpi = {
      total_requests: 4500,
      total_tokens: 2400000,
      total_errors: 23,
      errors_change_percent: 10.5, // Increasing errors = bad
    };

    const { container } = render(<DashboardKPICards kpi={kpi} loading={false} />);

    // Error card should have error color styling
    const errorCard = container.querySelector('[data-testid="dashboard-kpi__errors"]');
    expect(errorCard).toHaveClass(/error/);
  });

  it('hides optional cost card when cost data unavailable', () => {
    const kpi = {
      total_requests: 4500,
      total_tokens: 2400000,
      total_errors: 23,
      // No cost data
    };

    const { container } = render(<DashboardKPICards kpi={kpi} loading={false} />);

    // Should not have a cost card
    expect(container.querySelector('[data-testid="dashboard-kpi__cost"]')).toBeNull();
  });

  it('formats large numbers correctly', () => {
    const kpi = {
      total_requests: 1234567,
      total_tokens: 9876543210,
      total_errors: 0,
      total_cost_usd: 1234.56,
    };

    render(<DashboardKPICards kpi={kpi} loading={false} />);

    expect(screen.getByText(/1.2M/)).toBeInTheDocument(); // requests
    expect(screen.getByText(/9.9B/)).toBeInTheDocument(); // tokens
    expect(screen.getByText(/\$1,234.56/)).toBeInTheDocument(); // cost
  });

  it('returns null when kpi is undefined and not loading', () => {
    const { container } = render(<DashboardKPICards kpi={undefined} loading={false} />);

    expect(container.firstChild).toBeNull();
  });
});
