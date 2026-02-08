import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import UsagePage from '../page';

const mockUsageFilters = vi.fn((_props: unknown) => <div data-testid="usage-filters" />);
const mockHasPermission = vi.fn((_permission?: string) => true);
const STABLE_USAGE_KPI_RESULT = { data: undefined, isLoading: false };
const STABLE_USAGE_RECORDS_RESULT = { data: { items: [] }, isLoading: false, error: null };
const mockUseUsageKPI = vi.fn((..._args: unknown[]) => STABLE_USAGE_KPI_RESULT);
const mockUseUsageRecords = vi.fn((..._args: unknown[]) => STABLE_USAGE_RECORDS_RESULT);
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
  permissions: ['project:usage:view'],
};

vi.mock('@/components/audit-usage/UsageKPICards', () => ({
  UsageKPICards: () => <div data-testid="usage-kpi-cards" />,
}));

vi.mock('@/components/audit-usage/UsageFilters', () => ({
  UsageFilters: (props: any) => mockUsageFilters(props),
}));

vi.mock('@/components/audit-usage/UsageTable', () => ({
  UsageTable: () => <div data-testid="usage-table" />,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockHasPermission(permission),
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useUsageKPI: (workspaceId: string, projectId: string, startTime: string, endTime: string, endUserId?: string) =>
    mockUseUsageKPI(workspaceId, projectId, startTime, endTime, endUserId),
  useUsageRecords: (
    workspaceId: string,
    projectId: string,
    params: Record<string, unknown>,
    options: Record<string, unknown>
  ) => mockUseUsageRecords(workspaceId, projectId, params, options),
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

describe('UsagePage route', () => {
  it('shows permission error when usage token is missing', async () => {
    mockHasPermission.mockReturnValue(false);
    render(
      <UsagePage
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
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(mockUsageFilters).toHaveBeenCalled();
    });

    const props = mockUsageFilters.mock.calls[0]?.[0] as { defaultEndUserId?: string } | undefined;
    expect(props).toBeDefined();
    expect(props!.defaultEndUserId).toBeUndefined();
  });

  it('defaults usage time range to last 24 hours', async () => {
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(mockUseUsageRecords).toHaveBeenCalled();
    });

    const lastCall = mockUseUsageRecords.mock.calls[mockUseUsageRecords.mock.calls.length - 1];
    const params = lastCall?.[2] as { start_time?: string; end_time?: string } | undefined;
    expect(params?.start_time).toBeDefined();
    expect(params?.end_time).toBeDefined();

    const start = new Date(params!.start_time as string).getTime();
    const end = new Date(params!.end_time as string).getTime();
    const hours = (end - start) / (1000 * 60 * 60);
    expect(hours).toBeGreaterThanOrEqual(23.5);
    expect(hours).toBeLessThanOrEqual(24.5);
  });

  it('renders header and toolbar layout', async () => {
    render(
      <UsagePage
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
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <UsagePage
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
