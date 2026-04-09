import type { UpdateAgentRequest } from '@/lib/api/endpoints/agents';
import type { Agent } from '@/lib/api/types';
import type { ExecutionPreferences } from '@/components/settings/ExecutionPreferencesEditor';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from '@mbos/contracts';

import type { AgentInteractionKind, EnvEntry } from './types';

export interface EditAgentFormState {
  cpuLimit: string;
  cpuRequest: string;
  description: string;
  envEntries: EnvEntry[];
  executionEndpointId: string;
  executionPreferences: ExecutionPreferences;
  externalAcceptedMimeTypes: string;
  externalMaxFileCount: string;
  externalMaxTotalBytes: string;
  externalMultimodal: boolean;
  idleTimeoutSec: string;
  image: string;
  interactionKind: AgentInteractionKind;
  maxLifetimeSec: string;
  memoryLimit: string;
  memoryRequest: string;
  name: string;
  visibility: 'private' | 'public';
}

export function getEditAgentFormState(agent: Agent): EditAgentFormState {
  const executionPreferences = (agent.execution_preferences_json as ExecutionPreferences) ?? {};
  const executionPrefsRecord = (agent.execution_preferences_json as Record<string, unknown> | undefined) ?? {};
  const notebook = (executionPrefsRecord.notebook as Record<string, unknown> | undefined) ?? {};
  const chat = (executionPrefsRecord.chat as Record<string, unknown> | undefined) ?? {};
  const config = (agent.config as Record<string, unknown> | undefined) ?? {};
  const env = typeof config.env === 'object' && config.env !== null
    ? (config.env as Record<string, unknown>)
    : {};
  const envEntries = Object.entries(env)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => ({ key, value: typeof value === 'string' ? value : String(value) }));
  const interactionKind = agent.interaction_kind ?? 'chat';

  return {
    cpuLimit: typeof config.cpu_limit === 'string' ? config.cpu_limit : '2',
    cpuRequest: typeof config.cpu_request === 'string' ? config.cpu_request : '500m',
    description: agent.description ?? '',
    envEntries: envEntries.length > 0 ? envEntries : [{ key: '', value: '' }],
    executionEndpointId:
      interactionKind === 'chat'
        ? (typeof chat.endpoint_id === 'string' ? chat.endpoint_id : '')
        : (typeof notebook.endpoint_id === 'string' ? notebook.endpoint_id : ''),
    executionPreferences,
    externalAcceptedMimeTypes: (agent.capabilities?.accepted_mime_types ?? []).join(','),
    externalMaxFileCount: typeof agent.capabilities?.max_file_count === 'number'
      ? String(agent.capabilities.max_file_count)
      : '',
    externalMaxTotalBytes: typeof agent.capabilities?.max_total_bytes === 'number'
      ? String(agent.capabilities.max_total_bytes)
      : '',
    externalMultimodal: agent.capabilities?.multimodal_completion ?? false,
    idleTimeoutSec: typeof config.idle_timeout_sec === 'number'
      ? String(config.idle_timeout_sec)
      : String(INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS),
    image: typeof config.image === 'string' ? config.image : '',
    interactionKind,
    maxLifetimeSec: typeof config.max_lifetime_sec === 'number'
      ? String(config.max_lifetime_sec)
      : String(INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS),
    memoryLimit: typeof config.memory_limit === 'string' ? config.memory_limit : '4Gi',
    memoryRequest: typeof config.memory_request === 'string' ? config.memory_request : '512Mi',
    name: agent.name ?? '',
    visibility: agent.visibility === 'public' ? 'public' : 'private',
  };
}

export function buildUpdateAgentPayload(params: {
  agent: Agent;
  canSetVisibility: boolean;
  cpuLimit: string;
  cpuRequest: string;
  description: string;
  envEntries: EnvEntry[];
  executionEndpointId: string;
  executionPreferences: ExecutionPreferences;
  externalAcceptedMimeTypes: string;
  externalMaxFileCount: string;
  externalMaxTotalBytes: string;
  externalMultimodal: boolean;
  idleTimeoutSec: string;
  image: string;
  interactionKind: AgentInteractionKind;
  maxLifetimeSec: string;
  memoryLimit: string;
  memoryRequest: string;
  name: string;
  visibility: 'private' | 'public';
}): UpdateAgentRequest {
  const executionPreferencesRecord = params.executionPreferences as Record<string, unknown>;
  const notebookExecutionPreferences = (
    typeof executionPreferencesRecord.notebook === 'object' && executionPreferencesRecord.notebook !== null
      ? (executionPreferencesRecord.notebook as Record<string, unknown>)
      : {}
  );
  const chatExecutionPreferences = (
    typeof executionPreferencesRecord.chat === 'object' && executionPreferencesRecord.chat !== null
      ? (executionPreferencesRecord.chat as Record<string, unknown>)
      : {}
  );
  const endpointId = params.executionEndpointId.trim();

  const payload: UpdateAgentRequest = {
    name: params.name.trim(),
    description: params.description.trim() || undefined,
    interaction_kind: params.interactionKind,
    execution_preferences: (() => {
      if (!endpointId) return undefined;
      const nextPreferences: Record<string, unknown> = {
        ...(params.executionPreferences as Record<string, unknown>),
      };
      if (params.interactionKind === 'chat') {
        nextPreferences.chat = {
          ...chatExecutionPreferences,
          endpoint_id: endpointId,
          executor: 'llm_passthrough',
          wire_api: 'chat',
        };
        delete nextPreferences.notebook;
      } else {
        nextPreferences.notebook = {
          ...notebookExecutionPreferences,
          endpoint_id: endpointId,
          executor: 'codex_cli',
          wire_api: params.agent.mode === 'internal' ? 'responses' : 'chat',
        };
        delete nextPreferences.chat;
      }
      return Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined;
    })(),
    config: params.agent.mode === 'internal'
      ? {
          image: params.image.trim() || undefined,
          cpu_request: params.cpuRequest.trim() || undefined,
          cpu_limit: params.cpuLimit.trim() || undefined,
          memory_request: params.memoryRequest.trim() || undefined,
          memory_limit: params.memoryLimit.trim() || undefined,
          idle_timeout_sec: Number.isFinite(Number.parseInt(params.idleTimeoutSec, 10))
            ? Number.parseInt(params.idleTimeoutSec, 10)
            : undefined,
          max_lifetime_sec: Number.isFinite(Number.parseInt(params.maxLifetimeSec, 10))
            ? Number.parseInt(params.maxLifetimeSec, 10)
            : undefined,
          env: (() => {
            const env: Record<string, string> = {};
            for (const { key, value } of params.envEntries) {
              const trimmedKey = key.trim();
              if (!trimmedKey) continue;
              env[trimmedKey] = value;
            }
            return Object.keys(env).length > 0 ? env : undefined;
          })(),
        }
      : undefined,
    capabilities: params.agent.mode === 'external'
      ? {
          streaming_completion: true,
          multimodal_completion: params.externalMultimodal,
          accepted_mime_types: params.externalAcceptedMimeTypes
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          max_file_count: Number.isFinite(Number.parseInt(params.externalMaxFileCount, 10))
            ? Number.parseInt(params.externalMaxFileCount, 10)
            : undefined,
          max_total_bytes: Number.isFinite(Number.parseInt(params.externalMaxTotalBytes, 10))
            ? Number.parseInt(params.externalMaxTotalBytes, 10)
            : undefined,
        }
      : undefined,
    visibility: params.canSetVisibility ? params.visibility : undefined,
  };

  return payload;
}
