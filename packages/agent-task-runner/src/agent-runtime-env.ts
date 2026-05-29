import type { AgentWireApi, TaskExecutionContext } from '@mbos/agent-runner-contract';

export type AgentRuntimeEnvContext = Partial<Pick<
  TaskExecutionContext,
  | 'api_base'
  | 'workspace_id'
  | 'project_id'
  | 'task_id'
  | 'run_id'
  | 'runner_id'
  | 'endpoint_id'
  | 'model'
  | 'execution_ticket'
>> & {
  wire_api?: AgentWireApi;
};

export function buildAgentRuntimeEnv(
  executionContext: AgentRuntimeEnvContext,
): Record<string, string> {
  return {
    MBOS_AGENT_API_BASE: executionContext.api_base ?? '',
    MBOS_AGENT_WORKSPACE_ID: executionContext.workspace_id ?? '',
    MBOS_AGENT_PROJECT_ID: executionContext.project_id ?? '',
    MBOS_AGENT_TASK_ID: executionContext.task_id ?? '',
    MBOS_AGENT_RUN_ID: executionContext.run_id ?? '',
    MBOS_AGENT_RUNNER_ID: executionContext.runner_id ?? '',
    MBOS_AGENT_ENDPOINT_ID: executionContext.endpoint_id ?? '',
    MBOS_AGENT_MODEL: executionContext.model ?? '',
    MBOS_AGENT_WIRE_API: executionContext.wire_api ?? '',
    MBOS_AGENT_EXECUTION_TICKET: executionContext.execution_ticket ?? '',
  };
}
