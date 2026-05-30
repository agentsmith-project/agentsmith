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
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new WorkspaceAPI(client);
    const members = await api.listMembers('ws_1');

    expect(members).toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/members');
  });

  it('lists workspace project creators', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      items: [{ id: 'user_1', user_id: 'user_1', name: 'User One', email: 'user1@example.com' }],
    });
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

    const api = new WorkspaceAPI(client);
    const creators = await api.listProjectCreators('ws_1');

    expect(creators).toEqual([{ id: 'user_1', user_id: 'user_1', name: 'User One', email: 'user1@example.com' }]);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/project-creators');
  });

  it('updates workspace project creators', async () => {
    const mockPatch = vi.fn().mockResolvedValue({
      items: [{ id: 'user_2', user_id: 'user_2', name: 'User Two', email: 'user2@example.com' }],
    });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: mockPatch,
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new WorkspaceAPI(client);
    const creators = await api.updateProjectCreators('ws_1', ['user_2']);

    expect(creators).toEqual([{ id: 'user_2', user_id: 'user_2', name: 'User Two', email: 'user2@example.com' }]);
    expect(mockPatch).toHaveBeenCalledWith('/workspaces/ws_1/project-creators', {
      project_creator_user_ids: ['user_2'],
    });
  });

  it('searches workspace directory users', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      items: [{ user_id: 'user_3', email: 'user3@example.com', name: 'User Three' }],
    });
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

    const api = new WorkspaceAPI(client);
    const users = await api.searchDirectoryUsers('ws_1', 'user3@example.com');

    expect(users).toEqual([{ user_id: 'user_3', email: 'user3@example.com', name: 'User Three' }]);
    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/directory/users?query=user3%40example.com');
  });

  it('does not expose retired workspace Feishu helpers', () => {
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new WorkspaceAPI(client);
    const retiredApi = api as unknown as Record<string, unknown>;

    expect(retiredApi.getFeishuIntegration).toBeUndefined();
    expect(retiredApi.updateFeishuIntegration).toBeUndefined();
    expect(retiredApi.startFeishuVerification).toBeUndefined();
    expect(retiredApi.enableFeishuIntegration).toBeUndefined();
    expect(retiredApi.startWorkspaceFeishuAuth).toBeUndefined();
    expect(retiredApi.completeWorkspaceFeishuAuth).toBeUndefined();
  });
});
