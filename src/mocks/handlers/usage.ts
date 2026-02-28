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
  timestamp?: string;
  end_user_id?: string;
  request_id?: string;
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
  const durations: number[] = [];
  const trend = new Map<string, {
    requests: number;
    errors: number;
    recoveredRequests: number;
    costs: number[];
    durations: number[];
  }>();
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
    const durationMs = typeof (fact as { duration_ms?: number }).duration_ms === 'number' ? (fact as { duration_ms?: number }).duration_ms : undefined;
    if (typeof durationMs === 'number') durations.push(durationMs);
    if (fact.runtime?.missing_price) missingPriceFacts += reqs;
    const bucketKey = typeof fact.timestamp === 'string' ? fact.timestamp.slice(0, 13).replace('T', ' ') + ':00' : 'unknown';
    const trendItem = trend.get(bucketKey) ?? {
      requests: 0,
      errors: 0,
      recoveredRequests: 0,
      costs: [],
      durations: [],
    };
    trendItem.requests += reqs;
    if (fact.result === 'error') trendItem.errors += reqs;
    if (fallbackHops > 0) trendItem.recoveredRequests += reqs;
    if (cost > 0) trendItem.costs.push(cost);
    if (typeof durationMs === 'number') trendItem.durations.push(durationMs);
    trend.set(bucketKey, trendItem);

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
  const percentile = (values: number[], ratio: number) => {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[idx];
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
  const requestTrend = Array.from(trend.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([time_bucket, item]) => ({
    time_bucket,
    requests: item.requests,
    errors: item.errors,
    recovered_requests: item.recoveredRequests,
    avg_estimated_cost: item.costs.length > 0
      ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
      : 0,
    duration_p95_ms: percentile(item.durations, 0.95),
  }));
  const latestTrend = requestTrend[requestTrend.length - 1];
  const degradationSignals = [];
  if (latestTrend && latestTrend.recovered_requests > Math.max(1, latestTrend.requests * 0.4)) {
    degradationSignals.push({
      id: `fallback-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'fallback_spike',
      title: 'Fallback spike detected',
      message: `${latestTrend.recovered_requests} recovered requests in ${latestTrend.time_bucket}`,
    });
  }
  if (latestTrend && latestTrend.errors > Math.max(1, latestTrend.requests * 0.2)) {
    degradationSignals.push({
      id: `errors-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'error_rate_spike',
      title: 'Error spike detected',
      message: `${latestTrend.errors} errored requests in ${latestTrend.time_bucket}`,
    });
  }
  if (missingPriceFacts > 0) {
    degradationSignals.push({
      id: 'missing-price',
      severity: missingPriceFacts > 1 ? 'high' : 'medium',
      kind: 'missing_price',
      title: 'Missing price coverage',
      message: `${missingPriceFacts} runtime facts are missing price attribution`,
    });
  }
  const latencyP95 = percentile(durations, 0.95);
  if (latestTrend?.duration_p95_ms && latencyP95 && latestTrend.duration_p95_ms > latencyP95 * 1.25) {
    degradationSignals.push({
      id: `latency-${latestTrend.time_bucket}`,
      severity: 'medium',
      kind: 'latency_spike',
      title: 'Latency spike detected',
      message: `P95 latency elevated to ${Math.round(latestTrend.duration_p95_ms)}ms in ${latestTrend.time_bucket}`,
    });
  }

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
    request_trend: requestTrend,
    latency_distribution_ms: {
      p50: percentile(durations, 0.5),
      p95: latencyP95,
      p99: percentile(durations, 0.99),
    },
    cost_distribution_usd: {
      p50: percentile(costs, 0.5),
      p95: percentile(costs, 0.95),
      p99: percentile(costs, 0.99),
    },
    degradation_signals: degradationSignals,
    provider_breakdown: mapBreakdown(Array.from(providerBreakdown.values()).sort((a, b) => b.requests - a.requests)),
    model_breakdown: mapBreakdown(Array.from(modelBreakdown.values()).sort((a, b) => b.requests - a.requests)),
    time_range: {
      start,
      end,
    },
  };
}

function buildUsageOperationsSummary(records: Array<Record<string, unknown>>) {
  const facts = records.map(toRuntimeFact);
  const providerAgg = new Map<string, { provider: string; requests: number; errors: number; estimated_cost: number }>();
  const modelAgg = new Map<string, { provider: string; model: string; requests: number; errors: number; estimated_cost: number }>();
  const endUserAgg = new Map<string, { end_user_id: string; requests: number; errors: number; estimated_cost: number }>();
  const trend = new Map<string, { requests: number; errors: number; cost: number }>();

  for (const fact of facts) {
    const reqs = fact.requests ?? 1;
    const cost = typeof fact.runtime?.estimated_cost === 'number' ? fact.runtime.estimated_cost : 0;
    const provider = fact.runtime?.provider;
    const model = fact.runtime?.resolved_model;
    const endUserId = fact.end_user_id;
    const bucketKey = typeof fact.timestamp === 'string' ? fact.timestamp.slice(0, 13).replace('T', ' ') + ':00' : 'unknown';
    const trendItem = trend.get(bucketKey) ?? { requests: 0, errors: 0, cost: 0 };
    trendItem.requests += reqs;
    if (fact.result === 'error') trendItem.errors += reqs;
    trendItem.cost += cost;
    trend.set(bucketKey, trendItem);

    if (provider) {
      const item = providerAgg.get(provider) ?? { provider, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      providerAgg.set(provider, item);
    }
    if (provider && model) {
      const key = `${provider}:${model}`;
      const item = modelAgg.get(key) ?? { provider, model, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      modelAgg.set(key, item);
    }
    if (endUserId) {
      const item = endUserAgg.get(endUserId) ?? { end_user_id: endUserId, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      endUserAgg.set(endUserId, item);
    }
  }

  const trendItems = Array.from(trend.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([time_bucket, item]) => ({ time_bucket, ...item }));
  const baselineRequests = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.requests, 0) / trendItems.length : 0;
  const baselineErrors = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.errors, 0) / trendItems.length : 0;
  const baselineCost = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.cost, 0) / trendItems.length : 0;
  const anomalyPeaks = trendItems.slice(-12).flatMap((item) => {
    const peaks: Array<{
      id: string;
      time_bucket: string;
      metric: 'requests' | 'errors' | 'cost';
      value: number;
      baseline: number;
      severity: 'medium' | 'high';
    }> = [];
    if (baselineRequests > 0 && item.requests > baselineRequests * 1.5) {
      peaks.push({ id: `requests-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'requests', value: item.requests, baseline: Number(baselineRequests.toFixed(2)), severity: item.requests > baselineRequests * 2 ? 'high' : 'medium' });
    }
    if (baselineErrors > 0 && item.errors > baselineErrors * 1.5) {
      peaks.push({ id: `errors-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'errors', value: item.errors, baseline: Number(baselineErrors.toFixed(2)), severity: item.errors > baselineErrors * 2 ? 'high' : 'medium' });
    }
    if (baselineCost > 0 && item.cost > baselineCost * 1.5) {
      peaks.push({ id: `cost-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'cost', value: Number(item.cost.toFixed(8)), baseline: Number(baselineCost.toFixed(8)), severity: item.cost > baselineCost * 2 ? 'high' : 'medium' });
    }
    return peaks;
  });

  return {
    top_providers: Array.from(providerAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    top_models: Array.from(modelAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    top_end_users: Array.from(endUserAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    anomaly_peaks: anomalyPeaks.slice(0, 6),
    recent_requests: facts
      .slice()
      .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
      .slice(0, 12)
      .map((fact) => ({
        id: fact.request_id ?? `${fact.timestamp ?? 'unknown'}-${fact.runtime?.provider ?? 'runtime'}`,
        timestamp: fact.timestamp ?? new Date().toISOString(),
        request_id: fact.request_id,
        provider: fact.runtime?.provider,
        model: fact.runtime?.resolved_model,
        end_user_id: fact.end_user_id,
        result: fact.result,
        error_class: fact.runtime?.error_class ?? (fact.result === 'error' ? classifyRuntimeErrorClass(fact.error_code) : undefined),
        estimated_cost: fact.runtime?.estimated_cost ?? undefined,
      })),
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
    const result = url.searchParams.get('result');
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
        result: result === 'ok' || result === 'error' ? result : null,
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
    const result = url.searchParams.get('result');
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
      if (result && item.result !== result) return false;
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
      result: result === 'ok' || result === 'error' ? result : null,
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
    const result = url.searchParams.get('result');
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
      if (result && item.result !== result) return false;
      if (errorClass && item.runtime.error_class !== errorClass) return false;
      return true;
    });
    return HttpResponse.json(buildRuntimeObservabilitySummary([...factsResponse, ...fixtureFactsResponse], start, end));
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/export', ({ request, params }) => {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    const startTime = url.searchParams.get('start_time') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endTime = url.searchParams.get('end_time') ?? new Date().toISOString();
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const result = url.searchParams.get('result');
    const errorClass = url.searchParams.get('error_class');
    const items = listRuntimeUsageFacts({
      startTime,
      endTime,
      resourceType,
      resourceId,
      endUserId,
      provider,
      model,
      result: result === 'ok' || result === 'error' ? result : null,
      errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
    });
    const projectId = typeof params.prj === 'string' ? params.prj : 'proj_001';
    const filename = `usage-report-${projectId}.${format}`;

    if (format === 'json') {
      return new HttpResponse(JSON.stringify({
        generated_at: new Date().toISOString(),
        project_id: projectId,
        filters: {
          start_time: startTime,
          end_time: endTime,
          provider,
          model,
          result,
        },
        facts: items,
      }, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    const csvHeaders = [
      'timestamp',
      'request_id',
      'resource_type',
      'resource_id',
      'end_user_id',
      'provider',
      'resolved_model',
      'result',
      'error_code',
      'error_class',
      'fallback_hops',
      'pricing_version',
      'estimated_cost',
      'missing_price',
    ];
    const rows = items.map((item) => [
      item.timestamp,
      item.request_id,
      item.resource_type,
      item.resource_id,
      item.end_user_id,
      item.runtime?.provider,
      item.runtime?.resolved_model,
      item.result,
      item.error_code,
      item.runtime?.error_class,
      item.runtime?.fallback_hops,
      item.runtime?.pricing_version,
      item.runtime?.estimated_cost,
      item.runtime?.missing_price,
    ].map((cell) => {
      const value = cell === null || cell === undefined ? '' : String(cell);
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(','));

    return new HttpResponse([csvHeaders.join(','), ...rows].join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/operations-summary', ({ request }) => {
    const url = new URL(request.url);
    const start = url.searchParams.get('start_time') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = url.searchParams.get('end_time') ?? new Date().toISOString();
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const result = url.searchParams.get('result');
    const errorClass = url.searchParams.get('error_class');
    const runtimeFacts = listRuntimeUsageFacts({
      startTime: start,
      endTime: end,
      resourceType,
      resourceId,
      endUserId,
      provider,
      model,
      result: result === 'ok' || result === 'error' ? result : null,
      errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
    });
    const fixtureFacts = [
      {
        timestamp: end,
        end_user_id: 'user_001',
        request_id: 'req_runtime_001',
        requests: 1,
        result: 'ok',
        runtime: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          estimated_cost: 0.0068,
        },
      },
      {
        timestamp: start,
        end_user_id: 'user_002',
        request_id: 'req_runtime_002',
        requests: 1,
        result: 'error',
        error_code: 'UPSTREAM_429',
        runtime: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          error_class: 'provider_retryable',
          estimated_cost: null,
        },
      },
    ].filter((item) => {
      if (endUserId && item.end_user_id !== endUserId) return false;
      if (provider && item.runtime.provider !== provider) return false;
      if (model && item.runtime.resolved_model !== model) return false;
      if (result && item.result !== result) return false;
      if (errorClass && item.runtime.error_class !== errorClass) return false;
      return true;
    });
    return HttpResponse.json(buildUsageOperationsSummary([...runtimeFacts, ...fixtureFacts]));
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
