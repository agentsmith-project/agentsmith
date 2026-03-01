import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditDetailDrawer } from '../AuditDetailDrawer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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
        event={{
          id: 'audit_1',
          timestamp: '2026-03-01T00:00:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'resource_policy.quota_exceeded',
          resource_type: 'source_library',
          resource_id: 'lib_1',
          result: 'error',
          error_code: 'RESOURCE_POLICY_QUOTA_EXCEEDED',
          error_message: 'resource_policy_quota_exceeded',
          request_id: 'req_1',
          metadata_json: {
            governance_kind: 'resource_policy',
            enforcement_kind: 'quota_limit',
            quota_key: 'source_library.max_file_size_bytes',
            effective_limit: 1048576,
            current_usage: 1048577,
            usage_unit: 'bytes',
            scope: 'resource',
            reason: 'quota_exceeded',
          },
        }}
      />
    );

    const governance = screen.getByTestId('audit__detail-governance');
    expect(governance).toHaveTextContent('detail.governance_title');
    expect(governance).toHaveTextContent('source_library.max_file_size_bytes');
    expect(governance).toHaveTextContent('1048576');
    expect(governance).toHaveTextContent('1048577');
    expect(governance).toHaveTextContent('quota_exceeded');
  });

  it('renders forbidden explainability details from audit metadata', () => {
    render(
      <AuditDetailDrawer
        open
        onOpenChange={() => {}}
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
          metadata_json: {
            missing_permissions: ['project:member:manage'],
            authz_decision: {
              membership_status: 'suspended',
            },
          },
        }}
      />
    );

    const governance = screen.getByTestId('audit__detail-governance');
    expect(governance).toHaveTextContent('project:member:manage');
    expect(governance).toHaveTextContent('suspended');
  });
});
