import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { FilesAPI } from '@/lib/api/endpoints/files';

describe('FilesAPI', () => {
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
