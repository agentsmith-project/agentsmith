import type { EndpointRecord, EndpointUpstreamProtocol } from './resource-models.js';

type LegacyEndpointType = 'openai' | 'anthropic' | 'custom' | 'catalog';
type LegacyEndpointProtocol =
  | 'openai_compatible'
  | 'anthropic_compatible'
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'google_gemini'
  | 'glm_native'
  | 'dashscope_native';

type LegacyEndpointRecord = Omit<EndpointRecord, 'type' | 'upstream_protocol'> & {
  type?: LegacyEndpointType;
  upstream_protocol?: EndpointUpstreamProtocol;
  protocol?: LegacyEndpointProtocol;
};

function migrateLegacyUpstreamProtocol(
  endpoint: Pick<LegacyEndpointRecord, 'upstream_protocol' | 'protocol'>,
): EndpointUpstreamProtocol {
  if (endpoint.upstream_protocol) {
    return endpoint.upstream_protocol;
  }

  switch (endpoint.protocol) {
    case 'anthropic_compatible':
    case 'anthropic_messages':
      return 'anthropic_messages';
    case 'openai_responses':
      return 'openai_responses';
    case 'openai_chat_completions':
    case 'google_gemini':
    case 'glm_native':
    case 'dashscope_native':
    case 'openai_compatible':
    default:
      return 'openai_chat_completions';
  }
}

function migrateLegacyType(
  endpoint: Pick<LegacyEndpointRecord, 'type' | 'provider_family'>,
): EndpointRecord['type'] {
  if (endpoint.type === 'catalog' || endpoint.type === 'custom') {
    return endpoint.type;
  }

  if (endpoint.type === 'custom' || endpoint.provider_family === 'custom') {
    return 'custom';
  }

  return 'catalog';
}

export function migrateLegacyEndpointRecord(raw: LegacyEndpointRecord): EndpointRecord {
  const { protocol: _legacyProtocol, ...rest } = raw;
  return {
    ...rest,
    type: migrateLegacyType(raw),
    upstream_protocol: migrateLegacyUpstreamProtocol(raw),
  };
}

