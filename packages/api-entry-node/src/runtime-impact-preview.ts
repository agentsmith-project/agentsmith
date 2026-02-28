import { listUsageFacts } from './audit-usage-store.js';
import { dryRunRuntimeRouting, type RuntimeRoutingDryRunResponse } from './runtime-routing-dry-run.js';
import type { NodeApiDeps } from './node-api-deps.js';

export type RuntimeImpactPreviewRequest = {
  model: string;
  lookback_hours?: number;
  resource_id?: string;
};

export type RuntimeImpactPreviewResponse = {
  model: string;
  lookback_window: {
    start: string;
    end: string;
    lookback_hours: number;
  };
  sample: {
    request_count: number;
    total_estimated_cost: number;
    avg_estimated_cost: number | null;
    avg_tokens_in: number | null;
    avg_tokens_out: number | null;
    avg_tokens_total: number | null;
  };
  planned_route: RuntimeRoutingDryRunResponse;
  projected_cost: {
    primary_avg_cost: number | null;
    primary_total_cost: number | null;
    range_avg_cost: {
      low: number | null;
      high: number | null;
    };
    range_total_cost: {
      low: number | null;
      high: number | null;
    };
  };
  assumptions: string[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function roundCost(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

function estimateCostFromPricing(pricing: Record<string, number> | undefined, avgTokensIn: number, avgTokensOut: number): number | null {
  const inputRate = typeof pricing?.input === 'number' ? pricing.input : undefined;
  const outputRate = typeof pricing?.output === 'number' ? pricing.output : undefined;
  if (inputRate === undefined || outputRate === undefined) return null;
  const cost = ((avgTokensIn * inputRate) + (avgTokensOut * outputRate)) / 1_000_000;
  return roundCost(cost);
}

export async function previewRuntimeImpact(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  rawBody: unknown;
  now?: Date;
}): Promise<{ statusCode: number; body: RuntimeImpactPreviewResponse | { error_code: string; message: string } }> {
  const raw = asObject(params.rawBody);
  const modelRaw = asNonEmptyString(raw?.model);
  if (!modelRaw) {
    return {
      statusCode: 422,
      body: { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' },
    };
  }

  const lookbackHours = Math.min(asPositiveInt(raw?.lookback_hours) ?? 24 * 7, 24 * 30);
  const resourceId = asNonEmptyString(raw?.resource_id);
  const end = params.now ?? new Date();
  const start = new Date(end.getTime() - lookbackHours * 60 * 60 * 1000);

  const planned = await dryRunRuntimeRouting({
    deps: params.deps,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    rawBody: { model: modelRaw },
  });
  if (planned.statusCode !== 200) {
    return planned as { statusCode: number; body: { error_code: string; message: string } };
  }
  const plannedRoute = planned.body as RuntimeRoutingDryRunResponse;

  const facts = await listUsageFacts(params.deps.docStore, {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    resourceType: 'endpoint',
    resourceId,
  });

  const requestCount = facts.reduce((sum, fact) => sum + (fact.requests ?? 1), 0);
  const totalEstimatedCostRaw = facts.reduce((sum, fact) => {
    const cost = fact.metadata_json?.estimated_cost;
    return sum + (typeof cost === 'number' && Number.isFinite(cost) ? cost : 0);
  }, 0);
  const totalTokensIn = facts.reduce((sum, fact) => sum + (fact.tokens_in ?? 0), 0);
  const totalTokensOut = facts.reduce((sum, fact) => sum + (fact.tokens_out ?? 0), 0);
  const totalTokens = facts.reduce((sum, fact) => sum + (fact.tokens_total ?? 0), 0);

  const avgEstimatedCost = requestCount > 0 ? totalEstimatedCostRaw / requestCount : null;
  const avgTokensIn = requestCount > 0 ? totalTokensIn / requestCount : null;
  const avgTokensOut = requestCount > 0 ? totalTokensOut / requestCount : null;
  const avgTokensTotal = requestCount > 0 ? totalTokens / requestCount : null;

  const perAttemptProjectedCosts = plannedRoute.attempts.map((attempt: RuntimeRoutingDryRunResponse['attempts'][number]) =>
    estimateCostFromPricing(attempt.pricing, avgTokensIn ?? 0, avgTokensOut ?? 0),
  ).filter((value: number | null): value is number => value !== null);

  const primaryAvgCost = estimateCostFromPricing(
    plannedRoute.attempts[0]?.pricing,
    avgTokensIn ?? 0,
    avgTokensOut ?? 0,
  );
  const lowAvgCost = perAttemptProjectedCosts.length > 0 ? Math.min(...perAttemptProjectedCosts) : null;
  const highAvgCost = perAttemptProjectedCosts.length > 0 ? Math.max(...perAttemptProjectedCosts) : null;

  return {
    statusCode: 200,
    body: {
      model: modelRaw,
      lookback_window: {
        start: start.toISOString(),
        end: end.toISOString(),
        lookback_hours: lookbackHours,
      },
      sample: {
        request_count: requestCount,
        total_estimated_cost: roundCost(totalEstimatedCostRaw) ?? 0,
        avg_estimated_cost: roundCost(avgEstimatedCost),
        avg_tokens_in: avgTokensIn === null ? null : Number(avgTokensIn.toFixed(2)),
        avg_tokens_out: avgTokensOut === null ? null : Number(avgTokensOut.toFixed(2)),
        avg_tokens_total: avgTokensTotal === null ? null : Number(avgTokensTotal.toFixed(2)),
      },
      planned_route: plannedRoute,
      projected_cost: {
        primary_avg_cost: primaryAvgCost,
        primary_total_cost: primaryAvgCost === null ? null : roundCost(primaryAvgCost * requestCount),
        range_avg_cost: {
          low: lowAvgCost === null ? null : roundCost(lowAvgCost),
          high: highAvgCost === null ? null : roundCost(highAvgCost),
        },
        range_total_cost: {
          low: lowAvgCost === null ? null : roundCost(lowAvgCost * requestCount),
          high: highAvgCost === null ? null : roundCost(highAvgCost * requestCount),
        },
      },
      assumptions: [
        'impact_preview_uses_recent_endpoint_usage_facts',
        'impact_preview_applies_average_token_mix_to_planned_pricing',
        'impact_preview_does_not_model_runtime_fallback_probability',
      ],
    },
  };
}
