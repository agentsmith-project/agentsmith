import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';

import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
} from './file-library-runtime.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';

describe('project-file-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
      json: exchangeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(exchangeJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        filesystem_name: expect.any(String),
        metadata_url: expect.stringContaining('postgres://'),
        storage_bucket_url: expect.stringContaining('http://localhost:19000/'),
      }),
    );
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Workspace Library',
      }),
    });

    const createdBody = json.mock.calls.at(-1)?.[2] as { id: string };
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: createdBody.id,
      req: {} as never,
      res,
      deps,
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
      user: { user_id: 'user_1', email: 'user@example.com', name: 'User One' } as never,
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
});
