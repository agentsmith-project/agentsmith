import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { FileLibraryTaskInUseErrorSchema } from '@mbos/contracts';

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
import { putGatewayObjectStream } from './object-stream-bridge.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
} from './file-library-runtime.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';
import {
  JsonDocTaskFileLibraryBindingRepo,
  __resetTaskFileLibraryBindingsForTests,
} from './notebook-task/task-file-library-bindings.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import { listAuditEvents } from './audit-usage-store.js';

const OWNER_USER = { id: 'user_1', email: 'user@example.com', name: 'User One' } as never;

describe('project-file-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFileLibraryGatewayClientMock.mockReset();
    __resetTaskFileLibraryBindingsForTests();
  });

  function readContentDispositionHeader(
    headers: Record<string, string> | undefined,
  ): { raw: string; fallback: string | null } {
    const raw = headers?.['content-disposition'] ?? '';
    const fallbackMatch = raw.match(/filename="([^"]+)"/);
    return {
      raw,
      fallback: fallbackMatch?.[1] ?? null,
    };
  }

  async function nextTick(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

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
        task_home_binding_status: 'unbound',
        bound_task_visible: false,
      }),
    );
  });

  it('redacts infra failure details before returning file-library errors', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      fileLibraryOrchestrator: {
        provisionLibrary: vi.fn(async () => {
          throw new Error(
            'juicefs failed metadata_url=postgres://jfsu_user:super-secret@localhost:15432/jfs_lib?sslmode=disable MINIO_SECRET_KEY=minio-secret',
          );
        }),
      },
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
        name: 'Leaky Failure Library',
      }),
    })).resolves.toBe(true);

    const payload = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(502);
    expect(payload).toMatchObject({
      error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
      message: 'file_library_operation_failed',
    });
    expect(JSON.stringify(payload)).not.toContain('super-secret');
    expect(JSON.stringify(payload)).not.toContain('MINIO_SECRET_KEY');
    expect(JSON.stringify(payload)).not.toContain('metadata_url');
  });

  it('returns visible task HOME binding state in file library list and detail responses', async () => {
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
        name: 'Task Home Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_visible_binding', {
      id: 'task_visible_binding',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Visible Binding Task',
      workspace_file_library_id: createdBody.id,
      workspace_file_library_name: createdBody.name,
      status: 'archived',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(listJson).toHaveBeenCalledWith(
      res,
      200,
      {
        items: [
          expect.objectContaining({
            id: createdBody.id,
            task_home_binding_status: 'bound',
            bound_task_id: 'task_visible_binding',
            bound_task_title: 'Visible Binding Task',
            bound_task_status: 'archived',
            bound_task_visible: true,
          }),
        ],
      },
    );

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(detailJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        id: createdBody.id,
        task_home_binding_status: 'bound',
        bound_task_id: 'task_visible_binding',
        bound_task_title: 'Visible Binding Task',
        bound_task_status: 'archived',
        bound_task_visible: true,
      }),
    );
  });

  it('hides task identity fields when a file library binding task is not actor-visible', async () => {
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
        name: 'Hidden Binding Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_hidden_binding', {
      id: 'task_hidden_binding',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_2',
      title: 'Hidden Binding Task',
      workspace_file_library_id: createdBody.id,
      workspace_file_library_name: createdBody.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const payload = detailJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: createdBody.id,
      task_home_binding_status: 'bound',
      bound_task_visible: false,
    });
    expect(payload).not.toHaveProperty('bound_task_id');
    expect(payload).not.toHaveProperty('bound_task_title');
    expect(payload).not.toHaveProperty('bound_task_status');
  });

  it('returns task HOME binding state in file library update responses', async () => {
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
        name: 'Patch Binding Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_patch_binding', {
      id: 'task_patch_binding',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Patch Binding Task',
      workspace_file_library_id: createdBody.id,
      workspace_file_library_name: createdBody.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const patchJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'PATCH',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: patchJson,
      readBody: vi.fn().mockResolvedValue({
        description: 'Updated description',
      }),
    })).resolves.toBe(true);

    expect(patchJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        id: createdBody.id,
        description: 'Updated description',
        task_home_binding_status: 'bound',
        bound_task_id: 'task_patch_binding',
        bound_task_title: 'Patch Binding Task',
        bound_task_status: 'active',
        bound_task_visible: true,
      }),
    );
  });

  it('rebuilds file library task HOME bindings from current task records on hydrate', async () => {
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
        name: 'Hydrate Current Records Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_hydrate_binding', {
      id: 'task_hydrate_binding',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Hydrate binding task',
      workspace_file_library_id: createdBody.id,
      workspace_file_library_name: createdBody.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const boundJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: boundJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(boundJson.mock.calls[0]?.[2]).toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_id: 'task_hydrate_binding',
    });

    await deps.docStore.delete(notebookTasksCollection('ws_default'), 'task_hydrate_binding');

    const stillBoundJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: stillBoundJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(stillBoundJson.mock.calls[0]?.[2]).toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_id: 'task_hydrate_binding',
    });

    const binding = await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: createdBody.id,
    });
    if (!binding) throw new Error('expected durable binding');
    await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: createdBody.id,
      taskId: binding.taskId,
      bindingGeneration: binding.bindingGeneration,
      correlationId: 'release_hydrate_binding',
    });

    const unboundJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: OWNER_USER,
      json: unboundJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(unboundJson.mock.calls[0]?.[2]).toMatchObject({
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    });
    expect(unboundJson.mock.calls[0]?.[2]).not.toHaveProperty('bound_task_id');
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

  it('redacts raw gateway health errors from backend details', async () => {
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
        name: 'Health Leak Guard',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const rawError = [
      'juicefs gateway failed',
      'metadata_url=postgres://jfsu_user:super-secret@localhost:15432/jfs_lib?sslmode=disable',
      'MINIO_SECRET_KEY=minio-secret',
    ].join(' ');
    deps.fileLibraryGatewayManager = {
      ensureGateway: vi.fn(),
      stopGateway: vi.fn(),
      getHealth: vi.fn(async () => ({
        status: 'failed',
        checkedAt: new Date().toISOString(),
        lastError: rawError,
      })),
    };

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

    const payload = backendJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload.last_error).toBe('file_library_operation_failed');
    expect(JSON.stringify(payload)).not.toContain('super-secret');
    expect(JSON.stringify(payload)).not.toContain('MINIO_SECRET_KEY');
    expect(JSON.stringify(payload)).not.toContain('metadata_url');
    expect(JSON.stringify(payload)).not.toContain('postgres://');
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

  it.each([
    'creating',
    'degraded',
    'failed',
  ] as const)('rejects write and mount entrypoints while a file library is %s', async (status) => {
    const deps = createDeps();
    const res = {
      statusCode: 200,
      end: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as http.ServerResponse;
    const now = new Date().toISOString();
    await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).save({
      id: `flib_${status}`,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: `${status} Library`,
      status,
      filesystem_name: `flib-${status}`,
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    } as never);

    const multipartReq = () => {
      const req = new PassThrough() as PassThrough & http.IncomingMessage;
      req.headers = {
        'content-type': 'multipart/form-data; boundary=----agentsmith-non-ready-upload',
      };
      req.end([
        '------agentsmith-non-ready-upload',
        'Content-Disposition: form-data; name="file"; filename="hello.txt"',
        'Content-Type: text/plain',
        '',
        'hello',
        '------agentsmith-non-ready-upload--',
        '',
      ].join('\r\n'));
      return req;
    };
    const cases: Array<{
      routeKind: Parameters<typeof handleProjectFileLibraryRoutes>[0]['routeKind'];
      req?: http.IncomingMessage;
      readBody?: () => Promise<unknown>;
    }> = [
      {
        routeKind: 'fileLibraryFolders',
        readBody: async () => ({ path: 'docs' }),
      },
      {
        routeKind: 'fileLibraryDelete',
        readBody: async () => ({ paths: ['docs/hello.txt'] }),
      },
      {
        routeKind: 'fileLibraryMove',
        readBody: async () => ({
          from_path: 'docs/hello.txt',
          to_path: 'docs/renamed.txt',
        }),
      },
      {
        routeKind: 'fileLibraryUpload',
        req: multipartReq(),
      },
      {
        routeKind: 'fileLibraryStorageCredentialExchange',
      },
      {
        routeKind: 'fileLibraryDesktopMountAccess',
        req: { headers: { host: 'localhost:3000' }, socket: {} } as never,
      },
    ];

    for (const entry of cases) {
      const json = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: entry.routeKind,
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: `flib_${status}`,
        req: entry.req ?? { headers: {} } as never,
        res,
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn(entry.readBody ?? (async () => ({}))),
      })).resolves.toBe(true);
      expect(json).toHaveBeenCalledWith(
        res,
        409,
        {
          error_code: 'FILE_LIBRARY_NOT_READY',
          message: 'file_library_not_ready',
          file_library_id: `flib_${status}`,
          file_library_status: status,
        },
      );
    }
    expect(createFileLibraryGatewayClientMock).not.toHaveBeenCalled();
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

  it('repairs a stuck deleting file library by resuming delete when no task binding remains', async () => {
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
        name: 'Stuck Deleting Library',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const stored = await deps.docStore.get<Record<string, unknown>>('project_file_libraries', createdBody.id);
    await deps.docStore.upsert('project_file_libraries', createdBody.id, {
      ...stored,
      status: 'deleting',
      delete_correlation_id: 'req_previous_crash',
      updated_at: new Date().toISOString(),
    });
    createFileLibraryGatewayClientMock.mockResolvedValue({
      listObjectsV2: vi.fn().mockReturnValue(Readable.from([])),
    });

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: { headers: { 'x-request-id': 'req_repair_stuck_deleting' } } as never,
      res,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
    await expect(deps.docStore.get('project_file_libraries', createdBody.id)).resolves.toBeNull();
  });

  it('rolls deleting libraries back to ready with a new version when delete finds content', async () => {
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
        name: 'Non Empty Library',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; version: number };
    createFileLibraryGatewayClientMock.mockResolvedValue({
      listObjectsV2: vi.fn().mockReturnValue(Readable.from([{ name: 'workspace/notes.md' }])),
    });

    const deleteJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: { headers: { 'x-request-id': 'req_delete_non_empty' } } as never,
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
        error_code: 'FILE_LIBRARY_NOT_EMPTY',
        message: 'file_library_not_empty',
        file_library_id: createdBody.id,
      }),
    );
    await expect(deps.docStore.get<Record<string, unknown>>('project_file_libraries', createdBody.id))
      .resolves.toMatchObject({
        status: 'ready',
        version: expect.any(Number),
        delete_correlation_id: 'req_delete_non_empty',
      });
    const updatedLibrary = await deps.docStore.get<{ version: number }>('project_file_libraries', createdBody.id);
    expect(updatedLibrary?.version).toBeGreaterThan(createdBody.version);
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
    await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: createdBody.id,
      taskId: 'task_active',
      taskTitle: 'Active Task',
      taskStatus: 'active',
      ownerUserId: 'user_1',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_active_binding',
      now: new Date().toISOString(),
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
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: createdBody.id,
        bound_task_visible: true,
        bound_task_id: 'task_active',
        bound_task_title: 'Active Task',
        bound_task_status: 'active',
      }),
    );
    expect(FileLibraryTaskInUseErrorSchema.safeParse(deleteJson.mock.calls[0]?.[2]).success).toBe(true);
    const auditRows = await listAuditEvents(deps.docStore, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      startTime: '1970-01-01T00:00:00.000Z',
      endTime: '2999-01-01T00:00:00.000Z',
      page: 1,
      pageSize: 50,
    });
    expect(auditRows.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'project.file_library.delete.blocked',
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        metadata_json: expect.objectContaining({
          file_library_id: createdBody.id,
          bound_task_visible: true,
          bound_task_id: 'task_active',
        }),
      }),
    ]));
    expect(JSON.stringify(auditRows.items)).not.toContain('metadata_url');
    expect(JSON.stringify(auditRows.items)).not.toContain('storage_bucket_url');
  });

  it('redacts bound task identity when delete is blocked by another user task binding', async () => {
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
        name: 'Hidden Delete Binding Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: createdBody.id,
      taskId: 'task_hidden_delete_binding',
      taskTitle: 'Hidden Delete Binding Task',
      taskStatus: 'active',
      ownerUserId: 'user_2',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_hidden_delete_binding',
      now: new Date().toISOString(),
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
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: createdBody.id,
        bound_task_visible: false,
      }),
    );
    const payload = deleteJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('bound_task_id');
    expect(payload).not.toHaveProperty('bound_task_title');
    expect(payload).not.toHaveProperty('bound_task_status');
    expect(FileLibraryTaskInUseErrorSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects deleting a file library while any undeleted task is still using it', async () => {
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
        name: 'Archived Task Workspace',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string; name: string };
    await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: createdBody.id,
      taskId: 'task_archived',
      taskTitle: 'Archived Task',
      taskStatus: 'archived',
      ownerUserId: 'user_1',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_archived_binding',
      now: new Date().toISOString(),
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
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: createdBody.id,
        bound_task_visible: true,
        bound_task_id: 'task_archived',
        bound_task_title: 'Archived Task',
        bound_task_status: 'archived',
      }),
    );
    expect(FileLibraryTaskInUseErrorSchema.safeParse(deleteJson.mock.calls[0]?.[2]).success).toBe(true);
  });

  it('waits for a newly created root folder to become immediately visible before returning', async () => {
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
        name: 'Fresh Visibility Contract',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    let rootListCalls = 0;
    const putObject = vi.fn().mockResolvedValue(undefined);
    createFileLibraryGatewayClientMock.mockResolvedValue({
      putObject,
      listObjectsV2: vi.fn().mockImplementation((_bucket: string, prefix: string) => {
        if (prefix !== '') {
          return Readable.from([]);
        }
        rootListCalls += 1;
        if (rootListCalls < 2) {
          return Readable.from([]);
        }
        return Readable.from([{ prefix: 'docs/' }]);
      }),
    });

    const folderRes = {
      statusCode: 200,
      end: vi.fn(),
    } as unknown as http.ServerResponse & { end: ReturnType<typeof vi.fn>; statusCode: number };

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryFolders',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res: folderRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({
        path: 'docs',
      }),
    })).resolves.toBe(true);

    expect(putObject).toHaveBeenCalledWith(
      expect.any(String),
      'docs/',
      expect.any(Buffer),
      0,
      expect.objectContaining({
        'Content-Type': 'application/x-directory',
      }),
    );
    expect(folderRes.statusCode).toBe(204);
    expect(folderRes.end).toHaveBeenCalledTimes(1);

    const entriesJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {
        url: '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/entries',
      } as never,
      res: {} as never,
      deps,
      user: OWNER_USER,
      json: entriesJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(entriesJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        path: '',
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: 'directory',
            path: 'docs/',
            name: 'docs',
          }),
        ]),
      }),
    );
  });

  it('retries a transient first folder write for a freshly created library', async () => {
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
        name: 'Fresh Retry Contract',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    const transientBucketNotReadyError = Object.assign(
      new Error('The specified bucket does not exist'),
      { code: 'NoSuchBucket' },
    );
    const putObject = vi.fn()
      .mockRejectedValueOnce(transientBucketNotReadyError)
      .mockResolvedValue(undefined);
    createFileLibraryGatewayClientMock.mockResolvedValue({
      putObject,
      listObjectsV2: vi.fn().mockReturnValue(Readable.from([{ prefix: 'docs/' }])),
    });

    const folderRes = {
      statusCode: 200,
      end: vi.fn(),
    } as unknown as http.ServerResponse & { end: ReturnType<typeof vi.fn>; statusCode: number };

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryFolders',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res: folderRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({
        path: 'docs',
      }),
    })).resolves.toBe(true);

    expect(putObject).toHaveBeenCalledTimes(2);
    expect(folderRes.statusCode).toBe(204);
    expect(folderRes.end).toHaveBeenCalledTimes(1);
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

  it('keeps a raw UTF-8 multipart filename decoded as UTF-8 during file library upload', async () => {
    const createJson = vi.fn();
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: {} as never,
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'UTF-8 Uploads',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    const statObject = vi.fn()
      .mockRejectedValueOnce(new Error('object_not_found'))
      .mockResolvedValueOnce({
        size: 5,
        metaData: { 'content-type': 'text/plain' },
        lastModified: new Date('2026-04-22T10:00:00.000Z'),
        etag: 'etag-utf8-upload',
      });
    const putObject = vi.fn().mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
    ) => {
      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', reject);
        stream.resume();
      });
    });
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject,
      putObject,
    });

    const boundary = '----agentsmith-upload-utf8-filename';
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const uploadJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res: {
        setHeader: vi.fn(),
        end: vi.fn(),
      } as never,
      deps,
      user: OWNER_USER,
      json: uploadJson,
      readBody: vi.fn(),
    });

    req.write(`--${boundary}\r\n`);
    req.write('Content-Disposition: form-data; name="file"; filename="中文材料.txt"\r\n');
    req.write('Content-Type: text/plain\r\n\r\n');
    req.write('hello');
    req.end(`\r\n--${boundary}--\r\n`);

    await expect(routePromise).resolves.toBe(true);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(uploadJson).toHaveBeenCalledWith(
      expect.anything(),
      201,
      expect.objectContaining({
        kind: 'file',
        name: '中文材料.txt',
        path: '中文材料.txt',
      }),
    );
  });

  it('accepts RFC 5987 filename* upload parameters and prefers the UTF-8 filename value', async () => {
    const createJson = vi.fn();
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: {} as never,
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Extended Filename Uploads',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    const statObject = vi.fn()
      .mockRejectedValueOnce(new Error('object_not_found'))
      .mockResolvedValueOnce({
        size: 5,
        metaData: { 'content-type': 'text/plain' },
        lastModified: new Date('2026-04-22T10:00:00.000Z'),
        etag: 'etag-filename-star-upload',
      });
    const putObject = vi.fn().mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
    ) => {
      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', reject);
        stream.resume();
      });
    });
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject,
      putObject,
    });

    const boundary = '----agentsmith-upload-filename-star';
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const uploadJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res: {
        setHeader: vi.fn(),
        end: vi.fn(),
      } as never,
      deps,
      user: OWNER_USER,
      json: uploadJson,
      readBody: vi.fn(),
    });

    req.write(`--${boundary}\r\n`);
    req.write(
      'Content-Disposition: form-data; name="file"; filename="fallback.txt"; '
      + 'filename*=UTF-8\'\'%E4%B8%AD%E6%96%87%E6%8A%A5%E5%91%8A.txt\r\n',
    );
    req.write('Content-Type: text/plain\r\n\r\n');
    req.write('hello');
    req.end(`\r\n--${boundary}--\r\n`);

    await expect(routePromise).resolves.toBe(true);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(uploadJson).toHaveBeenCalledWith(
      expect.anything(),
      201,
      expect.objectContaining({
        kind: 'file',
        name: '中文报告.txt',
        path: '中文报告.txt',
      }),
    );
  });

  it('stops waiting for file moves when the response closes after the JSON body has already been read', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Move Contract',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    let resolveCopyObject: (() => void) | null = null;
    const copyObject = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveCopyObject = resolve;
    }));
    const removeObject = vi.fn();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      copyObject,
      removeObject,
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & { aborted: boolean };
    req.headers = {};
    req.aborted = false;
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
      statusCode: number;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;
    res.statusCode = 200;
    const moveJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMove',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json: moveJson,
      readBody: vi.fn().mockResolvedValue({
        from_path: 'docs/hello.txt',
        to_path: 'docs/renamed.txt',
        overwrite: true,
      }),
    });

    await nextTick();
    expect(copyObject).toHaveBeenCalledTimes(1);

    res.destroyed = true;
    res.emit('close');

    await expect(Promise.race([
      routePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])).resolves.toBe('resolved');

    resolveCopyObject?.();
    await nextTick();

    expect(removeObject).not.toHaveBeenCalled();
    expect(moveJson).not.toHaveBeenCalled();
  });

  it('completes a JSON file move after the request body has been fully read even if the request stream is already destroyed', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Move Request Body Lifecycle',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    const copyObject = vi.fn().mockResolvedValue(undefined);
    const removeObject = vi.fn().mockResolvedValue(undefined);
    createFileLibraryGatewayClientMock.mockResolvedValue({
      copyObject,
      removeObject,
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & {
      aborted: boolean;
      destroyed: boolean;
      complete: boolean;
    };
    req.headers = {};
    req.aborted = false;
    req.destroyed = false;
    req.complete = false;

    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
      statusCode: number;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn(() => {
      res.writableEnded = true;
      res.emit('finish');
    });
    res.writableEnded = false;
    res.destroyed = false;
    res.writableDestroyed = false;
    res.statusCode = 200;

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMove',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockImplementation(async () => {
        req.complete = true;
        req.destroyed = true;
        return {
          from_path: 'docs/hello.txt',
          to_path: 'docs/renamed.txt',
          overwrite: true,
        };
      }),
    });

    await expect(routePromise).resolves.toBe(true);
    expect(copyObject).toHaveBeenCalledWith(
      expect.any(String),
      'docs/renamed.txt',
      expect.stringContaining('/docs/hello.txt'),
    );
    expect(removeObject).toHaveBeenCalledWith(expect.any(String), 'docs/hello.txt');
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('stops waiting for file metadata when the client aborts before statObject resolves', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Meta Contract',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    let resolveStatObject: ((value: {
      size: number;
      metaData?: Record<string, string>;
      lastModified: Date;
      etag: string;
    }) => void) | null = null;
    const statObject = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveStatObject = resolve;
    }));
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject,
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & { aborted: boolean; url: string };
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/meta?path=docs%2Fhello.txt';
    req.headers = {};
    req.aborted = false;
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;
    const metaJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMeta',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json: metaJson,
      readBody: vi.fn(),
    });

    await nextTick();
    req.aborted = true;
    req.emit('aborted');

    await expect(Promise.race([
      routePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])).resolves.toBe('resolved');

    resolveStatObject?.({
      size: 11,
      metaData: { 'content-type': 'text/plain' },
      lastModified: new Date('2026-04-15T10:00:00.000Z'),
      etag: 'etag-meta',
    });
    await nextTick();

    expect(metaJson).not.toHaveBeenCalled();
  });

  it('stops waiting for upload completion and does not write json when the response closes after the body is fully parsed', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Upload Late Cancel',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    let resolveUploadStat: ((value: {
      size: number;
      metaData?: Record<string, string>;
      lastModified: Date;
      etag: string;
    }) => void) | null = null;
    const statObject = vi.fn()
      .mockRejectedValueOnce(new Error('object_not_found'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveUploadStat = resolve;
      }));
    const putObject = vi.fn().mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
    ) => {
      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', (error) => reject(error));
        stream.resume();
      });
    });

    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject,
      putObject,
    });

    const boundary = '----agentsmith-upload-late-close';
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;
    const uploadJson = vi.fn();

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
      json: uploadJson,
      readBody: vi.fn(),
    });

    req.write(`--${boundary}\r\n`);
    req.write('Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n');
    req.write('Content-Type: text/plain\r\n\r\n');
    req.write('hello world');
    req.end(`\r\n--${boundary}--\r\n`);

    await nextTick();
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(statObject).toHaveBeenCalledTimes(2);

    res.emit('close');

    await expect(Promise.race([
      routePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])).resolves.toBe('resolved');

    resolveUploadStat?.({
      size: 11,
      metaData: { 'content-type': 'text/plain' },
      lastModified: new Date('2026-04-15T10:00:00.000Z'),
      etag: 'etag-upload',
    });
    await nextTick();

    expect(uploadJson).not.toHaveBeenCalled();
  });

  it('stops waiting for statObject and never opens the object stream when the client aborts before download metadata resolves', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Download Pending Stat',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    let resolveStatObject: ((value: {
      size: number;
      metaData?: Record<string, string>;
      lastModified: Date;
      etag: string;
    }) => void) | null = null;
    const statObject = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveStatObject = resolve;
    }));
    const getObject = vi.fn();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject,
      getObject,
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & { aborted: boolean };
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2Fhello.txt';
    req.headers = {};
    req.aborted = false;
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;
    const downloadJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json: downloadJson,
      readBody: vi.fn(),
    });

    await nextTick();
    req.aborted = true;
    req.emit('aborted');

    await expect(Promise.race([
      routePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])).resolves.toBe('resolved');

    resolveStatObject?.({
      size: 11,
      metaData: { 'content-type': 'text/plain' },
      lastModified: new Date('2026-04-15T10:00:00.000Z'),
      etag: 'etag-download',
    });
    await nextTick();

    expect(getObject).not.toHaveBeenCalled();
    expect(downloadJson).not.toHaveBeenCalled();
  });

  it('cancels a late getObject resolution when the response closes before the download stream exists', async () => {
    const createJson = vi.fn();
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
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Download Pending Object',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    let resolveGetObject: ((stream: PassThrough) => void) | null = null;
    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 11,
        metaData: { 'content-type': 'text/plain' },
        lastModified: new Date('2026-04-15T10:00:00.000Z'),
        etag: 'etag-download',
      }),
      getObject: vi.fn().mockImplementation(() => new Promise<PassThrough>((resolve) => {
        resolveGetObject = resolve;
      })),
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & { aborted: boolean };
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2Fhello.txt';
    req.headers = {};
    req.aborted = false;
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
      statusCode: number;
    };
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;
    res.statusCode = 200;
    const downloadJson = vi.fn();

    const routePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req,
      res,
      deps,
      user: OWNER_USER,
      json: downloadJson,
      readBody: vi.fn(),
    });

    await nextTick();
    res.emit('close');

    await expect(Promise.race([
      routePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])).resolves.toBe('resolved');

    resolveGetObject?.(objectStream);
    await nextTick();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(downloadJson).not.toHaveBeenCalled();
  });

  it('aborts the real gateway stat request when download metadata is cancelled before statObject resolves', async () => {
    const actualGatewayClient = await vi.importActual<typeof import('./file-library-gateway-client.js')>('./file-library-gateway-client.js');
    const createJson = vi.fn();
    const deps = createDeps() as typeof createDeps extends (...args: never[]) => infer TResult ? TResult : never;
    const gatewayServer = createServer();
    const headStarted = new Promise<void>((resolve) => {
      gatewayServer.once('request', (_request, _response) => {
        resolve();
      });
    });
    const headClosed = new Promise<void>((resolve) => {
      gatewayServer.once('request', (request) => {
        request.once('close', () => {
          resolve();
        });
      });
    });

    gatewayServer.on('request', (request, response) => {
      if (request.method === 'HEAD') {
        return;
      }
      response.statusCode = 500;
      response.end('unexpected_gateway_request');
    });

    await new Promise<void>((resolve, reject) => {
      gatewayServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    try {
      const address = gatewayServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('gateway_test_server_address_unavailable');
      }
      deps.fileLibraryGatewayManager = {
        ensureGateway: vi.fn().mockResolvedValue({
          loopbackUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
          port: (address as AddressInfo).port,
          status: 'ready',
          lastStartedAt: '2026-04-16T10:00:00.000Z',
        }),
        getHealth: vi.fn().mockResolvedValue({
          status: 'ready',
          checkedAt: '2026-04-16T10:00:00.000Z',
        }),
        stopGateway: vi.fn().mockResolvedValue(undefined),
      } as never;
      createFileLibraryGatewayClientMock.mockImplementation((args) => actualGatewayClient.createFileLibraryGatewayClient(args as never));

      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: {} as never,
        res: {} as never,
        deps,
        user: OWNER_USER,
        json: createJson,
        readBody: vi.fn().mockResolvedValue({
          name: 'Real Gateway Download Abort',
        }),
      });

      const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
      const req = new EventEmitter() as EventEmitter & http.IncomingMessage & { aborted: boolean };
      req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2Fhello.txt';
      req.headers = {};
      req.aborted = false;
      const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
        setHeader: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        writableEnded: boolean;
        destroyed: boolean;
        writableDestroyed?: boolean;
      };
      res.setHeader = vi.fn();
      res.end = vi.fn();
      res.writableEnded = false;
      res.destroyed = false;

      const routePromise = handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryDownload',
        method: 'GET',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: createdBody.id,
        req,
        res,
        deps,
        user: OWNER_USER,
        json: vi.fn(),
        readBody: vi.fn(),
      });

      await headStarted;
      req.aborted = true;
      req.emit('aborted');

      await expect(routePromise).resolves.toBe(true);
      await headClosed;
    } finally {
      await closeServer(gatewayServer);
    }
  });

  it('aborts the real gateway put request when the upload is cancelled after the request body has been fully sent', async () => {
    const actualGatewayClient = await vi.importActual<typeof import('./file-library-gateway-client.js')>('./file-library-gateway-client.js');
    const createJson = vi.fn();
    const deps = createDeps() as typeof createDeps extends (...args: never[]) => infer TResult ? TResult : never;
    let resolvePutBodyReceived: (() => void) | null = null;
    let resolvePutClosed: (() => void) | null = null;
    const putBodyReceived = new Promise<void>((resolve) => {
      resolvePutBodyReceived = resolve;
    });
    const putClosed = new Promise<void>((resolve) => {
      resolvePutClosed = resolve;
    });
    const gatewayServer = createServer((request, response) => {
      if (request.method === 'PUT') {
        request.on('end', () => {
          resolvePutBodyReceived?.();
        });
        request.on('close', () => {
          if (!response.writableEnded) {
            resolvePutClosed?.();
          }
        });
        request.resume();
        return;
      }
      response.statusCode = 200;
      response.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      gatewayServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    try {
      const address = gatewayServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('gateway_test_server_address_unavailable');
      }
      deps.fileLibraryGatewayManager = {
        ensureGateway: vi.fn().mockResolvedValue({
          loopbackUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
          port: (address as AddressInfo).port,
          status: 'ready',
          lastStartedAt: '2026-04-16T10:00:00.000Z',
        }),
        getHealth: vi.fn().mockResolvedValue({
          status: 'ready',
          checkedAt: '2026-04-16T10:00:00.000Z',
        }),
        stopGateway: vi.fn().mockResolvedValue(undefined),
      } as never;
      createFileLibraryGatewayClientMock.mockImplementation((args) => actualGatewayClient.createFileLibraryGatewayClient(args as never));

      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: {} as never,
        res: {} as never,
        deps,
        user: OWNER_USER,
        json: createJson,
        readBody: vi.fn().mockResolvedValue({
          name: 'Real Gateway Upload Abort',
        }),
      });

      const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
      const uploadAbortController = new AbortController();
      const client = await actualGatewayClient.createFileLibraryGatewayClient({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: createdBody.id,
        filesystemName: 'flib-real-gateway-upload-abort',
        signal: uploadAbortController.signal,
      });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello world'));
          controller.close();
        },
      });

      const uploadPromise = putGatewayObjectStream(
        client,
        actualGatewayClient.fileLibraryBucketName('flib-real-gateway-upload-abort'),
        'hello.txt',
        body,
        {
          sizeBytes: 11,
          contentType: 'text/plain',
          signal: uploadAbortController.signal,
        },
      );

      await putBodyReceived;
      uploadAbortController.abort(new Error('client_response_closed'));

      await expect(uploadPromise).rejects.toMatchObject({
        name: 'AbortError',
      });
      await putClosed;
    } finally {
      await closeServer(gatewayServer);
    }
  });

  it('sets an RFC 6266 attachment header for ASCII file library downloads', async () => {
    const createJson = vi.fn();
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: {} as never,
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'ASCII Downloads',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    const objectStream = new PassThrough();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 11,
        metaData: { 'content-type': 'text/plain' },
        lastModified: new Date('2026-04-22T10:00:00.000Z'),
        etag: 'etag-ascii-download',
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

    objectStream.end('hello world');
    const contentDisposition = readContentDispositionHeader(res.headers);
    expect(contentDisposition.raw).toContain('attachment;');
    expect(contentDisposition.raw).toContain('filename="hello.txt"');
    expect(contentDisposition.raw).toContain("filename*=UTF-8''hello.txt");
  });

  it('sets a UTF-8 aware attachment header for non-ASCII file library downloads', async () => {
    const createJson = vi.fn();
    const deps = createDeps();

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: {} as never,
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'UTF-8 Downloads',
      }),
    });

    const createdBody = createJson.mock.calls.at(-1)?.[2] as { id: string };
    const objectStream = new PassThrough();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 11,
        metaData: { 'content-type': 'text/plain' },
        lastModified: new Date('2026-04-22T10:00:00.000Z'),
        etag: 'etag-utf8-download',
      }),
      getObject: vi.fn().mockResolvedValue(objectStream),
    });

    const req = new EventEmitter() as http.IncomingMessage;
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/download?path=docs%2F%E4%B8%AD%E6%96%87%E6%8A%A5%E5%91%8A.txt';
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

    objectStream.end('hello world');
    const contentDisposition = readContentDispositionHeader(res.headers);
    expect(contentDisposition.raw).toContain('attachment;');
    expect(contentDisposition.raw).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87%E6%8A%A5%E5%91%8A.txt",
    );
    expect(contentDisposition.fallback).not.toBeNull();
    expect(contentDisposition.fallback).toMatch(/^[\x20-\x7E]+$/);
    expect(contentDisposition.fallback).toMatch(/\.txt$/);
  });
});
