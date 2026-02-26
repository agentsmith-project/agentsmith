/**
 * Alert Rule Card Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertRuleCard } from '../AlertRuleCard';
import type { AlertRule } from '@/lib/types/alerts';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockRule: AlertRule = {
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
};

describe('AlertRuleCard', () => {
  it('renders rule name and description', () => {
    render(<AlertRuleCard rule={mockRule} onEdit={vi.fn()} onDelete={vi.fn()} onToggle={vi.fn()} onTest={vi.fn()} />);

    expect(screen.getByText('High Requests Alert')).toBeInTheDocument();
    expect(screen.getByText(/Alert when daily requests exceed threshold/)).toBeInTheDocument();
  });

  it('displays trigger condition', () => {
    render(<AlertRuleCard rule={mockRule} onEdit={vi.fn()} onDelete={vi.fn()} onToggle={vi.fn()} onTest={vi.fn()} />);

    expect(screen.getByText(/requests_per_day.*gt.*1000/)).toBeInTheDocument();
  });

  it('displays enabled toggle state', () => {
    render(<AlertRuleCard rule={mockRule} onEdit={vi.fn()} onDelete={vi.fn()} onToggle={vi.fn()} onTest={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeInTheDocument();
  });

  it('calls onToggle when toggle clicked', () => {
    const onToggle = vi.fn();
    render(<AlertRuleCard rule={mockRule} onEdit={vi.fn()} onDelete={vi.fn()} onToggle={onToggle} onTest={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('disables rule when disabled', () => {
    const disabledRule = { ...mockRule, enabled: false };
    render(<AlertRuleCard rule={disabledRule} onEdit={vi.fn()} onDelete={vi.fn()} onToggle={vi.fn()} onTest={vi.fn()} />);

    expect(screen.getByText(/disabled/i)).toBeInTheDocument();
  });
});
