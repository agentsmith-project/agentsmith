/**
 * Alert Notifications Panel Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertNotificationsPanel } from '../AlertNotificationsPanel';
import type { Alert } from '../AlertNotificationsPanel';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockAlerts: Alert[] = [
  {
    id: 'alert_1',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    type: 'quota.exceeded',
    severity: 'critical',
    title: 'Limit Exceeded',
    message: 'Daily limit has been exceeded',
    resource_type: 'endpoint',
    resource_id: 'ep_1',
    resource_name: 'GPT-4',
    metadata: {},
    created_at: '2026-02-27T14:30:00Z',
    status: 'unread',
    actions: [
      { label: 'View Usage', url: '/usage', primary: true },
      { label: 'Dismiss', handler: 'dismiss' },
    ],
  },
  {
    id: 'alert_2',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    type: 'rate_limit.warning',
    severity: 'warning',
    title: 'Rate Limit Warning',
    message: 'Approaching rate limit',
    metadata: {},
    created_at: '2026-02-27T13:00:00Z',
    status: 'read',
  },
  {
    id: 'alert_3',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    type: 'cost.budget_exceeded',
    severity: 'error',
    title: 'Budget Exceeded',
    message: 'Monthly cost budget exceeded',
    metadata: {},
    created_at: '2026-02-27T12:00:00Z',
    status: 'dismissed',
  },
];

describe('AlertNotificationsPanel', () => {
  it('renders non-dismissed alerts', () => {
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    // Should show unread and read alerts, not dismissed
    expect(screen.getByText('Limit Exceeded')).toBeInTheDocument();
    expect(screen.getByText('Rate Limit Warning')).toBeInTheDocument();
  });

  it('filters out dismissed alerts by default', () => {
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    // Should only show unread and read alerts, not dismissed
    expect(screen.getByText('Limit Exceeded')).toBeInTheDocument();
    expect(screen.getByText('Rate Limit Warning')).toBeInTheDocument();
    expect(screen.queryByText('Budget Exceeded')).not.toBeInTheDocument();
  });

  it('renders empty state when no alerts', () => {
    render(
      <AlertNotificationsPanel
        alerts={[]}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('alert-notifications__empty')).toBeInTheDocument();
  });

  it('calls onMarkAsRead when action button is clicked', () => {
    const onMarkAsRead = vi.fn();
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={onMarkAsRead}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    // Click the "View Usage" action button which calls onMarkAsRead
    const actionButton = screen.getByText('View Usage');
    fireEvent.click(actionButton);

    expect(onMarkAsRead).toHaveBeenCalledWith('alert_1');
  });

  it('calls onDismiss when dismiss action button clicked', () => {
    const onDismiss = vi.fn();
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onDismiss={onDismiss}
        onMarkAsRead={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    // Click the "Dismiss" action button (handler: 'dismiss')
    const dismissActionButtons = screen.getAllByText('Dismiss');
    fireEvent.click(dismissActionButtons[0]);

    expect(onDismiss).toHaveBeenCalledWith('alert_1');
  });

  it('displays severity badge for each alert', () => {
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('severity-badge-critical')).toBeInTheDocument();
    expect(screen.getByTestId('severity-badge-warning')).toBeInTheDocument();
  });

  it('shows action buttons for alerts with actions', () => {
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={vi.fn()}
      />
    );

    expect(screen.getByText('View Usage')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('calls onActionClick when action button clicked', () => {
    const onActionClick = vi.fn();
    render(
      <AlertNotificationsPanel
        alerts={mockAlerts}
        onMarkAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onActionClick={onActionClick}
      />
    );

    const actionButton = screen.getByText('View Usage');
    fireEvent.click(actionButton);

    expect(onActionClick).toHaveBeenCalledWith('alert_1', 'View Usage', '/usage');
  });
});
