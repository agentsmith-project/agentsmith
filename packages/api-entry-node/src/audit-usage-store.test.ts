import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  exportUsageData,
  getRuntimeObservability,
  getUsageOperationsSummary,
  listUsageFactRecords,
  recordUsageFact,
} from './audit-usage-store.js';

describe('audit-usage-store runtime observability', () => {
  it('aggregates fallback hops and error classes from usage facts', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4o', fallback_hops: 0, estimated_cost: 0.001 },
      request_id: 'req_1',
    });
    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4o', fallback_hops: 1, estimated_cost: 0.003 },
      request_id: 'req_2',
    });
    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_400',
      metadata_json: { provider: 'anthropic', resolved_model: 'claude-sonnet-4-5', fallback_hops: 2, estimated_cost: 0.005, missing_price: true },
      request_id: 'req_3',
    });

    const end = new Date();
    const start = new Date(end.getTime() - 60_000);
    const summary = await getRuntimeObservability(store, {
      workspaceId,
      projectId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });

    expect(summary.total_requests).toBe(3);
    expect(summary.total_errors).toBe(2);
    expect(summary.error_rate).toBeCloseTo(0.6667, 4);
    expect(summary.fallback_hops_histogram['0']).toBe(1);
    expect(summary.fallback_hops_histogram['1']).toBe(1);
    expect(summary.fallback_hops_histogram['2']).toBe(1);
    expect(summary.error_class_counts.provider_retryable).toBe(1);
    expect(summary.error_class_counts.provider_non_retryable).toBe(1);
    expect(summary.avg_estimated_cost).toBeGreaterThan(0);
    expect(summary.p95_estimated_cost).toBeGreaterThan(0);
    expect(summary.health_summary.recovered_requests).toBe(2);
    expect(summary.health_summary.missing_price_facts).toBe(1);
    expect(summary.request_trend.length).toBeGreaterThan(0);
    expect(summary.cost_distribution_usd.p95).toBeGreaterThan(0);
    expect(summary.degradation_signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'missing_price' })]),
    );
    expect(summary.provider_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', requests: 2, errors: 1, fallback_rate: 0.5 }),
      expect.objectContaining({ provider: 'anthropic', requests: 1, errors: 1, missing_price_facts: 1 }),
    ]);
    expect(summary.model_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o', requests: 2 }),
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-5', requests: 1 }),
    ]);
  });

  it('lists request-level usage facts with runtime metadata', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      request_id: 'req_1',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        fallback_hops: 1,
        pricing_version: 'runtime-pricing-v1',
        estimated_cost: 0.0068,
        attempt_trace: [
          { index: 0, provider: 'primaryfail', model: 'model-a', outcome: 'fallback_upstream_error' },
          { index: 1, provider: 'secondaryok', model: 'model-b', outcome: 'success' },
        ],
      },
    });

    const rows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      resourceType: 'endpoint',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(rows.total).toBe(1);
    expect(rows.items[0]?.request_id).toBe('req_1');
    expect(rows.items[0]?.runtime?.provider).toBe('secondaryok');
    expect(rows.items[0]?.runtime?.resolved_model).toBe('model-b');
    expect(rows.items[0]?.runtime?.error_class).toBeUndefined();
    expect(rows.items[0]?.runtime?.fallback_hops).toBe(1);
    expect(rows.items[0]?.runtime?.pricing_version).toBe('runtime-pricing-v1');
    expect(rows.items[0]?.runtime?.estimated_cost).toBe(0.0068);
    expect(rows.items[0]?.runtime?.attempts).toHaveLength(2);
  });

  it('filters usage facts by runtime provider, model, and error class', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      request_id: 'req_ok',
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
      },
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_2',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      request_id: 'req_error',
      metadata_json: {
        provider: 'anthropic',
        resolved_model: 'claude-sonnet-4-5',
      },
    });

    const rows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      errorClass: 'provider_retryable',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(rows.total).toBe(1);
    expect(rows.items[0]?.request_id).toBe('req_error');
    expect(rows.items[0]?.runtime?.error_class).toBe('provider_retryable');
  });

  it('builds usage operations summary from filtered runtime facts', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      end_user_id: 'user_a',
      requests: 2,
      result: 'ok',
      request_id: 'req_a',
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
        estimated_cost: 0.01,
      },
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      end_user_id: 'user_b',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      request_id: 'req_b',
      metadata_json: {
        provider: 'anthropic',
        resolved_model: 'claude-sonnet-4-5',
        estimated_cost: 0.02,
      },
    });

    const summary = await getUsageOperationsSummary(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      result: null,
    });

    expect(summary.top_providers[0]).toEqual(expect.objectContaining({ provider: 'anthropic', estimated_cost: 0.02 }));
    expect(summary.top_models).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'openai', model: 'gpt-4o', requests: 2 })]),
    );
    expect(summary.top_end_users).toEqual(
      expect.arrayContaining([expect.objectContaining({ end_user_id: 'user_a', requests: 2 })]),
    );
    expect(summary.recent_requests).toEqual(
      expect.arrayContaining([expect.objectContaining({ request_id: 'req_b', result: 'error', error_class: 'provider_retryable' })]),
    );
  });

  it('exports usage data as csv and json snapshots', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      end_user_id: 'user_export',
      requests: 1,
      result: 'ok',
      request_id: 'req_export',
      duration_ms: 321,
      tokens_in: 100,
      tokens_out: 50,
      tokens_total: 150,
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
        fallback_hops: 0,
        pricing_version: 'runtime-pricing-v1',
        estimated_cost: 0.0042,
      },
    });

    const csv = await exportUsageData(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      format: 'csv',
    });
    expect(csv.filename).toMatch(/\.csv$/);
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.body).toContain('request_id');
    expect(csv.body).toContain('req_export');
    expect(csv.body).toContain('openai');

    const json = await exportUsageData(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      format: 'json',
    });
    expect(json.filename).toMatch(/\.json$/);
    expect(json.contentType).toBe('application/json; charset=utf-8');
    const payload = JSON.parse(json.body) as {
      kpi: { requests_today?: number };
      facts: Array<{ request_id?: string }>;
      runtime_observability: { total_requests: number };
      operations_summary: { top_providers: Array<{ provider: string }> };
    };
    expect(payload.facts).toEqual(expect.arrayContaining([expect.objectContaining({ request_id: 'req_export' })]));
    expect(payload.runtime_observability.total_requests).toBe(1);
    expect(payload.operations_summary.top_providers).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'openai' })]));
  });
});
