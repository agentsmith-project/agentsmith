import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { usageRecordFixtures, usageKPI } from '../fixtures/usage';
import { buildRuntimeUsageRecords, listRuntimeUsageFacts } from '../state/runtime-usage';

type ResourceType = 'endpoint' | 'source_library' | 'agent';

type UsageLikeRecord = {
  id: string;
  time_bucket: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
};

function resolveResourceMultiplier(resourceType?: string | null) {
  if (resourceType === 'agent') return 0.65;
  if (resourceType === 'source_library') return 0.35;
  return 1;
}

function normalizeBucket(timeBucket: string, groupBy: 'day' | 'hour'): string {
  if (groupBy === 'hour') return timeBucket;
  return /^\d{4}-\d{2}-\d{2}/.test(timeBucket) ? timeBucket.slice(0, 10) : timeBucket;
}

function aggregateUsageRecords(records: UsageLikeRecord[], groupBy: 'day' | 'hour'): UsageLikeRecord[] {
  const grouped = new Map<string, UsageLikeRecord>();

  for (const record of records) {
    const timeBucket = normalizeBucket(record.time_bucket, groupBy);
    const key = [
      timeBucket,
      record.resource_type,
      record.resource_id ?? '',
      record.end_user_id ?? '',
    ].join('|');
    const current = grouped.get(key) ?? {
      ...record,
      id: `usage_agg_${key}`,
      time_bucket: timeBucket,
      requests: 0,
      duration_p95_ms: 0,
      bytes_in: 0,
      bytes_out: 0,
      tokens: 0,
    };

    current.requests += record.requests ?? 0;
    current.duration_p95_ms = Math.max(current.duration_p95_ms ?? 0, record.duration_p95_ms ?? 0);
    current.bytes_in = (current.bytes_in ?? 0) + (record.bytes_in ?? 0);
    current.bytes_out = (current.bytes_out ?? 0) + (record.bytes_out ?? 0);
    current.tokens = (current.tokens ?? 0) + (record.tokens ?? 0);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const bucketDiff = b.time_bucket.localeCompare(a.time_bucket);
    if (bucketDiff !== 0) return bucketDiff;
    return (b.requests ?? 0) - (a.requests ?? 0);
  });
}

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', ({ request }) => {
    const url = new URL(request.url);
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const groupBy = url.searchParams.get('group_by') === 'hour' ? 'hour' : 'day';
    const usageItems = p0.usage as Array<{ resource_type?: string | null }> | undefined;
    const hasStructuredUsage = Array.isArray(usageItems) && usageItems.some((item) => Boolean(item?.resource_type));
    const baseItems = (hasStructuredUsage ? p0.usage : usageRecordFixtures).filter((item) => {
      if (resourceType && item.resource_type !== resourceType) return false;
      if (resourceId && item.resource_id !== resourceId) return false;
      if (endUserId && item.end_user_id !== endUserId) return false;
      return true;
    });
    const runtimeItems = buildRuntimeUsageRecords({
      groupBy,
      filters: {
        startTime: url.searchParams.get('start_time'),
        endTime: url.searchParams.get('end_time'),
        resourceType,
        resourceId,
        endUserId,
      },
    });
    const aggregatedBaseItems = aggregateUsageRecords(baseItems as UsageLikeRecord[], groupBy);
    const items = [...runtimeItems, ...aggregatedBaseItems];
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      page_size: 25,
      has_more: false,
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/facts', ({ request }) => {
    const url = new URL(request.url);
    const startTime = url.searchParams.get('start_time') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endTime = url.searchParams.get('end_time') ?? new Date().toISOString();
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const fixtureItems = [
      {
        id: 'usgf_001',
        timestamp: endTime,
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        resource_type: 'endpoint',
        resource_id: 'endpoint_001',
        end_user_id: 'user_001',
        request_id: 'req_runtime_001',
        requests: 1,
        duration_ms: 1840,
        bytes_in: 2048,
        bytes_out: 8192,
        tokens_in: 540,
        tokens_out: 210,
        tokens_total: 750,
        result: 'ok',
        runtime: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          fallback_hops: 1,
          pricing_version: 'runtime-pricing-v1',
          estimated_cost: 0.0068,
          missing_price: false,
          attempts: [
            {
              index: 0,
              provider: 'primaryfail',
              model: 'model-a',
              outcome: 'fallback_upstream_error',
              statusCode: 429,
              errorClass: 'provider_retryable',
              reason: 'runtime_upstream_error_recovered',
              durationMs: 821,
            },
            {
              index: 1,
              provider: 'secondaryok',
              model: 'model-b',
              outcome: 'success',
              reason: 'runtime_upstream_ok',
              durationMs: 1019,
            },
          ],
        },
        metadata_json: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          fallback_hops: 1,
          pricing_version: 'runtime-pricing-v1',
          estimated_cost: 0.0068,
        },
      },
      {
        id: 'usgf_002',
        timestamp: startTime,
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        resource_type: 'endpoint',
        resource_id: 'endpoint_001',
        end_user_id: 'user_001',
        request_id: 'req_runtime_002',
        requests: 1,
        duration_ms: 932,
        bytes_in: 1536,
        bytes_out: 4096,
        tokens_in: 320,
        tokens_out: 120,
        tokens_total: 440,
        result: 'error',
        error_code: 'UPSTREAM_429',
        runtime: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          fallback_hops: 0,
          pricing_version: null,
          estimated_cost: null,
          missing_price: true,
          attempts: [
            {
              index: 0,
              provider: 'primaryfail',
              model: 'model-a',
              outcome: 'terminal_upstream_error',
              statusCode: 429,
              errorClass: 'provider_retryable',
              reason: 'runtime_upstream_error',
              durationMs: 932,
            },
          ],
        },
        metadata_json: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          fallback_hops: 0,
          missing_price: true,
        },
      },
    ].filter((item) => {
      if (resourceType && item.resource_type !== resourceType) return false;
      if (resourceId && item.resource_id !== resourceId) return false;
      if (endUserId && item.end_user_id !== endUserId) return false;
      return true;
    });
    const runtimeItems = listRuntimeUsageFacts({
      startTime,
      endTime,
      resourceType,
      resourceId,
      endUserId,
    });
    const items = [...runtimeItems, ...fixtureItems];
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      page_size: 20,
      has_more: false,
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/kpi', () => HttpResponse.json(usageKPI)),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/timeseries', ({ request }) => {
    const url = new URL(request.url);
    const resourceType = url.searchParams.get('resource_type');
    const multiplier = resolveResourceMultiplier(resourceType);
    const trend = (p0.dashboard_trend as Array<{ timestamp: string; value: number }>)
      .map((item) => {
        const requests = Math.round(item.value * multiplier);
        return {
          time_bucket: item.timestamp,
          requests,
          errors: Math.max(0, Math.round(requests * 0.01)),
          tokens: requests * 120,
          estimated_cost: Number((requests * 0.0008).toFixed(4)),
        };
      });
    const resourceBreakdown = (p0.top_resources as Array<{
      resource_id: string;
      resource_name: string;
      resource_type: ResourceType;
      requests: number;
      tokens?: number;
      cost_usd?: number;
    }>)
      .filter((item) => !resourceType || item.resource_type === resourceType)
      .map((item) => ({
        resource_id: item.resource_id,
        resource_name: item.resource_name,
        resource_type: item.resource_type,
        requests: item.requests,
        tokens: item.tokens,
        estimated_cost: item.cost_usd ?? 0,
        percentage_of_total: 0,
      }));
    const totalCost = resourceBreakdown.reduce((sum, item) => sum + item.estimated_cost, 0);
    const normalizedResourceBreakdown = totalCost > 0
      ? resourceBreakdown.map((item) => ({
        ...item,
        percentage_of_total: Number(((item.estimated_cost / totalCost) * 100).toFixed(2)),
      }))
      : resourceBreakdown;

    return HttpResponse.json({
      data_points: trend,
      resource_breakdown: normalizedResourceBreakdown,
      time_range: {
        start: trend[0]?.time_bucket ?? new Date().toISOString(),
        end: trend[trend.length - 1]?.time_bucket ?? new Date().toISOString(),
        granularity: url.searchParams.get('granularity') ?? 'day',
      },
      total_cost: Number(totalCost.toFixed(2)),
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/runtime-observability', ({ request }) => {
    const url = new URL(request.url);
    const start = url.searchParams.get('start_time') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = url.searchParams.get('end_time') ?? new Date().toISOString();
    return HttpResponse.json({
      total_requests: 120,
      total_errors: 7,
      error_rate: 0.0583,
      fallback_hops_histogram: {
        '0': 100,
        '1': 18,
        '2': 2,
      },
      error_class_counts: {
        provider_retryable: 5,
        provider_non_retryable: 1,
        system_error: 1,
      },
      avg_estimated_cost: 0.0021,
      p95_estimated_cost: 0.0068,
      time_range: {
        start,
        end,
      },
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/quota/summary', () => {
    const resources = p0.top_resources as Array<{
      resource_id: string;
      resource_name: string;
      resource_type: ResourceType;
      requests: number;
    }>;
    const now = new Date();
    const resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const endpoints = resources
      .filter((item) => item.resource_type === 'endpoint')
      .map((item) => ({
        resource_id: item.resource_id,
        resource_name: item.resource_name,
        resource_type: item.resource_type,
        quota_used: item.requests,
        quota_limit: 20000,
        quota_unit: 'requests',
        quota_reset_at: resetAt,
        percentage_used: Number(((item.requests / 20000) * 100).toFixed(2)),
      }));
    const agents = resources
      .filter((item) => item.resource_type === 'agent')
      .map((item) => ({
        resource_id: item.resource_id,
        resource_name: item.resource_name,
        resource_type: item.resource_type,
        quota_used: item.requests,
        quota_limit: 12000,
        quota_unit: 'requests',
        quota_reset_at: resetAt,
        percentage_used: Number(((item.requests / 12000) * 100).toFixed(2)),
      }));
    const sourceLibraries = resources
      .filter((item) => item.resource_type === 'source_library')
      .map((item) => ({
        resource_id: item.resource_id,
        resource_name: item.resource_name,
        resource_type: item.resource_type,
        quota_used: item.requests,
        quota_limit: 10000,
        quota_unit: 'requests',
        quota_reset_at: resetAt,
        percentage_used: Number(((item.requests / 10000) * 100).toFixed(2)),
      }));

    const totalQuotaUsed =
      [...endpoints, ...agents, ...sourceLibraries].reduce((sum, item) => sum + item.quota_used, 0);
    const totalQuotaLimit =
      endpoints.length * 20000 + agents.length * 12000 + sourceLibraries.length * 10000;

    return HttpResponse.json({
      endpoints,
      agents,
      source_libraries: sourceLibraries,
      total_quota_used: totalQuotaUsed,
      total_quota_limit: totalQuotaLimit,
    });
  }),
];
