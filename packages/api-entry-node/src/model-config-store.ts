import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/adapters-private';

export type ProjectScope = {
  workspaceId: string;
  projectId: string;
};

export type ProviderConnectionRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: string;
  label?: string;
  auth_mode: 'api_key';
  base_url: string;
  credential_ref?: string;
  priority?: number;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
};

export type ModelCatalogEntryRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: string;
  model_id: string;
  name?: string;
  capabilities: string[];
  limit?: Record<string, number>;
  cost?: Record<string, number | Record<string, number>>;
  created_at: string;
  updated_at: string;
};

export type ModelCatalogVersionRecord = {
  id: string;
  source: string;
  source_hash?: string;
  schema_kind?: 'models.dev.raw' | 'models.dev.normalized';
  provider_count: number;
  model_count: number;
  status: 'staged' | 'active' | 'archived' | 'failed';
  created_by?: string;
  created_at: string;
  activated_at?: string;
  synced_at?: string;
};

export type ModelCatalogMetadataRecord = {
  id: string;
  active_version_id?: string;
  latest_successful_sync_at?: string;
  initialized_from_seed?: boolean;
  updated_at: string;
};

export type ModelCatalogSyncJobRecord = {
  id: string;
  source: string;
  trigger: 'manual' | 'bootstrap';
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at?: string;
  version_id?: string;
  error_message?: string;
};

export type ProjectPricingRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  updated_at: string;
};

export type ResolvedProjectPricing = {
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  pricing_source_id?: string | null;
  pricing_source_name?: string | null;
  updated_at?: string | null;
  source: 'project' | 'missing';
};

const PROVIDERS_COLLECTION = 'provider_connections';
const MODELS_COLLECTION = 'project_model_entries';
const PRICING_COLLECTION = 'project_pricing_maps';
const CATALOG_VERSIONS_COLLECTION = 'model_catalog_versions';
const CATALOG_PROVIDERS_COLLECTION = 'model_catalog_projection_providers';
const CATALOG_MODELS_COLLECTION = 'model_catalog_projection_models';
const CATALOG_RAW_COLLECTION = 'model_catalog_raw_documents';
const CATALOG_METADATA_COLLECTION = 'model_catalog_metadata';
const CATALOG_JOBS_COLLECTION = 'model_catalog_sync_jobs';

function scopeFilter(scope: ProjectScope) {
  return {
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createModelConfigStore(docStore: JsonDocStorePort) {
  async function listScoped<T extends { workspace_id: string; project_id: string }>(
    collection: string,
    scope: ProjectScope,
  ): Promise<T[]> {
    return docStore.list<T>(collection, scopeFilter(scope));
  }

  return {
    nowIso,
    createId(prefix: string) {
      return `${prefix}_${randomUUID().replace(/-/g, '')}`;
    },
    pricingRecordId(scope: ProjectScope) {
      return `project_pricing_${scope.workspaceId}_${scope.projectId}`;
    },
    listProviders(scope: ProjectScope) {
      return listScoped<ProviderConnectionRecord>(PROVIDERS_COLLECTION, scope);
    },
    getProvider(providerConnectionId: string) {
      return docStore.get<ProviderConnectionRecord>(PROVIDERS_COLLECTION, providerConnectionId);
    },
    upsertProvider(record: ProviderConnectionRecord) {
      return docStore.upsert(PROVIDERS_COLLECTION, record.id, record);
    },
    deleteProvider(providerConnectionId: string) {
      return docStore.delete(PROVIDERS_COLLECTION, providerConnectionId);
    },
    listModels(scope: ProjectScope) {
      return listScoped<ModelCatalogEntryRecord>(MODELS_COLLECTION, scope);
    },
    async findModel(scope: ProjectScope, provider: string, modelId: string) {
      const items = await listScoped<ModelCatalogEntryRecord>(MODELS_COLLECTION, scope);
      return items.find((item) => item.provider === provider && item.model_id === modelId);
    },
    upsertModel(record: ModelCatalogEntryRecord) {
      return docStore.upsert(MODELS_COLLECTION, record.id, record);
    },
    deleteModel(recordId: string) {
      return docStore.delete(MODELS_COLLECTION, recordId);
    },
    getProjectPricing(scope: ProjectScope) {
      return docStore.get<ProjectPricingRecord>(PRICING_COLLECTION, `project_pricing_${scope.workspaceId}_${scope.projectId}`);
    },
    upsertPricing(record: ProjectPricingRecord) {
      return docStore.upsert(PRICING_COLLECTION, record.id, record);
    },
    async resolvePricing(scope: ProjectScope): Promise<ResolvedProjectPricing> {
      const record = await this.getProjectPricing(scope);
      if (record) {
        return {
          pricing_map: record.pricing_map,
          pricing_source_id: record.id,
          pricing_source_name: record.id,
          updated_at: record.updated_at,
          source: 'project',
        };
      }
      return {
        pricing_map: {},
        pricing_source_id: null,
        pricing_source_name: null,
        updated_at: null,
        source: 'missing',
      };
    },
    listCatalogVersions() {
      return docStore.list<ModelCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, {});
    },
    getCatalogVersion(versionId: string) {
      return docStore.get<ModelCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, versionId);
    },
    async upsertCatalogVersion(record: ModelCatalogVersionRecord) {
      const current = await docStore.get<ModelCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, record.id);
      const nextStatus = current?.status === 'active' ? 'active' : record.status;
      await docStore.upsert(CATALOG_VERSIONS_COLLECTION, record.id, { ...record, status: nextStatus });
    },
    async setActiveCatalogVersion(versionId: string) {
      const versions = await docStore.list<ModelCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, {});
      for (const item of versions) {
        await docStore.upsert(CATALOG_VERSIONS_COLLECTION, item.id, {
          ...item,
          status: item.id === versionId ? 'active' : (item.status === 'failed' ? 'failed' : 'staged'),
          activated_at: item.id === versionId ? nowIso() : item.activated_at,
        });
      }
      const existing = await docStore.get<ModelCatalogMetadataRecord>(CATALOG_METADATA_COLLECTION, 'active');
      await docStore.upsert(CATALOG_METADATA_COLLECTION, 'active', {
        id: 'active',
        active_version_id: versionId,
        latest_successful_sync_at: existing?.latest_successful_sync_at,
        initialized_from_seed: existing?.initialized_from_seed,
        updated_at: nowIso(),
      });
    },
    getCatalogMetadata() {
      return docStore.get<ModelCatalogMetadataRecord>(CATALOG_METADATA_COLLECTION, 'active');
    },
    upsertCatalogMetadata(record: ModelCatalogMetadataRecord) {
      return docStore.upsert(CATALOG_METADATA_COLLECTION, record.id, record);
    },
    async markCatalogSyncSuccess(params: { versionId: string; initializedFromSeed?: boolean }) {
      const existing = await docStore.get<ModelCatalogMetadataRecord>(CATALOG_METADATA_COLLECTION, 'active');
      await docStore.upsert(CATALOG_METADATA_COLLECTION, 'active', {
        id: 'active',
        active_version_id: params.versionId,
        latest_successful_sync_at: nowIso(),
        initialized_from_seed: params.initializedFromSeed ?? existing?.initialized_from_seed,
        updated_at: nowIso(),
      });
    },
    getActiveCatalogVersion: async () => {
      const metadata = await docStore.get<ModelCatalogMetadataRecord>(CATALOG_METADATA_COLLECTION, 'active');
      if (!metadata?.active_version_id) return null;
      return docStore.get<ModelCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, metadata.active_version_id);
    },
    async isCatalogEmpty() {
      const [providers, models, versions] = await Promise.all([
        docStore.list(CATALOG_PROVIDERS_COLLECTION, {}),
        docStore.list(CATALOG_MODELS_COLLECTION, {}),
        docStore.list(CATALOG_VERSIONS_COLLECTION, {}),
      ]);
      return providers.length === 0 && models.length === 0 && versions.length === 0;
    },
    listCatalogJobs() {
      return docStore.list<ModelCatalogSyncJobRecord>(CATALOG_JOBS_COLLECTION, {});
    },
    upsertCatalogJob(record: ModelCatalogSyncJobRecord) {
      return docStore.upsert(CATALOG_JOBS_COLLECTION, record.id, record);
    },
    listModelCatalogProviders(versionId?: string) {
      return docStore.list<ModelCatalogProviderProjectionRecord>(
        CATALOG_PROVIDERS_COLLECTION,
        versionId ? { version_id: versionId } : {},
      );
    },
    upsertCatalogProvider(record: ModelCatalogProviderProjectionRecord) {
      return docStore.upsert(CATALOG_PROVIDERS_COLLECTION, record.id, record);
    },
    replaceCatalogProviderProjections(records: Array<Record<string, unknown>>) {
      return docStore.replaceAll(CATALOG_PROVIDERS_COLLECTION, records as never[]);
    },
    listModelCatalogModels(versionId?: string) {
      return docStore.list<ModelCatalogModelProjectionRecord>(
        CATALOG_MODELS_COLLECTION,
        versionId ? { version_id: versionId } : {},
      );
    },
    upsertCatalogModel(record: ModelCatalogModelProjectionRecord) {
      return docStore.upsert(CATALOG_MODELS_COLLECTION, record.id, record);
    },
    replaceCatalogModelProjections(records: Array<Record<string, unknown>>) {
      return docStore.replaceAll(CATALOG_MODELS_COLLECTION, records as never[]);
    },
    getCatalogRawDocument(key: string) {
      return docStore.get<Record<string, unknown>>(CATALOG_RAW_COLLECTION, key);
    },
    upsertCatalogRawDocument(record: { id: string; version_id: string; payload: Record<string, unknown>; created_at: string }) {
      return docStore.upsert(CATALOG_RAW_COLLECTION, record.id, record);
    },
  };
}

export type ModelCatalogProviderProjectionRecord = {
  id: string;
  version_id: string;
  provider_key: string;
  provider_id: string;
  provider: string;
  family: string;
  label?: string;
  name: string;
  api?: string;
  doc?: string;
  npm?: string;
  env?: string[];
  model_count: number;
  default_base_url: string;
  protocol: string;
  compatibility_interface: string;
};

export type ModelCatalogModelProjectionRecord = {
  id: string;
  version_id: string;
  provider_key: string;
  provider_id: string;
  provider_name: string;
  provider: string;
  model_id: string;
  name: string;
  family?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  capabilities: string[];
  modalities?: {
    input?: string[];
    output?: string[];
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  cost?: Record<string, number | Record<string, number>>;
};
