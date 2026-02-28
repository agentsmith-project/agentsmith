import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageAPI } from '@/lib/api/endpoints/audit-usage';

describe('UsageAPI exportReport', () => {
  const client = {
    getToken: () => 'token_123',
  } as unknown as ConstructorParameters<typeof UsageAPI>[0];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads usage export and extracts filename', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('timestamp,request_id\n2026-02-28T00:00:00.000Z,req_1', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="usage-report-proj_1.csv"',
        },
      }),
    );

    const api = new UsageAPI(client);
    const result = await api.exportReport('ws_1', 'proj_1', {
      start_time: '2026-02-27T00:00:00.000Z',
      end_time: '2026-02-28T00:00:00.000Z',
      format: 'csv',
      provider: 'openai',
      result: 'ok',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/workspaces/ws_1/projects/proj_1/usage/export?');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('format=csv');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('provider=openai');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('result=ok');
    expect(result.filename).toBe('usage-report-proj_1.csv');
    expect(result.contentType).toContain('text/csv');
    expect(result.blob).toBeDefined();
  });

  it('creates usage report schedule via project route', async () => {
    const postMock = vi.fn().mockResolvedValue({
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
        created_at: '2026-02-28T00:00:00.000Z',
        updated_at: '2026-02-28T00:00:00.000Z',
        next_run_at: '2026-03-01T00:00:00.000Z',
      });

    const api = new UsageAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);
    const result = await api.createReportSchedule('ws_1', 'proj_1', {
      name: 'Daily Ops',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      delivery_config: undefined,
      release_evidence_required: true,
      empty_result_policy: 'deliver',
      filters: { provider: 'openai' },
    });

    expect(postMock).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/usage/report-schedules',
      expect.objectContaining({ name: 'Daily Ops', delivery_config: undefined }),
    );
    expect(result.name).toBe('Daily Ops');
  });

  it('creates webhook usage report schedule via project route', async () => {
    const postMock = vi.fn().mockResolvedValue({
      id: 'usage_schedule_2',
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      name: 'Webhook Ops',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'webhook',
      delivery_config: {
        webhook_url: 'https://example.internal/report-hook',
        credential_ref: 'cred_webhook',
        secret_header_name: 'x-webhook-secret',
        timeout_seconds: 15,
      },
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
      next_run_at: '2026-03-01T00:00:00.000Z',
    });

    const api = new UsageAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);

    const result = await api.createReportSchedule('ws_1', 'proj_1', {
      name: 'Webhook Ops',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'webhook',
      delivery_config: {
        webhook_url: 'https://example.internal/report-hook',
        credential_ref: 'cred_webhook',
        secret_header_name: 'x-webhook-secret',
        timeout_seconds: 15,
      },
      release_evidence_required: true,
      empty_result_policy: 'deliver',
    });

    expect(postMock).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/usage/report-schedules',
      expect.objectContaining({
        name: 'Webhook Ops',
        delivery_channel: 'webhook',
        delivery_config: {
          webhook_url: 'https://example.internal/report-hook',
          credential_ref: 'cred_webhook',
          secret_header_name: 'x-webhook-secret',
          timeout_seconds: 15,
        },
      }),
    );
    expect(result.delivery_channel).toBe('webhook');
  });

  it('calls usage report lifecycle endpoints', async () => {
    const getMock = vi.fn().mockResolvedValue({
      source: 'artifact',
      release_readiness: 'ready',
      blockers: [],
      warnings: [],
    });
    const postMock = vi.fn()
      .mockResolvedValueOnce({
        delivery_id: 'delivery_1',
        schedule_id: 'usage_schedule_1',
        delivery_channel: 'in_app',
        generated_at: '2026-02-28T00:00:00.000Z',
        preview_filename: 'usage-report.json',
        content_type: 'application/json; charset=utf-8',
        status: 'success',
        summary: { requests: 1, errors: 0 },
      })
      .mockResolvedValueOnce({
        delivery_id: 'delivery_2',
        schedule_id: 'usage_schedule_1',
        delivery_channel: 'in_app',
        generated_at: '2026-02-28T00:00:00.000Z',
        preview_filename: 'usage-report.json',
        content_type: 'application/json; charset=utf-8',
        status: 'success',
        summary: { requests: 1, errors: 0 },
      })
      .mockResolvedValueOnce({
        id: 'delivery_1',
        schedule_id: 'usage_schedule_1',
        acknowledged_by: 'user_1',
      })
      .mockResolvedValueOnce({
        processed: 1,
        deliveries: [],
      });

    const api = new UsageAPI({
      ...client,
      get: getMock,
      post: postMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);

    await api.runReportScheduleNow('ws_1', 'proj_1', 'usage_schedule_1');
    await api.retryReportScheduleDelivery('ws_1', 'proj_1', 'usage_schedule_1', 'delivery_1');
    await api.acknowledgeReportScheduleDelivery('ws_1', 'proj_1', 'usage_schedule_1', 'delivery_1');
    await api.runDueReportSchedules('ws_1', 'proj_1');
    await api.getReportEvidence('ws_1', 'proj_1');

    expect(postMock).toHaveBeenNthCalledWith(1, '/workspaces/ws_1/projects/proj_1/usage/report-schedules/usage_schedule_1/run-now');
    expect(postMock).toHaveBeenNthCalledWith(2, '/workspaces/ws_1/projects/proj_1/usage/report-schedules/usage_schedule_1/deliveries/delivery_1/retry');
    expect(postMock).toHaveBeenNthCalledWith(3, '/workspaces/ws_1/projects/proj_1/usage/report-schedules/usage_schedule_1/deliveries/delivery_1/acknowledge');
    expect(postMock).toHaveBeenNthCalledWith(4, '/workspaces/ws_1/projects/proj_1/usage/report-schedules/run-due');
    expect(getMock).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/usage/report-evidence');
  });
});
