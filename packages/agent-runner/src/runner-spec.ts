export type AgentRunnerContextModel = 'task';
export type AgentRunnerWorkspacePolicy = 'persistent_task_workspace';

export interface AgentRunnerSpec {
  app_family: string;
  protocol_version: '1.0';
  context_model: AgentRunnerContextModel;
  workspace_policy: AgentRunnerWorkspacePolicy;
  supports_terminal: boolean;
}

export const AGENT_TASK_RUNNER_SPEC: AgentRunnerSpec = {
  app_family: 'agent_task_runner',
  protocol_version: '1.0',
  context_model: 'task',
  workspace_policy: 'persistent_task_workspace',
  supports_terminal: true,
};

function hasLegacyWorkloadDiscriminant(actual: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(actual, 'interaction_kind')
    || Object.prototype.hasOwnProperty.call(actual, 'workload')
    || Object.prototype.hasOwnProperty.call(actual, 'chat')
    || Object.prototype.hasOwnProperty.call(actual, 'notebook');
}

export function isAgentTaskRunnerSpec(
  actual: Partial<AgentRunnerSpec> | Record<string, unknown> | null | undefined,
): boolean {
  if (!actual) return false;
  if (hasLegacyWorkloadDiscriminant(actual)) return false;
  return (
    actual.app_family === AGENT_TASK_RUNNER_SPEC.app_family
    && actual.protocol_version === AGENT_TASK_RUNNER_SPEC.protocol_version
    && actual.context_model === AGENT_TASK_RUNNER_SPEC.context_model
    && actual.workspace_policy === AGENT_TASK_RUNNER_SPEC.workspace_policy
    && actual.supports_terminal === AGENT_TASK_RUNNER_SPEC.supports_terminal
  );
}
