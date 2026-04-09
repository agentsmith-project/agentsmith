import type { AgentRecord } from './resource-models.js';

type ExecutionPreferencesRecord = Record<string, unknown>;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferInteractionKindFromPreferences(
  executionPreferences: ExecutionPreferencesRecord,
): 'chat' | 'notebook' {
  const hasNotebook = isRecord(executionPreferences.notebook);
  const hasChat = isRecord(executionPreferences.chat);
  if (hasNotebook && !hasChat) return 'notebook';
  return 'chat';
}

export function resolveAgentInteractionKind(
  agent: Pick<AgentRecord, 'interaction_kind' | 'execution_preferences_json'>,
): 'chat' | 'notebook' {
  if (agent.interaction_kind === 'chat' || agent.interaction_kind === 'notebook') {
    return agent.interaction_kind;
  }
  const executionPreferences = isRecord(agent.execution_preferences_json)
    ? agent.execution_preferences_json
    : {};
  return inferInteractionKindFromPreferences(executionPreferences);
}

export function readAgentExecutionPreferences(
  agent: Pick<AgentRecord, 'interaction_kind' | 'execution_preferences_json'>,
  kindOverride?: 'chat' | 'notebook',
): {
  interactionKind: 'chat' | 'notebook';
  endpointId: string | null;
  wireApi: 'chat' | 'responses';
  model: string | null;
  executor: string | null;
} {
  const executionPreferences = isRecord(agent.execution_preferences_json)
    ? agent.execution_preferences_json
    : {};
  const interactionKind = kindOverride ?? resolveAgentInteractionKind(agent);
  const scoped = isRecord(executionPreferences[interactionKind])
    ? executionPreferences[interactionKind] as ExecutionPreferencesRecord
    : {};

  return {
    interactionKind,
    endpointId: asNonEmptyString(scoped.endpoint_id),
    wireApi: scoped.wire_api === 'responses' ? 'responses' : 'chat',
    model: asNonEmptyString(scoped.model),
    executor: asNonEmptyString(scoped.executor),
  };
}
