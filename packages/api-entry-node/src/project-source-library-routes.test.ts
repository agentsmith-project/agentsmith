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

  it('lists only owned source libraries while preserving default-personal dedupe', async () => {
    const json = vi.fn();
    const res = {} as never;
    const deps = {
      listSourceLibrariesUseCase: {
        execute: vi
          .fn()
          .mockResolvedValueOnce({
            items: [
              { id: 'default-1', created_by_user_id: 'user-1', name: 'My Uploads' },
              { id: 'default-2', created_by_user_id: 'user-1', name: 'My Uploads', system_managed_kind: 'default_personal_uploads', created_at: '2026-03-02T00:00:00Z' },
              { id: 'shared-1', created_by_user_id: 'user-1', name: 'Docs' },
            ],
          })
          .mockResolvedValueOnce({
            items: [
              { id: 'default-1', created_by_user_id: 'user-1', name: 'My Uploads' },
              { id: 'default-2', created_by_user_id: 'user-1', name: 'My Uploads', system_managed_kind: 'default_personal_uploads', created_at: '2026-03-02T00:00:00Z' },
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
          expect.objectContaining({ id: 'default-2' }),
          expect.objectContaining({ id: 'shared-1' }),
        ],
      }),
    );
  });

  it('rejects manual creation of system managed source libraries', async () => {
    const json = vi.fn();
    const res = {} as never;

    await expect(handleProjectSourceLibraryRoutes({
      routeKind: 'sourceLibraries',
      method: 'POST',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      req: { headers: {} } as never,
      res,
      requestUrl: new URL('http://localhost'),
      deps: {} as never,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      requestId: 'req-1',
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Bad',
        system_managed_kind: 'default_personal_uploads',
      }),
      enforceSourceLibraryPreflight: vi.fn(),
      enforceSourceLibraryLimit: vi.fn(),
      enforceSourceLibraryAccessBySourceId: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      422,
      { error_code: 'VALIDATION_ERROR', message: 'system_managed_kind_not_allowed' },
    );
  });

  it('protects default personal libraries from deletion', async () => {
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;
    const deps = {
      listSourceLibrariesUseCase: {
        execute: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'lib-default',
              created_by_user_id: 'user-1',
              name: 'My Uploads',
              system_managed_kind: 'default_personal_uploads',
            },
          ],
        }),
      },
      deleteSourceLibraryUseCase: {
        execute: vi.fn(),
      },
    } as never;

    await expect(handleProjectSourceLibraryRoutes({
      routeKind: 'sourceLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      libraryId: 'lib-default',
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
      409,
      { error_code: 'RESOURCE_CONFLICT', message: 'default_personal_library_protected' },
    );
  });
});
