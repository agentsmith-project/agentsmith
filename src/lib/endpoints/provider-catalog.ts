import modelCatalog from './models-catalog.config.json';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import type { EndpointCapabilityType, EndpointProviderFamily, CustomEndpointProtocol } from '@/lib/api/types';

export type ProviderOption =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'google'
  | 'glm'
  | 'alibaba'
  | 'custom';

export interface ProviderModelOption {
  model_id: string;
  name: string;
  capabilities: EndpointCapabilityType[];
}

export interface ProviderCatalogOption {
  key: ProviderOption;
  display_name: string;
  logo_path?: string;
  family: EndpointProviderFamily;
  upstream_protocol: CreateEndpointRequest['upstream_protocol'];
  default_base_url: string;
  models: ProviderModelOption[];
}

/**
 * Custom endpoint protocol options for user selection.
 * When user selects "Custom" provider, they must choose a protocol type.
 */
export type CustomProtocolOption = CustomEndpointProtocol;

/**
 * Configuration for custom endpoint protocols.
 */
export interface CustomProtocolConfig {
  protocol: CustomEndpointProtocol;
  display_name: string;
  default_base_url: string;
  description?: string;
}

const PROVIDER_CONFIG: Record<
  Exclude<ProviderOption, 'custom'>,
  {
    family: EndpointProviderFamily;
    upstream_protocol: CreateEndpointRequest['upstream_protocol'];
    default_base_url: string;
  }
> = {
  openai: {
    family: 'openai',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://api.openai.com/v1',
  },
  anthropic: {
    family: 'anthropic',
    upstream_protocol: 'anthropic_messages',
    default_base_url: 'https://api.anthropic.com/v1',
  },
  deepseek: {
    family: 'deepseek',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://api.deepseek.com/v1',
  },
  minimax: {
    family: 'minimax',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://api.minimax.chat/v1',
  },
  kimi: {
    family: 'kimi',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://api.moonshot.cn/v1',
  },
  google: {
    family: 'google',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  glm: {
    family: 'glm',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
  alibaba: {
    family: 'alibaba',
    upstream_protocol: 'openai_chat_completions',
    default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
};

const catalogProviders = modelCatalog.providers as Array<{
  key: Exclude<ProviderOption, 'custom'>;
  display_name: string;
  logo_path?: string;
  models: ProviderModelOption[];
}>;

const providerMap = new Map(catalogProviders.map((provider) => [provider.key, provider] as const));

const DEFAULT_PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'deepseek',
  'minimax',
  'kimi',
  'google',
  'glm',
  'alibaba',
] as const satisfies ReadonlyArray<Exclude<ProviderOption, 'custom'>>;

export const ENDPOINT_PROVIDER_OPTIONS: ProviderCatalogOption[] = DEFAULT_PROVIDER_ORDER.map((key) => {
  const catalogProvider = providerMap.get(key);
  const config = PROVIDER_CONFIG[key];
  return {
    key,
    display_name: catalogProvider?.display_name ?? key,
    logo_path: catalogProvider?.logo_path,
    family: config.family,
    upstream_protocol: config.upstream_protocol,
    default_base_url: config.default_base_url,
    models: catalogProvider?.models ?? [],
  };
});

export const CUSTOM_PROVIDER_OPTION: ProviderCatalogOption = {
  key: 'custom',
  display_name: 'Custom',
  family: 'custom',
  upstream_protocol: 'openai_chat_completions',
  default_base_url: '',
  models: [],
};

/**
 * Available custom endpoint protocol configurations.
 * Used when user selects "Custom" provider option.
 */
export const CUSTOM_PROTOCOL_OPTIONS: CustomProtocolConfig[] = [
  {
    protocol: 'openai_chat_completions',
    display_name: 'OpenAI Chat Completions',
    default_base_url: 'https://api.openai.com/v1',
    description: 'Upstreams that speak the OpenAI chat/completions format',
  },
  {
    protocol: 'openai_responses',
    display_name: 'OpenAI Responses',
    default_base_url: 'https://api.openai.com/v1',
    description: 'Upstreams that natively expose the OpenAI responses format',
  },
  {
    protocol: 'anthropic_messages',
    display_name: 'Anthropic Messages',
    default_base_url: 'https://api.anthropic.com',
    description: 'Upstreams that speak the Anthropic Messages format',
  },
];

export function getProviderOption(provider: ProviderOption): ProviderCatalogOption {
  if (provider === 'custom') return CUSTOM_PROVIDER_OPTION;
  return ENDPOINT_PROVIDER_OPTIONS.find((item) => item.key === provider) ?? CUSTOM_PROVIDER_OPTION;
}

/**
 * Get custom protocol configuration by protocol type.
 */
export function getCustomProtocolConfig(protocol: CustomEndpointProtocol): CustomProtocolConfig | undefined {
  return CUSTOM_PROTOCOL_OPTIONS.find((option) => option.protocol === protocol);
}

/**
 * Get custom protocol configuration by index (for UI selection).
 */
export function getCustomProtocolByIndex(index: number): CustomProtocolConfig | undefined {
  return CUSTOM_PROTOCOL_OPTIONS[index];
}

export function getModelsByCapability(
  provider: ProviderCatalogOption,
  capability: EndpointCapabilityType,
): ProviderModelOption[] {
  return provider.models.filter((item) => item.capabilities.includes(capability));
}
