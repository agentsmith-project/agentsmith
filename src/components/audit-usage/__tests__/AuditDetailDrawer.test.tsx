import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditDetailDrawer } from '../AuditDetailDrawer';

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

describe('AuditDetailDrawer', () => {
  it('renders governance evidence details from audit metadata', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
        basePath="/en-US/workspaces/ws_1/projects/proj_1"
        event={{
          id: 'audit_1',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'resource_policy.spending_limit_exceeded',
          resource_type: 'source_library',
          resource_id: 'lib_1',
          result: 'error',
          error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          error_message: 'resource_policy_spending_limit_exceeded',
          request_id: 'req_1',
          decision_id: 'gdec_1',
          metadata_json: {
            governance_kind: 'resource_policy',
            enforcement_kind: 'spending_limit',
            limit_key: 'source_library.max_file_size_bytes',
            effective_limit: 1048576,
            current_usage: 1048577,
            usage_unit: 'bytes',
            scope: 'resource',
            reason: 'spending_limit_exceeded',
          },
        }}
      />
    );

    const governance = screen.getByTestId('audit__detail-governance');
    const summary = screen.getByTestId('audit__detail-summary');
    expect(summary).toHaveTextContent('User Hit Spending Limit on lib_1 and failed');
    expect(summary).toHaveTextContent('Spending limit exceeded');
    expect(governance).toHaveTextContent('detail.governance_title');
    expect(governance).toHaveTextContent('source_library.max_file_size_bytes');
    expect(governance).toHaveTextContent('1048576');
    expect(governance).toHaveTextContent('1048577');
    expect(governance).toHaveTextContent('Spending limit exceeded');
    expect(governance).not.toHaveTextContent('detail.governance_kind');
    expect(governance).not.toHaveTextContent('detail.enforcement_kind');
    expect(governance).not.toHaveTextContent('detail.scope');
    expect(governance).not.toHaveTextContent('detail.usage_unit');
    expect(screen.getByText('Spending Limit Exceeded')).toBeInTheDocument();
    expect(screen.getByText('gdec_1')).toBeInTheDocument();
    expect(screen.getByTestId('audit__detail-open-resource-policy')).toHaveAttribute(
      'href',
      expect.stringContaining('/resource-policy?resource_type=source_library'),
    );
    expect(screen.getByTestId('audit__detail-open-usage')).toHaveAttribute(
      'href',
      expect.stringContaining('/usage?'),
    );
    expect(screen.getByTestId('audit__detail-open-usage')).toHaveAttribute(
      'href',
      expect.stringContaining('decision_id=gdec_1'),
    );
  });

  it('renders forbidden explainability details from audit metadata', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
        basePath="/en-US/workspaces/ws_1/projects/proj_1"
        event={{
          id: 'audit_2',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'members.update',
          resource_type: 'project',
          resource_id: 'proj_1',
          result: 'error',
          error_code: 'FORBIDDEN',
          error_message: 'forbidden',
          request_id: 'req_2',
          decision_id: 'gdec_2',
          metadata_json: {
            missing_permissions: ['project:manage'],
            authz_decision: {
              membership_status: 'suspended',
            },
          },
        }}
      />
    );

    const governance = screen.getByTestId('audit__detail-governance');
    const summary = screen.getByTestId('audit__detail-summary');
    expect(summary).toHaveTextContent('User Updated Member Access on proj_1 and failed');
    expect(summary).toHaveTextContent('Permission denied');
    expect(screen.getByText('Permission Denied')).toBeInTheDocument();
    expect(governance).toHaveTextContent('project:manage');
    expect(governance).toHaveTextContent('Suspended');
    expect(governance).not.toHaveTextContent('detail.governance_kind');
    expect(screen.getByText('gdec_2')).toBeInTheDocument();
    expect(screen.queryByTestId('audit__detail-open-resource-policy')).not.toBeInTheDocument();
  });

  it('renders readable fallback labels for unknown actors and upstream error codes', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
        event={{
          id: 'audit_3',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'service_account',
          actor_id: 'svc_1',
          action: 'request_delivery_failed',
          resource_type: 'governance_incident',
          resource_id: 'incident_3',
          result: 'error',
          error_code: 'UPSTREAM_429',
          error_message: 'upstream throttled',
          request_id: 'req_3',
          metadata_json: {},
        }}
      />
    );

    expect(screen.getByTestId('audit__detail-summary')).toHaveTextContent(
      'Service Account Request Delivery Failed on incident_3 and failed',
    );
    expect(screen.getByText('Upstream Rate Limited')).toBeInTheDocument();
    expect(screen.getAllByText('Governance Incident').length).toBeGreaterThan(0);
  });

  it('shows governed resource labels for resource policy update failures', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
        event={{
          id: 'audit_4',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'resource_policy.updated',
          resource_type: 'resource_policy',
          resource_id: 'endpoint:ep_1',
          result: 'error',
          error_code: 'VALIDATION_ERROR',
          error_message: 'rate_limits_rule_key_invalid',
          request_id: 'req_policy_invalid',
          metadata_json: {
            governed_resource_type: 'endpoint',
            governed_resource_id: 'ep_1',
          },
        }}
      />
    );

    expect(screen.getByTestId('audit__detail-summary')).toHaveTextContent(
      'User Updated Resource Policy on Model Endpoint ep_1 and failed',
    );
    expect(screen.getAllByText('Resource Policy').length).toBeGreaterThan(0);
    expect(screen.getByText('ep_1')).toBeInTheDocument();
    expect(screen.getByText('Validation Error')).toBeInTheDocument();
    expect(screen.getAllByText('Invalid rate limit rule').length).toBeGreaterThan(0);
  });

  it('humanizes policy enforcement errors in detail view', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
        event={{
          id: 'audit_5',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'resource_policy.access_denied',
          resource_type: 'endpoint',
          resource_id: 'ep_access',
          result: 'error',
          error_code: 'RESOURCE_POLICY_ACCESS_DENIED',
          error_message: 'resource_policy_denied',
          request_id: 'req_policy_denied',
          metadata_json: {},
        }}
      />
    );

    expect(screen.getByTestId('audit__detail-summary')).toHaveTextContent(
      'User Denied Access on ep_access and failed',
    );
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getAllByText('Access denied by resource policy').length).toBeGreaterThan(0);
  });
});
