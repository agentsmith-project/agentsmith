import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';

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
});
