import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { AgentRunnerAPI } from '@/lib/api/endpoints/agent-runners';

describe('AgentRunnerAPI.getDiagnostics', () => {
  it('calls the canonical Agent Runners diagnostics endpoint', async () => {
    const mockGet = vi.fn().mockResolvedValue({ queue_depth: 3 });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: mockGet,
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new AgentRunnerAPI(client);
    const res = await api.getDiagnostics('ws_1', 'prj_1', 'ag_1');

    expect(res.queue_depth).toBe(3);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/projects/prj_1/agent-runners/ag_1/diagnostics');
  });
});
