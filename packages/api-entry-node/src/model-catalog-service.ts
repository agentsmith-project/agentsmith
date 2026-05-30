import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JsonDocStorePort } from '@mbos/ports';
import {
  createModelConfigStore,
  type ModelCatalogModelProjectionRecord,
  type ModelCatalogProviderProjectionRecord,
  type ModelCatalogVersionRecord,
  type ModelCatalogVersionStatus,
  type ModelCatalogSyncJobRecord,
} from './model-config-store.js';

type ModelsDevRawModel = {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  status?: 'alpha' | 'beta' | 'deprecated';
  modalities?: { input?: string[]; output?: string[] };
  cost?: Record<string, number | Record<string, number>>;
  limit?: { context?: number; input?: number; output?: number };
};

type ModelsDevRawProvider = {
  id?: string;
  env?: string[];
  npm?: string;
  api?: string;
  name?: string;
  doc?: string;
  models?: Record<string, ModelsDevRawModel>;
};

type ModelsDevRawPayload = Record<string, ModelsDevRawProvider>;

type NormalizedCatalogPayload = {
  source?: string;
  synced_at?: string;
  provider_count?: number;
  model_count?: number;
  providers?: Array<{
    provider_id?: string;
    key?: string;
    name?: string;
    api?: string;
    doc?: string;
    npm?: string;
    env?: string[];
    models?: Array<{
      model_id?: string;
      id?: string;
      name?: string;
      family?: string;
      capabilities?: string[];
      modalities?: { input?: string[]; output?: string[] };
      pricing?: Record<string, number>;
      limits?: { context?: number; input?: number; output?: number };
    }>;
  }>;
};

type MaterializedCatalog = {
  schema_kind: ModelCatalogVersionRecord['schema_kind'];
  providers: ModelCatalogProviderProjectionRecord[];
  models: ModelCatalogModelProjectionRecord[];
  rawPayload: Record<string, unknown>;
};

const DENIED_MODEL_CATALOG_PROVIDER_IDS = new Set(['github-copilot', 'github-models']);

function nowIso(): string {
  return new Date().toISOString();
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isDeniedModelCatalogProviderId(value?: string): boolean {
  if (!value) return false;
  return DENIED_MODEL_CATALOG_PROVIDER_IDS.has(value.trim().toLowerCase());
}

function shouldExposeModelCatalogProvider(...providerIds: Array<string | undefined>): boolean {
  return !providerIds.some(isDeniedModelCatalogProviderId);
}

function filterRawCatalogPayload(raw: ModelsDevRawPayload): ModelsDevRawPayload {
  const filtered: ModelsDevRawPayload = {};
  for (const [providerKey, provider] of Object.entries(raw)) {
    if (!shouldExposeModelCatalogProvider(providerKey, provider.id)) continue;
    filtered[providerKey] = provider;
  }
  return filtered;
}

function filterNormalizedCatalogPayload(raw: NormalizedCatalogPayload): NormalizedCatalogPayload {
  const providers = (raw.providers ?? []).filter((provider) => {
    const providerKey = (provider.key ?? provider.provider_id ?? '').trim();
    const providerId = (provider.provider_id ?? providerKey).trim();
    return shouldExposeModelCatalogProvider(providerKey, providerId);
  });
  const filtered: NormalizedCatalogPayload = {
    ...raw,
    providers,
  };
  if (Object.prototype.hasOwnProperty.call(raw, 'provider_count')) {
    filtered.provider_count = providers.length;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'model_count')) {
    filtered.model_count = providers.reduce(
      (sum, provider) => sum + (provider.models?.length ?? 0),
      0,
    );
  }
  return filtered;
}

function inferCapabilities(model: ModelsDevRawModel): string[] {
  const caps = new Set<string>();
  if (model.tool_call) caps.add('tool_call');
  if (model.reasoning) caps.add('reasoning');
  const input = model.modalities?.input ?? [];
  const output = model.modalities?.output ?? [];
  if (output.includes('text')) caps.add('chat_completion');
  if (input.some((item) => item !== 'text')) caps.add('multimodal_completion');
  const id = model.id?.toLowerCase() ?? '';
  if (id.includes('embed')) caps.add('embedding');
  if (id.includes('rerank')) caps.add('rerank');
  if (output.includes('image')) caps.add('image_generation');
  if (output.includes('video')) caps.add('video_generation');
  return [...caps];
}

function inferProviderFamily(providerKey: string, providerName: string): string {
  const composite = `${providerKey} ${providerName}`.toLowerCase();
  if (composite.includes('anthropic')) return 'anthropic';
  if (composite.includes('deepseek')) return 'deepseek';
  if (composite.includes('google')) return 'google';
  if (composite.includes('moonshot') || composite.includes('kimi')) return 'kimi';
  if (composite.includes('zhipu') || composite.includes('glm')) return 'glm';
  if (composite.includes('alibaba') || composite.includes('qwen') || composite.includes('dashscope')) return 'alibaba';
  if (composite.includes('openai')) return 'openai';
  if (composite.includes('minimax')) return 'minimax';
  return 'custom';
}

function inferProviderProtocol(api?: string, providerKey?: string): string {
  const value = `${providerKey ?? ''} ${api ?? ''}`.toLowerCase();
  return value.includes('anthropic') ? 'anthropic_messages' : 'openai_chat_completions';
}

function materializeRawPayload(raw: ModelsDevRawPayload): MaterializedCatalog {
  const filteredRaw = filterRawCatalogPayload(raw);
  const providers: ModelCatalogProviderProjectionRecord[] = [];
  const models: ModelCatalogModelProjectionRecord[] = [];
  for (const [providerKey, provider] of Object.entries(filteredRaw)) {
    const providerId = (provider.id ?? providerKey).trim();
    const providerName = (provider.name ?? providerKey).trim();
    const providerModels = provider.models ?? {};
    const protocol = inferProviderProtocol(provider.api, providerKey);
    providers.push({
      id: `catp_pending_${providerKey}`,
      version_id: '',
      provider_key: providerKey,
      provider_id: providerId,
      provider: providerKey,
      family: inferProviderFamily(providerKey, providerName),
      name: providerName,
      api: provider.api,
      doc: provider.doc,
      npm: provider.npm,
      env: provider.env ?? [],
      model_count: Object.keys(providerModels).length,
      default_base_url: provider.api ?? '',
      upstream_protocol: protocol as ModelCatalogProviderProjectionRecord['upstream_protocol'],
    });
    for (const [modelKey, model] of Object.entries(providerModels)) {
      const modelId = (model.id ?? modelKey).trim();
      models.push({
        id: `catm_pending_${providerKey}_${modelId}`,
        version_id: '',
        provider_key: providerKey,
        provider_id: providerId,
        provider_name: providerName,
        provider: providerKey,
        model_id: modelId,
        name: (model.name ?? modelId).trim(),
        family: model.family,
        attachment: model.attachment,
        reasoning: model.reasoning,
        tool_call: model.tool_call,
        structured_output: model.structured_output,
        temperature: model.temperature,
        knowledge: model.knowledge,
        release_date: model.release_date,
        last_updated: model.last_updated,
        open_weights: model.open_weights,
        status: model.status,
        modalities: model.modalities,
        cost: model.cost,
        limit: model.limit,
        capabilities: inferCapabilities(model),
        meta_source: 'models.dev',
      });
    }
  }

  return {
    schema_kind: 'models.dev.raw',
    providers,
    models,
    rawPayload: filteredRaw as Record<string, unknown>,
  };
}

function materializeNormalizedPayload(raw: NormalizedCatalogPayload): MaterializedCatalog {
  const filteredRaw = filterNormalizedCatalogPayload(raw);
  const providers: ModelCatalogProviderProjectionRecord[] = [];
  const models: ModelCatalogModelProjectionRecord[] = [];
  for (const provider of filteredRaw.providers ?? []) {
    const providerKey = (provider.key ?? provider.provider_id ?? '').trim();
    if (!providerKey) continue;
    const providerId = (provider.provider_id ?? providerKey).trim();
    const providerName = (provider.name ?? providerKey).trim();
    const providerModels = provider.models ?? [];
    const protocol = inferProviderProtocol(provider.api, providerKey);
    providers.push({
      id: `catp_pending_${providerKey}`,
      version_id: '',
      provider_key: providerKey,
      provider_id: providerId,
      provider: providerKey,
      family: inferProviderFamily(providerKey, providerName),
      name: providerName,
      api: provider.api,
      doc: provider.doc,
      npm: provider.npm,
      env: provider.env ?? [],
      model_count: providerModels.length,
      default_base_url: provider.api ?? '',
      upstream_protocol: protocol as ModelCatalogProviderProjectionRecord['upstream_protocol'],
    });
    for (const model of providerModels) {
      const modelId = (model.model_id ?? model.id ?? '').trim();
      if (!modelId) continue;
      models.push({
        id: `catm_pending_${providerKey}_${modelId}`,
        version_id: '',
        provider_key: providerKey,
        provider_id: providerId,
        provider_name: providerName,
        provider: providerKey,
        model_id: modelId,
        name: (model.name ?? modelId).trim(),
        family: model.family,
        modalities: model.modalities,
        cost: model.pricing,
        limit: model.limits,
        capabilities: model.capabilities ?? [],
        meta_source: 'models.dev',
      });
    }
  }

  return {
    schema_kind: 'models.dev.normalized',
    providers,
    models,
    rawPayload: filteredRaw as unknown as Record<string, unknown>,
  };
}

function filterCatalogProviders(
  providers: ModelCatalogProviderProjectionRecord[],
): ModelCatalogProviderProjectionRecord[] {
  return providers.filter((provider) =>
    shouldExposeModelCatalogProvider(provider.provider_key, provider.provider_id, provider.provider),
  );
}

function filterCatalogModels(models: ModelCatalogModelProjectionRecord[]): ModelCatalogModelProjectionRecord[] {
  return models.filter((model) =>
    shouldExposeModelCatalogProvider(model.provider_key, model.provider_id, model.provider),
  );
}

function materializeCatalogPayload(payload: unknown): MaterializedCatalog {
  const obj = asObject(payload);
  if (!obj) {
    return { schema_kind: 'models.dev.raw', providers: [], models: [], rawPayload: {} };
  }
  if (Array.isArray((obj as { providers?: unknown }).providers)) {
    return materializeNormalizedPayload(obj as unknown as NormalizedCatalogPayload);
  }
  return materializeRawPayload(obj as unknown as ModelsDevRawPayload);
}

async function persistVersion(args: {
  docStore: JsonDocStorePort;
  createdBy: string;
  source: string;
  sourceEtag?: string;
  payload: unknown;
  trigger: ModelCatalogSyncJobRecord['trigger'];
  initializedFromSeed?: boolean;
}): Promise<ModelCatalogVersionRecord> {
  const store = createModelConfigStore(args.docStore);
  const startedAt = nowIso();
  const jobId = store.createId('catjob');
  await store.upsertCatalogJob({
    id: jobId,
    source: args.source,
    trigger: args.trigger,
    status: 'running',
    started_at: startedAt,
  });

  try {
    const materialized = materializeCatalogPayload(args.payload);
    const versionId = store.createId('catver');
    const hash = hashPayload(materialized.rawPayload);
    const version: ModelCatalogVersionRecord = {
      id: versionId,
      source: args.source,
      source_etag: args.sourceEtag,
      source_hash: hash,
      schema_kind: materialized.schema_kind,
      provider_count: materialized.providers.length,
      model_count: materialized.models.length,
      status: 'staged',
      created_by: args.createdBy,
      created_at: startedAt,
    };
    await store.upsertCatalogVersion(version);
    for (const provider of materialized.providers) {
      await store.upsertCatalogProvider({
        ...provider,
        id: `${versionId}:${provider.provider_key}`,
        version_id: versionId,
      });
    }
    for (const model of materialized.models) {
      await store.upsertCatalogModel({
        ...model,
        id: `${versionId}:${model.provider_key}:${model.model_id}`,
        version_id: versionId,
      });
    }
    await store.upsertCatalogRawDocument({
      id: versionId,
      version_id: versionId,
      payload: materialized.rawPayload,
      created_at: startedAt,
    });
    await store.setActiveCatalogVersion(versionId);
    const metadata = await store.getCatalogMetadata();
    await store.upsertCatalogMetadata({
      id: 'model_catalog_metadata',
      active_version_id: versionId,
      latest_successful_sync_at: nowIso(),
      initialized_from_seed: args.initializedFromSeed ?? metadata?.initialized_from_seed ?? false,
      updated_at: nowIso(),
    });
    await store.upsertCatalogJob({
      id: jobId,
      source: args.source,
      trigger: args.trigger,
      status: 'succeeded',
      started_at: startedAt,
      finished_at: nowIso(),
      version_id: versionId,
    });
    return { ...version, status: 'active', activated_at: nowIso() };
  } catch (error) {
    await store.upsertCatalogJob({
      id: jobId,
      source: args.source,
      trigger: args.trigger,
      status: 'failed',
      started_at: startedAt,
      finished_at: nowIso(),
      error_message: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  }
}

export async function ensureModelCatalogBootstrap(docStore: JsonDocStorePort): Promise<void> {
  const store = createModelConfigStore(docStore);
  const isEmpty = await store.isCatalogEmpty();
  if (!isEmpty) return;
  const seedCandidates = [
    resolve(process.cwd(), 'assets/models-catalog/catalog.normalized.json'),
    resolve(process.cwd(), '../../assets/models-catalog/catalog.normalized.json'),
  ];
  let seedPath: string | null = null;
  for (const candidate of seedCandidates) {
    try {
      await access(candidate);
      seedPath = candidate;
      break;
    } catch {
      // Continue trying candidates.
    }
  }
  if (!seedPath) {
    throw new Error('model_catalog_seed_not_found');
  }
  const raw = await readFile(seedPath, 'utf-8');
  const payload = JSON.parse(raw) as unknown;
  await persistVersion({
    docStore,
    createdBy: 'system/bootstrap',
    source: `seed:${seedPath}`,
    payload,
    trigger: 'bootstrap',
    initializedFromSeed: true,
  });
}

export async function syncModelCatalogFromModelsDev(docStore: JsonDocStorePort, createdBy: string) {
  const source = 'https://models.dev/api.json';
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`model_catalog_sync_fetch_failed:${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return persistVersion({
    docStore,
    createdBy,
    source,
    sourceEtag: response.headers.get('etag') ?? undefined,
    payload,
    trigger: 'manual',
  });
}

export async function readActiveModelCatalogSnapshot(docStore: JsonDocStorePort): Promise<{
  version: ModelCatalogVersionRecord | null;
  providers: ModelCatalogProviderProjectionRecord[];
  models: ModelCatalogModelProjectionRecord[];
}> {
  const store = createModelConfigStore(docStore);
  const active = await store.getActiveCatalogVersion();
  if (!active) {
    return { version: null, providers: [], models: [] };
  }
  const [providers, models] = await Promise.all([
    store.listModelCatalogProviders(active.id),
    store.listModelCatalogModels(active.id),
  ]);
  const filteredProviders = filterCatalogProviders(providers);
  const filteredModels = filterCatalogModels(models);
  return {
    version: {
      ...active,
      provider_count: filteredProviders.length,
      model_count: filteredModels.length,
    },
    providers: filteredProviders,
    models: filteredModels,
  };
}

export async function listModelCatalogJobs(docStore: JsonDocStorePort): Promise<ModelCatalogSyncJobRecord[]> {
  const store = createModelConfigStore(docStore);
  const jobs = await store.listCatalogJobs();
  return [...jobs].sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function normalizeCatalogStatus(version: ModelCatalogVersionStatus | undefined): ModelCatalogVersionStatus {
  return version ?? 'failed';
}
