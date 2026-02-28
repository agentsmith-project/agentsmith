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

export type RuntimeModelAliasRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  alias: string;
  target_provider: string;
  target_model: string;
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
  };
}
