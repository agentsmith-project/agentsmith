import type { AgentInteractionKind } from './protocol.js';

export type AgentRuntimeEnvContext = {
  api_base?: string;
  workspace_id?: string;
  project_id?: string;
  session_id?: string;
  task_id?: string;
  execution_ticket?: string;
  interaction_kind?: AgentInteractionKind;
};

export function buildAgentRuntimeEnv(
  executionContext: AgentRuntimeEnvContext,
): Record<string, string> {
  return {
    MBOS_AGENT_API_BASE: executionContext.api_base ?? '',
    MBOS_AGENT_WORKSPACE_ID: executionContext.workspace_id ?? '',
    MBOS_AGENT_PROJECT_ID: executionContext.project_id ?? '',
    MBOS_AGENT_SESSION_ID: executionContext.session_id ?? '',
    MBOS_AGENT_TASK_ID: executionContext.task_id ?? '',
    MBOS_AGENT_INTERACTION_KIND: executionContext.interaction_kind ?? '',
    MBOS_AGENT_EXECUTION_TICKET: executionContext.execution_ticket ?? '',
  };
}
