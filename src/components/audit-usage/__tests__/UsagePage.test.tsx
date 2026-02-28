import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsagePage } from '../UsagePage';

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

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

const exportReportMock = vi.fn();
const createReportScheduleMock = vi.fn();
const updateReportScheduleMock = vi.fn();
const deleteReportScheduleMock = vi.fn();
const testReportScheduleDeliveryMock = vi.fn();
const runReportScheduleNowMock = vi.fn();
const retryReportScheduleDeliveryMock = vi.fn();
const acknowledgeReportScheduleDeliveryMock = vi.fn();
const runDueReportSchedulesMock = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<object>('@/lib/api');
  return {
    ...actual,
    getApiClient: () => ({ getToken: () => null }),
    UsageAPI: class {
      exportReport = exportReportMock;
      createReportSchedule = createReportScheduleMock;
      updateReportSchedule = updateReportScheduleMock;
      deleteReportSchedule = deleteReportScheduleMock;
      testReportScheduleDelivery = testReportScheduleDeliveryMock;
      runReportScheduleNow = runReportScheduleNowMock;
      retryReportScheduleDelivery = retryReportScheduleDeliveryMock;
      acknowledgeReportScheduleDelivery = acknowledgeReportScheduleDeliveryMock;
      runDueReportSchedules = runDueReportSchedulesMock;
    },
  };
});

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
  useUsageOperationsSummary: () => ({
    data: {
      top_providers: [{ provider: 'secondaryok', requests: 2, errors: 0, estimated_cost: 0.0068 }],
      top_models: [{ provider: 'secondaryok', model: 'model-b', requests: 2, errors: 0, estimated_cost: 0.0068 }],
      top_end_users: [{ end_user_id: 'user_001', requests: 2, errors: 0, estimated_cost: 0.0068 }],
      anomaly_peaks: [],
      recent_requests: [{ id: 'req_1', timestamp: '2026-02-28T15:10:00.000Z', request_id: 'req_1', provider: 'secondaryok', model: 'model-b', end_user_id: 'user_001', result: 'ok', estimated_cost: 0.0068 }],
    },
    isLoading: false,
  }),
  useUsageReportSchedules: () => ({
    data: {
      items: [
        {
          id: 'usage_schedule_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          name: 'Daily Ops',
          cadence: 'daily',
          status: 'active',
          format: 'json',
          time_window: 'last_7d',
          delivery_channel: 'in_app',
          delivery_config: undefined,
          release_evidence_required: true,
          empty_result_policy: 'deliver',
          created_at: '2026-02-28T00:00:00.000Z',
          updated_at: '2026-02-28T00:00:00.000Z',
          next_run_at: '2026-03-01T00:00:00.000Z',
          recent_deliveries: [
            {
              id: 'delivery_1',
              workspace_id: 'ws_1',
              project_id: 'proj_1',
              schedule_id: 'usage_schedule_1',
              trigger: 'manual',
              status: 'success',
              attempt_count: 1,
              report_period_start: '2026-02-27T00:00:00.000Z',
              report_period_end: '2026-02-28T00:00:00.000Z',
              created_at: '2026-02-28T00:00:00.000Z',
              completed_at: '2026-02-28T00:00:00.000Z',
              preview_filename: 'usage-report-proj_1.json',
              content_type: 'application/json; charset=utf-8',
              summary: { requests: 2, errors: 0, top_provider: 'secondaryok', estimated_cost: 0.0068 },
            },
          ],
        },
      ],
    },
    isLoading: false,
  }),
  useUsageReportEvidence: () => ({
    data: {
      source: 'artifact',
      generated_at: '2026-02-28T00:00:00.000Z',
      release_readiness: 'ready',
      blockers: [],
      warnings: [],
      active_schedules: 1,
      required_schedules: 1,
      successful_deliveries_last_7d: 1,
      failed_deliveries_last_7d: 0,
      unacknowledged_required_deliveries: 0,
      runner_health: {
        enabled: true,
        interval_ms: 60000,
        running: false,
        run_count: 3,
        last_status: 'success',
        last_completed_at: '2026-02-28T00:00:00.000Z',
      },
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
    error: vi.fn(),
  },
}));

describe('UsagePage', () => {
  it('opens request detail drawer from usage table row', async () => {
    const user = userEvent.setup();
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage__operations-summary')).toBeInTheDocument();
    expect(screen.getByTestId('usage__export-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('usage__report-schedules')).toBeInTheDocument();
    expect(screen.getByTestId('usage__report-evidence-runner-health')).toBeInTheDocument();
    await user.click(screen.getByTestId('usage__table__row'));

    expect(screen.getByText('detail.title')).toBeInTheDocument();
    expect(screen.getByTestId('usage__detail-summary__cost')).toHaveTextContent('$0.006800');
    expect(screen.getByTestId('usage__detail-fact-usgf_1')).toBeInTheDocument();
    expect(screen.getByTestId('usage__detail-pricing-version-usgf_1')).toHaveTextContent('runtime-pricing-v1');
    expect(screen.getByTestId('usage__detail-timeline-usgf_1')).toBeInTheDocument();
  });

  it('creates a usage report schedule from dialog', async () => {
    const user = userEvent.setup();
    createReportScheduleMock.mockResolvedValue({
      id: 'usage_schedule_2',
    });

    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__report-schedules-create'));
    await user.type(screen.getByTestId('usage__report-schedules-form-name'), 'Weekly Runtime Digest');
    await user.click(screen.getByTestId('usage__report-schedules-form-submit'));

    expect(createReportScheduleMock).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      expect.objectContaining({
        name: 'Weekly Runtime Digest',
        delivery_channel: 'in_app',
        delivery_config: undefined,
        release_evidence_required: true,
        empty_result_policy: 'deliver',
      }),
    );
  });

  it('creates a webhook usage report schedule from dialog', async () => {
    const user = userEvent.setup();
    createReportScheduleMock.mockResolvedValue({
      id: 'usage_schedule_3',
    });

    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__report-schedules-create'));
    await user.type(screen.getByTestId('usage__report-schedules-form-name'), 'Webhook Digest');
    await user.click(screen.getByTestId('usage__report-schedules-form-delivery-channel'));
    await user.keyboard('{ArrowDown}{Enter}');
    await user.type(screen.getByTestId('usage__report-schedules-form-webhook-url'), 'https://example.internal/report-hook');
    await user.click(screen.getByTestId('usage__report-schedules-form-submit'));

    expect(createReportScheduleMock).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      expect.objectContaining({
        name: 'Webhook Digest',
        delivery_channel: 'webhook',
        delivery_config: {
          webhook_url: 'https://example.internal/report-hook',
        },
      }),
    );
  });

  it('runs report schedule actions from the panel', async () => {
    const user = userEvent.setup();
    runReportScheduleNowMock.mockResolvedValue({
      delivery_id: 'delivery_2',
      schedule_id: 'usage_schedule_1',
      delivery_channel: 'in_app',
      generated_at: '2026-02-28T01:00:00.000Z',
      preview_filename: 'usage-report-proj_1.json',
      content_type: 'application/json; charset=utf-8',
      status: 'success',
      summary: { requests: 2, errors: 0, top_provider: 'secondaryok', estimated_cost: 0.0068 },
    });
    acknowledgeReportScheduleDeliveryMock.mockResolvedValue({ id: 'delivery_1' });
    runDueReportSchedulesMock.mockResolvedValue({ processed: 1, deliveries: [] });

    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__report-schedules-run-due'));
    await user.click(screen.getByTestId('usage__report-schedule-run-usage_schedule_1'));
    await user.click(screen.getByTestId('usage__report-delivery-ack-delivery_1'));

    expect(runDueReportSchedulesMock).toHaveBeenCalledWith('ws_1', 'proj_1');
    expect(runReportScheduleNowMock).toHaveBeenCalledWith('ws_1', 'proj_1', 'usage_schedule_1');
    expect(acknowledgeReportScheduleDeliveryMock).toHaveBeenCalledWith('ws_1', 'proj_1', 'usage_schedule_1', 'delivery_1');
    expect(screen.getByTestId('usage__report-evidence')).toBeInTheDocument();
  });
});
