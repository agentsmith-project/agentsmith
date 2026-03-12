import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditTable } from '../AuditTable';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'summary.user_actor') return 'User';
    if (key === 'summary.agent_actor') return 'Agent';
    if (key === 'summary.plugin_actor') return 'Plugin';
    if (key === 'summary.system_actor') return 'System';
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

  it('humanizes unknown actor, resource, action, and error shapes without breaking the review table', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_4',
            timestamp: '2026-03-01T03:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'service_account',
            actor_id: 'svc_1',
            action: 'request_delivery_failed',
            resource_type: 'governance_incident',
            resource_id: 'incident_1',
            result: 'error',
            error_code: 'UPSTREAM_429',
            request_id: 'req_4',
            metadata_json: {},
          },
        ]}
      />,
    );

    expect(screen.getByText('Service Account')).toBeInTheDocument();
    expect(screen.getByText('Governance Incident')).toBeInTheDocument();
    expect(screen.getByText('Service Account Request Delivery Failed on incident_1 and failed')).toBeInTheDocument();
  });

  it('uses governed resource details for resource policy updates', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_5',
            timestamp: '2026-03-01T04:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_5',
            action: 'resource_policy.updated',
            resource_type: 'resource_policy',
            resource_id: 'endpoint:ep_1',
            result: 'error',
            request_id: 'req_policy_invalid',
            error_code: 'VALIDATION_ERROR',
            error_message: 'rate_limits_rule_key_invalid',
            metadata_json: {
              governed_resource_type: 'endpoint',
              governed_resource_id: 'ep_1',
            },
          },
        ]}
      />,
    );

    expect(screen.getByText('User Updated Resource Policy on Model Endpoint ep_1 and failed')).toBeInTheDocument();
    expect(screen.getByText('Resource Policy')).toBeInTheDocument();
    expect(screen.getByText('Model Endpoint ep_1')).toBeInTheDocument();
    expect(screen.getByText('Invalid rate limit rule')).toBeInTheDocument();
  });

  it('prefers resource names for endpoint and credential configuration events', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_11',
            timestamp: '2026-03-01T10:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_11',
            action: 'endpoint.update',
            resource_type: 'endpoint',
            resource_id: 'ep_11',
            result: 'ok',
            request_id: 'req_endpoint_update',
            metadata_json: {
              name: 'Primary GPT Endpoint',
            },
          },
          {
            id: 'audit_12',
            timestamp: '2026-03-01T11:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_12',
            action: 'credential.create',
            resource_type: 'credential',
            resource_id: 'cred_12',
            result: 'ok',
            request_id: 'req_credential_create',
            metadata_json: {
              name: 'OpenAI Admin Key',
            },
          },
        ]}
      />,
    );

    expect(screen.getByText('User Updated Endpoint on Model Endpoint Primary GPT Endpoint and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Model Endpoint Primary GPT Endpoint')).toBeInTheDocument();
    expect(screen.getByText('User Created Credential on Credential OpenAI Admin Key and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Credential OpenAI Admin Key')).toBeInTheDocument();
  });

  it('humanizes policy enforcement actions for review scanning', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_6',
            timestamp: '2026-03-01T05:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_6',
            action: 'resource_policy.access_denied',
            resource_type: 'endpoint',
            resource_id: 'ep_access',
            result: 'error',
            error_code: 'RESOURCE_POLICY_ACCESS_DENIED',
            request_id: 'req_access',
            metadata_json: {},
          },
          {
            id: 'audit_7',
            timestamp: '2026-03-01T06:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_7',
            action: 'resource_policy.rate_limited',
            resource_type: 'endpoint',
            resource_id: 'ep_rate',
            result: 'error',
            error_code: 'RESOURCE_POLICY_RATE_LIMIT_EXCEEDED',
            request_id: 'req_rate',
            metadata_json: {},
          },
        ]}
      />,
    );

    expect(screen.getByText('User Denied Access on ep_access and failed')).toBeInTheDocument();
    expect(screen.getByText('User Rate Limited on ep_rate and failed')).toBeInTheDocument();
    expect(screen.getByText('Denied Access')).toBeInTheDocument();
    expect(screen.getByText('Rate Limited')).toBeInTheDocument();
  });

  it('humanizes membership and permission change actions', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_8',
            timestamp: '2026-03-01T07:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_8',
            action: 'member.permissions.updated',
            resource_type: 'member',
            resource_id: 'user_alt',
            result: 'ok',
            request_id: 'req_member_permissions',
            metadata_json: {},
          },
          {
            id: 'audit_9',
            timestamp: '2026-03-01T08:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_9',
            action: 'member.membership.suspended',
            resource_type: 'membership',
            resource_id: 'user_alt',
            result: 'ok',
            request_id: 'req_member_suspended',
            metadata_json: {},
          },
        ]}
      />,
    );

    expect(screen.getByText('User Updated Member Permissions on user_alt and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Updated Member Permissions')).toBeInTheDocument();
    expect(screen.getByText('User Suspended Membership on user_alt and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Membership')).toBeInTheDocument();
    expect(screen.getByText('Suspended Membership')).toBeInTheDocument();
  });

  it('prefers requested user context for join request events', () => {
    render(
      <AuditTable
        data={[
          {
            id: 'audit_10',
            timestamp: '2026-03-01T09:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            actor_type: 'user',
            actor_id: 'user_alt',
            action: 'member.join_request.created',
            resource_type: 'join_request',
            resource_id: 'jr_123',
            result: 'ok',
            request_id: 'req_join_request_created',
            metadata_json: {
              requested_user_id: 'user_alt',
            },
          },
        ]}
      />,
    );

    expect(screen.getByText('User Created Join Request on Join Request user_alt and succeeded')).toBeInTheDocument();
    expect(screen.getByText('Join Request')).toBeInTheDocument();
    expect(screen.getByText('Join Request user_alt')).toBeInTheDocument();
  });
});
