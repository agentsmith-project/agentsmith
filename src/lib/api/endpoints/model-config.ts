import type { ApiClient } from '../client';
import type { ErrorResponse } from '../types';

export type ProjectPricingMap = Record<string, Record<string, Record<string, number>>>;

export interface ModelRequestTrace {
  index: number;
  provider: string;
  model: string;
  outcome: string;
  statusCode?: number;
  errorClass?: string;
  reason: string;
  durationMs?: number;
}

export interface ModelRequestDetails {
  provider?: string;
  resolved_model?: string;
  fallback_hops?: number;
  pricing_source?: string | null;
  estimated_cost?: number | null;
  attempts?: ModelRequestTrace[];
}

export interface ModelRequestPayload {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream?: boolean;
}

export interface ModelRequestResponse {
  id: string;
  object: string;
  model?: string;
  choices: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  request_details?: ModelRequestDetails;
}

export interface ModelRequestErrorResponse extends Partial<ErrorResponse> {
  error_code: string;
  message: string;
  request_details?: ModelRequestDetails;
}

export interface ModelRequestExecutionResult {
  ok: boolean;
  statusCode: number;
  data: ModelRequestResponse | ModelRequestErrorResponse;
}

export interface ModelCatalogVersion {
  version?: string;
  id?: string;
  source?: string;
  source_etag?: string;
  source_hash?: string;
  schema_kind?: 'models.dev.raw' | 'models.dev.normalized';
  provider_count: number;
  model_count: number;
  status?: 'staged' | 'active' | 'archived' | 'failed';
  created_by?: string;
  created_at?: string;
  activated_at?: string;
  synced_at?: string;
}

export interface ModelCatalogProvider {
  id?: string;
  version_id?: string;
  provider_key?: string;
  provider_id?: string;
  provider: string;
  family: string;
  label?: string;
  name?: string;
  api?: string;
  doc?: string;
  npm?: string;
  env?: string[];
  model_count?: number;
  default_base_url: string;
  upstream_protocol: 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';
}

export interface ModelCatalogModel {
  id?: string;
  version_id?: string;
  provider_key?: string;
  provider_id?: string;
  provider_name?: string;
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
}

export class ModelConfigAPI {
  constructor(private client: ApiClient) {}

  async getProjectPricing(workspaceId: string, projectId: string): Promise<ProjectPricingMap> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/project-pricing`);
  }

  async patchProjectPricing(workspaceId: string, projectId: string, payload: ProjectPricingMap): Promise<ProjectPricingMap> {
    return this.client.patch(`/workspaces/${workspaceId}/projects/${projectId}/project-pricing`, payload);
  }

  async listModelCatalogProviders(
    workspaceId: string,
    projectId: string,
  ): Promise<{ version: ModelCatalogVersion; items: ModelCatalogProvider[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/model-catalog/providers`);
  }

  async listModelCatalogModels(
    workspaceId: string,
    projectId: string,
    params?: { provider?: string; capability?: string; q?: string },
  ): Promise<{ version: ModelCatalogVersion; items: ModelCatalogModel[]; total: number }> {
    const search = new URLSearchParams();
    if (params?.provider) search.set('provider', params.provider);
    if (params?.capability) search.set('capability', params.capability);
    if (params?.q) search.set('q', params.q);
    const suffix = search.toString();
    return this.client.get(
      `/workspaces/${workspaceId}/projects/${projectId}/model-catalog/models${suffix ? `?${suffix}` : ''}`,
    );
  }

  async syncModelCatalog(workspaceId: string, projectId: string): Promise<{ version: ModelCatalogVersion }> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/model-catalog/sync`, {});
  }
}
