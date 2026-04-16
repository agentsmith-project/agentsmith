import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';

const { createFileLibraryGatewayClientMock } = vi.hoisted(() => ({
  createFileLibraryGatewayClientMock: vi.fn(),
}));

vi.mock('./file-library-gateway-client.js', async () => {
  const actual = await vi.importActual<typeof import('./file-library-gateway-client.js')>('./file-library-gateway-client.js');
  return {
    ...actual,
    createFileLibraryGatewayClient: createFileLibraryGatewayClientMock,
  };
});

import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
} from './file-library-runtime.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';

const OWNER_USER = { id: 'user_1', email: 'user@example.com', name: 'User One' } as never;

describe('project-file-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFileLibraryGatewayClientMock.mockReset();
  });

  function createDeps() {
    return {
      docStore: new InMemoryJsonDocStore(),
      fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
    } as never;
  }

  it('creates a file library and returns ready metadata when orchestrator is configured', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = createDeps();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Shared Docs',
        description: 'Library for documents',
      }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      201,
      expect.objectContaining({
        name: 'Shared Docs',
        status: 'ready',
      }),
    );
  });

  it('returns exchange data for an existing file library', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Shared Docs',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const exchangeJson = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryStorageCredentialExchange',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: exchangeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(exchangeJson).toHaveBeenCalledTimes(1);
    const [, statusCode, payload] = exchangeJson.mock.calls[0] as [unknown, number, {
      client_mount_access?: {
        filesystem_name?: string;
        metadata_url?: string;
        storage_bucket_url?: string;
        recommended_mount_commands?: Record<string, string>;
      };
    }];
    expect(statusCode).toBe(200);
    expect(payload.client_mount_access).toMatchObject({
      filesystem_name: expect.any(String),
      metadata_url: expect.stringContaining('postgres://'),
      storage_bucket_url: expect.stringContaining('http://localhost:19000/'),
    });
    expect(payload.client_mount_access?.recommended_mount_commands?.linux).toContain('"$HOME/Agentsmith/');
    expect(payload.client_mount_access?.recommended_mount_commands?.macos).toContain('"$HOME/Agentsmith/');
    expect(payload.client_mount_access?.recommended_mount_commands?.windows).toContain('%USERPROFILE%');
  });

  it('returns desktop mount access without shell commands', async () => {
    const previousPostgresHost = process.env.FILE_LIBRARY_CLIENT_POSTGRES_HOST;
    const previousPostgresPort = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
    const previousMinioEndpoint = process.env.JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT;
    process.env.FILE_LIBRARY_CLIENT_POSTGRES_HOST = '127.0.0.1';
    process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = '15432';
    process.env.JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT = 'http://127.0.0.1:19000';

    try {
      const json = vi.fn();
      const res = {} as never;
      const deps = createDeps();

      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: {} as never,
        res,
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue({
          name: 'Shared Docs',
        }),
      });

      const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
      const desktopJson = vi.fn();

      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryDesktopMountAccess',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: createdBody.id,
        req: {
          headers: {
            host: 'mbos.imotion.ai:3001',
            'x-forwarded-proto': 'https',
          },
          socket: {},
        } as never,
        res,
        deps,
        user: OWNER_USER,
        json: desktopJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);

      const [, statusCode, payload] = desktopJson.mock.calls[0] as [unknown, number, {
        desktop_mount_access?: {
          deployment_base_url?: string;
          default_mount_roots?: Record<string, string>;
          windows_requires_drive_letter?: boolean;
          metadata_url?: string;
          storage_bucket_url?: string;
          recommended_mount_commands?: unknown;
        };
      }];
      expect(statusCode).toBe(200);
      expect(payload.desktop_mount_access).toMatchObject({
        deployment_base_url: 'https://mbos.imotion.ai:3001',
        default_mount_roots: {
          linux: '~/AgentSmith',
          macos: '~/AgentSmith',
          windows: '%USERPROFILE%\\AgentSmith',
        },
        windows_requires_drive_letter: true,
        metadata_url: expect.stringContaining('@127.0.0.1:15432/'),
        storage_bucket_url: expect.stringContaining('http://127.0.0.1:19000/'),
      });
      expect(payload.desktop_mount_access?.recommended_mount_commands).toBeUndefined();
    } finally {
      process.env.FILE_LIBRARY_CLIENT_POSTGRES_HOST = previousPostgresHost;
      process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = previousPostgresPort;
      if (previousMinioEndpoint === undefined) {
        delete process.env.JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT;
      } else {
        process.env.JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT = previousMinioEndpoint;
      }
    }
  });

  it('prefers the public web base url for desktop sign-in guidance', async () => {
    const previousPublicWebBaseUrl = process.env.PUBLIC_WEB_BASE_URL;
    process.env.PUBLIC_WEB_BASE_URL = 'http://localhost:3101/';

    try {
      const json = vi.fn();
      const res = {} as never;
      const deps = createDeps();

      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: {} as never,
        res,
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue({
          name: 'Desktop Sign-in Guidance',
        }),
      });

      const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
      const desktopJson = vi.fn();

      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryDesktopMountAccess',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: createdBody.id,
        req: {
          headers: {
            host: 'localhost:21000',
          },
          socket: {},
        } as never,
        res,
        deps,
        user: OWNER_USER,
        json: desktopJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);

      const [, statusCode, payload] = desktopJson.mock.calls[0] as [unknown, number, {
        desktop_mount_access?: {
          deployment_base_url?: string;
        };
      }];
      expect(statusCode).toBe(200);
      expect(payload.desktop_mount_access?.deployment_base_url).toBe('http://localhost:3101');
    } finally {
      process.env.PUBLIC_WEB_BASE_URL = previousPublicWebBaseUrl;
    }
  });

  it('does not expose metadata credentials from backend details', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Shared Docs',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const backendJson = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryBackend',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: backendJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(backendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.not.objectContaining({
        metadata_url: expect.any(String),
      }),
    );
  });

  it('deletes failed libraries that never provisioned backend state', async () => {
    const json = vi.fn();
    const res = {
      end: vi.fn(),
    } as unknown as never;
    const deps = createDeps();
    await deps.docStore.upsert('project_file_libraries', 'flib_failed', {
      id: 'flib_failed',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Broken Smoke Library',
      description: 'failed provisioning',
      status: 'failed',
      filesystem_name: 'flib-broken-smoke-library',
      created_by_user_id: 'user_1',
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    });

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_failed',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect((res as unknown as { statusCode?: number }).statusCode).toBe(204);
    expect((res as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled();
    await expect(deps.docStore.get('project_file_libraries', 'flib_failed')).resolves.toBeNull();
  });

  it('returns a precise error when juicefs cli is unavailable during provisioning', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      fileLibraryOrchestrator: {
        provisionLibrary: vi.fn().mockRejectedValue(new Error('file_library_juicefs_cli_missing')),
      },
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
    } as never;

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Shared Docs',
      }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      503,
      expect.objectContaining({
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'file_library_juicefs_cli_missing',
      }),
    );
    await expect(deps.docStore.list('project_file_libraries')).resolves.toHaveLength(0);
  });

  it('returns a precise error when minio env is missing during provisioning', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      fileLibraryOrchestrator: {
        provisionLibrary: vi.fn().mockRejectedValue(new Error('file_library_env_missing_minio_access_key')),
      },
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
    } as never;

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Shared Docs',
      }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      503,
      expect.objectContaining({
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'file_library_env_missing_minio_access_key',
      }),
    );
    await expect(deps.docStore.list('project_file_libraries')).resolves.toHaveLength(0);
  });

  it('cleans up internal workspace bindings when deleting a file library', async () => {
    const json = vi.fn();
    const res = {
      end: vi.fn(),
      statusCode: 200,
    } as unknown as never;
    const deleteWorkspaceBinding = vi.fn().mockResolvedValue(undefined);
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
      internalAgentWorkspaceBindingManager: {
        deleteWorkspaceBinding,
      },
    } as never;

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Workspace Library',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    createFileLibraryGatewayClientMock.mockResolvedValue({
      listObjectsV2: vi.fn().mockReturnValue(Readable.from([])),
    });
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: createdBody.id,
    });
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('rejects deleting a file library while an active task is using it', async () => {
    const json = vi.fn();
    const res = {
      end: vi.fn(),
      statusCode: 200,
    } as unknown as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Workspace Library',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_active', {
      id: 'task_active',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Active Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: createdBody.id,
      workspace_file_library_name: createdBody.name,
      status: 'active',
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    });

    const deleteJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: deleteJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(deleteJson).toHaveBeenCalledWith(
      res,
      409,
      expect.objectContaining({
        error_code: 'RESOURCE_CONFLICT',
        message: 'file_library_task_in_use',
      }),
    );
  });

  it('cancels file library downloads when the client disconnects mid-stream', async () => {
    const json = vi.fn();
    const createRes = {} as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createRes,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Download Contract',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 11,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockResolvedValue(objectStream),
    });

    const req = new EventEmitter() as http.IncomingMessage;
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2Fhello.txt';
    req.headers = {};
    const res = new PassThrough() as PassThrough & http.ServerResponse & {
      headers: Record<string, string>;
    };
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
      res.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
      return res;
    }) as never;

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res: res as unknown as http.ServerResponse,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    res.emit('close');

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('cancels file library downloads when the client already aborted before the bridge attaches listeners', async () => {
    const json = vi.fn();
    const createRes = {} as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createRes,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Download Early Abort',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    let resolveGetObject: ((stream: PassThrough) => void) | null = null;
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 11,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockImplementation(() => new Promise<PassThrough>((resolve) => {
        resolveGetObject = resolve;
      })),
    });

    const req = new EventEmitter() as http.IncomingMessage & { aborted: boolean };
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2Fhello.txt';
    req.headers = {};
    req.aborted = false;
    const res = new PassThrough() as PassThrough & http.ServerResponse & {
      headers: Record<string, string>;
    };
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
      res.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
      return res;
    }) as never;

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res: res as unknown as http.ServerResponse,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    req.aborted = true;
    req.emit('aborted');
    resolveGetObject?.(objectStream);

    await expect(routePromise).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('propagates upload aborts into the backing gateway stream lifecycle', async () => {
    const json = vi.fn();
    const createRes = {} as never;
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createRes,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Upload Contract',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    let destroyError: Error | null = null;
    const putObject = vi.fn().mockImplementation(
      async (_bucket: string, _key: string, stream: Readable) =>
        new Promise<void>((_resolve, reject) => {
          const originalDestroy = stream.destroy.bind(stream);
          stream.destroy = ((error?: Error) => {
            destroyError = error ?? null;
            return originalDestroy(error);
          }) as typeof stream.destroy;
          stream.on('error', (error) => {
            reject(error);
          });
          stream.resume();
        }),
    );

    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockRejectedValue(new Error('object_not_found')),
      putObject,
    });

    const boundary = '----agentsmith-upload-boundary';
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };

    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as http.ServerResponse;

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    });

    req.write(`--${boundary}\r\n`);
    req.write('Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n');
    req.write('Content-Type: text/plain\r\n\r\n');
    req.write('hello');
    await new Promise((resolve) => setImmediate(resolve));
    expect(putObject).toHaveBeenCalledTimes(1);

    req.emit('aborted');
    req.destroy();

    await expect(routePromise).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(destroyError?.name).toBe('AbortError');
  });
});
