import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';

describe('EndpointAPI', () => {
  it('imports openai-compatible endpoint payload', async () => {
    const mockPost = vi.fn().mockResolvedValue({ items: [] });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => new EventSource('http://localhost'),
    };

    const api = new EndpointAPI(client);
    const payload = {
      reranker: {
        model: 'qwen3-reranker-0.6b',
        source_model: 'qwen3-reranker-0.6b',
        api_base: 'http://pullot.com:20551/v1',
        api_key: '20552055',
        mode: 'openai' as const,
      },
      embedding: {
        model: 'qwen3-embedding-0.6b',
        source_model: 'qwen3-embedding-0.6b',
        api_base: 'http://pullot.com:20553/v1',
        api_key: '20552055',
      },
      completion: {
        model: 'deepseek-chat',
        source_model: 'deepseek-chat',
        api_base: 'https://api.deepseek.com',
        api_key: 'sk-test',
      },
    };

    await api.importOpenAICompatible('ws_1', 'proj_1', payload);

    expect(mockPost).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/endpoints/import-openai-compatible',
      payload,
    );
  });
});
