import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { usageRecordFixtures, usageKPI } from '../fixtures/usage';

type ResourceType = 'endpoint' | 'source_library' | 'agent';

function resolveResourceMultiplier(resourceType?: string | null) {
  if (resourceType === 'agent') return 0.65;
  if (resourceType === 'source_library') return 0.35;
  return 1;
}

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', () => {
    const usageItems = p0.usage as Array<{ resource_type?: string | null }> | undefined;
    const hasStructuredUsage = Array.isArray(usageItems) && usageItems.some((item) => Boolean(item?.resource_type));
    const items = hasStructuredUsage ? p0.usage : usageRecordFixtures;
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      page_size: 25,
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
