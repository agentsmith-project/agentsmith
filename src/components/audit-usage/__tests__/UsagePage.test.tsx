import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    useQueryClient: () => ({
      invalidateQueries,
    }),
  };
});

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: () => true,
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
          resource_id: 'endpoint_runtime_primary',
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
  useUsageFacts: () => ({
    data: {
      items: [
        {
          id: 'usgf_1',
          timestamp: '2026-02-28T15:10:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          resource_type: 'endpoint',
          resource_id: 'endpoint_runtime_primary',
          request_id: 'req_1',
          requests: 1,
          result: 'ok',
          runtime: {
            provider: 'secondaryok',
            resolved_model: 'model-b',
            fallback_hops: 1,
            pricing_version: 'runtime-pricing-v1',
            estimated_cost: 0.0068,
            attempts: [
              { index: 0, provider: 'primaryfail', model: 'model-a', outcome: 'fallback_upstream_error' },
              { index: 1, provider: 'secondaryok', model: 'model-b', outcome: 'success' },
            ],
          },
          metadata_json: {
            provider: 'secondaryok',
          },
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/components/dashboard', () => ({
  CostDashboardPage: () => <div data-testid="usage-dashboard" />,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('UsagePage', () => {
  it('opens request detail drawer from usage table row', async () => {
    const user = userEvent.setup();
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__table__row'));

    expect(screen.getByText('detail.title')).toBeInTheDocument();
    expect(screen.getByTestId('usage__detail-summary__cost')).toHaveTextContent('$0.006800');
    expect(screen.getByTestId('usage__detail-fact-usgf_1')).toBeInTheDocument();
    expect(screen.getByTestId('usage__detail-pricing-version-usgf_1')).toHaveTextContent('runtime-pricing-v1');
    expect(screen.getByTestId('usage__detail-timeline-usgf_1')).toBeInTheDocument();
  });
});
