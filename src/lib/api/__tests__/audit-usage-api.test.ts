import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditAPI, UsageAPI } from '@/lib/api/endpoints/audit-usage';

describe('UsageAPI', () => {
  const client = {
    getToken: () => 'token_123',
  } as unknown as ConstructorParameters<typeof UsageAPI>[0];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes limits summary to limit semantics', async () => {
    const getMock = vi.fn().mockResolvedValue({
      endpoints: [
        {
          endpoint_id: 'ep_1',
          endpoint_name: 'Endpoint 1',
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
          ],
        },
      ],
      project_summary: {
        project_used: 40,
        project_max: 100,
        project_remaining: 60,
        project_usage_pct: 40,
      },
    });

    const api = new UsageAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);

    const result = await api.getLimitsSummary('ws_1', 'proj_1');
    const firstEndpoint = result.endpoints?.[0];
    const firstRule = firstEndpoint?.limits?.[0];

    expect(firstEndpoint?.endpoint_id).toBe('ep_1');
    expect(firstRule?.used).toBe(40);
    expect(firstRule?.max).toBe(100);
    expect(firstRule?.remaining).toBe(60);
    expect(firstRule?.kind).toBe('rate_limit');
    expect(firstRule?.window).toBe('minute');
    expect(firstRule?.policy_key).toBe('endpoint.requests_per_minute');
    expect(result.project_summary?.project_used).toBe(40);
    expect(result.project_summary?.project_max).toBe(100);
  });

  it('normalizes endpoint limits when project summary is absent', async () => {
    const getMock = vi.fn().mockResolvedValue({
      endpoints: [
        {
          endpointName: 'Endpoint 2',
          endpointId: 'ep_2',
          snapshots: [
            {
              type: 'cost',
              period: '5hours',
              unit: 'money',
              key: 'endpoint.spending_usd_per_5_hours',
              currentUsed: '12.5',
              limit: '20',
              remainingUsage: '7.5',
              usagePct: '62.5',
              windowResetAt: '2026-03-08T05:00:00.000Z',
            },
          ],
        },
      ],
    });

    const api = new UsageAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);

    const result = await api.getLimitsSummary('ws_1', 'proj_1');
    const firstEndpoint = result.endpoints?.[0];
    const firstRule = firstEndpoint?.limits?.[0];

    expect(firstEndpoint?.endpoint_id).toBe('ep_2');
    expect(firstEndpoint?.endpoint_name).toBe('Endpoint 2');
    expect(firstRule?.kind).toBe('spending_limit');
    expect(firstRule?.window).toBe('5h');
    expect(firstRule?.metric).toBe('usd');
    expect(firstRule?.used).toBe(12.5);
    expect(firstRule?.max).toBe(20);
    expect(firstRule?.remaining).toBe(7.5);
    expect(firstRule?.usage_pct).toBe(62.5);
    expect(result.project_summary).toBeUndefined();
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
          action: 'governance_blocked',
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

  it('preserves unknown actor and resource types from wire response', async () => {
    const getMock = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'audit_2',
          timestamp: '2026-03-02T00:00:00.000Z',
          actor_type: 'service_account',
          actor_id: 'svc_1',
          action: 'request_delivery_failed',
          resource_type: 'governance_incident',
          resource_id: 'incident_2',
          result: 'error',
          error_code: 'UPSTREAM_429',
          request_id: 'req_2',
          metadata_json: {},
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

    const first = result.items[0];
    expect(first?.actor_type).toBe('service_account');
    expect(first?.resource_type).toBe('governance_incident');
    expect(first?.error_code).toBe('UPSTREAM_429');
  });
});
