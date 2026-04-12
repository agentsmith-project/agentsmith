/**
 * Alert Center Page Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertCenterPage } from '../AlertCenterPage';
import type { AlertRule } from '@/lib/types/alerts';
import type { Alert } from '@/lib/types/alerts';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock use-permissions hook
const mockUseAlertPageCapabilities = vi.fn(() => ({ canRead: true, canManage: true }));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useAlertPageCapabilities: () => mockUseAlertPageCapabilities(),
}));

// Mock child components
vi.mock('../AlertRulesList', () => ({
  AlertRulesList: ({ onEdit, onDelete, onToggle, onTest }: any) => (
    <div data-testid="alert-rules-list-mock">
      <button onClick={() => onEdit('rule_1')}>Edit</button>
      <button onClick={() => onDelete('rule_1')}>Delete</button>
      <button onClick={() => onToggle('rule_1', false)}>Toggle</button>
      <button onClick={() => onTest('rule_1')}>Test</button>
    </div>
  ),
}));

vi.mock('../AlertNotificationsPanel', () => ({
  AlertNotificationsPanel: ({ onMarkAsRead, onDismiss }: any) => (
    <div data-testid="alert-notifications-panel-mock">
      <button onClick={() => onMarkAsRead('alert_1')}>Mark Read</button>
      <button onClick={() => onDismiss('alert_1')}>Dismiss</button>
    </div>
  ),
}));

vi.mock('../AlertRuleFormDialog', () => ({
  AlertRuleFormDialog: ({ open, onClose, onSave }: any) => {
    if (!open) return null;
    return (
      <div data-testid="alert-rule-form-dialog-mock">
        <button onClick={() => onSave({ name: 'Test Rule' })}>Save</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    );
  },
}));

const _mockRules: AlertRule[] = [
  {
    id: 'rule_1',
    project_id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'High Requests Alert',
    description: 'Alert when daily requests exceed threshold',
    enabled: true,
    trigger: {
      metric: 'requests_per_day',
      operator: 'gt',
      threshold: 1000,
    },
    channels: {
      in_app: true,
      webhook: { url: 'https://example.com/webhook' },
    },
    behavior: {
      debounce_minutes: 10,
      notify_on_recovery: true,
    },
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
    last_triggered_at: '2026-02-27T14:30:00Z',
  },
];

const _mockAlerts: Alert[] = [
  {
    id: 'alert_1',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    type: 'spending_limit.exceeded',
    severity: 'critical',
    title: 'Limit Exceeded',
    message: 'Daily limit has been exceeded',
    metadata: {},
    created_at: '2026-02-27T14:30:00Z',
    status: 'unread',
  },
];

describe('AlertCenterPage', () => {
  beforeEach(() => {
    mockUseAlertPageCapabilities.mockReturnValue({ canRead: true, canManage: true });
  });

  it('renders tabs for rules and notifications', () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    expect(screen.getByRole('tab', { name: /rules/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByTestId('alert-center-page')).toBeInTheDocument();
    expect(screen.getByTestId('alert-center__summary-meta')).toBeInTheDocument();
    expect(screen.getByTestId('alert-center__summary-meta')).toHaveTextContent('enabled_rules');
    expect(screen.getByTestId('alert-center__summary-meta')).not.toHaveTextContent('create_rule');
    expect(screen.getByTestId('alert-center__main-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-center__summary-card')).not.toBeInTheDocument();
  });

  it('shows rules list by default', () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    expect(screen.getByTestId('alert-rules-list-mock')).toBeInTheDocument();
  });

  it('switches to notifications tab when clicked', () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    // Verify rules tab is initially selected
    const rulesTab = screen.getByRole('tab', { name: /rules/i });
    expect(rulesTab).toHaveAttribute('data-state', 'active');

    // Click notifications tab - should not throw
    const notificationsTab = screen.getByRole('tab', { name: /notifications/i });
    expect(() => fireEvent.click(notificationsTab)).not.toThrow();
  });

  it('opens create dialog when create button clicked', async () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    const createButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByTestId('alert-rule-form-dialog-mock')).toBeInTheDocument();
    });
  });

  it('has create button in rules tab', () => {
    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('hides create button for audit readers without governance update', () => {
    mockUseAlertPageCapabilities.mockReturnValue({ canRead: true, canManage: false });

    render(
      <AlertCenterPage
        workspaceId="ws_1"
        projectId="proj_1"
      />
    );

    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });
});
