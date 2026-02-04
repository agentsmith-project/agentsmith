import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';

describe('WorkspaceAPI', () => {
  it('lists workspace members', async () => {
    const mockGet = vi.fn().mockResolvedValue({ items: [] });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => new EventSource('http://localhost'),
    };

    const api = new WorkspaceAPI(client);
    const members = await api.listMembers('ws_1');

    expect(members).toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/members');
  });
});
