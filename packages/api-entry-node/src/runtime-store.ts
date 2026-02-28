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

const PROVIDERS_COLLECTION = 'runtime_provider_connections';
const MODELS_COLLECTION = 'runtime_model_catalog_entries';
const ALIASES_COLLECTION = 'runtime_model_aliases';
const COMBOS_COLLECTION = 'runtime_model_combos';
const PRICING_COLLECTION = 'runtime_pricing_maps';

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
  };
}
