import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePage } from '../UsagePage';
import { UsageView } from '../UsageView';

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
          endpoint_id: 'ep_1',
          endpoint_name: '',
          limits: [
            {
              kind: 'rate_limit',
              window: 'minute',
              metric: 'requests',
              policy_key: 'endpoint.requests_per_minute',
              used: 40,
              max: 100,
              remaining: 60,
              usage_pct: 40,
              reset_at: '2026-03-08T00:00:00.000Z',
            },
            {
              kind: 'spending_limit',
              window: 'day',
              metric: 'usd',
              policy_key: 'endpoint.spending_usd_per_day',
              used: 12,
              max: 50,
              remaining: 38,
              usage_pct: 24,
              reset_at: '2026-03-08T00:00:00.000Z',
            },
          ],
        },
        {
          endpoint_id: 'ep_2',
          endpoint_name: 'Endpoint 2',
          limits: [
            {
              kind: 'rate_limit',
              window: 'day',
              metric: 'requests',
              policy_key: 'endpoint.requests_per_day',
              used: 10,
              max: 20,
              remaining: 10,
              usage_pct: 50,
              reset_at: '2026-03-08T00:00:00.000Z',
            },
          ],
        },
      ],
    },
  }),
}));

vi.mock('@/lib/endpoints/use-endpoints-data', () => ({
  useEndpointsData: () => ({
    endpoints: [
      { id: 'ep_1', name: 'Endpoint 1' },
      { id: 'ep_2', name: 'Endpoint 2' },
    ],
    endpointsLoading: false,
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
    expect(screen.getByTestId('usage__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__open-audit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__report-schedules')).not.toBeInTheDocument();
    expect(screen.getByTestId('usage__endpoint-tabs')).toBeInTheDocument();
    expect(screen.getAllByTestId('usage__endpoint-dimensions').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('usage__progress-card').length).toBeGreaterThan(0);
    expect(screen.getAllByText('view.rate_limit_title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('view.spending_limit_title').length).toBeGreaterThan(0);
    expect(screen.queryByText('view.project_max')).not.toBeInTheDocument();
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

  it('keeps usage view when current user id is set', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-facts__table')).not.toBeInTheDocument();
  });

  it('keeps usage view when default end user id is set', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" defaultEndUserId="user_002" />);

    expect(screen.getByTestId('usage__view')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__filters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__view-mode')).not.toBeInTheDocument();
  });

  it('switches period between 48h and 24h', async () => {
    const user = userEvent.setup();
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__period-24'));
    expect(screen.getByTestId('usage__period-24')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('usage__period-48')).toHaveAttribute('data-active', 'false');
  });

  it('shows selected endpoint dimensions without project aggregate', () => {
    render(
      <UsageView
        records={[]}
        periodHours={48}
        endpointOptions={[
          { id: 'ep_1', name: 'Endpoint 1' },
          { id: 'ep_2', name: 'Endpoint 2' },
        ]}
        selectedEndpointId="ep_2"
        limitsOverview={{
          endpoints: [
            {
              endpointId: 'ep_1',
              endpointName: 'Endpoint 1',
              limits: [],
            },
            {
              endpointId: 'ep_2',
              endpointName: 'Endpoint 2',
              limits: [
                {
                  kind: 'rate_limit',
                  window: 'day',
                  metric: 'requests',
                  policyKey: 'endpoint.requests_per_day',
                  used: 10,
                  max: 20,
                  remaining: 10,
                  usagePct: 50,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByTestId('usage__endpoint-dimensions').length).toBeGreaterThan(0);
    expect(screen.getByTestId('usage__resource-tab-ep_2')).toBeInTheDocument();
    expect(screen.getAllByTestId('usage__progress-card').length).toBe(1);
    expect(screen.getAllByText('Endpoint 2').length).toBeGreaterThan(0);
    expect(screen.queryByText('ep_2')).not.toBeInTheDocument();
    expect(screen.getByText(/view\.limit_reset_at:/)).toBeInTheDocument();
    expect(screen.getByText('view.status_badge:{"value":50}')).toBeInTheDocument();
    expect(screen.queryByText('view.project_max')).not.toBeInTheDocument();
  });

});
