import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertNotificationItem } from '../AlertNotificationItem';
import type { AlertNotification } from '@/lib/types/alerts';

const sampleNotification: AlertNotification = {
  id: 'notif_1',
  rule_id: 'rule_1',
  rule_name: 'Requests Spike',
  status: 'firing',
  triggered_at: '2026-02-27T10:00:00Z',
  metric: 'requests_per_day',
  operator: 'gt',
  threshold: 1000,
  actual_value: 1300,
  context: {
    resource_type: 'endpoint',
    resource_id: 'ep_1',
    resource_name: 'OpenAI Main',
  },
  delivery: {
    in_app_sent: true,
    webhook_sent: false,
  },
};

describe('AlertNotificationItem', () => {
  it('renders notification content', () => {
    render(
      <AlertNotificationItem
        notification={sampleNotification}
        onAcknowledge={vi.fn()}
        onSilence={vi.fn()}
      />,
    );

    expect(screen.getByText('Requests Spike')).toBeInTheDocument();
    expect(screen.getByText(/requests_per_day gt 1000/)).toBeInTheDocument();
    expect(screen.getByText(/actual: 1300/)).toBeInTheDocument();
    expect(screen.getByText(/Resource: OpenAI Main/)).toBeInTheDocument();
  });

  it('calls action handlers', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    const onSilence = vi.fn();

    render(
      <AlertNotificationItem
        notification={sampleNotification}
        onAcknowledge={onAcknowledge}
        onSilence={onSilence}
      />,
    );

    await user.click(screen.getByTestId('alert-notification__acknowledge--notif_1'));
    await user.click(screen.getByTestId('alert-notification__silence--notif_1'));

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it('disables actions for resolved notifications', () => {
    render(
      <AlertNotificationItem
        notification={{ ...sampleNotification, status: 'resolved' }}
        onAcknowledge={vi.fn()}
        onSilence={vi.fn()}
      />,
    );

    expect(screen.getByTestId('alert-notification__acknowledge--notif_1')).toBeDisabled();
    expect(screen.getByTestId('alert-notification__silence--notif_1')).toBeDisabled();
  });
});
