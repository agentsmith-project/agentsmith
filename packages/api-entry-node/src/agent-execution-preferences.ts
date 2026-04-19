import type { AgentRecord } from './resource-models.js';

type ExecutionPreferencesRecord = Record<string, unknown>;
export type AgentExecutionWireApi = 'chat' | 'responses' | 'anthropic_messages';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveAgentInteractionKind(
  agent: Pick<AgentRecord, 'interaction_kind' | 'execution_preferences_json'>,
): 'chat' | 'notebook' | null {
  if (agent.interaction_kind === 'chat' || agent.interaction_kind === 'notebook') {
    return agent.interaction_kind;
  }
  return null;
}

export function readAgentExecutionPreferences(
  agent: Pick<AgentRecord, 'interaction_kind' | 'execution_preferences_json'>,
  kindOverride?: 'chat' | 'notebook',
): {
  interactionKind: 'chat' | 'notebook';
  endpointId: string | null;
  wireApi: AgentExecutionWireApi;
  model: string | null;
  executor: string | null;
} {
  const executionPreferences = isRecord(agent.execution_preferences_json)
    ? agent.execution_preferences_json
    : {};
  const interactionKind = kindOverride ?? resolveAgentInteractionKind(agent);
  if (!interactionKind) {
    throw new Error('agent_interaction_kind_required');
  }
  const scoped = isRecord(executionPreferences[interactionKind])
    ? executionPreferences[interactionKind] as ExecutionPreferencesRecord
    : {};

  return {
    interactionKind,
    endpointId: asNonEmptyString(scoped.endpoint_id),
    wireApi:
      scoped.wire_api === 'responses'
        ? 'responses'
        : interactionKind === 'chat' && scoped.wire_api === 'anthropic_messages'
          ? 'anthropic_messages'
          : 'chat',
    model: asNonEmptyString(scoped.model),
    executor: asNonEmptyString(scoped.executor),
  };
}
