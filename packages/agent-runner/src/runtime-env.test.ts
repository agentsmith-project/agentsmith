import { describe, expect, it } from 'vitest';
import { buildAgentRuntimeEnv } from './runtime-env.js';

describe('buildAgentRuntimeEnv', () => {
  it('maps execution context into stable MBOS_AGENT env vars', () => {
    expect(
      buildAgentRuntimeEnv({
        api_base: 'http://127.0.0.1:20000/api/v1',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        session_id: 'session_1',
        task_id: 'task_1',
        interaction_kind: 'notebook',
        execution_ticket: 'exec_123',
      }),
    ).toEqual({
      MBOS_AGENT_API_BASE: 'http://127.0.0.1:20000/api/v1',
      MBOS_AGENT_WORKSPACE_ID: 'ws_1',
      MBOS_AGENT_PROJECT_ID: 'proj_1',
      MBOS_AGENT_SESSION_ID: 'session_1',
      MBOS_AGENT_TASK_ID: 'task_1',
      MBOS_AGENT_INTERACTION_KIND: 'notebook',
      MBOS_AGENT_EXECUTION_TICKET: 'exec_123',
    });
  });

  it('fills missing values with empty strings', () => {
    expect(buildAgentRuntimeEnv({})).toEqual({
      MBOS_AGENT_API_BASE: '',
      MBOS_AGENT_WORKSPACE_ID: '',
      MBOS_AGENT_PROJECT_ID: '',
      MBOS_AGENT_SESSION_ID: '',
      MBOS_AGENT_TASK_ID: '',
      MBOS_AGENT_INTERACTION_KIND: '',
      MBOS_AGENT_EXECUTION_TICKET: '',
    });
  });
});
