import type { Endpoint } from '@/lib/api/types';
import type { UpdateEndpointRequest } from '@/lib/api/endpoints/endpoints';

import type { CapabilityOption } from '../create-endpoint-dialog/types';

export function buildEditEndpointPayload(params: {
  baseUrl: string;
  cacheReadDiscountRatio: string;
  cacheWriteDiscountRatio: string;
  capability: CapabilityOption;
  credentialRef: string;
  description: string;
  endpoint: Endpoint;
  isCustomProvider: boolean;
  maxContextTokens: string;
  maxOutputTokens: string;
  name: string;
  priceInputPer1m: string;
  priceOutputPer1m: string;
  provider: string;
  protocolForSubmit: Endpoint['protocol'];
  selectedModel: string;
  selectedProvider: {
    family: Endpoint['provider_family'];
    protocol: NonNullable<Endpoint['protocol']>;
    compatibility_interface?: string;
    default_base_url?: string;
  };
  status: 'active' | 'disabled';
  supportsFile: boolean;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
}): UpdateEndpointRequest {
  const selectedModel = params.selectedModel.trim();
  const isEndpointCustom = params.endpoint.type === 'custom' || params.endpoint.provider_family === 'custom';

  return {
    name: params.name.trim(),
    description: params.description.trim() || undefined,
    model: selectedModel,
    base_url: params.baseUrl,
    status: params.status,
    credential_ref: params.credentialRef,
    provider_family: isEndpointCustom ? 'custom' : params.selectedProvider.family,
    protocol: params.protocolForSubmit,
    meta: {
      compatibility_interface: isEndpointCustom
        ? (params.endpoint.meta?.compatibility_interface ?? params.protocolForSubmit ?? 'openai_compatible')
        : (params.selectedProvider.compatibility_interface ?? 'openai'),
      catalog_provider_key: params.isCustomProvider ? 'custom' : params.provider,
    },
    capabilities: [{ type: params.capability, enabled: true, default_model_id: selectedModel }],
    models: [{ capability: params.capability, model_id: selectedModel, display_name: selectedModel }],
    defaults:
      params.capability === 'chat_completion'
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
    model_profile: params.isCustomProvider
      ? {
          max_context_tokens: Number(params.maxContextTokens),
          max_output_tokens: Number(params.maxOutputTokens),
          supports_file: params.supportsFile,
          supports_tool_call: params.supportsToolCall,
          supports_reasoning: params.supportsReasoning,
          price_input_per_1m: Number(params.priceInputPer1m),
          price_output_per_1m: Number(params.priceOutputPer1m),
          cache_read_discount_ratio: Number(params.cacheReadDiscountRatio),
          cache_write_discount_ratio: Number(params.cacheWriteDiscountRatio),
        }
      : undefined,
  };
}
