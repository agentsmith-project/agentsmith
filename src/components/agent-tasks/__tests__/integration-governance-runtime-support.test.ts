import { describe, expect, it } from 'vitest';
import { bindAgentTaskExecutionSocketToTask } from '../../../../e2e/integration-real-helpers';

describe('bindAgentTaskExecutionSocketToTask', () => {
  it('binds an Agent task execution socket to the authoritative task session', () => {
    expect(
      bindAgentTaskExecutionSocketToTask({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=agent_123',
        taskId: 'task_456',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=agent_123&runner_session_id=task_456');
  });

  it('replaces an existing session binding instead of appending duplicate session params', () => {
    expect(
      bindAgentTaskExecutionSocketToTask({
        wsUrl: 'wss://agent-runners.example.com/api/v1/agent-execution/ws?agent_runner_id=agent_123&runner_session_id=stale_task',
        taskId: 'task_789',
      }),
    ).toBe('wss://agent-runners.example.com/api/v1/agent-execution/ws?agent_runner_id=agent_123&runner_session_id=task_789');
  });
});
