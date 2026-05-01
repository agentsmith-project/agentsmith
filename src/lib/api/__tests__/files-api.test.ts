import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchApiClient } from '@/lib/api/adapters/fetch-adapter';
import { API_BASE, ApiError, type ApiClient } from '@/lib/api/client';
import { FilesAPI } from '@/lib/api/endpoints/files';

vi.mock('@/lib/auth/session-recovery', () => ({
  notifyUnauthorized: vi.fn(),
  tryRefreshSession: vi.fn().mockResolvedValue(false),
}));

describe('FilesAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes abort signal through object listing requests', async () => {
    const controller = new AbortController();
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn().mockResolvedValue({
        path: 'docs/',
        items: [],
        next_continuation_token: null,
      }),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);
    await api.listObjects('ws_1', 'proj_1', 'flib_1', { prefix: 'docs/', page_size: 200 }, {
      signal: controller.signal,
    });

    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/entries?path=docs%2F&page_size=200',
      { signal: controller.signal },
    );
  });

  it('passes object listing aborts through the FetchApiClient fetch path', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new FilesAPI(new FetchApiClient());
    const listingPromise = api.listObjects(
      'ws_1',
      'proj_1',
      'flib_1',
      { prefix: 'docs/', page_size: 200 },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(listingPromise).rejects.toMatchObject({
      errorCode: 'NETWORK_ERROR',
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/entries?path=docs%2F&page_size=200`,
      expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
      }),
    );
    expect(controller.signal.aborted).toBe(true);
  });

  it('routes object downloads through the shared blob client path', async () => {
    const blob = new Blob(['downloaded'], { type: 'text/plain' });
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn().mockResolvedValue(blob),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);
    await expect(api.downloadObject('ws_1', 'proj_1', 'flib_1', 'docs/guide.txt')).resolves.toBe(blob);

    expect(client.getBlob).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/download',
      { params: { path: 'docs/guide.txt' } },
    );
  });

  it('routes object uploads through the shared multipart client path', async () => {
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn().mockResolvedValue({
        kind: 'file',
        path: 'docs/guide.txt',
        name: 'guide.txt',
        size_bytes: 12,
        content_type: 'text/plain',
        modified_at: '2026-04-02T10:00:00.000Z',
        etag: 'etag-1',
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const file = new File(['hello world'], 'guide.txt', { type: 'text/plain' });
    const onProgress = vi.fn();
    const api = new FilesAPI(client);

    await expect(
      api.uploadObject('ws_1', 'proj_1', 'flib_1', file, 'docs', true, undefined, onProgress),
    ).resolves.toEqual({
      kind: 'object',
      key: 'docs/guide.txt',
      name: 'guide.txt',
      size_bytes: 12,
      content_type: 'text/plain',
      etag: 'etag-1',
      last_modified: '2026-04-02T10:00:00.000Z',
    });

    expect(client.postMultipart).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/upload',
      expect.any(FormData),
      {
        signal: undefined,
        onProgress,
      },
    );
  });
});
