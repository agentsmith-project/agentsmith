import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditTable } from '../AuditTable';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'summary.user_actor') return 'User';
    if (key === 'summary.agent_actor') return 'Agent';
    if (key === 'summary.plugin_actor') return 'Plugin';
    if (key === 'summary.result_ok') return 'succeeded';
    if (key === 'summary.result_error') return 'failed';
    if (key === 'summary.line' && values) {
      return `${values.actor} ${values.action} on ${values.resource} and ${values.result}`;
    }
    return key;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('AuditTable', () => {
  it('shows only MVP review columns in the main table', () => {
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
    expect(within(table).getByText('table.timestamp')).toBeInTheDocument();
    expect(within(table).getByText('table.action')).toBeInTheDocument();
    expect(within(table).getByText('table.summary')).toBeInTheDocument();
    expect(within(table).getByText('table.actor')).toBeInTheDocument();
    expect(within(table).getByText('table.resource')).toBeInTheDocument();
    expect(within(table).getByText('table.result')).toBeInTheDocument();
    expect(within(table).queryByText('table.request_id')).not.toBeInTheDocument();
    expect(within(table).queryByText('table.decision_id')).not.toBeInTheDocument();
    expect(within(table).queryByText('table.trace_ref')).not.toBeInTheDocument();
    expect(within(table).queryByText('table.error_code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit__column-settings')).not.toBeInTheDocument();
  });

  it('shows category summary and row category badges', () => {
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
            action: 'credential_create',
            result: 'ok',
            request_id: 'req_change',
            resource_id: 'endpoint_1',
            metadata_json: {},
          },
          {
            id: 'audit_2',
            timestamp: '2026-03-01T01:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'agent',
            actor_id: 'agent_1',
            action: 'endpoint.invoke',
            result: 'ok',
            request_id: 'req_event',
            resource_id: 'endpoint_1',
            metadata_json: {},
          },
          {
            id: 'audit_3',
            timestamp: '2026-03-01T02:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_2',
            action: 'governance_blocked',
            result: 'error',
            request_id: 'req_anomaly',
            error_code: 'blocked',
            resource_id: 'endpoint_2',
            metadata_json: {},
          },
        ]}
      />,
    );

    expect(screen.getByTestId('audit__category-summary--change')).toHaveTextContent('1');
    expect(screen.getByTestId('audit__category-summary--event')).toHaveTextContent('1');
    expect(screen.getByTestId('audit__category-summary--anomaly')).toHaveTextContent('1');
    expect(screen.getByTestId('audit__category-badge--change')).toBeInTheDocument();
    expect(screen.getByTestId('audit__category-badge--event')).toBeInTheDocument();
    expect(screen.getByTestId('audit__category-badge--anomaly')).toBeInTheDocument();
    expect(screen.getByText('User Created Credential on endpoint_1 and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Agent Invoked on endpoint_1 and succeeded')).toBeInTheDocument();
    expect(screen.getByText('User Triggered Governance Block on endpoint_2 and failed')).toBeInTheDocument();
  });
});
