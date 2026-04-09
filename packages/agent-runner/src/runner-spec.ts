import type { AgentInteractionKind } from './protocol.js';

export type AgentRunnerContextModel = 'explicit_dialogue' | 'cli_session';
export type AgentRunnerWorkspacePolicy = 'ephemeral_session_dir' | 'persistent_task_workspace';

export interface AgentRunnerSpec {
  interaction_kind: AgentInteractionKind;
  app_family: string;
  protocol_version: '1.0';
  context_model: AgentRunnerContextModel;
  workspace_policy: AgentRunnerWorkspacePolicy;
  supports_terminal: boolean;
}

export const NOTEBOOK_RUNNER_SPEC: AgentRunnerSpec = {
  interaction_kind: 'notebook',
  app_family: 'codex_runner',
  protocol_version: '1.0',
  context_model: 'cli_session',
  workspace_policy: 'persistent_task_workspace',
  supports_terminal: true,
};

export const CHAT_RUNNER_SPEC: AgentRunnerSpec = {
  interaction_kind: 'chat',
  app_family: 'llm_runner',
  protocol_version: '1.0',
  context_model: 'explicit_dialogue',
  workspace_policy: 'ephemeral_session_dir',
  supports_terminal: false,
};

export function isMatchingRunnerSpec(
  expectedInteractionKind: AgentInteractionKind,
  actual: Partial<AgentRunnerSpec> | null | undefined,
): boolean {
  if (!actual) return false;
  const expected = expectedInteractionKind === 'chat' ? CHAT_RUNNER_SPEC : NOTEBOOK_RUNNER_SPEC;
  return (
    actual.interaction_kind === expected.interaction_kind
    && actual.app_family === expected.app_family
    && actual.protocol_version === expected.protocol_version
    && actual.context_model === expected.context_model
    && actual.workspace_policy === expected.workspace_policy
    && actual.supports_terminal === expected.supports_terminal
  );
}
