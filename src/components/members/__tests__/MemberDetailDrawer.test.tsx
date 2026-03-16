import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, children }: { value?: string; children: React.ReactNode }) => (
    <div data-testid="mock-select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MemberDetailDrawer } from '../MemberDetailDrawer';

describe('MemberDetailDrawer', () => {
  const baseMember = {
    id: 'u_1',
    email: 'u1@example.com',
    name: 'User One',
    groups: [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }],
    permissions: [],
    status: 'active' as const,
    joined_at: '2026-02-01T00:00:00Z',
  };

  it('shows effective-access-only view and removes editable sections', () => {
    render(
      <MemberDetailDrawer
        open
        onOpenChange={() => {}}
        member={baseMember}
        permissions={{ platform_permissions: ['project:endpoint:use', 'project:membership:update'] }}
      />
    );

    expect(screen.getByTestId('member-detail__effective-access-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('permissions-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-select')).toHaveAttribute('data-value', 'endpoint');
  });

  it('renders effective access summary and authorization result', () => {
    render(
      <MemberDetailDrawer
        open
        onOpenChange={() => {}}
        member={baseMember}
        _workspaceId="ws_1"
        _projectId="proj_1"
        locale="en-US"
        initialAuthorization={{
          resourceType: 'endpoint',
          resourceId: 'endpoint_1',
          action: 'invoke',
        }}
        permissions={{ platform_permissions: ['project:endpoint:use'] }}
        effectiveAccessSnapshot={{
          membership: {
            project_id: 'proj_1',
            user_id: 'u_1',
            groups: [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }],
            permissions: ['project:endpoint:use'],
            status: 'suspended',
            joined_at: '2026-02-01T00:00:00Z',
          },
          permissions: { platform_permissions: ['project:endpoint:use'] },
          effective_permissions: ['project:endpoint:use'],
          membership_status: 'suspended',
        }}
        authorizationCheckResult={{
          allowed: false,
          decision: {
            source: 'resource_policy',
            rule_id: 'rp_1',
            reason: 'resource_policy_denied',
          },
          matched_policy: {
            id: 'rp_1',
            resource_type: 'endpoint',
            resource_id: 'endpoint_1',
            access_mode: 'allow_list',
            matched_subject: { type: 'user', id: 'u_1' },
          },
        }}
      />
    );

    expect(screen.getByTestId('member-detail__effective-access-summary')).toBeInTheDocument();
    expect(screen.getByTestId('member-detail__membership-status')).toHaveTextContent('effective_access.membership_status.suspended');
    expect(screen.getByTestId('member-detail__effective-permissions')).toHaveTextContent('project:endpoint:use');
    expect(screen.getByTestId('member-detail__authorize-result')).toBeInTheDocument();
    expect(screen.getByTestId('member-detail__authorize-result')).toHaveTextContent('Resource Policy');
    expect(screen.getByTestId('member-detail__authorize-result')).toHaveTextContent('Resource Policy Denied');
    expect(screen.getByTestId('member-detail__matched-policy')).toHaveTextContent('endpoint/endpoint_1');
    expect(screen.getByTestId('member-detail__open-resource-policy')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1/projects/proj_1/resource-policy?resource_type=endpoint&resource_id=endpoint_1&explain_subject_type=user&explain_subject_id=u_1&explain_action=invoke',
    );
  });
});
