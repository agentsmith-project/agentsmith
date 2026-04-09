import type { AgentExecutionContext } from './protocol.js';

export function buildAgentRuntimeEnv(
  executionContext: Pick<
    AgentExecutionContext,
    'api_base' | 'workspace_id' | 'project_id' | 'task_id' | 'execution_ticket'
  >,
): Record<string, string> {
  return {
    MBOS_AGENT_API_BASE: executionContext.api_base ?? '',
    MBOS_AGENT_WORKSPACE_ID: executionContext.workspace_id ?? '',
    MBOS_AGENT_PROJECT_ID: executionContext.project_id ?? '',
    MBOS_AGENT_TASK_ID: executionContext.task_id ?? '',
    MBOS_AGENT_EXECUTION_TICKET: executionContext.execution_ticket ?? '',
  };
}
