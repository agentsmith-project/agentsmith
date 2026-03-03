import type { EndpointProtocol } from '@/lib/api/types';

export function resolveEndpointProtocolLabel(
  t: (key: string) => string,
  protocol: EndpointProtocol | undefined,
): string {
  const normalized = protocol ?? 'openai_compatible';
  const key = `protocol_labels.${normalized}`;
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  switch (normalized) {
    case 'openai_compatible':
      return 'OpenAI Compatible';
    case 'anthropic_compatible':
      return 'Anthropic Compatible';
    case 'google_gemini':
      return 'Google Gemini Native';
    case 'glm_native':
      return 'GLM Native';
    case 'dashscope_native':
      return 'DashScope Native';
    default:
      return normalized;
  }
}

export function normalizeCompatibilityInterface(protocol: EndpointProtocol | undefined): 'openai_compatible' | 'anthropic_compatible' {
  return protocol === 'anthropic_compatible' ? 'anthropic_compatible' : 'openai_compatible';
}
