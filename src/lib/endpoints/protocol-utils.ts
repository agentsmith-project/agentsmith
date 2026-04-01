import type { EndpointUpstreamProtocol } from '@/lib/api/types';

export function resolveEndpointProtocolLabel(
  t: (key: string) => string,
  protocol: EndpointUpstreamProtocol | undefined,
): string {
  const normalized = protocol ?? 'openai_chat_completions';
  const key = `protocol_labels.${normalized}`;
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  switch (normalized) {
    case 'openai_chat_completions':
      return 'OpenAI Chat Completions';
    case 'openai_responses':
      return 'OpenAI Responses';
    case 'anthropic_messages':
      return 'Anthropic Messages';
    default:
      return normalized;
  }
}
