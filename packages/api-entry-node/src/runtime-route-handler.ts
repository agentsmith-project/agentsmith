import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  providerConnectionId?: string;
}

interface RuntimeHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
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

export async function handleRuntimeRoute(args: RuntimeHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, json, readBody } = args;

  const scope = requireProjectScope(route, json, res);
  if (!scope) return false;
  const { workspaceId, projectId } = scope;

  if (route.kind === 'llmUnifiedChat' && method === 'POST') {
    json(res, 501, {
      error_code: 'NOT_IMPLEMENTED',
      message: 'llm_unified_chat_not_implemented',
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
