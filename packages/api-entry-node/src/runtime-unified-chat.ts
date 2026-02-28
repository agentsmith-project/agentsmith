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

export type RuntimeAttemptOutcome =
  | 'provider_connection_missing'
  | 'credential_ref_missing'
  | 'credential_secret_missing'
  | 'fallback_network_error'
  | 'terminal_network_error'
  | 'fallback_upstream_error'
  | 'terminal_upstream_error'
  | 'success';

export type RuntimeAttemptTrace = {
  index: number;
  provider: string;
  model: string;
  providerConnectionId?: string;
  outcome: RuntimeAttemptOutcome;
  statusCode?: number;
  errorClass?: string;
  reason: string;
  durationMs?: number;
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

async function writeRuntimeUsageFact(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  resourceId?: string;
  endUserId: string;
  requestId?: string | null;
  startedAtMs: number;
  nowMs: () => number;
  attempts: RuntimeAttemptTrace[];
  routedBy: 'direct' | 'alias' | 'combo';
  resolvedProvider?: string;
  resolvedModel?: string;
  fallbackHops?: number;
  pricingVersion?: string | null;
  estimatedCost?: number | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  result: 'ok' | 'error';
  errorCode?: string;
}) {
  await writeProjectUsageFact(params.deps, {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    resourceType: 'endpoint',
    resourceId: params.resourceId,
    endUserId: params.endUserId,
    requestId: params.requestId,
    requests: 1,
    durationMs: params.nowMs() - params.startedAtMs,
    tokensIn: params.usage?.inputTokens,
    tokensOut: params.usage?.outputTokens,
    tokensTotal: params.usage?.totalTokens,
    result: params.result,
    errorCode: params.errorCode,
    metadata: {
      provider: params.resolvedProvider ?? null,
      model: params.resolvedModel ?? null,
      routed_by: params.routedBy,
      fallback_hops: params.fallbackHops ?? null,
      pricing_version: params.pricingVersion ?? null,
      estimated_cost: params.estimatedCost ?? null,
      attempt_trace: params.attempts,
    },
  });
}

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
  const attemptTrace: RuntimeAttemptTrace[] = [];
  let lastErrorCode = 'RUNTIME_UPSTREAM_ERROR';
  let lastMessage = 'runtime_upstream_error';

  for (let idx = 0; idx < attempts.length; idx += 1) {
    const attempt = attempts[idx]!;
    const attemptStartedAtMs = nowMs();
    const providerSelection = selectProviderConnection({ providers, attempt });
    if (!providerSelection.ok) {
      lastErrorCode = providerSelection.failure.errorCode;
      lastMessage = providerSelection.failure.message;
      attemptTrace.push({
        index: idx,
        provider: attempt.provider,
        model: attempt.model,
        outcome: providerSelection.failure.errorCode === 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND'
          ? 'provider_connection_missing'
          : 'credential_ref_missing',
        reason: providerSelection.failure.message,
        durationMs: nowMs() - attemptStartedAtMs,
      });
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
      attemptTrace.push({
        index: idx,
        provider: attempt.provider,
        model: attempt.model,
        providerConnectionId: providerConn.id,
        outcome: 'credential_secret_missing',
        reason: failure.message,
        durationMs: nowMs() - attemptStartedAtMs,
      });
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
      const shouldFallback = shouldFallbackAfterNetworkError({
        attemptIndex: idx,
        attemptCount: attempts.length,
        comboName,
        comboFallbackPolicy,
      });
      attemptTrace.push({
        index: idx,
        provider: attempt.provider,
        model: attempt.model,
        providerConnectionId: providerConn.id,
        outcome: shouldFallback ? 'fallback_network_error' : 'terminal_network_error',
        errorClass: 'system_error',
        reason: shouldFallback ? 'runtime_upstream_network_error_recovered' : 'runtime_upstream_network_error',
        durationMs: nowMs() - attemptStartedAtMs,
      });
      if (shouldFallback) {
        continue;
      }
      await writeRuntimeUsageFact({
        deps,
        workspaceId,
        projectId,
        resourceId: providerConn.id,
        endUserId,
        requestId,
        startedAtMs,
        nowMs,
        attempts: attemptTrace,
        routedBy: routingPlan.routedBy,
        result: 'error',
        errorCode: 'RUNTIME_UPSTREAM_NETWORK_ERROR',
      });
      return {
        statusCode: 502,
        body: {
          error_code: 'RUNTIME_UPSTREAM_NETWORK_ERROR',
          message: 'runtime_upstream_network_error',
          runtime: {
            provider: attempt.provider,
            resolved_model: attempt.model,
            fallback_hops: idx,
            attempts: attemptTrace,
          },
        },
      };
    }

    const upstreamDecision = evaluateUpstreamFallback({
      attemptIndex: idx,
      attemptCount: attempts.length,
      upstreamStatus: upstreamRes.status,
      comboName,
      comboFallbackPolicy,
    });
    attemptTrace.push({
      index: idx,
      provider: attempt.provider,
      model: attempt.model,
      providerConnectionId: providerConn.id,
      outcome: upstreamRes.ok
        ? 'success'
        : (upstreamDecision.shouldFallback ? 'fallback_upstream_error' : 'terminal_upstream_error'),
      statusCode: upstreamRes.status,
      errorClass: upstreamRes.ok ? undefined : upstreamDecision.errorClass,
      reason: upstreamRes.ok
        ? 'runtime_upstream_ok'
        : (upstreamDecision.shouldFallback ? 'runtime_upstream_error_recovered' : 'runtime_upstream_error'),
      durationMs: nowMs() - attemptStartedAtMs,
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

    await writeRuntimeUsageFact({
      deps,
      workspaceId,
      projectId,
      resourceId: providerConn.id,
      endUserId,
      requestId,
      startedAtMs,
      nowMs,
      attempts: attemptTrace,
      routedBy: routingPlan.routedBy,
      resolvedProvider: attempt.provider,
      resolvedModel: attempt.model,
      fallbackHops: idx,
      pricingVersion: pricing?.updated_at ?? null,
      estimatedCost: estimatedCost ?? null,
      usage,
      result: upstreamRes.ok ? 'ok' : 'error',
      errorCode: upstreamRes.ok ? undefined : `UPSTREAM_${upstreamRes.status}`,
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
            attempts: attemptTrace,
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

  await writeRuntimeUsageFact({
    deps,
    workspaceId,
    projectId,
    endUserId,
    requestId,
    startedAtMs,
    nowMs,
    attempts: attemptTrace,
    routedBy: routingPlan.routedBy,
    result: 'error',
    errorCode: lastErrorCode,
  });
  return {
    statusCode: 502,
    body: {
      error_code: lastErrorCode,
      message: lastMessage,
      runtime: {
        fallback_hops: attemptTrace.filter((item) => item.outcome.startsWith('fallback_')).length,
        attempts: attemptTrace,
      },
    },
  };
}
