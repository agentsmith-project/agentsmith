import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsageFactDetailDrawer } from '../UsageFactDetailDrawer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

describe('UsageFactDetailDrawer', () => {
  it('renders governance quota evidence details from fact metadata', () => {
    render(
      <UsageFactDetailDrawer
        open
        onOpenChange={() => {}}
        basePath="/en-US/workspaces/ws_1/projects/proj_1"
        facts={[
          {
            id: 'fact_quota_1',
            timestamp: '2026-03-01T00:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            resource_type: 'source_library',
            resource_id: 'lib_1',
            request_id: 'req_quota_1',
            requests: 1,
            result: 'error',
            error_code: 'RESOURCE_POLICY_QUOTA_EXCEEDED',
            runtime: {
              provider: 'secondaryok',
              resolved_model: 'model-b',
            },
            metadata_json: {
              governance_kind: 'resource_policy',
              enforcement_kind: 'quota_limit',
              quota_key: 'source_library.max_total_files',
              effective_limit: 200,
              current_usage: 201,
              usage_unit: 'files',
              scope: 'resource',
              reason: 'quota_exceeded',
            },
          },
        ]}
      />
    );

    const governance = screen.getByTestId('usage__detail-governance-fact_quota_1');
    expect(governance).toHaveTextContent('detail.governance_title');
    expect(governance).toHaveTextContent('source_library.max_total_files');
    expect(governance).toHaveTextContent('200');
    expect(governance).toHaveTextContent('201');
    expect(governance).toHaveTextContent('quota_exceeded');
    expect(screen.getByTestId('usage__detail-open-resource-policy-fact_quota_1')).toHaveAttribute(
      'href',
      expect.stringContaining('/resource-policy?resource_type=source_library'),
    );
  });

  it('renders forbidden membership and missing permission evidence', () => {
    render(
      <UsageFactDetailDrawer
        open
        onOpenChange={() => {}}
        basePath="/en-US/workspaces/ws_1/projects/proj_1"
        facts={[
          {
            id: 'fact_forbidden_1',
            timestamp: '2026-03-01T00:00:00.000Z',
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            resource_type: 'project',
            resource_id: 'proj_1',
            request_id: 'req_forbidden_1',
            requests: 1,
            result: 'error',
            error_code: 'FORBIDDEN',
            metadata_json: {
              missing_permissions: ['project:manage'],
              authz_decision: {
                membership_status: 'suspended',
              },
            },
          },
        ]}
      />
    );

    const governance = screen.getByTestId('usage__detail-governance-fact_forbidden_1');
    expect(governance).toHaveTextContent('project:manage');
    expect(governance).toHaveTextContent('suspended');
    expect(screen.queryByTestId('usage__detail-open-resource-policy-fact_forbidden_1')).not.toBeInTheDocument();
  });
});
