import type { CreateAgentRequest } from '@/lib/api/endpoints/agents';

import type { AgentInteractionMode, AgentMode, EnvEntry } from './types';

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
  externalAcceptedMimeTypes: string;
  externalMaxFileCount: string;
  externalMaxTotalBytes: string;
  externalMultimodal: boolean;
  idleTimeoutSec: string;
  image: string;
  interactionMode: AgentInteractionMode;
  maxConcurrentSessions: string;
  maxLifetimeSec: string;
  memoryLimit: string;
  memoryRequest: string;
  mode: AgentMode;
  name: string;
  notebookEndpointId: string;
}): CreateAgentRequest {
  const parsedMaxFileCount = Number.parseInt(params.externalMaxFileCount, 10);
  const parsedMaxTotalBytes = Number.parseInt(params.externalMaxTotalBytes, 10);

  const data: CreateAgentRequest = {
    name: params.name.trim(),
    description: params.description.trim() || undefined,
    mode: params.mode,
    interaction_mode: params.interactionMode,
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

  if (params.mode === 'internal') {
    const env: Record<string, string> = {};
    params.envEntries.forEach(({ key, value }) => {
      if (key.trim()) env[key.trim()] = value;
    });
    const parsedIdleTimeoutSec = Number.parseInt(params.idleTimeoutSec, 10);
    const parsedMaxLifetimeSec = Number.parseInt(params.maxLifetimeSec, 10);
    data.config = {
      image: params.image.trim(),
      endpoint_id: params.notebookEndpointId.trim(),
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
    data.execution_preferences = {
      notebook: {
        executor: 'codex_cli',
        endpoint_id: params.notebookEndpointId.trim(),
        wire_api: 'responses',
        model: 'gpt-5-codex',
      },
    };
  }

  if (params.mode === 'external' && (params.interactionMode === 'notebook' || params.interactionMode === 'both')) {
    data.execution_preferences = {
      notebook: {
        executor: 'codex_cli',
        endpoint_id: params.notebookEndpointId.trim(),
        wire_api: 'chat',
        model: 'gpt-5-codex',
      },
    };
  }

  return data;
}
