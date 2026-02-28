import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeObservabilityConsole } from '../RuntimeObservabilityConsole';

const useUsageFactsMock = vi.fn(() => ({
  data: {
    items: [
      {
        id: 'fact_1',
        timestamp: '2026-02-28T14:01:00.000Z',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        resource_type: 'endpoint',
        resource_id: 'endpoint_runtime',
        request_id: 'req_1',
        requests: 1,
        tokens_total: 128,
        result: 'ok',
        runtime: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          estimated_cost: 0.0031,
          fallback_hops: 1,
          pricing_version: 'global-v1',
          attempts: [],
        },
        metadata_json: {},
      },
    ],
  },
  isLoading: false,
  isFetching: false,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useRuntimeObservability: () => ({
    data: {
      total_requests: 120,
      total_errors: 7,
      error_rate: 0.0583,
      fallback_hops_histogram: { '0': 100, '1': 18, '2': 2 },
      error_class_counts: {
        provider_retryable: 5,
        provider_non_retryable: 1,
        system_error: 1,
      },
      avg_estimated_cost: 0.0021,
      p95_estimated_cost: 0.0068,
      health_summary: {
        recovered_requests: 20,
        terminal_error_requests: 7,
        missing_price_facts: 1,
        provider_count: 3,
        model_count: 4,
      },
      request_trend: [
        {
          time_bucket: '2026-02-28 14:00',
          requests: 20,
          errors: 2,
          recovered_requests: 6,
          avg_estimated_cost: 0.0031,
          duration_p95_ms: 1900,
        },
      ],
      latency_distribution_ms: {
        p50: 820,
        p95: 1900,
        p99: 2500,
      },
      cost_distribution_usd: {
        p50: 0.0024,
        p95: 0.0068,
        p99: 0.0072,
      },
      degradation_signals: [
        {
          id: 'missing-price',
          severity: 'medium',
          kind: 'missing_price',
          title: 'Missing price coverage',
          message: '1 runtime fact is missing price attribution',
        },
      ],
      provider_breakdown: [
        {
          provider: 'secondaryok',
          requests: 80,
          errors: 2,
          error_rate: 0.025,
          fallback_rate: 0.2,
          avg_estimated_cost: 0.0031,
          p95_estimated_cost: 0.0068,
          missing_price_facts: 0,
        },
      ],
      model_breakdown: [
        {
          provider: 'secondaryok',
          model: 'model-b',
          requests: 48,
          errors: 1,
          error_rate: 0.0208,
          fallback_rate: 0.25,
          avg_estimated_cost: 0.0038,
          p95_estimated_cost: 0.0071,
          missing_price_facts: 0,
        },
      ],
      time_range: {
        start: '2026-02-27T00:00:00.000Z',
        end: '2026-02-28T00:00:00.000Z',
      },
    },
    isFetching: false,
    refetch: vi.fn(),
  }),
  useUsageFacts: (...args: unknown[]) => useUsageFactsMock(...args),
}));

describe('RuntimeObservabilityConsole', () => {
  it('renders KPI and breakdown sections', () => {
    render(
      <RuntimeObservabilityConsole
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />,
    );

    expect(screen.getByTestId('runtime-observability__kpi-total-requests')).toHaveTextContent('120');
    expect(screen.getByTestId('runtime-observability__health-missing-price')).toHaveTextContent('1');
    expect(screen.getByTestId('runtime-observability__provider-table')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-observability__model-table')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-observability__request-trend')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-observability__distributions')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-observability__signals')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-observability__provider-row-0')).toHaveTextContent('secondaryok');
    expect(screen.getByTestId('runtime-observability__model-row-0')).toHaveTextContent('secondaryok/model-b');
  });

  it('opens request detail drill-down from provider breakdown', () => {
    render(
      <RuntimeObservabilityConsole
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />,
    );

    fireEvent.click(screen.getByTestId('runtime-observability__provider-detail-0'));

    expect(useUsageFactsMock).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      expect.objectContaining({
        provider: 'secondaryok',
        page: 1,
        page_size: 20,
        sort_order: 'desc',
      }),
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByTestId('usage__detail-summary__requests')).toHaveTextContent('1');
    expect(screen.getByTestId('usage__detail-fact-fact_1')).toHaveTextContent('secondaryok');
  });
});
