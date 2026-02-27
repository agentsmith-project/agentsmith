import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { writeProjectUsageFact } from './audit-usage-recorders.js';
import { classifyUpstreamStatus, resolveRoutingPlan, shouldFallbackByPolicy } from './runtime-routing.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  providerConnectionId?: string;
  modelId?: string;
  alias?: string;
  combo?: string;
}

interface RuntimeHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

type RuntimeProviderConnectionRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: string;
  auth_mode: 'api_key' | 'oauth' | 'aws_sdk' | 'token';
  base_url: string;
  credential_ref?: string;
  priority?: number;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
};

type RuntimeModelCatalogEntryRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: string;
  model_id: string;
  display_name?: string;
  capabilities: string[];
  context_window?: number;
  max_tokens?: number;
  pricing?: Record<string, number>;
  created_at: string;
  updated_at: string;
};

type RuntimeModelAliasRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  alias: string;
  target_provider: string;
  target_model: string;
  created_at: string;
  updated_at: string;
};

type RuntimeModelComboRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  targets: Array<{ provider: string; model: string }>;
  fallback_policy: {
    max_hops: number;
    retryable_error_classes: string[];
  };
  created_at: string;
  updated_at: string;
};

type RuntimePricingRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  updated_at: string;
};

const PROVIDERS_COLLECTION = 'runtime_provider_connections';
const MODELS_COLLECTION = 'runtime_model_catalog_entries';
const ALIASES_COLLECTION = 'runtime_model_aliases';
const COMBOS_COLLECTION = 'runtime_model_combos';
const PRICING_COLLECTION = 'runtime_pricing_maps';

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requireProjectScope(
  route: AnyRoute,
  json: RuntimeHandlerArgs['json'],
  res: http.ServerResponse,
): { workspaceId: string; projectId: string } | null {
  if (!route.workspaceId || !route.projectId) {
    json(res, 400, { error_code: 'BAD_REQUEST', message: 'workspace_and_project_required' });
    return null;
  }
  return { workspaceId: route.workspaceId, projectId: route.projectId };
}

async function listScoped<T extends { workspace_id: string; project_id: string }>(
  deps: NodeApiDeps,
  collection: string,
  workspaceId: string,
  projectId: string,
): Promise<T[]> {
  return deps.docStore.list<T>(collection, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
}

function pricingRecordId(workspaceId: string, projectId: string): string {
  return `runtime_pricing_${workspaceId}_${projectId}`;
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

export async function handleRuntimeRoute(args: RuntimeHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody } = args;

  const scope = requireProjectScope(route, json, res);
  if (!scope) return false;
  const { workspaceId, projectId } = scope;

  if (route.kind === 'llmUnifiedChat' && method === 'POST') {
    const raw = asObject(await readBody(req));
    const modelRaw = asNonEmptyString(raw?.model);
    if (!raw || !modelRaw) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' });
      return true;
    }
    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
    const startedAtMs = Date.now();

    const providers = await listScoped<RuntimeProviderConnectionRecord>(deps, PROVIDERS_COLLECTION, workspaceId, projectId);
    const aliases = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    const combos = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    const pricing = await deps.docStore.get<RuntimePricingRecord>(PRICING_COLLECTION, pricingRecordId(workspaceId, projectId));
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
      json(res, 422, { error_code: routingPlan.errorCode, message: routingPlan.message });
      return true;
    }
    if (routingPlan.attempts.length === 0) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_routing_target_required' });
      return true;
    }
    const attempts = routingPlan.attempts;
    const comboName = routingPlan.comboName ?? null;
    const comboFallbackPolicy = routingPlan.fallbackPolicy;

    let lastErrorCode = 'RUNTIME_UPSTREAM_ERROR';
    let lastMessage = 'runtime_upstream_error';

    for (let idx = 0; idx < attempts.length; idx += 1) {
      const attempt = attempts[idx]!;
      const available = providers
        .filter((item) => item.provider === attempt.provider && item.status === 'active')
        .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
      if (available.length === 0) {
        lastErrorCode = 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND';
        lastMessage = 'runtime_provider_connection_not_found';
        continue;
      }
      const providerConn = available[0]!;
      if (!providerConn.credential_ref) {
        lastErrorCode = 'RUNTIME_PROVIDER_CREDENTIAL_MISSING';
        lastMessage = 'runtime_provider_credential_missing';
        continue;
      }
      const apiKey = await deps.endpointResourceService.getCredentialSecret(
        workspaceId,
        projectId,
        providerConn.credential_ref,
      );
      if (!apiKey) {
        lastErrorCode = 'RUNTIME_PROVIDER_CREDENTIAL_NOT_FOUND';
        lastMessage = 'runtime_provider_credential_not_found';
        continue;
      }

      const upstreamUrl = `${providerConn.base_url.replace(/\/+$/, '')}/chat/completions`;
      const body = { ...raw, model: attempt.model };
      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        if (idx < attempts.length - 1) {
          const hopAfterFallback = idx + 1;
          const shouldFallback = shouldFallbackByPolicy({
            errorClass: 'system_error',
            hopAfterFallback,
            policy: comboName ? comboFallbackPolicy : undefined,
          });
          if (shouldFallback) {
            continue;
          }
        }
        json(res, 502, { error_code: 'RUNTIME_UPSTREAM_NETWORK_ERROR', message: 'runtime_upstream_network_error' });
        return true;
      }

      const errorClass = upstreamRes.ok ? undefined : classifyUpstreamStatus(upstreamRes.status);
      if (!upstreamRes.ok && idx < attempts.length - 1 && errorClass) {
        const hopAfterFallback = idx + 1;
        const shouldFallback = shouldFallbackByPolicy({
          errorClass,
          hopAfterFallback,
          policy: comboName ? comboFallbackPolicy : undefined,
        });
        if (shouldFallback) {
          continue;
        }
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
        endUserId: user.id,
        requestId,
        requests: 1,
        durationMs: Date.now() - startedAtMs,
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

      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', contentType);
      if (contentType.toLowerCase().includes('application/json') && parsed && typeof parsed === 'object') {
        const responsePayload = {
          ...parsed,
          runtime: {
            provider: attempt.provider,
            resolved_model: attempt.model,
            fallback_hops: idx,
          },
        };
        res.end(JSON.stringify(responsePayload));
      } else {
        res.end(text);
      }
      return true;
    }

    json(res, 502, {
      error_code: lastErrorCode,
      message: lastMessage,
    });
    return true;
  }

  if (route.kind === 'runtimeProviders' && method === 'GET') {
    const items = await listScoped<RuntimeProviderConnectionRecord>(deps, PROVIDERS_COLLECTION, workspaceId, projectId);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeProviders' && method === 'POST') {
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_provider_payload_invalid' });
      return true;
    }
    const provider = asNonEmptyString(body.provider);
    const authMode = asNonEmptyString(body.auth_mode) as RuntimeProviderConnectionRecord['auth_mode'] | undefined;
    const baseUrl = asNonEmptyString(body.base_url);
    if (!provider || !authMode || !baseUrl) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_provider_required_fields_missing' });
      return true;
    }

    const record: RuntimeProviderConnectionRecord = {
      id: `rpc_${randomUUID().replace(/-/g, '')}`,
      workspace_id: workspaceId,
      project_id: projectId,
      provider,
      auth_mode: authMode,
      base_url: baseUrl,
      credential_ref: asNonEmptyString(body.credential_ref),
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      status: (asNonEmptyString(body.status) as RuntimeProviderConnectionRecord['status']) ?? 'active',
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(PROVIDERS_COLLECTION, record.id, record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeProviderItem' && route.providerConnectionId && method === 'PUT') {
    const existing = await deps.docStore.get<RuntimeProviderConnectionRecord>(
      PROVIDERS_COLLECTION,
      route.providerConnectionId,
    );
    if (!existing || existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'runtime_provider_not_found' });
      return true;
    }

    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_provider_payload_invalid' });
      return true;
    }

    const updated: RuntimeProviderConnectionRecord = {
      ...existing,
      base_url: asNonEmptyString(body.base_url) ?? existing.base_url,
      credential_ref: asNonEmptyString(body.credential_ref) ?? existing.credential_ref,
      priority: typeof body.priority === 'number' ? body.priority : existing.priority,
      status: (asNonEmptyString(body.status) as RuntimeProviderConnectionRecord['status']) ?? existing.status,
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(PROVIDERS_COLLECTION, updated.id, updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeProviderItem' && route.providerConnectionId && method === 'DELETE') {
    const existing = await deps.docStore.get<RuntimeProviderConnectionRecord>(
      PROVIDERS_COLLECTION,
      route.providerConnectionId,
    );
    if (!existing || existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'runtime_provider_not_found' });
      return true;
    }
    await deps.docStore.delete(PROVIDERS_COLLECTION, route.providerConnectionId);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeModels' && method === 'GET') {
    const items = await listScoped<RuntimeModelCatalogEntryRecord>(deps, MODELS_COLLECTION, workspaceId, projectId);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeModels' && method === 'POST') {
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_model_payload_invalid' });
      return true;
    }

    const provider = asNonEmptyString(body.provider);
    const modelId = asNonEmptyString(body.model_id);
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];

    if (!provider || !modelId || capabilities.length === 0) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_model_required_fields_missing' });
      return true;
    }
    const existing = await listScoped<RuntimeModelCatalogEntryRecord>(deps, MODELS_COLLECTION, workspaceId, projectId);
    if (existing.some((item) => item.provider === provider && item.model_id === modelId)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_model_already_exists' });
      return true;
    }

    const record: RuntimeModelCatalogEntryRecord = {
      id: `rmc_${randomUUID().replace(/-/g, '')}`,
      workspace_id: workspaceId,
      project_id: projectId,
      provider,
      model_id: modelId,
      display_name: asNonEmptyString(body.display_name),
      capabilities,
      context_window: typeof body.context_window === 'number' ? body.context_window : undefined,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      pricing: asObject(body.pricing) as Record<string, number> | undefined,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(MODELS_COLLECTION, record.id, record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'GET') {
    if (!route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_id_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelCatalogEntryRecord>(deps, MODELS_COLLECTION, workspaceId, projectId);
    const item = items.find((entry) => entry.model_id === route.modelId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    json(res, 200, item);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'PUT') {
    if (!route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_id_required' });
      return true;
    }
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_model_payload_invalid' });
      return true;
    }
    const items = await listScoped<RuntimeModelCatalogEntryRecord>(deps, MODELS_COLLECTION, workspaceId, projectId);
    const existing = items.find((entry) => entry.model_id === route.modelId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : existing.capabilities;
    if (capabilities.length === 0) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_model_capabilities_required' });
      return true;
    }
    const provider = asNonEmptyString(body.provider) ?? existing.provider;
    const updated: RuntimeModelCatalogEntryRecord = {
      ...existing,
      provider,
      display_name: asNonEmptyString(body.display_name) ?? existing.display_name,
      capabilities,
      context_window: typeof body.context_window === 'number' ? body.context_window : existing.context_window,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : existing.max_tokens,
      pricing: asObject(body.pricing) as Record<string, number> | undefined ?? existing.pricing,
      updated_at: nowIso(),
    };
    await deps.docStore.upsert(MODELS_COLLECTION, updated.id, updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'DELETE') {
    if (!route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_id_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelCatalogEntryRecord>(deps, MODELS_COLLECTION, workspaceId, projectId);
    const existing = items.find((entry) => entry.model_id === route.modelId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    await deps.docStore.delete(MODELS_COLLECTION, existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeRoutingAliases' && method === 'GET') {
    const items = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeRoutingAliases' && method === 'POST') {
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_alias_payload_invalid' });
      return true;
    }
    const alias = asNonEmptyString(body.alias);
    const targetProvider = asNonEmptyString(body.target_provider);
    const targetModel = asNonEmptyString(body.target_model);

    if (!alias || !targetProvider || !targetModel) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_alias_required_fields_missing' });
      return true;
    }
    const existing = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    if (existing.some((item) => item.alias === alias)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_alias_already_exists' });
      return true;
    }

    const record: RuntimeModelAliasRecord = {
      id: `rma_${randomUUID().replace(/-/g, '')}`,
      workspace_id: workspaceId,
      project_id: projectId,
      alias,
      target_provider: targetProvider,
      target_model: targetModel,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(ALIASES_COLLECTION, record.id, record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'GET') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.alias === route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    json(res, 200, existing);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'PUT') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_alias_payload_invalid' });
      return true;
    }
    const items = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.alias === route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    const targetProvider = asNonEmptyString(body.target_provider) ?? existing.target_provider;
    const targetModel = asNonEmptyString(body.target_model) ?? existing.target_model;
    const updated: RuntimeModelAliasRecord = {
      ...existing,
      target_provider: targetProvider,
      target_model: targetModel,
      updated_at: nowIso(),
    };
    await deps.docStore.upsert(ALIASES_COLLECTION, updated.id, updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'DELETE') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelAliasRecord>(deps, ALIASES_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.alias === route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    await deps.docStore.delete(ALIASES_COLLECTION, existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeRoutingCombos' && method === 'GET') {
    const items = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeRoutingCombos' && method === 'POST') {
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_combo_payload_invalid' });
      return true;
    }

    const name = asNonEmptyString(body.name);
    const targets = Array.isArray(body.targets)
      ? body.targets
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          provider: asNonEmptyString(item.provider),
          model: asNonEmptyString(item.model),
        }))
        .filter((item): item is { provider: string; model: string } => Boolean(item.provider && item.model))
      : [];

    const fallbackPolicy = asObject(body.fallback_policy);
    const maxHops = fallbackPolicy && typeof fallbackPolicy.max_hops === 'number'
      ? Math.max(1, Math.floor(fallbackPolicy.max_hops))
      : undefined;
    const retryableErrorClasses = fallbackPolicy && Array.isArray(fallbackPolicy.retryable_error_classes)
      ? fallbackPolicy.retryable_error_classes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    if (!name || targets.length === 0 || !maxHops || retryableErrorClasses.length === 0) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_combo_required_fields_missing' });
      return true;
    }
    const existing = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    if (existing.some((item) => item.name === name)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_combo_already_exists' });
      return true;
    }

    const record: RuntimeModelComboRecord = {
      id: `rmco_${randomUUID().replace(/-/g, '')}`,
      workspace_id: workspaceId,
      project_id: projectId,
      name,
      targets,
      fallback_policy: {
        max_hops: maxHops,
        retryable_error_classes: retryableErrorClasses,
      },
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(COMBOS_COLLECTION, record.id, record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'GET') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.name === route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    json(res, 200, existing);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'PUT') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_combo_payload_invalid' });
      return true;
    }
    const items = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.name === route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    const targets = Array.isArray(body.targets)
      ? body.targets
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          provider: asNonEmptyString(item.provider),
          model: asNonEmptyString(item.model),
        }))
        .filter((item): item is { provider: string; model: string } => Boolean(item.provider && item.model))
      : existing.targets;
    const fallbackPolicy = asObject(body.fallback_policy);
    const maxHops = fallbackPolicy && typeof fallbackPolicy.max_hops === 'number'
      ? Math.max(1, Math.floor(fallbackPolicy.max_hops))
      : existing.fallback_policy.max_hops;
    const retryableErrorClasses = fallbackPolicy && Array.isArray(fallbackPolicy.retryable_error_classes)
      ? fallbackPolicy.retryable_error_classes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : existing.fallback_policy.retryable_error_classes;
    if (targets.length === 0 || retryableErrorClasses.length === 0) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_combo_required_fields_missing' });
      return true;
    }
    const updated: RuntimeModelComboRecord = {
      ...existing,
      targets,
      fallback_policy: {
        max_hops: maxHops,
        retryable_error_classes: retryableErrorClasses,
      },
      updated_at: nowIso(),
    };
    await deps.docStore.upsert(COMBOS_COLLECTION, updated.id, updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'DELETE') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const items = await listScoped<RuntimeModelComboRecord>(deps, COMBOS_COLLECTION, workspaceId, projectId);
    const existing = items.find((item) => item.name === route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    await deps.docStore.delete(COMBOS_COLLECTION, existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimePricing' && method === 'GET') {
    const record = await deps.docStore.get<RuntimePricingRecord>(PRICING_COLLECTION, pricingRecordId(workspaceId, projectId));
    json(res, 200, record?.pricing_map ?? {});
    return true;
  }

  if (route.kind === 'runtimePricing' && method === 'PATCH') {
    const body = asObject(await readBody(req));
    if (!body) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'runtime_pricing_payload_invalid' });
      return true;
    }

    const record: RuntimePricingRecord = {
      id: pricingRecordId(workspaceId, projectId),
      workspace_id: workspaceId,
      project_id: projectId,
      pricing_map: body as RuntimePricingRecord['pricing_map'],
      updated_at: nowIso(),
    };

    await deps.docStore.upsert(PRICING_COLLECTION, record.id, record);
    json(res, 200, record.pricing_map);
    return true;
  }

  return false;
}
