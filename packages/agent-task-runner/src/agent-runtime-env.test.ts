import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentRuntimeEnv } from './agent-runtime-env.js';

describe('buildAgentRuntimeEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps task execution context into task and run scoped MBOS_AGENT env vars', () => {
    const env = buildAgentRuntimeEnv({
      api_base: 'http://127.0.0.1:20000/api/v1',
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      task_id: 'task_1',
      run_id: 'run_1',
      runner_id: 'runner_1',
      endpoint_id: 'ep_1',
      model: 'gpt-5-codex',
      wire_api: 'openai_responses',
      execution_ticket: 'exec_123',
    });

    expect(env).toEqual({
      MBOS_AGENT_API_BASE: 'http://127.0.0.1:20000/api/v1',
      MBOS_AGENT_WORKSPACE_ID: 'ws_1',
      MBOS_AGENT_PROJECT_ID: 'proj_1',
      MBOS_AGENT_TASK_ID: 'task_1',
      MBOS_AGENT_RUN_ID: 'run_1',
      MBOS_AGENT_RUNNER_ID: 'runner_1',
      MBOS_AGENT_ENDPOINT_ID: 'ep_1',
      MBOS_AGENT_MODEL: 'gpt-5-codex',
      MBOS_AGENT_WIRE_API: 'openai_responses',
      MBOS_AGENT_EXECUTION_TICKET: 'exec_123',
      MBOS_AGENT_PROJECTED_DEPENDENCIES: '',
    });
    expect(env).not.toHaveProperty('MBOS_AGENT_SESSION_ID');
    expect(env).not.toHaveProperty('MBOS_AGENT_INTERACTION_KIND');
  });

  it('fills missing task runtime values with empty strings', () => {
    expect(buildAgentRuntimeEnv({})).toEqual({
      MBOS_AGENT_API_BASE: '',
      MBOS_AGENT_WORKSPACE_ID: '',
      MBOS_AGENT_PROJECT_ID: '',
      MBOS_AGENT_TASK_ID: '',
      MBOS_AGENT_RUN_ID: '',
      MBOS_AGENT_RUNNER_ID: '',
      MBOS_AGENT_ENDPOINT_ID: '',
      MBOS_AGENT_MODEL: '',
      MBOS_AGENT_WIRE_API: '',
      MBOS_AGENT_EXECUTION_TICKET: '',
      MBOS_AGENT_PROJECTED_DEPENDENCIES: '',
    });
  });

  it('serializes projected dependencies into the runtime env', () => {
    const projectedDependencies = {
      dependencies: {
        'sample-secret': {
          fields: {
            base_url: 'http://127.0.0.1:45001',
            token: 'sample_task_token',
          },
        },
      },
    };

    const env = buildAgentRuntimeEnv({
      projected_dependencies: projectedDependencies,
    });

    expect(env.MBOS_AGENT_PROJECTED_DEPENDENCIES).toBe(JSON.stringify(projectedDependencies));
  });

  it('does not inherit projected dependencies from the parent process env', () => {
    vi.stubEnv(
      'MBOS_AGENT_PROJECTED_DEPENDENCIES',
      JSON.stringify({ dependencies: { from_parent: true } }),
    );

    expect(buildAgentRuntimeEnv({}).MBOS_AGENT_PROJECTED_DEPENDENCIES).toBe('');
  });
});
