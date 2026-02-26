import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { AgentAPI } from '@/lib/api/endpoints/agents';

describe('AgentAPI.getDiagnostics', () => {
  it('calls diagnostics endpoint', async () => {
    const mockGet = vi.fn().mockResolvedValue({ queue_depth: 3 });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new AgentAPI(client);
    const res = await api.getDiagnostics('ws_1', 'prj_1', 'ag_1');

    expect(res.queue_depth).toBe(3);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/projects/prj_1/agents/ag_1/diagnostics');
  });
});
