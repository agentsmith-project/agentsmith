import { describe, expect, it, vi } from 'vitest';
import { createSourceLibraryGuards } from './project-source-library-guards.js';

describe('project-source-library-guards', () => {
  it('returns forbidden when library is not visible to the caller', async () => {
    const json = vi.fn();
    const res = { setHeader: vi.fn() } as never;
    const guards = createSourceLibraryGuards({
      deps: {
        listSourceLibrariesUseCase: {
          execute: vi.fn().mockResolvedValue({ items: [] }),
        },
      } as never,
      user: { id: 'user-1' } as never,
      requestId: 'req-1',
      res,
      json,
    });

    await expect(
      guards.enforceSourceLibraryAccess({
        workspaceId: 'ws',
        projectId: 'proj',
        libraryId: 'lib-1',
        routeKind: 'download',
      }),
    ).resolves.toBe(false);

    expect(json).toHaveBeenCalledWith(
      res,
      403,
      expect.objectContaining({ error_code: 'FORBIDDEN', resource_id: 'lib-1' }),
    );
  });
});
