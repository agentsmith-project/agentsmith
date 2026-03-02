import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import AuditPage from '../page';

const mockAuditFilters = vi.fn((_props: unknown) => <div data-testid="audit-filters" />);
const mockHasPermission = vi.fn((_permission?: string) => true);
const STABLE_AUDIT_ITEMS: [] = [];
const STABLE_PROJECT = {
  id: 'proj_1',
  workspace_id: 'ws_1',
  name: 'Project',
  visibility: 'private',
  owner_id: 'user_001',
  status: 'active',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  role: 'user' as const,
  permissions: ['project:audit:view'],
};
const mockSearchParams = new URLSearchParams();
const mockUseSearchParams = vi.fn(() => mockSearchParams);

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useSearchParams: () => mockUseSearchParams(),
  };
});

vi.mock('@/components/audit-usage/AuditFilters', () => ({
  AuditFilters: (props: any) => mockAuditFilters(props),
}));

vi.mock('@/components/audit-usage/AuditTable', () => ({
  AuditTable: () => <div data-testid="audit-table" />,
}));

vi.mock('@/components/audit-usage/AuditDetailDrawer', () => ({
  AuditDetailDrawer: () => null,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockHasPermission(permission),
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useAuditEvents: () => ({ data: { items: STABLE_AUDIT_ITEMS }, isLoading: false, error: null }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn() },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => ({
    data: STABLE_PROJECT,
  }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user_001' } }),
}));

describe('AuditPage route', () => {
  beforeEach(() => {
    mockSearchParams.forEach((_value, key) => {
      mockSearchParams.delete(key);
    });
  });

  it('hydrates audit filters from URL search params', async () => {
    mockSearchParams.set('start_time', '2026-02-28T00:00:00.000Z');
    mockSearchParams.set('end_time', '2026-03-01T00:00:00.000Z');
    mockSearchParams.set('result', 'error');
    render(
      <AuditPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(mockAuditFilters).toHaveBeenCalled();
    });
    const latestProps = mockAuditFilters.mock.calls.at(-1)?.[0] as { filters?: Record<string, string> } | undefined;
    expect(latestProps?.filters?.result).toBe('error');
    expect(latestProps?.filters?.start_time).toBe('2026-02-28T00:00:00.000Z');
    expect(latestProps?.filters?.end_time).toBe('2026-03-01T00:00:00.000Z');
    mockSearchParams.delete('start_time');
    mockSearchParams.delete('end_time');
    mockSearchParams.delete('result');
  });

  it('shows permission error when audit token is missing', async () => {
    mockHasPermission.mockReturnValue(false);
    render(
      <AuditPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    mockHasPermission.mockReturnValue(true);
  });

  it('does not force end_user_id by role', async () => {
    render(
      <AuditPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(mockAuditFilters).toHaveBeenCalled();
    });

    const props = mockAuditFilters.mock.calls[0]?.[0] as { defaultEndUserId?: string } | undefined;
    expect(props).toBeDefined();
    expect(props!.defaultEndUserId).toBeUndefined();
  });

  it('renders header and toolbar layout', async () => {
    render(
      <AuditPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(within(header).getByTestId('audit__open-members')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/members');
    expect(within(header).getByTestId('audit__open-resource-policy')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/resource-policy');
    expect(within(header).getByTestId('audit__open-usage')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/usage');
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByRole('button', { name: 'refresh' })).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <AuditPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
