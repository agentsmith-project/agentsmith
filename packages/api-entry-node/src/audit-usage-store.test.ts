import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { getRuntimeObservability, listUsageFactRecords, recordUsageFact } from './audit-usage-store.js';

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
      metadata_json: { fallback_hops: 0, estimated_cost: 0.001 },
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
      metadata_json: { fallback_hops: 1, estimated_cost: 0.003 },
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
      metadata_json: { fallback_hops: 2, estimated_cost: 0.005 },
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
    expect(rows.items[0]?.runtime?.fallback_hops).toBe(1);
    expect(rows.items[0]?.runtime?.pricing_version).toBe('runtime-pricing-v1');
    expect(rows.items[0]?.runtime?.estimated_cost).toBe(0.0068);
    expect(rows.items[0]?.runtime?.attempts).toHaveLength(2);
  });
});
