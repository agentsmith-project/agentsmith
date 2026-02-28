import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeObservabilityConsole } from '../RuntimeObservabilityConsole';

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
    expect(screen.getByTestId('runtime-observability__provider-row-0')).toHaveTextContent('secondaryok');
    expect(screen.getByTestId('runtime-observability__model-row-0')).toHaveTextContent('secondaryok/model-b');
  });
});
