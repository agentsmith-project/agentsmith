import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePage } from '../UsagePage';
import { UsageView } from '../UsageView';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';

const invalidateQueries = vi.fn();
const useUsageTimeseriesMock = vi.fn();
const useLimitsSummaryMock = vi.fn();

declare global {
  interface Window {
    __MBOS_TEST_NOW__?: string;
  }
}

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
  useUsagePageCapabilities: () => ({ canRead: true }),
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useUsageTimeseries: (...args: unknown[]) => useUsageTimeseriesMock(...args),
  useLimitsSummary: (...args: unknown[]) => useLimitsSummaryMock(...args),
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

function buildExpectedTrendStart(endIso: string): string {
  const start = new Date(endIso);
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

describe('UsagePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T15:30:00.000Z'));
    delete window.__MBOS_TEST_NOW__;
    invalidateQueries.mockClear();
    useUsageTimeseriesMock.mockReturnValue({
      data: {
        data_points: [
          { time_bucket: '2026-03-01', requests: 2, errors: 0 },
          { time_bucket: '2026-03-02', requests: 4, errors: 0 },
        ],
      },
      isLoading: false,
      error: null,
    });
    useLimitsSummaryMock.mockReturnValue({
      data: {
        endpoints: [
          {
            endpoint_id: 'ep_1',
            endpoint_name: 'Endpoint 1',
            limits: [
              {
                kind: 'rate_limit',
                window: '5h',
                metric: 'requests',
                policy_key: 'endpoint.requests_per_5_hours',
                used: 140,
                max: 500,
                remaining: 360,
                usage_pct: 28,
                reset_at: '2026-03-08T00:00:00.000Z',
              },
              {
                kind: 'rate_limit',
                window: 'day',
                metric: 'requests',
                policy_key: 'endpoint.requests_per_day',
                used: 420,
                max: 2000,
                remaining: 1580,
                usage_pct: 21,
                reset_at: '2026-03-08T00:00:00.000Z',
              },
              {
                kind: 'spending_limit',
                window: '5h',
                metric: 'usd',
                policy_key: 'endpoint.spending_usd_per_5_hours',
                used: 12.5,
                max: 100,
                remaining: 87.5,
                usage_pct: 12.5,
                reset_at: '2026-03-08T00:00:00.000Z',
              },
              {
                kind: 'spending_limit',
                window: 'day',
                metric: 'usd',
                policy_key: 'endpoint.spending_usd_per_day',
                used: 34,
                max: 400,
                remaining: 366,
                usage_pct: 8.5,
                reset_at: '2026-03-08T00:00:00.000Z',
              },
            ],
          },
          {
            endpoint_id: 'ep_2',
            endpoint_name: 'Endpoint 2',
            limits: [],
          },
        ],
      },
    });
  });

  afterEach(() => {
    delete window.__MBOS_TEST_NOW__;
    vi.useRealTimers();
  });

  it('requests rolling 30 day timeseries for the current end user', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(useUsageTimeseriesMock).toHaveBeenCalled();
    const [, , params] = useUsageTimeseriesMock.mock.calls.at(-1) as [string, string, {
      start_time: string;
      end_time: string;
      granularity: string;
      metric: string;
      end_user_id: string;
    }];
    expect(params.granularity).toBe('day');
    expect(params.metric).toBe('requests');
    expect(params.end_user_id).toBe('user_001');
  });

  it('uses the real current clock by default', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    const [, , params] = useUsageTimeseriesMock.mock.calls.at(-1) as [string, string, {
      start_time: string;
      end_time: string;
    }];
    expect(params.end_time).toBe('2026-05-01T15:30:00.000Z');
    expect(params.start_time).toBe(buildExpectedTrendStart('2026-05-01T15:30:00.000Z'));
  });

  it('uses the injected test clock when provided', () => {
    window.__MBOS_TEST_NOW__ = VISUAL_TEST_REFERENCE_NOW_ISO;

    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    const [, , params] = useUsageTimeseriesMock.mock.calls.at(-1) as [string, string, {
      start_time: string;
      end_time: string;
    }];
    expect(params.end_time).toBe(VISUAL_TEST_REFERENCE_NOW_ISO);
    expect(params.start_time).toBe(buildExpectedTrendStart(VISUAL_TEST_REFERENCE_NOW_ISO));
  });

  it('enables 15 second auto refresh for limits summary', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    const [, , , options] = useLimitsSummaryMock.mock.calls.at(-1) as [
      string,
      string,
      { end_user_id?: string },
      { refetchInterval: number },
    ];
    expect(options.refetchInterval).toBe(15000);
  });

  it('renders compact 30 day usage view', () => {
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage__summary-line')).toHaveTextContent('scope_my_usage');
    expect(screen.getByTestId('usage__summary-line')).toHaveTextContent('view.last_30_days');
    expect(screen.getByTestId('usage__summary-line').className).not.toMatch(/rounded-md|border|bg-surface-low/);
    expect(screen.getByTestId('usage__work-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__progress-card')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('usage__limit-row')).toHaveLength(4);
    expect(screen.getByText('view.cards.requests_5h')).toBeInTheDocument();
    expect(screen.getByText('view.cards.spending_day')).toBeInTheDocument();
    expect(screen.queryByText('view.card_remaining')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__endpoint-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__limits-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('usage__trend').className).not.toMatch(/rounded-md|border|bg-background/);
  });

  it('fills the trend chart to 30 daily bars', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    render(
      <UsageView
        trendPoints={[
          { time_bucket: yesterday.toISOString(), requests: 2, errors: 0 },
          { time_bucket: today.toISOString(), requests: 4, errors: 0 },
        ]}
        endpointOptions={[{ id: 'ep_1', name: 'Endpoint 1' }]}
        selectedEndpointId="ep_1"
        limitsOverview={{
          endpoints: [
            {
              endpointId: 'ep_1',
              endpointName: 'Endpoint 1',
              limits: [
                {
                  kind: 'rate_limit',
                  window: '5h',
                  metric: 'requests',
                  policyKey: 'endpoint.requests_per_5_hours',
                  used: 2,
                  max: 10,
                  remaining: 8,
                  usagePct: 20,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
                {
                  kind: 'rate_limit',
                  window: 'day',
                  metric: 'requests',
                  policyKey: 'endpoint.requests_per_day',
                  used: 4,
                  max: 20,
                  remaining: 16,
                  usagePct: 20,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
                {
                  kind: 'spending_limit',
                  window: '5h',
                  metric: 'usd',
                  policyKey: 'endpoint.spending_usd_per_5_hours',
                  used: 1,
                  max: 20,
                  remaining: 19,
                  usagePct: 5,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
                {
                  kind: 'spending_limit',
                  window: 'day',
                  metric: 'usd',
                  policyKey: 'endpoint.spending_usd_per_day',
                  used: 2,
                  max: 40,
                  remaining: 38,
                  usagePct: 5,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByTestId('usage__trend-bar')).toHaveLength(30);
  });

  it('shows not configured state when spending cards are missing', () => {
    render(
      <UsageView
        trendPoints={[]}
        endpointOptions={[{ id: 'ep_1', name: 'Endpoint 1' }]}
        selectedEndpointId="ep_1"
        limitsOverview={{
          endpoints: [
            {
              endpointId: 'ep_1',
              endpointName: 'Endpoint 1',
              limits: [
                {
                  kind: 'rate_limit',
                  window: '5h',
                  metric: 'requests',
                  policyKey: 'endpoint.requests_per_5_hours',
                  used: 2,
                  max: 10,
                  remaining: 8,
                  usagePct: 20,
                  resetAt: '2026-03-08T00:00:00.000Z',
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByText('view.limit_not_configured').length).toBeGreaterThan(0);
  });
});
