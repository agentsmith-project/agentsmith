import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';

export type RuntimeProjectScope = {
  workspaceId: string;
  projectId: string;
};

export type RuntimeProviderConnectionRecord = {
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

export type RuntimeModelCatalogEntryRecord = {
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

export type RuntimeCatalogVersionStatus = 'staged' | 'active' | 'archived' | 'failed';

export type RuntimeCatalogVersionRecord = {
  id: string;
  source: string;
  source_etag?: string;
  source_hash: string;
  schema_kind: 'models.dev.raw' | 'models.dev.normalized';
  provider_count: number;
  model_count: number;
  status: RuntimeCatalogVersionStatus;
  created_by: string;
  created_at: string;
  activated_at?: string;
};

export type RuntimeCatalogSyncJobRecord = {
  id: string;
  source: string;
  trigger: 'manual' | 'bootstrap';
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at?: string;
  version_id?: string;
  error_message?: string;
};

export type RuntimeCatalogProviderProjectionRecord = {
  id: string;
  version_id: string;
  provider_key: string;
  provider_id: string;
  name: string;
  api?: string;
  doc?: string;
  npm?: string;
  env: string[];
  model_count: number;
};

export type RuntimeCatalogModelProjectionRecord = {
  id: string;
  version_id: string;
  provider_key: string;
  provider_id: string;
  provider_name: string;
  model_id: string;
  name: string;
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
  modalities?: {
    input?: string[];
    output?: string[];
  };
  cost?: Record<string, number | Record<string, number>>;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  capabilities: string[];
  meta_source: 'models.dev';
};

export type RuntimeCatalogRawDocumentRecord = {
  id: string;
  version_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RuntimeCatalogMetadataRecord = {
  id: 'runtime_catalog_metadata';
  active_version_id?: string;
  latest_successful_sync_at?: string;
  initialized_from_seed?: boolean;
  updated_at: string;
};

export type RuntimeModelAliasRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  alias: string;
  target_provider: string;
  target_model: string;
  release?: RuntimeRouteReleaseRecord;
  created_at: string;
  updated_at: string;
};

export type RuntimeModelComboRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  targets: Array<{ provider: string; model: string }>;
  fallback_policy: {
    max_hops: number;
    retryable_error_classes: string[];
  };
  release?: RuntimeRouteReleaseRecord;
  created_at: string;
  updated_at: string;
};

export type RuntimePricingRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  updated_at: string;
};

export type RuntimePricingScopeType = 'global' | 'workspace' | 'project';
export type RuntimePricingVersionStatus = 'draft' | 'active' | 'archived';
export type RuntimeRouteReleaseStatus = 'draft' | 'published' | 'archived';
export type RuntimeRouteRolloutMode = 'full' | 'canary';

export type RuntimeRouteApprovalChecklist = {
  owner_verified: boolean;
  observability_verified: boolean;
  rollback_verified: boolean;
};

export type RuntimeRouteRolloutPolicy = {
  mode: RuntimeRouteRolloutMode;
  canary_percent?: number;
};

export type RuntimeRouteReleaseRecord = {
  status: RuntimeRouteReleaseStatus;
  approval_checklist?: RuntimeRouteApprovalChecklist;
  rollout_policy?: RuntimeRouteRolloutPolicy;
  published_at?: string;
  archived_at?: string;
};

export type RuntimePricingVersionRecord = {
  id: string;
  scope_type: RuntimePricingScopeType;
  workspace_id?: string;
  project_id?: string;
  version_name: string;
  description?: string;
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  status: RuntimePricingVersionStatus;
  created_at: string;
  updated_at: string;
  activated_at?: string;
};

export type ResolvedRuntimePricing = {
  pricing_map: Record<string, Record<string, Record<string, number>>>;
  pricing_version_id?: string | null;
  pricing_version_name?: string | null;
  pricing_scope_type?: RuntimePricingScopeType | null;
  updated_at?: string | null;
  source: 'versioned' | 'legacy' | 'missing';
  active_versions: {
    global?: RuntimePricingVersionRecord;
    workspace?: RuntimePricingVersionRecord;
    project?: RuntimePricingVersionRecord;
  };
};

const PROVIDERS_COLLECTION = 'runtime_provider_connections';
const MODELS_COLLECTION = 'runtime_model_catalog_entries';
const ALIASES_COLLECTION = 'runtime_model_aliases';
const COMBOS_COLLECTION = 'runtime_model_combos';
const PRICING_COLLECTION = 'runtime_pricing_maps';
const PRICING_VERSIONS_COLLECTION = 'runtime_pricing_versions';
const CATALOG_VERSIONS_COLLECTION = 'runtime_catalog_versions';
const CATALOG_JOBS_COLLECTION = 'runtime_catalog_sync_jobs';
const CATALOG_PROVIDERS_COLLECTION = 'runtime_catalog_projection_providers';
const CATALOG_MODELS_COLLECTION = 'runtime_catalog_projection_models';
const CATALOG_RAW_COLLECTION = 'runtime_catalog_raw_documents';
const CATALOG_METADATA_COLLECTION = 'runtime_catalog_metadata';

function scopeFilter(scope: RuntimeProjectScope) {
  return {
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createRuntimeStore(docStore: JsonDocStorePort) {
  async function listScoped<T extends { workspace_id: string; project_id: string }>(
    collection: string,
    scope: RuntimeProjectScope,
  ): Promise<T[]> {
    return docStore.list<T>(collection, scopeFilter(scope));
  }

  return {
    nowIso,
    createId(prefix: string) {
      return `${prefix}_${randomUUID().replace(/-/g, '')}`;
    },
    pricingRecordId(scope: RuntimeProjectScope) {
      return `runtime_pricing_${scope.workspaceId}_${scope.projectId}`;
    },
    pricingVersionId(scopeType: RuntimePricingScopeType, name: string, scope: RuntimeProjectScope) {
      const ws = scopeType === 'global' ? 'global' : scope.workspaceId;
      const prj = scopeType === 'project' ? scope.projectId : 'default';
      return `runtime_pricing_version_${scopeType}_${ws}_${prj}_${name}`;
    },
    listProviders(scope: RuntimeProjectScope) {
      return listScoped<RuntimeProviderConnectionRecord>(PROVIDERS_COLLECTION, scope);
    },
    getProvider(providerConnectionId: string) {
      return docStore.get<RuntimeProviderConnectionRecord>(PROVIDERS_COLLECTION, providerConnectionId);
    },
    upsertProvider(record: RuntimeProviderConnectionRecord) {
      return docStore.upsert(PROVIDERS_COLLECTION, record.id, record);
    },
    deleteProvider(providerConnectionId: string) {
      return docStore.delete(PROVIDERS_COLLECTION, providerConnectionId);
    },
    listModels(scope: RuntimeProjectScope) {
      return listScoped<RuntimeModelCatalogEntryRecord>(MODELS_COLLECTION, scope);
    },
    async findModel(scope: RuntimeProjectScope, provider: string, modelId: string) {
      const items = await listScoped<RuntimeModelCatalogEntryRecord>(MODELS_COLLECTION, scope);
      return items.find((item) => item.provider === provider && item.model_id === modelId);
    },
    upsertModel(record: RuntimeModelCatalogEntryRecord) {
      return docStore.upsert(MODELS_COLLECTION, record.id, record);
    },
    deleteModel(recordId: string) {
      return docStore.delete(MODELS_COLLECTION, recordId);
    },
    listAliases(scope: RuntimeProjectScope) {
      return listScoped<RuntimeModelAliasRecord>(ALIASES_COLLECTION, scope);
    },
    async findAlias(scope: RuntimeProjectScope, alias: string) {
      const items = await listScoped<RuntimeModelAliasRecord>(ALIASES_COLLECTION, scope);
      return items.find((item) => item.alias === alias);
    },
    upsertAlias(record: RuntimeModelAliasRecord) {
      return docStore.upsert(ALIASES_COLLECTION, record.id, record);
    },
    deleteAlias(recordId: string) {
      return docStore.delete(ALIASES_COLLECTION, recordId);
    },
    listCombos(scope: RuntimeProjectScope) {
      return listScoped<RuntimeModelComboRecord>(COMBOS_COLLECTION, scope);
    },
    async findCombo(scope: RuntimeProjectScope, comboName: string) {
      const items = await listScoped<RuntimeModelComboRecord>(COMBOS_COLLECTION, scope);
      return items.find((item) => item.name === comboName);
    },
    upsertCombo(record: RuntimeModelComboRecord) {
      return docStore.upsert(COMBOS_COLLECTION, record.id, record);
    },
    deleteCombo(recordId: string) {
      return docStore.delete(COMBOS_COLLECTION, recordId);
    },
    getPricing(scope: RuntimeProjectScope) {
      return docStore.get<RuntimePricingRecord>(PRICING_COLLECTION, `runtime_pricing_${scope.workspaceId}_${scope.projectId}`);
    },
    upsertPricing(record: RuntimePricingRecord) {
      return docStore.upsert(PRICING_COLLECTION, record.id, record);
    },
    listPricingVersions() {
      return docStore.list<RuntimePricingVersionRecord>(PRICING_VERSIONS_COLLECTION, {});
    },
    getPricingVersion(versionId: string) {
      return docStore.get<RuntimePricingVersionRecord>(PRICING_VERSIONS_COLLECTION, versionId);
    },
    upsertPricingVersion(record: RuntimePricingVersionRecord) {
      return docStore.upsert(PRICING_VERSIONS_COLLECTION, record.id, record);
    },
    async listScopedPricingVersions(scope: RuntimeProjectScope) {
      const records = await docStore.list<RuntimePricingVersionRecord>(PRICING_VERSIONS_COLLECTION, {});
      return records.filter((record) => {
        if (record.scope_type === 'global') return true;
        if (record.scope_type === 'workspace') return record.workspace_id === scope.workspaceId && !record.project_id;
        return record.workspace_id === scope.workspaceId && record.project_id === scope.projectId;
      });
    },
    async resolvePricing(scope: RuntimeProjectScope): Promise<ResolvedRuntimePricing> {
      const versions = await this.listScopedPricingVersions(scope);
      const activeVersions = {
        global: versions.find((item) => item.scope_type === 'global' && item.status === 'active'),
        workspace: versions.find((item) => item.scope_type === 'workspace' && item.status === 'active'),
        project: versions.find((item) => item.scope_type === 'project' && item.status === 'active'),
      };
      const effective = activeVersions.project ?? activeVersions.workspace ?? activeVersions.global;
      if (effective) {
        return {
          pricing_map: effective.pricing_map,
          pricing_version_id: effective.id,
          pricing_version_name: effective.version_name,
          pricing_scope_type: effective.scope_type,
          updated_at: effective.updated_at,
          source: 'versioned',
          active_versions: activeVersions,
        };
      }

      const legacy = await this.getPricing(scope);
      if (legacy) {
        return {
          pricing_map: legacy.pricing_map,
          pricing_version_id: legacy.id,
          pricing_version_name: legacy.id,
          pricing_scope_type: 'project',
          updated_at: legacy.updated_at,
          source: 'legacy',
          active_versions: activeVersions,
        };
      }

      return {
        pricing_map: {},
        pricing_version_id: null,
        pricing_version_name: null,
        pricing_scope_type: null,
        updated_at: null,
        source: 'missing',
        active_versions: activeVersions,
      };
    },
    listCatalogVersions() {
      return docStore.list<RuntimeCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, {});
    },
    getCatalogVersion(versionId: string) {
      return docStore.get<RuntimeCatalogVersionRecord>(CATALOG_VERSIONS_COLLECTION, versionId);
    },
    upsertCatalogVersion(record: RuntimeCatalogVersionRecord) {
      return docStore.upsert(CATALOG_VERSIONS_COLLECTION, record.id, record);
    },
    listCatalogJobs() {
      return docStore.list<RuntimeCatalogSyncJobRecord>(CATALOG_JOBS_COLLECTION, {});
    },
    getCatalogJob(jobId: string) {
      return docStore.get<RuntimeCatalogSyncJobRecord>(CATALOG_JOBS_COLLECTION, jobId);
    },
    upsertCatalogJob(record: RuntimeCatalogSyncJobRecord) {
      return docStore.upsert(CATALOG_JOBS_COLLECTION, record.id, record);
    },
    async setActiveCatalogVersion(versionId: string) {
      const versions = await this.listCatalogVersions();
      const now = nowIso();
      for (const version of versions) {
        const nextStatus: RuntimeCatalogVersionStatus = version.id === versionId ? 'active' : (version.status === 'active' ? 'archived' : version.status);
        const updated: RuntimeCatalogVersionRecord = {
          ...version,
          status: nextStatus,
          activated_at: version.id === versionId ? now : version.activated_at,
        };
        await this.upsertCatalogVersion(updated);
      }
      const metadata = await this.getCatalogMetadata();
      await this.upsertCatalogMetadata({
        id: 'runtime_catalog_metadata',
        active_version_id: versionId,
        latest_successful_sync_at: now,
        initialized_from_seed: metadata?.initialized_from_seed ?? false,
        updated_at: now,
      });
    },
    listCatalogProviders(versionId: string) {
      return docStore.list<RuntimeCatalogProviderProjectionRecord>(CATALOG_PROVIDERS_COLLECTION, {
        version_id: versionId,
      });
    },
    listCatalogModels(versionId: string) {
      return docStore.list<RuntimeCatalogModelProjectionRecord>(CATALOG_MODELS_COLLECTION, {
        version_id: versionId,
      });
    },
    upsertCatalogProvider(record: RuntimeCatalogProviderProjectionRecord) {
      return docStore.upsert(CATALOG_PROVIDERS_COLLECTION, record.id, record);
    },
    upsertCatalogModel(record: RuntimeCatalogModelProjectionRecord) {
      return docStore.upsert(CATALOG_MODELS_COLLECTION, record.id, record);
    },
    upsertCatalogRawDocument(record: RuntimeCatalogRawDocumentRecord) {
      return docStore.upsert(CATALOG_RAW_COLLECTION, record.id, record);
    },
    async clearCatalogVersionData(versionId: string) {
      const providers = await this.listCatalogProviders(versionId);
      const models = await this.listCatalogModels(versionId);
      for (const provider of providers) {
        await docStore.delete(CATALOG_PROVIDERS_COLLECTION, provider.id);
      }
      for (const model of models) {
        await docStore.delete(CATALOG_MODELS_COLLECTION, model.id);
      }
    },
    getCatalogMetadata() {
      return docStore.get<RuntimeCatalogMetadataRecord>(CATALOG_METADATA_COLLECTION, 'runtime_catalog_metadata');
    },
    upsertCatalogMetadata(record: RuntimeCatalogMetadataRecord) {
      return docStore.upsert(CATALOG_METADATA_COLLECTION, record.id, record);
    },
    async getActiveCatalogVersion() {
      const metadata = await this.getCatalogMetadata();
      if (metadata?.active_version_id) {
        return this.getCatalogVersion(metadata.active_version_id);
      }
      const versions = await this.listCatalogVersions();
      return versions.find((item) => item.status === 'active') ?? null;
    },
    async isCatalogEmpty() {
      const versions = await this.listCatalogVersions();
      return versions.length === 0;
    },
  };
}
