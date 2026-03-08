import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditAPI, UsageAPI } from '@/lib/api/endpoints/audit-usage';

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
        signature_header_name: 'x-agentsmith-signature',
        timeout_seconds: 15,
        retry_attempts: 2,
        retry_backoff_ms: 250,
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
        signature_header_name: 'x-agentsmith-signature',
        timeout_seconds: 15,
        retry_attempts: 2,
        retry_backoff_ms: 250,
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
          signature_header_name: 'x-agentsmith-signature',
          timeout_seconds: 15,
          retry_attempts: 2,
          retry_backoff_ms: 250,
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

  it('normalizes limits summary to limit semantics', async () => {
    const getMock = vi.fn().mockResolvedValue({
      endpoints: [
        {
          resource_id: 'ep_1',
          resource_name: 'Endpoint 1',
          resource_type: 'endpoint',
          limit_used: 40,
          limit_total: 100,
          limit_limit: 100,
          limit_unit: 'requests',
          limit_kind: 'rate_limit',
          window_key: 'minute',
          limit_key: 'endpoint.requests_per_minute',
          limit_reset_at: '2026-03-08T00:00:00.000Z',
          percentage_used: 40,
        },
      ],
      total_limit_used: 40,
      total_limit: 100,
      total_limit_limit: 100,
    });

    const api = new UsageAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);

    const result = await api.getLimitsSummary('ws_1', 'proj_1');
    const firstEndpoint = result.endpoints?.[0];

    expect(firstEndpoint?.limit_used).toBe(40);
    expect(firstEndpoint?.limit_total).toBe(100);
    expect(firstEndpoint?.limit_limit).toBe(100);
    expect(firstEndpoint?.limit_kind).toBe('rate_limit');
    expect(firstEndpoint?.window_key).toBe('minute');
    expect(firstEndpoint?.limit_key).toBe('endpoint.requests_per_minute');
    expect(result.total_limit_used).toBe(40);
    expect(result.total_limit).toBe(100);
    expect(result.total_limit_limit).toBe(100);
  });
});

describe('AuditAPI list normalization', () => {
  it('normalizes trace references and metadata payload from wire response', async () => {
    const getMock = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'audit_1',
          timestamp: '2026-03-02T00:00:00.000Z',
          actor_type: 'user',
          actor_id: 'user_1',
          action: 'release_gate_blocked',
          result: 'error',
          request_id: 'req_1',
          metadata_json: {
            incident_id: 'incident_1',
            escalation_id: 'esc_1',
            run_id: 'run_1',
          },
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_more: false,
    });
    const api = new AuditAPI({
      get: getMock,
    } as unknown as ConstructorParameters<typeof AuditAPI>[0]);

    const result = await api.list('ws_1', 'proj_1', {
      start_time: '2026-03-01T00:00:00.000Z',
      end_time: '2026-03-02T00:00:00.000Z',
    });

    expect(getMock).toHaveBeenCalledOnce();
    const first = result.items[0];
    expect(first?.workspace_id).toBe('ws_1');
    expect(first?.project_id).toBe('proj_1');
    expect(first?.trace_incident_id).toBe('incident_1');
    expect(first?.trace_escalation_id).toBe('esc_1');
    expect(first?.trace_run_id).toBe('run_1');
    expect(first?.trace_ref).toBe('esc_1');
  });
});
