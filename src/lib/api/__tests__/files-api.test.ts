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

  it('normalizes file-library delete 204 responses as deleted results', async () => {
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
      delete: vi.fn().mockResolvedValue(undefined),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);

    await expect(api.deleteLibrary('ws_1', 'proj_1', 'flib_1')).resolves.toEqual({
      status: 'deleted',
    });
    expect(client.delete).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1',
    );
  });

  it('returns accepted file-library delete operation results for 202 responses', async () => {
    const accepted = {
      file_library_id: 'flib_1',
      file_library_status: 'deleting' as const,
      operation_id: 'op_repo_delete',
      operation_status: 'pending' as const,
    };
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
      delete: vi.fn().mockResolvedValue(accepted),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);

    await expect(api.deleteLibrary('ws_1', 'proj_1', 'flib_1')).resolves.toEqual({
      status: 'accepted',
      ...accepted,
    });
  });

  it('rejects malformed non-empty file-library delete response bodies instead of treating them as deleted', async () => {
    const malformedAccepted = {
      file_library_id: 'flib_1',
      file_library_status: 'deleting',
      operation_id: 'op_repo_delete',
      operation_status: 'queued',
    };
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
      delete: vi.fn().mockResolvedValue(malformedAccepted),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);

    await expect(api.deleteLibrary('ws_1', 'proj_1', 'flib_1')).rejects.toMatchObject({
      errorCode: 'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID',
      statusCode: 202,
      details: {
        file_library_id: 'flib_1',
      },
    });
  });

  it('rejects accepted file-library delete responses without an operation id', async () => {
    const acceptedWithoutOperationId = {
      file_library_id: 'flib_1',
      file_library_status: 'deleting',
      operation_id: null,
      operation_status: 'pending',
    };
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
      delete: vi.fn().mockResolvedValue(acceptedWithoutOperationId),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);

    await expect(api.deleteLibrary('ws_1', 'proj_1', 'flib_1')).rejects.toMatchObject({
      errorCode: 'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID',
      statusCode: 202,
      details: {
        file_library_id: 'flib_1',
      },
    });
  });

  it('routes file-library operation projection requests through the project scoped path', async () => {
    const projection = {
      operation_id: 'op_repo_delete',
      operation_state: 'succeeded',
      operation_type: 'repo_delete',
      resource: { type: 'repo' },
      error: null,
      updated_at: '2026-05-09T00:00:01.000Z',
    };
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn().mockResolvedValue(projection),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const api = new FilesAPI(client);

    await expect(api.getFileLibraryOperationProjection('ws_1', 'proj_1', 'op_repo_delete'))
      .resolves.toEqual(projection);
    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-library-operations/op_repo_delete',
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

  it('routes file-library save point and direct restore requests through project scoped paths', async () => {
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi
        .fn()
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ restore_operation: null }),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'sp_1',
          file_library_id: 'flib_1',
          message: 'Before edits',
          created_at: '2026-05-09T12:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'flro_1',
          file_library_id: 'flib_1',
          source_save_point_id: 'sp_1',
          status: 'succeeded',
          created_at: '2026-05-09T12:02:00.000Z',
          updated_at: '2026-05-09T12:02:00.000Z',
        }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };
    const api = new FilesAPI(client);

    await api.listSavePoints('ws_1', 'proj_1', 'flib_1');
    await api.createSavePoint('ws_1', 'proj_1', 'flib_1', { message: 'Before edits' });
    await api.getActiveRestoreOperation('ws_1', 'proj_1', 'flib_1');
    await api.restoreFileLibrary(
      'ws_1',
      'proj_1',
      'flib_1',
      { save_point_id: 'sp_1' },
      { idempotencyKey: 'restore-key-1' },
    );

    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/save-points',
    );
    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/restore',
    );
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/save-points',
      { message: 'Before edits' },
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/restore',
      { save_point_id: 'sp_1' },
      {
        headers: {
          'Idempotency-Key': 'restore-key-1',
        },
      },
    );
  });

  it('releases file-library runtime access through the library scoped route without task ticket payload', async () => {
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn(),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn().mockResolvedValue({
        file_library_id: 'flib_1',
        released: true,
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };
    const api = new FilesAPI(client);

    await expect(api.releaseRuntimeAccess('ws_1', 'proj_1', 'flib_1')).resolves.toEqual({
      file_library_id: 'flib_1',
      released: true,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/file-libraries/flib_1/runtime-access/release',
      undefined,
    );
  });

  it('routes project task file template requests through project scoped paths', async () => {
    const client: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: vi.fn().mockResolvedValue({ items: [] }),
      getBlob: vi.fn(),
      postMultipart: vi.fn(),
      post: vi.fn().mockResolvedValue({
        id: 'tmpl_1',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        source_library_id: 'flib_1',
        name: 'Starter',
        status: 'published',
        created_by_user_id: 'user_1',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:00.000Z',
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };
    const api = new FilesAPI(client);

    await api.listTaskFileTemplates('ws_1', 'proj_1');
    await api.createTaskFileTemplate('ws_1', 'proj_1', {
      source_library_id: 'flib_1',
      name: 'Starter',
      description: 'Baseline files',
    });
    await api.publishTaskFileTemplate('ws_1', 'proj_1', 'tmpl_1');
    await api.unpublishTaskFileTemplate('ws_1', 'proj_1', 'tmpl_1');
    await api.deleteTaskFileTemplate('ws_1', 'proj_1', 'tmpl_1');

    expect(client.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/task-file-templates',
    );
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/workspaces/ws_1/projects/proj_1/task-file-templates',
      {
        source_library_id: 'flib_1',
        name: 'Starter',
        description: 'Baseline files',
      },
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      '/workspaces/ws_1/projects/proj_1/task-file-templates/tmpl_1/publish',
      undefined,
    );
    expect(client.post).toHaveBeenNthCalledWith(
      3,
      '/workspaces/ws_1/projects/proj_1/task-file-templates/tmpl_1/unpublish',
      undefined,
    );
    expect(client.delete).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/task-file-templates/tmpl_1',
    );
  });
});
