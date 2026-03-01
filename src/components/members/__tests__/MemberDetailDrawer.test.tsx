import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GROUP_TEMPLATES } from '@/lib/constants/permissions';

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

vi.mock('@/components/members/PermissionsEditor/PermissionsEditor', () => ({
  PermissionsEditor: ({ initialPermissions }: { initialPermissions: string[] }) => (
    <div data-testid="permissions-editor" data-count={initialPermissions.length} />
  ),
}));

vi.mock('@/components/members/QuotaOverridesEditor', () => ({
  QuotaOverridesEditor: () => <div data-testid="quota-overrides-editor" />,
}));

import { MemberDetailDrawer } from '../MemberDetailDrawer';

describe('MemberDetailDrawer', () => {
  const baseMember = {
    id: 'u_1',
    email: 'u1@example.com',
    name: 'User One',
    role: 'admin' as const,
    permissions: [],
    status: 'active' as const,
    joined_at: '2026-02-01T00:00:00Z',
  };

  it('preselects matching permission template from existing member permissions', async () => {
    render(
      <MemberDetailDrawer
        open
        onOpenChange={() => {}}
        member={baseMember}
        permissions={{ platform_permissions: [...GROUP_TEMPLATES.admin] }}
      />
    );

    await waitFor(() => {
      const selects = screen.getAllByTestId('mock-select');
      expect(selects[1]).toHaveAttribute('data-value', 'admin');
    });
  });

  it('keeps template unselected for custom permission set', async () => {
    render(
      <MemberDetailDrawer
        open
        onOpenChange={() => {}}
        member={{ ...baseMember, id: 'u_2' }}
        permissions={{ platform_permissions: ['project:read', 'project:member:view'] }}
      />
    );

    await waitFor(() => {
      const selects = screen.getAllByTestId('mock-select');
      expect(selects[1]).toHaveAttribute('data-value', '__none__');
    });
  });

  it('renders effective access summary and authorization result', async () => {
    render(
      <MemberDetailDrawer
        open
        onOpenChange={() => {}}
        member={baseMember}
        permissions={{ platform_permissions: ['project:read'] }}
        quotaOverrides={{ daily_tokens: 1000 }}
        effectiveAccessSnapshot={{
          membership: {
            project_id: 'proj_1',
            user_id: 'u_1',
            role: 'admin',
            permissions: ['project:read'],
            status: 'suspended',
            joined_at: '2026-02-01T00:00:00Z',
          },
          permissions: { platform_permissions: ['project:read'] },
          quota_overrides: { daily_tokens: 1000 },
          effective_permissions: ['project:read'],
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
    expect(screen.getByTestId('member-detail__effective-permissions')).toHaveTextContent('project:read');
    expect(screen.getByTestId('member-detail__effective-quotas')).toHaveTextContent('daily_tokens: 1000');
    expect(screen.getByTestId('member-detail__authorize-result')).toBeInTheDocument();
    expect(screen.getByTestId('member-detail__matched-policy')).toHaveTextContent('endpoint/endpoint_1');
  });
});
