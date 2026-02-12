import type { EndpointRecord } from './resource-models.js';

export type EndpointTaskAction =
  | 'chat'
  | 'rerank'
  | 'image_generation'
  | 'video_generation_create'
  | 'video_generation_poll'
  | 'video_generation_cancel';

export interface ResolvedEndpointTaskRoute {
  capability: 'chat_completion' | 'rerank' | 'image_generation' | 'video_generation';
  proxyPath: string;
}

export function isCapabilitySupportedByProtocol(
  protocol: EndpointRecord['protocol'],
  capability: ResolvedEndpointTaskRoute['capability'],
): boolean {
  const effectiveProtocol = protocol ?? 'openai_compatible';
  if (effectiveProtocol === 'openai_compatible') {
    return true;
  }
  if (effectiveProtocol === 'google_gemini') {
    return capability !== 'rerank';
  }
  if (effectiveProtocol === 'glm_native') {
    return capability !== 'rerank';
  }
  if (effectiveProtocol === 'dashscope_native') {
    return capability !== 'rerank';
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

  // Current production default: all supported providers are configured via OpenAI-compatible
  // endpoints. Keep protocol branch explicit for future native provider adapters.
  switch (endpoint.protocol) {
    case 'google_gemini':
    case 'glm_native':
    case 'dashscope_native':
    case 'openai_compatible':
    default:
      return base;
  }
}
