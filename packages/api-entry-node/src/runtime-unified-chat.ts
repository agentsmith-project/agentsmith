import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectUsageFact } from './audit-usage-recorders.js';
import {
  evaluateUpstreamFallback,
  selectProviderConnection,
  shouldFallbackAfterNetworkError,
  toMissingCredentialFailure,
} from './runtime-execution-policy.js';
import { resolveRoutingPlan } from './runtime-routing.js';
import { createRuntimeStore, type RuntimePricingRecord } from './runtime-store.js';

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUsage(payload: Record<string, unknown> | null): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const obj = usage as Record<string, unknown>;
  const inputTokens = typeof obj.prompt_tokens === 'number'
    ? obj.prompt_tokens
    : (typeof obj.input_tokens === 'number' ? obj.input_tokens : undefined);
  const outputTokens = typeof obj.completion_tokens === 'number'
    ? obj.completion_tokens
    : (typeof obj.output_tokens === 'number' ? obj.output_tokens : undefined);
  const totalTokens = typeof obj.total_tokens === 'number'
    ? obj.total_tokens
    : ((typeof inputTokens === 'number' && typeof outputTokens === 'number') ? inputTokens + outputTokens : undefined);
  return { inputTokens, outputTokens, totalTokens };
}

function calculateEstimatedCost(
  pricingMap: RuntimePricingRecord['pricing_map'],
  provider: string,
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): number | undefined {
  const providerEntry = pricingMap[provider];
  const modelEntry = providerEntry?.[model];
  if (!modelEntry) return undefined;
  const inputRate = typeof modelEntry.input === 'number' ? modelEntry.input : undefined;
  const outputRate = typeof modelEntry.output === 'number' ? modelEntry.output : undefined;
  if (inputRate === undefined || outputRate === undefined) return undefined;
  const inTokens = usage.inputTokens ?? 0;
  const outTokens = usage.outputTokens ?? 0;
  const cost = (inTokens * (inputRate / 1_000_000)) + (outTokens * (outputRate / 1_000_000));
  return Number.isFinite(cost) ? cost : undefined;
}

export type RuntimeUnifiedChatResult =
  | {
    statusCode: number;
    body: unknown;
    contentType?: undefined;
    text?: undefined;
  }
  | {
    statusCode: number;
    contentType: string;
    body?: undefined;
    text: string;
  };

export async function executeRuntimeUnifiedChat(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  rawBody: unknown;
  endUserId: string;
  requestId?: string | null;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}): Promise<RuntimeUnifiedChatResult> {
  const {
    deps,
    workspaceId,
    projectId,
    rawBody,
    endUserId,
    requestId,
    fetchFn = fetch,
    nowMs = Date.now,
  } = params;

  const raw = asObject(rawBody);
  const modelRaw = asNonEmptyString(raw?.model);
  if (!raw || !modelRaw) {
    return {
      statusCode: 422,
      body: { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' },
    };
  }

  const runtimeStore = createRuntimeStore(deps.docStore);
  const projectScope = { workspaceId, projectId };
  const startedAtMs = nowMs();

  const [providers, aliases, combos, pricing] = await Promise.all([
    runtimeStore.listProviders(projectScope),
    runtimeStore.listAliases(projectScope),
    runtimeStore.listCombos(projectScope),
    runtimeStore.getPricing(projectScope),
  ]);
  const pricingMap = pricing?.pricing_map ?? {};

  const routingPlan = resolveRoutingPlan({
    modelRaw,
    aliases: aliases.map((item) => ({
      alias: item.alias,
      target_provider: item.target_provider,
      target_model: item.target_model,
    })),
    combos: combos.map((item) => ({
      name: item.name,
      targets: item.targets,
      fallback_policy: item.fallback_policy,
    })),
  });
  if ('errorCode' in routingPlan) {
    return {
      statusCode: 422,
      body: { error_code: routingPlan.errorCode, message: routingPlan.message },
    };
  }
  if (routingPlan.attempts.length === 0) {
    return {
      statusCode: 422,
      body: { error_code: 'VALIDATION_ERROR', message: 'runtime_routing_target_required' },
    };
  }

  const attempts = routingPlan.attempts;
  const comboName = routingPlan.comboName ?? null;
  const comboFallbackPolicy = routingPlan.fallbackPolicy;
  let lastErrorCode = 'RUNTIME_UPSTREAM_ERROR';
  let lastMessage = 'runtime_upstream_error';

  for (let idx = 0; idx < attempts.length; idx += 1) {
    const attempt = attempts[idx]!;
    const providerSelection = selectProviderConnection({ providers, attempt });
    if (!providerSelection.ok) {
      lastErrorCode = providerSelection.failure.errorCode;
      lastMessage = providerSelection.failure.message;
      continue;
    }
    const providerConn = providerSelection.providerConnection;
    const apiKey = await deps.endpointResourceService.getCredentialSecret(
      workspaceId,
      projectId,
      providerConn.credential_ref,
    );
    if (!apiKey) {
      const failure = toMissingCredentialFailure();
      lastErrorCode = failure.errorCode;
      lastMessage = failure.message;
      continue;
    }

    const upstreamUrl = `${providerConn.base_url.replace(/\/+$/, '')}/chat/completions`;
    const upstreamBody = { ...raw, model: attempt.model };
    let upstreamRes: Response;
    try {
      upstreamRes = await fetchFn(upstreamUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch {
      if (shouldFallbackAfterNetworkError({
        attemptIndex: idx,
        attemptCount: attempts.length,
        comboName,
        comboFallbackPolicy,
      })) {
        continue;
      }
      return {
        statusCode: 502,
        body: { error_code: 'RUNTIME_UPSTREAM_NETWORK_ERROR', message: 'runtime_upstream_network_error' },
      };
    }

    const upstreamDecision = evaluateUpstreamFallback({
      attemptIndex: idx,
      attemptCount: attempts.length,
      upstreamStatus: upstreamRes.status,
      comboName,
      comboFallbackPolicy,
    });
    if (!upstreamRes.ok && upstreamDecision.shouldFallback) {
      continue;
    }

    const contentType = upstreamRes.headers.get('content-type') ?? 'application/json';
    const text = await upstreamRes.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const usage = normalizeUsage(parsed);
    const estimatedCost = calculateEstimatedCost(pricingMap, attempt.provider, attempt.model, usage);

    await writeProjectUsageFact(deps, {
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: providerConn.id,
      endUserId,
      requestId,
      requests: 1,
      durationMs: nowMs() - startedAtMs,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      tokensTotal: usage.totalTokens,
      result: upstreamRes.ok ? 'ok' : 'error',
      errorCode: upstreamRes.ok ? undefined : `UPSTREAM_${upstreamRes.status}`,
      metadata: {
        provider: attempt.provider,
        model: attempt.model,
        routed_by: routingPlan.routedBy,
        fallback_hops: idx,
        pricing_version: pricing?.updated_at ?? null,
        estimated_cost: estimatedCost ?? null,
      },
    });

    if (contentType.toLowerCase().includes('application/json') && parsed) {
      return {
        statusCode: upstreamRes.status,
        body: {
          ...parsed,
          runtime: {
            provider: attempt.provider,
            resolved_model: attempt.model,
            fallback_hops: idx,
          },
        },
      };
    }

    return {
      statusCode: upstreamRes.status,
      contentType,
      text,
    };
  }

  return {
    statusCode: 502,
    body: {
      error_code: lastErrorCode,
      message: lastMessage,
    },
  };
}
