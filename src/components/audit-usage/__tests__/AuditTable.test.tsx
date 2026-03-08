import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuditTable } from '../AuditTable';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('AuditTable', () => {
  it('toggles anchor columns visibility', async () => {
    const user = userEvent.setup();
    render(
      <AuditTable
        data={[
          {
            id: 'audit_1',
            timestamp: '2026-03-01T00:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_1',
            action: 'endpoint.invoke',
            result: 'ok',
            request_id: 'req_1',
            decision_id: 'gdec_1',
            trace_ref: 'trace_1',
            metadata_json: {},
          },
        ]}
      />,
    );

    const table = screen.getByTestId('audit__table');
    expect(within(table).getByText('table.request_id')).toBeInTheDocument();
    expect(within(table).getByText('table.decision_id')).toBeInTheDocument();
    expect(within(table).getByText('table.trace_ref')).toBeInTheDocument();

    await user.click(screen.getByTestId('audit__column-settings'));
    await user.click(screen.getByTestId('audit__column-toggle-request_id'));

    expect(within(table).queryByText('table.request_id')).not.toBeInTheDocument();
    expect(within(table).getByText('table.decision_id')).toBeInTheDocument();
    expect(within(table).getByText('table.trace_ref')).toBeInTheDocument();
  });
});
