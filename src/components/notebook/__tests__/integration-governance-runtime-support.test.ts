import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindNotebookExecutionSocketToTask,
  waitForNotebookAgentReply,
} from '../../../../e2e/integration-governance-runtime-support';
import { readStoredAuthToken } from '../../../../e2e/integration-workspace-access';

vi.mock('../../../../e2e/integration-workspace-access', () => ({
  readStoredAuthToken: vi.fn(),
}));

function createResponse(messages: Array<{ role?: string; content?: string }>) {
  return {
    ok: () => true,
    json: async () => messages,
  };
}

describe('waitForNotebookAgentReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readStoredAuthToken).mockResolvedValue('workspace-token');
  });

  it('waits for an agent message instead of resolving from an echoed user token', async () => {
    const requestGet = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse([
          {
            role: 'user',
            content: 'Reply with the exact token NOTEBOOK_OK and nothing else.',
          },
        ]),
      )
      .mockResolvedValueOnce(
        createResponse([
          {
            role: 'user',
            content: 'Reply with the exact token NOTEBOOK_OK and nothing else.',
          },
          {
            role: 'agent',
            content: 'NOTEBOOK_OK',
          },
        ]),
      );

    const reply = await waitForNotebookAgentReply({
      page: {
        request: {
          get: requestGet,
        },
      } as never,
      workspaceId: 'ws_test',
      projectId: 'proj_test',
      taskId: 'task_test',
      token: 'NOTEBOOK_OK',
    });

    expect(reply).toBe('NOTEBOOK_OK');
    expect(requestGet).toHaveBeenCalledTimes(2);
    expect(requestGet).toHaveBeenLastCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_test/projects/proj_test/tasks/task_test/messages',
      {
        headers: {
          Authorization: 'Bearer workspace-token',
        },
      },
    );
  });

  it('retries after a transient notebook messages transport failure', async () => {
    const requestGet = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(
        createResponse([
          {
            role: 'user',
            content: 'Reply with the exact token NOTEBOOK_OK and nothing else.',
          },
          {
            role: 'agent',
            content: 'NOTEBOOK_OK',
          },
        ]),
      );

    const reply = await waitForNotebookAgentReply({
      page: {
        request: {
          get: requestGet,
        },
      } as never,
      workspaceId: 'ws_test',
      projectId: 'proj_test',
      taskId: 'task_test',
      token: 'NOTEBOOK_OK',
    });

    expect(reply).toBe('NOTEBOOK_OK');
    expect(requestGet).toHaveBeenCalledTimes(2);
  });
});

describe('bindNotebookExecutionSocketToTask', () => {
  it('binds a notebook execution socket to the authoritative task session', () => {
    expect(
      bindNotebookExecutionSocketToTask({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_id=agent_123',
        taskId: 'task_456',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_id=agent_123&session_id=task_456');
  });

  it('replaces an existing session binding instead of appending duplicate session params', () => {
    expect(
      bindNotebookExecutionSocketToTask({
        wsUrl: 'wss://agents.example.com/api/v1/agent-execution/ws?agent_id=agent_123&session_id=stale_task',
        taskId: 'task_789',
      }),
    ).toBe('wss://agents.example.com/api/v1/agent-execution/ws?agent_id=agent_123&session_id=task_789');
  });
});
