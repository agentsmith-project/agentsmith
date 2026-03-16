import { describe, expect, it, vi } from 'vitest';
import type { FilesAPI } from '@/lib/api/endpoints/files';

import { DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME, ensureDefaultUploadLibrary } from '../default-library';

describe('ensureDefaultUploadLibrary', () => {
  it('reuses the existing default project upload library when present', async () => {
    const api = {
      listLibraries: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'lib_project_uploads',
            name: DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME,
          },
        ],
      }),
      createLibrary: vi.fn(),
    } as unknown as Pick<FilesAPI, 'listLibraries' | 'createLibrary'>;

    const result = await ensureDefaultUploadLibrary({
      sourcesAPI: api,
      workspaceId: 'ws_default',
      projectId: 'proj_001',
    });

    expect(result).toEqual({
      id: 'lib_project_uploads',
      name: DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME,
    });
    expect(api.createLibrary).not.toHaveBeenCalled();
  });

  it('creates the default project upload library when missing', async () => {
    const created = { id: 'lib_created', name: DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME };
    const api = {
      listLibraries: vi.fn().mockResolvedValue({ items: [] }),
      createLibrary: vi.fn().mockResolvedValue(created),
    } as unknown as Pick<FilesAPI, 'listLibraries' | 'createLibrary'>;

    const result = await ensureDefaultUploadLibrary({
      sourcesAPI: api,
      workspaceId: 'ws_default',
      projectId: 'proj_001',
    });

    expect(api.createLibrary).toHaveBeenCalledWith('ws_default', 'proj_001', {
      name: DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME,
      description: 'System-managed default file library for project uploads.',
      visibility: 'shared',
    });
    expect(result).toBe(created);
  });
});
