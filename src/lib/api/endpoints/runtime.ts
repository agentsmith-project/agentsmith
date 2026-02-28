import type { ApiClient } from '../client';

export type RuntimeAuthMode = 'api_key' | 'oauth' | 'aws_sdk' | 'token';

export interface RuntimeProviderConnection {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: string;
  auth_mode: RuntimeAuthMode;
  base_url: string;
  credential_ref?: string;
  priority?: number;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface CreateRuntimeProviderConnectionRequest {
  provider: string;
  auth_mode: RuntimeAuthMode;
  base_url: string;
  credential_ref?: string;
  priority?: number;
  status?: 'active' | 'disabled';
}

export interface UpdateRuntimeProviderConnectionRequest {
  base_url?: string;
  credential_ref?: string;
  priority?: number;
  status?: 'active' | 'disabled';
}

export interface RuntimeModelCatalogEntry {
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
}

export interface CreateRuntimeModelCatalogEntryRequest {
  provider: string;
  model_id: string;
  display_name?: string;
  capabilities: string[];
  context_window?: number;
  max_tokens?: number;
  pricing?: Record<string, number>;
}

export interface UpdateRuntimeModelCatalogEntryRequest {
  provider?: string;
  display_name?: string;
  capabilities?: string[];
  context_window?: number;
  max_tokens?: number;
  pricing?: Record<string, number>;
}

export interface RuntimeModelAlias {
  id: string;
  workspace_id: string;
  project_id: string;
  alias: string;
  target_provider: string;
  target_model: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRuntimeModelAliasRequest {
  alias: string;
  target_provider: string;
  target_model: string;
}

export interface UpdateRuntimeModelAliasRequest {
  target_provider?: string;
  target_model?: string;
}

export interface RuntimeModelComboTarget {
  provider: string;
  model: string;
}

export type RuntimeAttemptOutcome =
  | 'provider_connection_missing'
  | 'credential_ref_missing'
  | 'credential_secret_missing'
  | 'fallback_network_error'
  | 'terminal_network_error'
  | 'fallback_upstream_error'
  | 'terminal_upstream_error'
  | 'success';

export interface RuntimeAttemptTrace {
  index: number;
  provider: string;
  model: string;
  providerConnectionId?: string;
  outcome: RuntimeAttemptOutcome;
  statusCode?: number;
  errorClass?: string;
  reason: string;
  durationMs?: number;
}

export interface UnifiedChatRuntimeMetadata {
  provider?: string;
  resolved_model?: string;
  fallback_hops?: number;
  estimated_cost?: number | null;
  attempts?: RuntimeAttemptTrace[];
}

export interface RuntimeModelCombo {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  targets: RuntimeModelComboTarget[];
  fallback_policy: {
    max_hops: number;
    retryable_error_classes: string[];
  };
  created_at: string;
  updated_at: string;
}

export interface CreateRuntimeModelComboRequest {
  name: string;
  targets: RuntimeModelComboTarget[];
  fallback_policy: {
    max_hops: number;
    retryable_error_classes: string[];
  };
}

export interface UpdateRuntimeModelComboRequest {
  targets?: RuntimeModelComboTarget[];
  fallback_policy?: {
    max_hops: number;
    retryable_error_classes: string[];
  };
}

export type RuntimePricingMap = Record<string, Record<string, Record<string, number>>>;

export class RuntimeAPI {
  constructor(private client: ApiClient) {}

  async listProviders(workspaceId: string, projectId: string): Promise<{ items: RuntimeProviderConnection[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers`);
  }

  async createProvider(
    workspaceId: string,
    projectId: string,
    payload: CreateRuntimeProviderConnectionRequest,
  ): Promise<RuntimeProviderConnection> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers`, payload);
  }

  async updateProvider(
    workspaceId: string,
    projectId: string,
    providerConnectionId: string,
    payload: UpdateRuntimeProviderConnectionRequest,
  ): Promise<RuntimeProviderConnection> {
    return this.client.put(
      `/workspaces/${workspaceId}/projects/${projectId}/runtime/providers/${providerConnectionId}`,
      payload,
    );
  }

  async deleteProvider(workspaceId: string, projectId: string, providerConnectionId: string): Promise<void> {
    return this.client.delete(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers/${providerConnectionId}`);
  }

  async listModels(workspaceId: string, projectId: string): Promise<{ items: RuntimeModelCatalogEntry[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/models`);
  }

  async createModel(
    workspaceId: string,
    projectId: string,
    payload: CreateRuntimeModelCatalogEntryRequest,
  ): Promise<RuntimeModelCatalogEntry> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/models`, payload);
  }

  async getModel(workspaceId: string, projectId: string, provider: string, modelId: string): Promise<RuntimeModelCatalogEntry> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers/${provider}/models/${modelId}`);
  }

  async updateModel(
    workspaceId: string,
    projectId: string,
    provider: string,
    modelId: string,
    payload: UpdateRuntimeModelCatalogEntryRequest,
  ): Promise<RuntimeModelCatalogEntry> {
    return this.client.put(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers/${provider}/models/${modelId}`, payload);
  }

  async deleteModel(workspaceId: string, projectId: string, provider: string, modelId: string): Promise<void> {
    return this.client.delete(`/workspaces/${workspaceId}/projects/${projectId}/runtime/providers/${provider}/models/${modelId}`);
  }

  async listAliases(workspaceId: string, projectId: string): Promise<{ items: RuntimeModelAlias[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases`);
  }

  async createAlias(
    workspaceId: string,
    projectId: string,
    payload: CreateRuntimeModelAliasRequest,
  ): Promise<RuntimeModelAlias> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases`, payload);
  }

  async getAlias(workspaceId: string, projectId: string, alias: string): Promise<RuntimeModelAlias> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases/${alias}`);
  }

  async updateAlias(
    workspaceId: string,
    projectId: string,
    alias: string,
    payload: UpdateRuntimeModelAliasRequest,
  ): Promise<RuntimeModelAlias> {
    return this.client.put(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases/${alias}`, payload);
  }

  async deleteAlias(workspaceId: string, projectId: string, alias: string): Promise<void> {
    return this.client.delete(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases/${alias}`);
  }

  async listCombos(workspaceId: string, projectId: string): Promise<{ items: RuntimeModelCombo[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos`);
  }

  async createCombo(
    workspaceId: string,
    projectId: string,
    payload: CreateRuntimeModelComboRequest,
  ): Promise<RuntimeModelCombo> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos`, payload);
  }

  async getCombo(workspaceId: string, projectId: string, combo: string): Promise<RuntimeModelCombo> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos/${combo}`);
  }

  async updateCombo(
    workspaceId: string,
    projectId: string,
    combo: string,
    payload: UpdateRuntimeModelComboRequest,
  ): Promise<RuntimeModelCombo> {
    return this.client.put(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos/${combo}`, payload);
  }

  async deleteCombo(workspaceId: string, projectId: string, combo: string): Promise<void> {
    return this.client.delete(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos/${combo}`);
  }

  async getPricing(workspaceId: string, projectId: string): Promise<RuntimePricingMap> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`);
  }

  async patchPricing(workspaceId: string, projectId: string, payload: RuntimePricingMap): Promise<RuntimePricingMap> {
    return this.client.patch(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`, payload);
  }
}
