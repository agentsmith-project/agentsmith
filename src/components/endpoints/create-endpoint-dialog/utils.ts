import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';

import type { CapabilityOption, CatalogModelOption, EndpointProviderSelection } from './types';

export function buildProviderModels(items: Array<{
  model_id: string;
  name?: string;
  capabilities: string[];
  limit?: { context?: number; output?: number };
  cost?: Record<string, number | Record<string, number>>;
}>): CatalogModelOption[] {
  if (items.length === 0) return [];
  return items.map((item) => ({
    model_id: item.model_id,
    name: item.name || item.model_id,
    capabilities: item.capabilities as CapabilityOption[],
    limit: item.limit,
    cost: item.cost,
  }));
}

export function buildCreateEndpointPayload(params: {
  baseUrl: string;
  capability: CapabilityOption;
  credentialRef: string;
  description: string;
  name: string;
  provider: string;
  selectedProvider: EndpointProviderSelection;
  selectedModel: string;
}): CreateEndpointRequest {
  const selectedModel = params.selectedModel.trim();

  return {
    name: params.name.trim(),
    description: params.description.trim() || undefined,
    model: selectedModel,
    type: 'catalog',
    base_url: params.baseUrl.trim(),
    credential_ref: params.credentialRef,
    provider_family: params.selectedProvider.family,
    upstream_protocol: params.selectedProvider.upstream_protocol,
    meta: {
      catalog_provider_key: params.provider,
    },
    capabilities: [{ type: params.capability, enabled: true, default_model_id: selectedModel }],
    models: [{ capability: params.capability, model_id: selectedModel, display_name: selectedModel }],
    defaults: params.capability === 'chat_completion'
      ? { chat_model_id: selectedModel }
      : params.capability === 'multimodal_completion'
        ? { multimodal_model_id: selectedModel }
        : params.capability === 'embedding'
          ? { embedding_model_id: selectedModel }
          : params.capability === 'rerank'
            ? { rerank_model_id: selectedModel }
            : params.capability === 'image_generation'
              ? { image_model_id: selectedModel }
              : { video_model_id: selectedModel },
    model_profile: undefined,
  };
}
