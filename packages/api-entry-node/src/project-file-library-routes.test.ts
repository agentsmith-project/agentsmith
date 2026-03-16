import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
} from './file-library-runtime.js';

describe('project-file-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a file library and returns ready metadata when orchestrator is configured', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
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
    const deps = {
      fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
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
      }),
    );
  });

  it('does not expose metadata credentials from backend details', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
      fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
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
});
