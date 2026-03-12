import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectUsageFact } from './audit-usage-recorders.js';
import {
  evaluateUpstreamFallback,
  selectProviderConnection,
  shouldFallbackAfterNetworkError,
  toMissingCredentialFailure,
} from './model-request-policy.js';
import { createModelConfigStore, type ProjectPricingRecord } from './model-config-store.js';
import { parseModelRequestRef } from './model-config-validation.js';

export type ModelRequestOutcome =
  | 'provider_connection_missing'
  | 'credential_ref_missing'
  | 'credential_secret_missing'
  | 'terminal_network_error'
  | 'terminal_upstream_error'
  | 'success';

export type ModelRequestTrace = {
  index: number;
  provider: string;
  model: string;
  providerConnectionId?: string;
  outcome: ModelRequestOutcome;
  statusCode?: number;
  errorClass?: string;
  reason: string;
  durationMs?: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  pricingMap: ProjectPricingRecord['pricing_map'],
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

export type ModelRequestExecutionResult =
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

async function writeRequestUsageFact(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  resourceId?: string;
  endUserId: string;
  requestId?: string | null;
  startedAtMs: number;
  nowMs: () => number;
  attempts: ModelRequestTrace[];
  resolvedProvider?: string;
  resolvedModel?: string;
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
      routed_by: 'direct',
      fallback_hops: 0,
      pricing_source: params.pricingVersion ?? null,
      estimated_cost: params.estimatedCost ?? null,
      attempt_trace: params.attempts,
    },
  });
}

export async function executeModelRequest(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  rawBody: unknown;
  endUserId: string;
  requestId?: string | null;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}): Promise<ModelRequestExecutionResult> {
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
  const parsedModel = parseModelRequestRef(rawBody);
  if (!raw || !parsedModel.ok) {
    return {
      statusCode: 422,
      body: {
        error_code: 'VALIDATION_ERROR',
        message: raw ? parsedModel.message : 'model_request_model_required',
      },
    };
  }

  const modelConfigStore = createModelConfigStore(deps.docStore);
  const projectScope = { workspaceId, projectId };
  const startedAtMs = nowMs();

  const [providers, pricing] = await Promise.all([
    modelConfigStore.listProviders(projectScope),
    modelConfigStore.resolvePricing(projectScope),
  ]);
  const pricingMap = pricing.pricing_map ?? {};

  const attempt = parsedModel.value;
  const attemptTrace: ModelRequestTrace[] = [];

  const attemptStartedAtMs = nowMs();
  const providerSelection = selectProviderConnection({ providers, attempt });
  if (!providerSelection.ok) {
    attemptTrace.push({
      index: 0,
      provider: attempt.provider,
      model: attempt.model,
      outcome: providerSelection.failure.errorCode === 'PROVIDER_CONNECTION_NOT_FOUND'
        ? 'provider_connection_missing'
        : 'credential_ref_missing',
      reason: providerSelection.failure.message,
      durationMs: nowMs() - attemptStartedAtMs,
    });

    await writeRequestUsageFact({
      deps,
      workspaceId,
      projectId,
      endUserId,
      requestId,
      startedAtMs,
      nowMs,
      attempts: attemptTrace,
      result: 'error',
      errorCode: providerSelection.failure.errorCode,
    });

    return {
      statusCode: 502,
      body: {
        error_code: providerSelection.failure.errorCode,
        message: providerSelection.failure.message,
        request_details: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: 0,
          pricing_source: pricing.pricing_source_name ?? pricing.pricing_source_id ?? null,
          estimated_cost: null,
          attempts: attemptTrace,
        },
      },
    };
  }

  const providerConn = providerSelection.providerConnection;
  const apiKey = await deps.endpointResourceService.getCredentialSecret(
    workspaceId,
    projectId,
    providerConn.credential_ref,
  );
  if (!apiKey) {
    const failure = toMissingCredentialFailure();
    attemptTrace.push({
      index: 0,
      provider: attempt.provider,
      model: attempt.model,
      providerConnectionId: providerConn.id,
      outcome: 'credential_secret_missing',
      reason: failure.message,
      durationMs: nowMs() - attemptStartedAtMs,
    });

    await writeRequestUsageFact({
      deps,
      workspaceId,
      projectId,
      resourceId: providerConn.id,
      endUserId,
      requestId,
      startedAtMs,
      nowMs,
      attempts: attemptTrace,
      result: 'error',
      errorCode: failure.errorCode,
    });

    return {
      statusCode: 502,
      body: {
        error_code: failure.errorCode,
        message: failure.message,
        request_details: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: 0,
          pricing_source: pricing.pricing_source_name ?? pricing.pricing_source_id ?? null,
          estimated_cost: null,
          attempts: attemptTrace,
        },
      },
    };
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
    shouldFallbackAfterNetworkError();
    attemptTrace.push({
      index: 0,
      provider: attempt.provider,
      model: attempt.model,
      providerConnectionId: providerConn.id,
      outcome: 'terminal_network_error',
      errorClass: 'system_error',
      reason: 'model_upstream_network_error',
      durationMs: nowMs() - attemptStartedAtMs,
    });
    await writeRequestUsageFact({
      deps,
      workspaceId,
      projectId,
      resourceId: providerConn.id,
      endUserId,
      requestId,
      startedAtMs,
      nowMs,
      attempts: attemptTrace,
      result: 'error',
      errorCode: 'RUNTIME_UPSTREAM_NETWORK_ERROR',
    });
    return {
      statusCode: 502,
      body: {
        error_code: 'RUNTIME_UPSTREAM_NETWORK_ERROR',
        message: 'model_upstream_network_error',
        request_details: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: 0,
          pricing_source: pricing.pricing_source_name ?? pricing.pricing_source_id ?? null,
          estimated_cost: null,
          attempts: attemptTrace,
        },
      },
    };
  }

  const upstreamDecision = evaluateUpstreamFallback({ upstreamStatus: upstreamRes.status });
  attemptTrace.push({
    index: 0,
    provider: attempt.provider,
    model: attempt.model,
    providerConnectionId: providerConn.id,
    outcome: upstreamRes.ok ? 'success' : 'terminal_upstream_error',
    statusCode: upstreamRes.status,
    errorClass: upstreamRes.ok ? undefined : upstreamDecision.errorClass,
    reason: upstreamRes.ok ? 'model_upstream_ok' : 'model_upstream_error',
    durationMs: nowMs() - attemptStartedAtMs,
  });

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

  await writeRequestUsageFact({
    deps,
    workspaceId,
    projectId,
    resourceId: providerConn.id,
    endUserId,
    requestId,
    startedAtMs,
    nowMs,
    attempts: attemptTrace,
    resolvedProvider: attempt.provider,
    resolvedModel: attempt.model,
    pricingSource: pricing.pricing_source_name ?? pricing.pricing_source_id ?? null,
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
        request_details: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: 0,
          pricing_source: pricing.pricing_source_name ?? pricing.pricing_source_id ?? null,
          estimated_cost: estimatedCost ?? null,
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
