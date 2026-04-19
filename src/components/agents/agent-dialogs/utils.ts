import type { CreateAgentRequest } from '@/lib/api/endpoints/agents';
import type { EndpointUpstreamProtocol } from '@/lib/api/types';

import type { AgentInteractionKind, AgentMode, EnvEntry } from './types';

export function resolveChatExecutionWireApi(
  upstreamProtocol?: EndpointUpstreamProtocol | null,
): 'chat' | 'anthropic_messages' {
  return upstreamProtocol === 'anthropic_messages' ? 'anthropic_messages' : 'chat';
}

export function endpointLabel(endpoint: {
  name: string;
  model?: string;
  provider_family?: string;
}): string {
  const model = endpoint.model?.trim() || 'n/a';
  const family = endpoint.provider_family ?? 'custom';
  return `${endpoint.name} (${family}/${model})`;
}

export function buildCreateAgentPayload(params: {
  cpuLimit: string;
  cpuRequest: string;
  description: string;
  envEntries: EnvEntry[];
  executionEndpointId: string;
  executionEndpointUpstreamProtocol?: EndpointUpstreamProtocol | null;
  externalAcceptedMimeTypes: string;
  externalMaxFileCount: string;
  externalMaxTotalBytes: string;
  externalMultimodal: boolean;
  idleTimeoutSec: string;
  image: string;
  interactionKind: AgentInteractionKind;
  maxConcurrentSessions: string;
  maxLifetimeSec: string;
  memoryLimit: string;
  memoryRequest: string;
  mode: AgentMode;
  name: string;
}): CreateAgentRequest {
  const parsedMaxFileCount = Number.parseInt(params.externalMaxFileCount, 10);
  const parsedMaxTotalBytes = Number.parseInt(params.externalMaxTotalBytes, 10);

  const data: CreateAgentRequest = {
    name: params.name.trim(),
    description: params.description.trim() || undefined,
    mode: params.mode,
    interaction_kind: params.interactionKind,
    capabilities: {
      streaming_completion: true,
      multimodal_completion: params.mode === 'external' ? params.externalMultimodal : false,
      accepted_mime_types: params.mode === 'external'
        ? params.externalAcceptedMimeTypes.split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      max_file_count: params.mode === 'external' && Number.isFinite(parsedMaxFileCount) && parsedMaxFileCount > 0
        ? parsedMaxFileCount
        : undefined,
      max_total_bytes: params.mode === 'external' && Number.isFinite(parsedMaxTotalBytes) && parsedMaxTotalBytes > 0
        ? parsedMaxTotalBytes
        : undefined,
    },
  };

  const endpointId = params.executionEndpointId.trim();
  const executionPreferences =
    params.interactionKind === 'chat'
        ? {
            chat: {
              executor: 'llm_passthrough',
              endpoint_id: endpointId,
              wire_api: resolveChatExecutionWireApi(params.executionEndpointUpstreamProtocol),
            },
          }
      : {
          notebook: {
            executor: 'codex_cli',
            endpoint_id: endpointId,
            wire_api: params.mode === 'internal' ? 'responses' : 'chat',
          },
        };

  if (params.mode === 'internal') {
    const env: Record<string, string> = {};
    params.envEntries.forEach(({ key, value }) => {
      if (key.trim()) env[key.trim()] = value;
    });
    const parsedIdleTimeoutSec = Number.parseInt(params.idleTimeoutSec, 10);
    const parsedMaxLifetimeSec = Number.parseInt(params.maxLifetimeSec, 10);
    data.config = {
      image: params.image.trim(),
      cpu_request: params.cpuRequest.trim() || undefined,
      cpu_limit: params.cpuLimit.trim() || undefined,
      memory_request: params.memoryRequest.trim() || undefined,
      memory_limit: params.memoryLimit.trim() || undefined,
      idle_timeout_sec: Number.isFinite(parsedIdleTimeoutSec) && parsedIdleTimeoutSec > 0 ? parsedIdleTimeoutSec : undefined,
      max_lifetime_sec: Number.isFinite(parsedMaxLifetimeSec) && parsedMaxLifetimeSec > 0 ? parsedMaxLifetimeSec : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      max_concurrent_sessions_override: params.maxConcurrentSessions.trim()
        ? Number.parseInt(params.maxConcurrentSessions, 10)
        : undefined,
    };
  }

  data.execution_preferences = executionPreferences;
  return data;
}
