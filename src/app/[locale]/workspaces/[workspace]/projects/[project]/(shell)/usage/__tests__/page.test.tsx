import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import UsagePage from '../page';

const mockUsageFilters = vi.fn(() => <div data-testid="usage-filters" />);
const STABLE_USAGE_KPI_RESULT = { data: undefined, isLoading: false };
const STABLE_USAGE_RECORDS_RESULT = { data: { items: [] }, isLoading: false, error: null };
const mockUseUsageKPI = vi.fn(() => STABLE_USAGE_KPI_RESULT);
const mockUseUsageRecords = vi.fn(() => STABLE_USAGE_RECORDS_RESULT);
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
  permissions: ['project:usage:read'],
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
  useHasPermission: () => true,
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
  it('locks end_user_id for user role', async () => {
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

    const props = mockUsageFilters.mock.calls[0][0];
    expect(props.defaultEndUserId).toBe('user_001');
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
