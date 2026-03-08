import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePage } from '../UsagePage';

const invalidateQueries = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<object>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  };
});

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => permission === 'project:endpoint:use',
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useUsageKPI: () => ({ data: { requests_today: 10, errors_today: 1, tokens_today: 100 }, isLoading: false }),
  useUsageRecords: () => ({
    data: {
      items: [
        {
          id: 'usage_1',
          time_bucket: '2026-02-28 15:00',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          end_user_id: 'user_001',
          requests: 2,
          duration_p95_ms: 1000,
          bytes_in: 10,
          bytes_out: 20,
          tokens: 300,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_more: false,
    },
    isLoading: false,
    error: null,
  }),
  useLimitsSummary: () => ({
    data: {
      endpoints: [
        {
          resource_id: 'ep_1',
          resource_name: 'Endpoint 1',
          quota_used: 40,
          quota_limit: 100,
          quota_unit: 'requests',
          quota_reset_at: '2026-03-08T00:00:00.000Z',
          percentage_used: 40,
        },
      ],
      total_quota_used: 40,
      total_quota_limit: 100,
    },
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UsagePage', () => {
  beforeEach(() => {
    invalidateQueries.mockClear();
  });

  it('renders simplified my-usage view', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage__my-scope-badge')).toBeInTheDocument();
    expect(screen.getByTestId('usage-lite__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__open-runtime-observability')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__open-release-ops')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__report-schedules')).not.toBeInTheDocument();
  });

  it('does not expose export action in usage view', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.queryByTestId('usage__export-trigger')).not.toBeInTheDocument();
  });

  it('does not expose advanced view toggles in usage view', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.queryByTestId('usage__view-mode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__view-facts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-facts__table')).not.toBeInTheDocument();
  });

  it('keeps lite usage view when current user id is set', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage-lite__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-facts__table')).not.toBeInTheDocument();
  });

  it('keeps lite usage view when default end user id is set', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" defaultEndUserId="user_002" />);

    expect(screen.getByTestId('usage-lite__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__filters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__view-mode')).not.toBeInTheDocument();
  });

  it('switches lite period between 30d and 7d', async () => {
    const user = userEvent.setup();
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage-lite__period-7'));
    expect(screen.getByTestId('usage-lite__period-7')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('usage-lite__period-30')).toHaveAttribute('data-active', 'false');
  });
});
