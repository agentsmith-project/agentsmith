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

export interface RuntimeModelComboTarget {
  provider: string;
  model: string;
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

  async getPricing(workspaceId: string, projectId: string): Promise<RuntimePricingMap> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`);
  }

  async patchPricing(workspaceId: string, projectId: string, payload: RuntimePricingMap): Promise<RuntimePricingMap> {
    return this.client.patch(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`, payload);
  }
}
