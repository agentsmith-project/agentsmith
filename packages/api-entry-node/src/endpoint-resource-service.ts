import { createHash } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type {
  CredentialRecord,
  CredentialSecretRecord,
  EndpointCapability,
  EndpointCapabilityType,
  EndpointDefaults,
  EndpointBulkImportItem,
  EndpointBulkImportPayload,
  EndpointModelBinding,
  EndpointModelProfile,
  EndpointRecord,
} from './resource-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

export class EndpointResourceService {
  private static readonly credentialsCollection = 'credentials';
  private static readonly credentialSecretsCollection = 'credential_secrets';
  private static readonly endpointsCollection = 'endpoints';

  constructor(private readonly docStore: JsonDocStorePort) {}

  private credentialsCollection(workspaceId: string): string {
    return resolveWorkspaceScopedCollection(EndpointResourceService.credentialsCollection, workspaceId);
  }

  private credentialSecretsCollection(workspaceId: string): string {
    return resolveWorkspaceScopedCollection(EndpointResourceService.credentialSecretsCollection, workspaceId);
  }

  private endpointsCollection(workspaceId: string): string {
    return resolveWorkspaceScopedCollection(EndpointResourceService.endpointsCollection, workspaceId);
  }

  private hashFingerprint(secret: string): string {
    return createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const cleaned = baseUrl.trim().replace(/\/+$/, '');
    return cleaned
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/messages$/i, '')
      .replace(/\/embeddings$/i, '')
      .replace(/\/rerank$/i, '')
      .replace(/\/images\/generations$/i, '')
      .replace(/\/videos\/generations(?:\/[^/]+(?:\/cancel)?)?$/i, '');
  }

  private endpointId(): string {
    return `ep_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private credentialId(): string {
    return `cred_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private dedupeCapabilities(capabilities: EndpointCapability[]): EndpointCapability[] {
    const unique = new Map<EndpointCapabilityType, EndpointCapability>();
    for (const capability of capabilities) {
      unique.set(capability.type, capability);
    }
    return [...unique.values()];
  }

  private dedupeModels(models: EndpointModelBinding[]): EndpointModelBinding[] {
    const unique = new Map<string, EndpointModelBinding>();
    for (const model of models) {
      unique.set(`${model.capability}:${model.model_id}`, model);
    }
    return [...unique.values()];
  }

  private buildDefaults(models: EndpointModelBinding[], current?: EndpointDefaults): EndpointDefaults | undefined {
    const defaults: EndpointDefaults = { ...(current ?? {}) };
    for (const model of models) {
      if (model.capability === 'chat_completion' && !defaults.chat_model_id) defaults.chat_model_id = model.model_id;
      if (model.capability === 'multimodal_completion' && !defaults.multimodal_model_id) {
        defaults.multimodal_model_id = model.model_id;
      }
      if (model.capability === 'embedding' && !defaults.embedding_model_id) defaults.embedding_model_id = model.model_id;
      if (model.capability === 'rerank' && !defaults.rerank_model_id) defaults.rerank_model_id = model.model_id;
      if (model.capability === 'image_generation' && !defaults.image_model_id) defaults.image_model_id = model.model_id;
      if (model.capability === 'video_generation' && !defaults.video_model_id) defaults.video_model_id = model.model_id;
    }
    return Object.keys(defaults).length > 0 ? defaults : undefined;
  }

  private inferUpstreamProtocol(
    baseUrl: string,
    fallback: EndpointRecord['upstream_protocol'] | undefined,
  ): EndpointRecord['upstream_protocol'] {
    if (fallback) return fallback;
    if (baseUrl.includes('/responses')) return 'openai_responses';
    if (baseUrl.includes('/anthropic') || /api\\.anthropic\\.com/i.test(baseUrl)) return 'anthropic_messages';
    return 'openai_chat_completions';
  }

  private inferProviderFamily(
    upstreamProtocol: EndpointRecord['upstream_protocol'],
    fallback: EndpointRecord['provider_family'],
  ): EndpointRecord['provider_family'] {
    if (fallback) return fallback;
    if (upstreamProtocol === 'anthropic_messages') return 'anthropic';
    return 'custom';
  }

  private normalizeModelProfile(
    profile: EndpointModelProfile | undefined,
    fallback?: EndpointModelProfile,
  ): EndpointModelProfile | undefined {
    const source = profile ?? fallback;
    if (!source) return undefined;
    const clampRatio = (value: number | undefined, defaultValue = 0): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
      if (value < 0) return 0;
      if (value > 1) return 1;
      return value;
    };
    const asPositiveInt = (value: number | undefined, defaultValue: number): number => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return defaultValue;
      return Math.floor(value);
    };
    const asNonNegative = (value: number | undefined, defaultValue = 0): number => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return defaultValue;
      return value;
    };
    return {
      max_context_tokens: asPositiveInt(source.max_context_tokens, fallback?.max_context_tokens ?? 128000),
      max_output_tokens: asPositiveInt(source.max_output_tokens, fallback?.max_output_tokens ?? 8192),
      supports_file: source.supports_file ?? fallback?.supports_file ?? false,
      supports_tool_call: source.supports_tool_call ?? fallback?.supports_tool_call ?? true,
      supports_reasoning: source.supports_reasoning ?? fallback?.supports_reasoning ?? false,
      price_input_per_1m: asNonNegative(source.price_input_per_1m, fallback?.price_input_per_1m ?? 0),
      price_output_per_1m: asNonNegative(source.price_output_per_1m, fallback?.price_output_per_1m ?? 0),
      cache_read_discount_ratio: clampRatio(
        source.cache_read_discount_ratio,
        fallback?.cache_read_discount_ratio ?? 0,
      ),
      cache_write_discount_ratio: source.cache_write_discount_ratio === undefined
        ? fallback?.cache_write_discount_ratio
        : asNonNegative(source.cache_write_discount_ratio, fallback?.cache_write_discount_ratio ?? 0),
    };
  }

  private defaultModelProfileForEndpoint(input: Partial<EndpointRecord>): EndpointModelProfile | undefined {
    const isCustom = input.type === 'custom';
    if (!isCustom) return undefined;
    return {
      max_context_tokens: 128000,
      max_output_tokens: 8192,
      supports_file: false,
      supports_tool_call: true,
      supports_reasoning: false,
      price_input_per_1m: 0,
      price_output_per_1m: 0,
      cache_read_discount_ratio: 0,
      cache_write_discount_ratio: 0,
    };
  }

  private normalizeEndpointFields(input: Partial<EndpointRecord>, fallbackOpenAIModel?: string): {
    model: string;
    capabilities: EndpointCapability[] | undefined;
    models: EndpointModelBinding[] | undefined;
    defaults: EndpointDefaults | undefined;
  } {
    const normalizedModels = this.dedupeModels(
      (input.models ?? []).filter((item) => item.model_id?.trim()).map((item) => ({
        ...item,
        model_id: item.model_id.trim(),
      })),
    );
    const normalizedCapabilities = this.dedupeCapabilities(
      (input.capabilities ?? []).map((item) => ({
        type: item.type,
        enabled: item.enabled !== false,
        default_model_id: item.default_model_id?.trim() || undefined,
      })),
    );

    const directModel = String(input.model ?? fallbackOpenAIModel ?? '').trim();
    const chatModel = normalizedModels.find((item) => item.capability === 'chat_completion')?.model_id;
    const multimodalModel = normalizedModels.find(
      (item) => item.capability === 'multimodal_completion',
    )?.model_id;
    const primaryModel = chatModel ?? multimodalModel ?? directModel;
    const defaults = this.buildDefaults(normalizedModels, input.defaults);

    if (normalizedCapabilities.length === 0 && primaryModel) {
      normalizedCapabilities.push({
        type: chatModel ? 'chat_completion' : multimodalModel ? 'multimodal_completion' : 'chat_completion',
        enabled: true,
        default_model_id: primaryModel,
      });
    }
    if (normalizedModels.length === 0 && primaryModel) {
      normalizedModels.push({
        capability: chatModel ? 'chat_completion' : multimodalModel ? 'multimodal_completion' : 'chat_completion',
        model_id: primaryModel,
        display_name: primaryModel,
      });
    }

    return {
      model: primaryModel,
      capabilities: normalizedCapabilities.length > 0 ? normalizedCapabilities : undefined,
      models: normalizedModels.length > 0 ? normalizedModels : undefined,
      defaults,
    };
  }

  async listCredentials(workspaceId: string, projectId: string): Promise<CredentialRecord[]> {
    return this.docStore.list<CredentialRecord>(this.credentialsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async createCredential(
    workspaceId: string,
    projectId: string,
    input: { name: string; value: string; type?: 'api_key' },
  ): Promise<CredentialRecord> {
    const id = this.credentialId();
    const now = new Date().toISOString();
    const credential: CredentialRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      name: input.name.trim(),
      type: 'api_key',
      fingerprint: this.hashFingerprint(input.value),
      created_at: now,
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      value: input.value,
      updated_at: now,
    };
    await this.docStore.upsert(this.credentialsCollection(workspaceId), id, credential);
    await this.docStore.upsert(this.credentialSecretsCollection(workspaceId), id, secret);
    return credential;
  }

  async rotateCredential(
    workspaceId: string,
    projectId: string,
    credentialId: string,
    value: string,
  ): Promise<CredentialRecord | null> {
    const credential = await this.docStore.get<CredentialRecord>(
      this.credentialsCollection(workspaceId),
      credentialId,
    );
    if (!credential) {
      return null;
    }
    if (credential.workspace_id !== workspaceId || credential.project_id !== projectId) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: CredentialRecord = {
      ...credential,
      fingerprint: this.hashFingerprint(value),
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id: credentialId,
      workspace_id: workspaceId,
      project_id: projectId,
      value,
      updated_at: now,
    };
    await this.docStore.upsert(this.credentialsCollection(workspaceId), credentialId, updated);
    await this.docStore.upsert(this.credentialSecretsCollection(workspaceId), credentialId, secret);
    return updated;
  }

  async deleteCredential(workspaceId: string, projectId: string, credentialId: string): Promise<boolean> {
    const existing = await this.docStore.get<CredentialRecord>(
      this.credentialsCollection(workspaceId),
      credentialId,
    );
    if (!existing) {
      return false;
    }
    if (existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      return false;
    }
    await this.docStore.delete(this.credentialsCollection(workspaceId), credentialId);
    await this.docStore.delete(this.credentialSecretsCollection(workspaceId), credentialId);
    return true;
  }

  async getCredentialSecret(
    workspaceId: string,
    projectId: string,
    credentialId: string,
  ): Promise<string | null> {
    const secret = await this.docStore.get<CredentialSecretRecord>(
      this.credentialSecretsCollection(workspaceId),
      credentialId,
    );
    if (!secret) {
      return null;
    }
    if (secret.workspace_id !== workspaceId || secret.project_id !== projectId) {
      return null;
    }
    return secret.value;
  }

  async listEndpoints(workspaceId: string, projectId: string): Promise<EndpointRecord[]> {
    const endpoints = await this.docStore.list<EndpointRecord>(this.endpointsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return endpoints;
  }

  async getEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
  ): Promise<EndpointRecord | null> {
    const endpoint = await this.docStore.get<EndpointRecord>(
      this.endpointsCollection(workspaceId),
      endpointId,
    );
    if (!endpoint) {
      return null;
    }
    if (endpoint.workspace_id !== workspaceId || endpoint.project_id !== projectId) {
      return null;
    }
    return endpoint;
  }

  async createEndpoint(
    workspaceId: string,
    projectId: string,
    input: Partial<EndpointRecord>,
  ): Promise<EndpointRecord> {
    const normalized = this.normalizeEndpointFields(input);
    if (!normalized.model) {
      throw new Error('endpoint_model_required');
    }
    const now = new Date().toISOString();
    const upstreamProtocol = this.inferUpstreamProtocol(
      String(input.base_url ?? ''),
      input.upstream_protocol,
    );
    const endpoint: EndpointRecord = {
      id: this.endpointId(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: String(input.name ?? '').trim(),
      description: input.description?.trim() || undefined,
      model: normalized.model,
      type: (input.type as EndpointRecord['type']) ?? 'catalog',
      mode: input.mode,
      base_url: this.normalizeBaseUrl(String(input.base_url ?? '')),
      status: (input.status as EndpointRecord['status']) ?? 'active',
      credential_ref: input.credential_ref?.trim() || undefined,
      upstream_protocol: upstreamProtocol,
      provider_family: this.inferProviderFamily(upstreamProtocol, input.provider_family),
      capabilities: normalized.capabilities,
      models: normalized.models,
      defaults: normalized.defaults,
      health: input.health ?? { status: 'unknown' },
      meta: input.meta,
      model_profile: this.normalizeModelProfile(
        input.model_profile,
        this.defaultModelProfileForEndpoint(input),
      ),
      limits: input.limits,
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(this.endpointsCollection(workspaceId), endpoint.id, endpoint);
    return endpoint;
  }

  async updateEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    patch: Partial<EndpointRecord>,
  ): Promise<EndpointRecord | null> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return null;
    }
    const normalized = this.normalizeEndpointFields(
      {
        ...existing,
        ...patch,
      },
      existing.model,
    );
    const upstreamProtocol = this.inferUpstreamProtocol(
      patch.base_url !== undefined ? this.normalizeBaseUrl(String(patch.base_url)) : existing.base_url,
      patch.upstream_protocol ?? existing.upstream_protocol,
    );
    const updated: EndpointRecord = {
      ...existing,
      ...patch,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      model: normalized.model,
      base_url:
        patch.base_url !== undefined
          ? this.normalizeBaseUrl(String(patch.base_url))
          : existing.base_url,
      upstream_protocol: upstreamProtocol,
      provider_family: this.inferProviderFamily(upstreamProtocol, patch.provider_family ?? existing.provider_family),
      capabilities: normalized.capabilities,
      models: normalized.models,
      defaults: normalized.defaults,
      model_profile: this.normalizeModelProfile(
        patch.model_profile,
        existing.model_profile ?? this.defaultModelProfileForEndpoint({ ...existing, ...patch }),
      ),
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(this.endpointsCollection(workspaceId), endpointId, updated);
    return updated;
  }

  async deleteEndpoint(workspaceId: string, projectId: string, endpointId: string): Promise<boolean> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return false;
    }
    await this.docStore.delete(this.endpointsCollection(workspaceId), endpointId);
    return true;
  }

  async importBulk(
    workspaceId: string,
    projectId: string,
    payload: EndpointBulkImportPayload,
  ): Promise<{ items: EndpointRecord[] }> {
    const pairs: Array<{
      name: string;
      capability: EndpointCapabilityType;
      item: EndpointBulkImportItem | undefined;
      type: EndpointRecord['type'];
    }> = [
      { name: 'reranker', capability: 'rerank', item: payload.reranker, type: 'custom' },
      { name: 'embedding', capability: 'embedding', item: payload.embedding, type: 'catalog' },
      { name: 'completion', capability: 'chat_completion', item: payload.completion, type: 'catalog' },
      { name: 'image_generation', capability: 'image_generation', item: payload.image_generation, type: 'custom' },
      { name: 'video_generation', capability: 'video_generation', item: payload.video_generation, type: 'custom' },
    ];
    const created: EndpointRecord[] = [];

    for (const pair of pairs) {
      if (!pair.item) continue;
      const credential = await this.createCredential(workspaceId, projectId, {
        name: `${pair.name}-key`,
        value: pair.item.api_key,
      });
      const endpoint = await this.createEndpoint(workspaceId, projectId, {
        name: `${pair.name}-${pair.item.model}`,
        model: pair.item.model,
        type: pair.type,
        mode: pair.item.mode,
        base_url: pair.item.api_base,
        credential_ref: credential.id,
        status: 'active',
        upstream_protocol: 'openai_chat_completions',
        provider_family: 'custom',
        capabilities: [
          {
            type: pair.capability,
            enabled: true,
            default_model_id: pair.item.model,
          },
        ],
        models: [
          {
            capability: pair.capability,
            model_id: pair.item.model,
            display_name: pair.item.model,
          },
        ],
      });
      created.push(endpoint);
    }
    return { items: created };
  }
}
