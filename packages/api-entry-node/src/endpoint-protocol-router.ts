import type { EndpointRecord } from './resource-models.js';

export type EndpointTaskAction =
  | 'chat'
  | 'rerank'
  | 'image_generation'
  | 'video_generation_create'
  | 'video_generation_poll'
  | 'video_generation_cancel';

export interface ResolvedEndpointTaskRoute {
  capability:
    | 'chat_completion'
    | 'multimodal_completion'
    | 'rerank'
    | 'image_generation'
    | 'video_generation';
  proxyPath: string;
}

export function isCapabilitySupportedByProtocol(
  protocol: EndpointRecord['upstream_protocol'],
  capability: ResolvedEndpointTaskRoute['capability'],
): boolean {
  const effectiveProtocol = protocol;
  if (effectiveProtocol === 'openai_chat_completions' || effectiveProtocol === 'openai_responses') {
    return true;
  }
  if (effectiveProtocol === 'anthropic_messages') {
    return capability === 'chat_completion' || capability === 'multimodal_completion';
  }
  return false;
}

const OPENAI_COMPATIBLE_PATHS: Record<EndpointTaskAction, ResolvedEndpointTaskRoute> = {
  chat: { capability: 'chat_completion', proxyPath: 'chat/completions' },
  rerank: { capability: 'rerank', proxyPath: 'rerank' },
  image_generation: { capability: 'image_generation', proxyPath: 'images/generations' },
  video_generation_create: { capability: 'video_generation', proxyPath: 'videos/generations' },
  video_generation_poll: { capability: 'video_generation', proxyPath: '' },
  video_generation_cancel: { capability: 'video_generation', proxyPath: '' },
};

export function resolveEndpointTaskRoute(
  endpoint: EndpointRecord,
  action: EndpointTaskAction,
  jobId?: string,
): ResolvedEndpointTaskRoute {
  const base = OPENAI_COMPATIBLE_PATHS[action];
  if (action === 'video_generation_poll') {
    return {
      capability: base.capability,
      proxyPath: `videos/generations/${jobId ?? ''}`.replace(/\/+$/, ''),
    };
  }
  if (action === 'video_generation_cancel') {
    return {
      capability: base.capability,
      proxyPath: `videos/generations/${jobId ?? ''}/cancel`.replace(/\/+$/, ''),
    };
  }

  switch (endpoint.upstream_protocol) {
    case 'anthropic_messages':
      if (action === 'chat') {
        return { capability: 'chat_completion', proxyPath: 'messages' };
      }
      return base;
    case 'openai_responses':
    case 'openai_chat_completions':
    default:
      return base;
  }
}
