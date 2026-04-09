type SharedExecutionContext = {
  api_base?: string;
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  execution_ticket?: string;
};

export function buildAgentRuntimeEnv(
  executionContext: SharedExecutionContext,
): Record<string, string> {
  return {
    MBOS_AGENT_API_BASE: executionContext.api_base ?? '',
    MBOS_AGENT_WORKSPACE_ID: executionContext.workspace_id ?? '',
    MBOS_AGENT_PROJECT_ID: executionContext.project_id ?? '',
    MBOS_AGENT_TASK_ID: executionContext.task_id ?? '',
    MBOS_AGENT_EXECUTION_TICKET: executionContext.execution_ticket ?? '',
  };
}
