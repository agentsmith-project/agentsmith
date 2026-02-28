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

type RuntimeFactLike = {
  requests?: number;
  result: 'ok' | 'error';
  error_code?: string;
  runtime?: {
    provider?: string;
    resolved_model?: string;
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    fallback_hops?: number;
    estimated_cost?: number | null;
    missing_price?: boolean;
  };
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

function classifyRuntimeErrorClass(errorCode?: string): 'provider_retryable' | 'provider_non_retryable' | 'system_error' {
  if (!errorCode?.startsWith('UPSTREAM_')) return 'system_error';
  const status = Number.parseInt(errorCode.replace('UPSTREAM_', ''), 10);
  if (!Number.isFinite(status)) return 'system_error';
  if (status === 429 || status >= 500) return 'provider_retryable';
  if (status >= 400) return 'provider_non_retryable';
  return 'system_error';
}

function toRuntimeFact(item: Record<string, unknown>): RuntimeFactLike {
  const runtime = typeof item.runtime === 'object' && item.runtime
    ? item.runtime as RuntimeFactLike['runtime']
    : undefined;
  return {
    requests: typeof item.requests === 'number' ? item.requests : 1,
    result: item.result === 'error' ? 'error' : 'ok',
    error_code: typeof item.error_code === 'string' ? item.error_code : undefined,
    runtime: {
      provider: runtime?.provider,
      resolved_model: runtime?.resolved_model,
      error_class: runtime?.error_class ?? (item.result === 'error' ? classifyRuntimeErrorClass(typeof item.error_code === 'string' ? item.error_code : undefined) : undefined),
      fallback_hops: typeof runtime?.fallback_hops === 'number' ? runtime.fallback_hops : 0,
      estimated_cost: typeof runtime?.estimated_cost === 'number' ? runtime.estimated_cost : null,
      missing_price: runtime?.missing_price === true,
    },
  };
}

function buildRuntimeObservabilitySummary(records: Array<Record<string, unknown>>, start: string, end: string) {
  const facts = records.map(toRuntimeFact);
  const errorClassCounts = {
    provider_retryable: 0,
    provider_non_retryable: 0,
    system_error: 0,
  };
  const fallbackHopsHistogram: Record<string, number> = {};
  const providerBreakdown = new Map<string, {
    provider: string;
    requests: number;
    errors: number;
    fallbackRequests: number;
    costs: number[];
    missingPriceFacts: number;
  }>();
  const modelBreakdown = new Map<string, {
    provider: string;
    model: string;
    requests: number;
    errors: number;
    fallbackRequests: number;
    costs: number[];
    missingPriceFacts: number;
  }>();
  const costs: number[] = [];
  let totalRequests = 0;
  let totalErrors = 0;
  let recoveredRequests = 0;
  let missingPriceFacts = 0;

  for (const fact of facts) {
    const reqs = fact.requests ?? 1;
    totalRequests += reqs;
    const fallbackHops = fact.runtime?.fallback_hops ?? 0;
    fallbackHopsHistogram[String(fallbackHops)] = (fallbackHopsHistogram[String(fallbackHops)] ?? 0) + reqs;
    if (fallbackHops > 0) recoveredRequests += reqs;
    if (fact.result === 'error') {
      totalErrors += reqs;
      const errorClass = fact.runtime?.error_class ?? classifyRuntimeErrorClass(fact.error_code);
      errorClassCounts[errorClass] += reqs;
    }
    const cost = typeof fact.runtime?.estimated_cost === 'number' ? fact.runtime.estimated_cost : 0;
    if (cost > 0) costs.push(cost);
    if (fact.runtime?.missing_price) missingPriceFacts += reqs;

    if (fact.runtime?.provider) {
      const providerAgg = providerBreakdown.get(fact.runtime.provider) ?? {
        provider: fact.runtime.provider,
        requests: 0,
        errors: 0,
        fallbackRequests: 0,
        costs: [],
        missingPriceFacts: 0,
      };
      providerAgg.requests += reqs;
      if (fact.result === 'error') providerAgg.errors += reqs;
      if (fallbackHops > 0) providerAgg.fallbackRequests += reqs;
      if (cost > 0) providerAgg.costs.push(cost);
      if (fact.runtime?.missing_price) providerAgg.missingPriceFacts += reqs;
      providerBreakdown.set(fact.runtime.provider, providerAgg);
    }

    if (fact.runtime?.provider && fact.runtime?.resolved_model) {
      const key = `${fact.runtime.provider}:${fact.runtime.resolved_model}`;
      const modelAgg = modelBreakdown.get(key) ?? {
        provider: fact.runtime.provider,
        model: fact.runtime.resolved_model,
        requests: 0,
        errors: 0,
        fallbackRequests: 0,
        costs: [],
        missingPriceFacts: 0,
      };
      modelAgg.requests += reqs;
      if (fact.result === 'error') modelAgg.errors += reqs;
      if (fallbackHops > 0) modelAgg.fallbackRequests += reqs;
      if (cost > 0) modelAgg.costs.push(cost);
      if (fact.runtime?.missing_price) modelAgg.missingPriceFacts += reqs;
      modelBreakdown.set(key, modelAgg);
    }
  }

  const percentile95 = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[idx] ?? 0;
  };

  const mapBreakdown = <
    T extends {
      requests: number;
      errors: number;
      fallbackRequests: number;
      costs: number[];
      missingPriceFacts: number;
    },
  >(items: T[]) =>
    items.map((item) => ({
      error_rate: item.requests > 0 ? Number((item.errors / item.requests).toFixed(4)) : 0,
      fallback_rate: item.requests > 0 ? Number((item.fallbackRequests / item.requests).toFixed(4)) : 0,
      avg_estimated_cost: item.costs.length > 0
        ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
        : 0,
      p95_estimated_cost: Number(percentile95(item.costs).toFixed(8)),
      missing_price_facts: item.missingPriceFacts,
      ...(Object.fromEntries(
        Object.entries(item).filter(([key]) => (
          key !== 'fallbackRequests'
          && key !== 'costs'
          && key !== 'missingPriceFacts'
        )),
      ) as Omit<T, 'fallbackRequests' | 'costs' | 'missingPriceFacts'>),
    }));

  const totalCost = costs.reduce((sum, value) => sum + value, 0);

  return {
    total_requests: totalRequests,
    total_errors: totalErrors,
    error_rate: totalRequests > 0 ? Number((totalErrors / totalRequests).toFixed(4)) : 0,
    fallback_hops_histogram: fallbackHopsHistogram,
    error_class_counts: errorClassCounts,
    avg_estimated_cost: costs.length > 0 ? Number((totalCost / costs.length).toFixed(8)) : 0,
    p95_estimated_cost: Number(percentile95(costs).toFixed(8)),
    health_summary: {
      recovered_requests: recoveredRequests,
      terminal_error_requests: totalErrors,
      missing_price_facts: missingPriceFacts,
      provider_count: providerBreakdown.size,
      model_count: modelBreakdown.size,
    },
    provider_breakdown: mapBreakdown(Array.from(providerBreakdown.values()).sort((a, b) => b.requests - a.requests)),
    model_breakdown: mapBreakdown(Array.from(modelBreakdown.values()).sort((a, b) => b.requests - a.requests)),
    time_range: {
      start,
      end,
    },
  };
}

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', ({ request }) => {
    const url = new URL(request.url);
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const errorClass = url.searchParams.get('error_class');
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
        provider,
        model,
        errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
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
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const errorClass = url.searchParams.get('error_class');
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
          error_class: undefined,
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
          error_class: 'provider_retryable',
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
      if (provider && item.runtime?.provider !== provider) return false;
      if (model && item.runtime?.resolved_model !== model) return false;
      if (errorClass && item.runtime?.error_class !== errorClass) return false;
      return true;
    });
    const runtimeItems = listRuntimeUsageFacts({
      startTime,
      endTime,
      resourceType,
      resourceId,
      endUserId,
      provider,
      model,
      errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
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
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const errorClass = url.searchParams.get('error_class');
    const factsResponse = listRuntimeUsageFacts({
      startTime: start,
      endTime: end,
      resourceType: 'endpoint',
      provider,
      model,
      errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
    });
    const fixtureFactsResponse = [
      {
        requests: 1,
        result: 'ok',
        runtime: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          fallback_hops: 1,
          estimated_cost: 0.0068,
          missing_price: false,
        },
      },
      {
        requests: 1,
        result: 'error',
        error_code: 'UPSTREAM_429',
        runtime: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          error_class: 'provider_retryable',
          fallback_hops: 0,
          estimated_cost: null,
          missing_price: true,
        },
      },
    ].filter((item) => {
      if (provider && item.runtime.provider !== provider) return false;
      if (model && item.runtime.resolved_model !== model) return false;
      if (errorClass && item.runtime.error_class !== errorClass) return false;
      return true;
    });
    return HttpResponse.json(buildRuntimeObservabilitySummary([...factsResponse, ...fixtureFactsResponse], start, end));
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
