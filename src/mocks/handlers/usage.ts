import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { buildRequestUsageRecords, listRequestUsageFacts } from '../state/request-usage';

type ResourceType = 'endpoint' | 'file_library' | 'agent';

type RequestFactLike = {
  requests?: number;
  result: 'ok' | 'error';
  timestamp?: string;
  end_user_id?: string;
  request_id?: string;
  error_code?: string;
  request_details?: {
    provider?: string;
    resolved_model?: string;
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    fallback_hops?: number;
    estimated_cost?: number | null;
    missing_price?: boolean;
  };
};

function buildUsageOperationsSummary(facts: RequestFactLike[]) {
  const providerAgg = new Map<string, { provider: string; requests: number; errors: number; estimated_cost: number }>();
  const modelAgg = new Map<string, { provider: string; model: string; requests: number; errors: number; estimated_cost: number }>();
  const endUserAgg = new Map<string, { end_user_id: string; requests: number; errors: number; estimated_cost: number }>();

  for (const fact of facts) {
    const requests = fact.requests ?? 1;
    const provider = fact.request_details?.provider;
    const model = fact.request_details?.resolved_model;
    const estimatedCost = fact.request_details?.estimated_cost ?? 0;

    if (provider) {
      const providerItem = providerAgg.get(provider) ?? { provider, requests: 0, errors: 0, estimated_cost: 0 };
      providerItem.requests += requests;
      if (fact.result === 'error') providerItem.errors += requests;
      providerItem.estimated_cost += estimatedCost;
      providerAgg.set(provider, providerItem);
    }

    if (provider && model) {
      const key = `${provider}:${model}`;
      const modelItem = modelAgg.get(key) ?? { provider, model, requests: 0, errors: 0, estimated_cost: 0 };
      modelItem.requests += requests;
      if (fact.result === 'error') modelItem.errors += requests;
      modelItem.estimated_cost += estimatedCost;
      modelAgg.set(key, modelItem);
    }

    if (fact.end_user_id) {
      const endUserItem = endUserAgg.get(fact.end_user_id) ?? {
        end_user_id: fact.end_user_id,
        requests: 0,
        errors: 0,
        estimated_cost: 0,
      };
      endUserItem.requests += requests;
      if (fact.result === 'error') endUserItem.errors += requests;
      endUserItem.estimated_cost += estimatedCost;
      endUserAgg.set(fact.end_user_id, endUserItem);
    }
  }

  return {
    top_providers: Array.from(providerAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    top_models: Array.from(modelAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    top_end_users: Array.from(endUserAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    anomaly_peaks: [],
    recent_requests: facts.slice(0, 12).map((fact, index) => ({
      id: fact.request_id ?? `mock_request_${index + 1}`,
      timestamp: fact.timestamp,
      request_id: fact.request_id,
      provider: fact.request_details?.provider,
      model: fact.request_details?.resolved_model,
      end_user_id: fact.end_user_id,
      result: fact.result,
      error_class: fact.request_details?.error_class,
      estimated_cost: fact.request_details?.estimated_cost,
    })),
    webhook_destinations: [],
  };
}

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', ({ request }) => {
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
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '30', 10) || 30;

    const items = buildRequestUsageRecords({
      groupBy: 'day',
      filters: {
        startTime: start,
        endTime: end,
        resourceType,
        resourceId,
        endUserId,
        provider,
        model,
        result: result === 'ok' || result === 'error' ? result : null,
        errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
      },
    });

    return HttpResponse.json({
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      page_size: pageSize,
      total: items.length,
      total_pages: Math.max(1, Math.ceil(items.length / pageSize)),
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/timeseries', ({ request }) => {
    const url = new URL(request.url);
    const start = url.searchParams.get('start_time') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = url.searchParams.get('end_time') ?? new Date().toISOString();
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');

    const items = buildRequestUsageRecords({
      groupBy: 'day',
      filters: {
        startTime: start,
        endTime: end,
        resourceType,
        resourceId,
        endUserId,
      },
    });

    return HttpResponse.json({
      data_points: items.map((item) => ({
        time_bucket: item.time_bucket,
        requests: item.requests ?? 0,
        errors: 0,
        tokens: item.tokens ?? undefined,
        duration_p95_ms: item.duration_p95_ms ?? undefined,
        bytes_in: item.bytes_in ?? undefined,
        bytes_out: item.bytes_out ?? undefined,
      })),
      time_range: {
        start,
        end,
        granularity: 'day',
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
    const requestFacts = listRequestUsageFacts({
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
    const fixtureFactsBase: RequestFactLike[] = [
      {
        timestamp: end,
        end_user_id: 'user_001',
        request_id: 'req_model_001',
        requests: 1,
        result: 'ok',
        request_details: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          estimated_cost: 0.0068,
        },
      },
      {
        timestamp: start,
        end_user_id: 'user_002',
        request_id: 'req_model_002',
        requests: 1,
        result: 'error',
        error_code: 'UPSTREAM_429',
        request_details: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          error_class: 'provider_retryable',
          estimated_cost: null,
        },
      },
    ];
    const fixtureFacts = fixtureFactsBase.filter((item) => {
      if (endUserId && item.end_user_id !== endUserId) return false;
      if (provider && item.request_details?.provider !== provider) return false;
      if (model && item.request_details?.resolved_model !== model) return false;
      if (result && item.result !== result) return false;
      if (errorClass && item.request_details?.error_class !== errorClass) return false;
      return true;
    });
    return HttpResponse.json(buildUsageOperationsSummary([...requestFacts, ...fixtureFacts]));
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/limits/summary', () => {
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
      .map((item) => {
        const requestsPerMinuteLimit = 1200;
        const requestsPer5HoursLimit = 18000;
        const requestsPerDayLimit = 20000;
        const spendingPerDayLimitUsd = 500;

        const requestsPerMinuteUsed = Math.max(1, Math.round(item.requests / 60));
        const requestsPer5HoursUsed = Math.max(1, Math.round(item.requests * 0.75));
        const requestsPerDayUsed = item.requests;
        const spendingPerDayUsedUsd = Math.max(1, Number((item.requests * 0.08).toFixed(2)));

        const makeRule = (
          kind: 'rate_limit' | 'spending_limit',
          window: 'minute' | '5h' | 'day',
          metric: 'requests' | 'usd',
          policyKey: string,
          used: number,
          max: number,
        ) => ({
          kind,
          window,
          metric,
          policy_key: policyKey,
          used,
          max,
          remaining: Math.max(0, max - used),
          usage_pct: Number((max > 0 ? Math.min(100, (used / max) * 100) : 0).toFixed(2)),
          reset_at: resetAt,
        });

        return {
          endpoint_id: item.resource_id,
          endpoint_name: item.resource_name,
          limits: [
            makeRule('rate_limit', 'minute', 'requests', 'endpoint.requests_per_minute', requestsPerMinuteUsed, requestsPerMinuteLimit),
            makeRule('rate_limit', '5h', 'requests', 'endpoint.requests_per_5_hours', requestsPer5HoursUsed, requestsPer5HoursLimit),
            makeRule('rate_limit', 'day', 'requests', 'endpoint.requests_per_day', requestsPerDayUsed, requestsPerDayLimit),
            makeRule('spending_limit', 'day', 'usd', 'endpoint.spending_usd_per_day', spendingPerDayUsedUsd, spendingPerDayLimitUsd),
          ],
        };
      });
    return HttpResponse.json({
      endpoints,
    });
  }),
];
