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

  it('reads and updates workspace Feishu integration settings', async () => {
    const mockGet = vi.fn().mockResolvedValue({ id: 'workspace_feishu:ws_1', workspace_id: 'ws_1', provider: 'feishu', status: 'not_configured' });
    const mockPut = vi.fn().mockResolvedValue({ id: 'workspace_feishu:ws_1', workspace_id: 'ws_1', provider: 'feishu', status: 'verification_required' });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: mockGet,
      post: vi.fn(),
      put: mockPut,
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new WorkspaceAPI(client);
    await api.getFeishuIntegration('ws_1');
    await api.updateFeishuIntegration('ws_1', {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      redirect_uri: 'http://localhost:3001/en-US/workspaces/ws_1/feishu/callback',
    });

    expect(mockGet).toHaveBeenCalledWith('/workspaces/ws_1/integrations/feishu');
    expect(mockPut).toHaveBeenCalledWith('/workspaces/ws_1/integrations/feishu', {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      redirect_uri: 'http://localhost:3001/en-US/workspaces/ws_1/feishu/callback',
    });
  });

  it('starts verification and user auth for workspace Feishu', async () => {
    const mockPost = vi.fn().mockResolvedValue({
      authorization_url: 'https://accounts.feishu.cn/auth',
      state: 'state_1',
      redirect_uri: 'http://localhost:3001/en-US/workspaces/ws_1/feishu/callback',
      expires_at: '2026-03-19T00:00:00.000Z',
    });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new WorkspaceAPI(client);
    await api.startFeishuVerification('ws_1', '/en-US/workspaces/ws_1/settings/feishu?step=enable');
    await api.startWorkspaceFeishuAuth('ws_1', '/en-US/workspaces/ws_1/connections?provider=feishu');

    expect(mockPost).toHaveBeenNthCalledWith(1, '/workspaces/ws_1/integrations/feishu/verify/start', {
      post_redirect_path: '/en-US/workspaces/ws_1/settings/feishu?step=enable',
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/workspaces/ws_1/me/feishu/auth/start', {
      post_redirect_path: '/en-US/workspaces/ws_1/connections?provider=feishu',
    });
  });
});
