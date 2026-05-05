import { describe, expect, it, vi } from 'vitest';
import { TaskAPI } from '@/lib/api/endpoints/tasks';
import type { ApiClient } from '@/lib/api/client';

function createMockClient(): ApiClient {
  return {
    setToken: vi.fn(),
    getToken: vi.fn(() => null),
    clearToken: vi.fn(),
    get: vi.fn(),
    getBlob: vi.fn(),
    post: vi.fn(),
    postMultipart: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    connectSSE: vi.fn(),
  };
}

describe('TaskAPI public Agent Task activity/run surface', () => {
  it('lists task activity from the activity route instead of public messages', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue([]);
    const api = new TaskAPI(client);

    await api.listActivity('ws_default', 'proj_1', 'task_1');

    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_default/projects/proj_1/tasks/task_1/activity',
    );
    expect(client.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/messages'),
    );
  });

  it('starts a task run with intent and input refs through the runs route', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({
      id: 'msg_runner',
      task_id: 'task_1',
      kind: 'runner_output',
      actor: 'runner',
      content: '',
      created_at: '2026-03-06T04:00:00.000Z',
      run_id: 'run_1',
    });
    const api = new TaskAPI(client);

    await api.startRun('ws_default', 'proj_1', 'task_1', {
      intent: 'Summarize the attached report',
      input_refs: [
        {
          kind: 'url',
          url: 'https://example.com/report',
          name: 'report',
        },
      ],
    });

    expect(client.post).toHaveBeenCalledWith(
      '/workspaces/ws_default/projects/proj_1/tasks/task_1/runs',
      {
        intent: 'Summarize the attached report',
        input_refs: [
          {
            kind: 'url',
            url: 'https://example.com/report',
            name: 'report',
          },
        ],
      },
    );
    expect(client.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/messages'),
      expect.anything(),
    );
    const postedBody = vi.mocked(client.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('role');
    expect(postedBody).not.toHaveProperty('content');
  });
});
