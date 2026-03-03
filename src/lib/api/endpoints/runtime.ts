import type { ApiClient } from '../client';
import { API_BASE } from '../client';
import type { ErrorResponse } from '../types';

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
  release?: RuntimeRouteRelease;
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
  pricing_version?: string | null;
  estimated_cost?: number | null;
  attempts?: RuntimeAttemptTrace[];
}

export interface RuntimeUnifiedChatRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream?: boolean;
}

export interface RuntimeRoutingDryRunRequest {
  model: string;
}

export interface RuntimeRoutingDryRunAttempt {
  index: number;
  provider: string;
  model: string;
  provider_connection_id?: string;
  provider_connection_status: 'active' | 'disabled' | 'missing';
  provider_connection_has_credential?: boolean;
  connection_priority?: number;
  connection_base_url?: string;
  pricing_source: 'project_override' | 'workspace_default' | 'global_default' | 'model_catalog' | 'missing';
  pricing?: Record<string, number>;
}

export interface RuntimeReleaseGuardrails {
  release_readiness: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
}

export interface RuntimeRoutingDryRunResponse {
  model: string;
  routed_by: 'direct' | 'alias' | 'combo';
  alias?: string;
  combo_name?: string;
  fallback_policy?: {
    max_hops: number;
    retryable_error_classes: string[];
  };
  attempts: RuntimeRoutingDryRunAttempt[];
  issues: string[];
  guardrails: RuntimeReleaseGuardrails;
}

export interface RuntimeImpactPreviewRequest {
  model: string;
  lookback_hours?: number;
  resource_id?: string;
}

export interface RuntimeImpactPreviewResponse {
  model: string;
  lookback_window: {
    start: string;
    end: string;
    lookback_hours: number;
  };
  sample: {
    request_count: number;
    total_estimated_cost: number;
    avg_estimated_cost: number | null;
    avg_tokens_in: number | null;
    avg_tokens_out: number | null;
    avg_tokens_total: number | null;
  };
  planned_route: RuntimeRoutingDryRunResponse;
  projected_cost: {
    primary_avg_cost: number | null;
    primary_total_cost: number | null;
    range_avg_cost: {
      low: number | null;
      high: number | null;
    };
    range_total_cost: {
      low: number | null;
      high: number | null;
    };
  };
  assumptions: string[];
  guardrails: RuntimeReleaseGuardrails;
}

export interface RuntimeUnifiedChatResponse {
  id: string;
  object: string;
  model?: string;
  choices: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  runtime?: UnifiedChatRuntimeMetadata;
}

export interface RuntimeUnifiedChatErrorResponse extends Partial<ErrorResponse> {
  error_code: string;
  message: string;
  runtime?: UnifiedChatRuntimeMetadata;
}

export interface RuntimeUnifiedChatResult {
  ok: boolean;
  statusCode: number;
  data: RuntimeUnifiedChatResponse | RuntimeUnifiedChatErrorResponse;
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
  release?: RuntimeRouteRelease;
  created_at: string;
  updated_at: string;
}

export type RuntimeRouteReleaseStatus = 'draft' | 'published' | 'archived';
export type RuntimeRouteRolloutMode = 'full' | 'canary';

export interface RuntimeRouteApprovalChecklist {
  owner_verified: boolean;
  observability_verified: boolean;
  rollback_verified: boolean;
}

export interface RuntimeRouteRolloutPolicy {
  mode: RuntimeRouteRolloutMode;
  canary_percent?: number;
}

export interface RuntimeRouteRelease {
  status: RuntimeRouteReleaseStatus;
  approval_checklist?: RuntimeRouteApprovalChecklist;
  rollout_policy?: RuntimeRouteRolloutPolicy;
  published_at?: string;
  archived_at?: string;
}

export interface PublishRuntimeRouteRequest {
  approval_checklist: RuntimeRouteApprovalChecklist;
  rollout_policy: RuntimeRouteRolloutPolicy;
}

export interface PublishRuntimeAliasResponse {
  item: RuntimeModelAlias;
  guardrails: RuntimeReleaseGuardrails;
}

export interface PublishRuntimeComboResponse {
  item: RuntimeModelCombo;
  guardrails: RuntimeReleaseGuardrails;
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
export type RuntimePricingScopeType = 'global' | 'workspace' | 'project';
export type RuntimePricingVersionStatus = 'draft' | 'active' | 'archived';

export interface RuntimePricingVersion {
  id: string;
  scope_type: RuntimePricingScopeType;
  workspace_id?: string;
  project_id?: string;
  version_name: string;
  description?: string;
  pricing_map: RuntimePricingMap;
  status: RuntimePricingVersionStatus;
  created_at: string;
  updated_at: string;
  activated_at?: string;
}

export interface CreateRuntimePricingVersionRequest {
  scope_type: RuntimePricingScopeType;
  version_name: string;
  description?: string;
  pricing_map: RuntimePricingMap;
  activate?: boolean;
}

export interface RuntimePricingVersionsResponse {
  items: RuntimePricingVersion[];
  active_versions: {
    global?: string | null;
    workspace?: string | null;
    project?: string | null;
  };
  effective_version?: {
    id: string;
    version_name: string;
    scope_type?: RuntimePricingScopeType | null;
  } | null;
}

export interface RuntimePricingActivationReadiness {
  release_readiness: 'ready' | 'blocked';
  missing_targets: Array<{ provider: string; model: string }>;
  blockers: string[];
}

export interface RuntimePricingActivationResponse {
  version: RuntimePricingVersion;
  readiness: RuntimePricingActivationReadiness;
}

export interface RuntimePricingCompareResponse {
  baseline_version: {
    id: string;
    version_name: string;
    scope_type: RuntimePricingScopeType;
  };
  candidate_version: {
    id: string;
    version_name: string;
    scope_type: RuntimePricingScopeType;
  };
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  items: Array<{
    provider: string;
    model: string;
    change_type: 'added' | 'removed' | 'changed' | 'unchanged';
    baseline: Record<string, number> | null;
    candidate: Record<string, number> | null;
  }>;
}

export interface RuntimeCatalogVersion {
  id: string;
  source: string;
  source_etag?: string;
  source_hash: string;
  schema_kind: 'models.dev.raw' | 'models.dev.normalized';
  provider_count: number;
  model_count: number;
  status: 'staged' | 'active' | 'archived' | 'failed';
  created_by: string;
  created_at: string;
  activated_at?: string;
}

export interface RuntimeCatalogProvider {
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
}

export interface RuntimeCatalogModel {
  id: string;
  version_id: string;
  provider_key: string;
  provider_id: string;
  provider_name: string;
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

export interface RuntimeCatalogSyncJob {
  id: string;
  source: string;
  trigger: 'manual' | 'bootstrap';
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at?: string;
  version_id?: string;
  error_message?: string;
}

export interface RuntimeCatalogStatusResponse {
  initialized: boolean;
  active_version: RuntimeCatalogVersion | null;
  provider_count: number;
  model_count: number;
  last_job: RuntimeCatalogSyncJob | null;
}

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

  async publishAlias(
    workspaceId: string,
    projectId: string,
    alias: string,
    payload: PublishRuntimeRouteRequest,
  ): Promise<PublishRuntimeAliasResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/aliases/${alias}/publish`, payload);
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

  async publishCombo(
    workspaceId: string,
    projectId: string,
    combo: string,
    payload: PublishRuntimeRouteRequest,
  ): Promise<PublishRuntimeComboResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/combos/${combo}/publish`, payload);
  }

  async getPricing(workspaceId: string, projectId: string): Promise<RuntimePricingMap> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`);
  }

  async patchPricing(workspaceId: string, projectId: string, payload: RuntimePricingMap): Promise<RuntimePricingMap> {
    return this.client.patch(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing`, payload);
  }

  async listPricingVersions(workspaceId: string, projectId: string): Promise<RuntimePricingVersionsResponse> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing/versions`);
  }

  async createPricingVersion(
    workspaceId: string,
    projectId: string,
    payload: CreateRuntimePricingVersionRequest,
  ): Promise<RuntimePricingVersion> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing/versions`, payload);
  }

  async activatePricingVersion(
    workspaceId: string,
    projectId: string,
    versionId: string,
  ): Promise<RuntimePricingActivationResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing/versions/${versionId}/activate`, {});
  }

  async comparePricingVersions(
    workspaceId: string,
    projectId: string,
    payload: { baseline_version_id: string; candidate_version_id: string },
  ): Promise<RuntimePricingCompareResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/pricing/compare`, payload);
  }

  async getCatalogStatus(workspaceId: string, projectId: string): Promise<RuntimeCatalogStatusResponse> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/catalog/status`);
  }

  async listCatalogProviders(
    workspaceId: string,
    projectId: string,
  ): Promise<{ version: RuntimeCatalogVersion; items: RuntimeCatalogProvider[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/catalog/providers`);
  }

  async listCatalogModels(
    workspaceId: string,
    projectId: string,
    params?: { provider?: string; capability?: string; q?: string },
  ): Promise<{ version: RuntimeCatalogVersion; items: RuntimeCatalogModel[]; total: number }> {
    const search = new URLSearchParams();
    if (params?.provider) search.set('provider', params.provider);
    if (params?.capability) search.set('capability', params.capability);
    if (params?.q) search.set('q', params.q);
    const suffix = search.toString();
    return this.client.get(
      `/workspaces/${workspaceId}/projects/${projectId}/runtime/catalog/models${suffix ? `?${suffix}` : ''}`,
    );
  }

  async listCatalogJobs(workspaceId: string, projectId: string): Promise<{ items: RuntimeCatalogSyncJob[] }> {
    return this.client.get(`/workspaces/${workspaceId}/projects/${projectId}/runtime/catalog/jobs`);
  }

  async syncCatalog(workspaceId: string, projectId: string): Promise<{ version: RuntimeCatalogVersion }> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/catalog/sync`, {});
  }

  async dryRunRouting(
    workspaceId: string,
    projectId: string,
    payload: RuntimeRoutingDryRunRequest,
  ): Promise<RuntimeRoutingDryRunResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/routing/dry-run`, payload);
  }

  async previewImpact(
    workspaceId: string,
    projectId: string,
    payload: RuntimeImpactPreviewRequest,
  ): Promise<RuntimeImpactPreviewResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/runtime/impact-preview`, payload);
  }

  async probeUnifiedChat(
    workspaceId: string,
    projectId: string,
    payload: RuntimeUnifiedChatRequest,
  ): Promise<RuntimeUnifiedChatResult> {
    const token = this.client.getToken();
    const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/llm/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data: RuntimeUnifiedChatResponse | RuntimeUnifiedChatErrorResponse;
    try {
      data = JSON.parse(text) as RuntimeUnifiedChatResponse | RuntimeUnifiedChatErrorResponse;
    } catch {
      data = {
        error_code: response.ok ? 'INVALID_RESPONSE' : 'UNKNOWN_ERROR',
        message: text || `HTTP ${response.status}`,
      };
    }

    return {
      ok: response.ok,
      statusCode: response.status,
      data,
    };
  }
}
