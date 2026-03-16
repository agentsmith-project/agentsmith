import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeProjectAuditEvent,
  writeProjectUsageFact,
  drainJobQueue,
} = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
  writeProjectUsageFact: vi.fn(),
  drainJobQueue: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
  writeProjectUsageFact,
}));

vi.mock('@mbos/application', () => ({
  drainJobQueue,
}));

import { handleProjectSourceLibraryRoutes } from './project-source-library-routes.js';

describe('project-source-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    writeProjectUsageFact.mockResolvedValue(undefined);
    drainJobQueue.mockResolvedValue(undefined);
  });

  it('lists source libraries without default-personal dedupe semantics', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      listSourceLibrariesUseCase: {
        execute: vi
          .fn()
          .mockResolvedValueOnce({
            items: [
              { id: 'default-1', created_by_user_id: 'user-1', name: 'Project Uploads' },
              { id: 'shared-1', created_by_user_id: 'user-1', name: 'Docs' },
              { id: 'other-1', created_by_user_id: 'user-2', name: 'Other' },
            ],
            total: 4,
          }),
      },
      createSourceLibraryUseCase: {
        execute: vi.fn(),
      },
    } as never;

    await expect(handleProjectSourceLibraryRoutes({
      routeKind: 'sourceLibraries',
      method: 'GET',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      req: { headers: {} } as never,
      res,
      requestUrl: new URL('http://localhost'),
      deps,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      requestId: 'req-1',
      json,
      readBody: vi.fn(),
      enforceSourceLibraryPreflight: vi.fn(),
      enforceSourceLibraryLimit: vi.fn(),
      enforceSourceLibraryAccessBySourceId: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'default-1' }),
          expect.objectContaining({ id: 'shared-1' }),
          expect.objectContaining({ id: 'other-1' }),
        ],
      }),
    );
  });

  it('creates source libraries without system-managed markers', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      createSourceLibraryUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'lib_1',
          name: 'Docs',
        }),
      },
    } as never;

    await expect(handleProjectSourceLibraryRoutes({
      routeKind: 'sourceLibraries',
      method: 'POST',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      req: { headers: {} } as never,
      res,
      requestUrl: new URL('http://localhost'),
      deps,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      requestId: 'req-1',
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Docs',
      }),
      enforceSourceLibraryPreflight: vi.fn(),
      enforceSourceLibraryLimit: vi.fn(),
      enforceSourceLibraryAccessBySourceId: vi.fn(),
    })).resolves.toBe(true);

    expect(deps.createSourceLibraryUseCase.execute).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(res, 201, expect.objectContaining({ id: 'lib_1', name: 'Docs' }));
  });

});
