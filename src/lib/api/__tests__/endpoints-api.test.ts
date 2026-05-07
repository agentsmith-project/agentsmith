import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import { queryKeys } from '@/lib/query-keys';

describe('EndpointAPI', () => {
  it('imports endpoint bundle payload', async () => {
    const mockPost = vi.fn().mockResolvedValue({ items: [] });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new EndpointAPI(client);
    const payload = {
      reranker: {
        model: 'qwen3-reranker-0.6b',
        api_base: 'http://pullot.com:20551/v1',
        api_key: '20552055',
        mode: 'openai' as const,
      },
      embedding: {
        model: 'qwen3-embedding-0.6b',
        api_base: 'http://pullot.com:20553/v1',
        api_key: '20552055',
      },
      completion: {
        model: 'deepseek-chat',
        api_base: 'https://api.deepseek.com',
        api_key: 'sk-test',
      },
    };

    await api.importBulk('ws_1', 'proj_1', payload);

    expect(mockPost).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/endpoints/import-bulk',
      payload,
    );
  });

  it('calls capability task endpoints', async () => {
    const mockPost = vi.fn().mockResolvedValue({});
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };
    const api = new EndpointAPI(client);

    await api.runRerank('ws_1', 'proj_1', 'ep_1', { query: 'a', documents: ['b'] });
    await api.generateImage('ws_1', 'proj_1', 'ep_1', { prompt: 'city' });
    await api.generateVideo('ws_1', 'proj_1', 'ep_1', { prompt: 'ocean' });
    await api.getVideoGenerationJob('ws_1', 'proj_1', 'ep_1', 'job_1');
    await api.cancelVideoGenerationJob('ws_1', 'proj_1', 'ep_1', 'job_1');

    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/workspaces/ws_1/projects/proj_1/endpoints/ep_1/rerank',
      { query: 'a', documents: ['b'] },
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      '/workspaces/ws_1/projects/proj_1/endpoints/ep_1/images/generations',
      { prompt: 'city' },
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      3,
      '/workspaces/ws_1/projects/proj_1/endpoints/ep_1/videos/generations',
      { prompt: 'ocean' },
    );
    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/endpoints/ep_1/videos/generations/job_1',
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      4,
      '/workspaces/ws_1/projects/proj_1/endpoints/ep_1/videos/generations/job_1/cancel',
      {},
    );
  });

  it('reads and updates the narrow Agent task model setting resource', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        endpoint_id: 'ep_1',
        endpoint_display_name: 'OpenAI production',
        default_model: 'gpt-5.5',
        setting_revision: 'set_7',
        updated_at: '2026-05-07T00:00:00.000Z',
        updated_by_user_id: 'user_1',
      },
      actions: {
        update: {
          operation: 'update',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
          danger_level: 'none',
        },
      },
    });
    const mockPatch = vi.fn().mockResolvedValue({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
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
      patch: mockPatch,
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };
    const api = new EndpointAPI(client);

    await api.getAgentTaskModelSetting('ws_1', 'proj_1');
    await api.updateAgentTaskModelSetting('ws_1', 'proj_1', {
      endpoint_id: 'ep_2',
      expected_setting_revision: 'set_7',
    });
    await api.updateAgentTaskModelSetting('ws_1', 'proj_1', {
      endpoint_id: 'ep_1',
      expected_setting_revision: null,
    });

    expect(mockGet).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/agent-task-model-setting',
    );
    expect(mockPatch).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/agent-task-model-setting',
      {
        endpoint_id: 'ep_2',
        expected_setting_revision: 'set_7',
      },
    );
    expect(mockPatch).toHaveBeenLastCalledWith(
      '/workspaces/ws_1/projects/proj_1/agent-task-model-setting',
      {
        endpoint_id: 'ep_1',
        expected_setting_revision: null,
      },
    );
    expect(queryKeys.endpoints.agentTaskModelSetting('ws_1', 'proj_1')).toEqual([
      'endpoints',
      'agent-task-model-setting',
      'ws_1',
      'proj_1',
    ]);
  });
});
