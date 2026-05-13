import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  buildFileLibraryRecord,
  JsonDocFileLibraryRestorePreviewRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocProjectFileLibraryCatalogRepo,
} from './file-library-persistence.js';

describe('file-library-persistence catalog schema', () => {
  it('writes only current catalog schema and presents the public source contract', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const record = buildFileLibraryRecord({
      id: 'flib_no_filesystem_truth',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'No filesystem truth',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_no_filesystem_truth',
    });

    await repo.save(record);

    const stored = await docStore.get<Record<string, unknown>>(
      'project_file_libraries',
      'flib_no_filesystem_truth',
    );
    expect(stored).toMatchObject({
      id: 'flib_no_filesystem_truth',
      source: 'agent_task_files',
      file_library_home_segment: 'flibhome_no_filesystem_truth',
    });
    expect(stored).not.toHaveProperty('filesystem_name');

    await expect(repo.getById('ws_default', 'proj_1', 'flib_no_filesystem_truth')).resolves.toEqual(
      expect.not.objectContaining({
        filesystem_name: expect.anything(),
      }),
    );
  });

  it('accepts Mongo-normalized null optional fields as absent catalog fields', async () => {
    const docStore = new InMemoryJsonDocStore();
    await docStore.upsert('project_file_libraries', 'flib_mongo_null_optional', {
      id: 'flib_mongo_null_optional',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Mongo null optional',
      description: null,
      status: 'creating',
      version: 1,
      file_library_home_segment: 'flibhome_mongo_null_optional',
      source: 'agent_task_files',
      delete_correlation_id: null,
      created_by_user_id: 'user_1',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    });

    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);

    await expect(repo.getById('ws_default', 'proj_1', 'flib_mongo_null_optional')).resolves.toMatchObject({
      id: 'flib_mongo_null_optional',
      status: 'creating',
    });
    await expect(repo.update('ws_default', 'proj_1', 'flib_mongo_null_optional', {
      status: 'ready',
    })).resolves.toMatchObject({
      id: 'flib_mongo_null_optional',
      status: 'ready',
      version: 2,
    });
  });

  it.each([
    {
      caseName: 'missing file_library_home_segment',
      record: {
        id: 'flib_invalid_missing_home',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Invalid Missing Home',
        status: 'ready',
        version: 1,
        source: 'agent_task_files',
        created_by_user_id: 'user_1',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
      },
    },
    {
      caseName: 'invalid file_library_home_segment',
      record: {
        id: 'flib_invalid_home',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Invalid Home',
        status: 'ready',
        version: 1,
        file_library_home_segment: '../raw-path',
        source: 'agent_task_files',
        created_by_user_id: 'user_1',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
      },
    },
    {
      caseName: 'raw storage field',
      record: {
        id: 'flib_invalid_raw_field',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Invalid Raw Field',
        status: 'ready',
        version: 1,
        filesystem_name: 'raw-filesystem',
        file_library_home_segment: 'flibhome_invalid_raw_field',
        source: 'agent_task_files',
        created_by_user_id: 'user_1',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
      },
    },
    {
      caseName: 'invalid source',
      record: {
        id: 'flib_invalid_source',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Invalid Source',
        status: 'ready',
        version: 1,
        file_library_home_segment: 'flibhome_invalid_source',
        source: 'agent_task_auto',
        created_by_user_id: 'user_1',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
      },
    },
  ])('ignores invalid stored catalog drift: $caseName', async ({ record }) => {
    const docStore = new InMemoryJsonDocStore();
    await docStore.upsert('project_file_libraries', String(record.id), record);

    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const before = await docStore.get<Record<string, unknown>>(
      'project_file_libraries',
      String(record.id),
    );

    await expect(repo.getById('ws_default', 'proj_1', String(record.id))).resolves.toBeNull();
    await expect(docStore.get('project_file_libraries', String(record.id))).resolves.toEqual(before);
  });

  it('rejects writes with invalid catalog fields', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const record = buildFileLibraryRecord({
      id: 'flib_invalid_write',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Invalid Write',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_invalid_write',
    });

    await expect(repo.save({
      ...record,
      filesystem_name: 'raw-filesystem',
    } as never)).rejects.toThrow('invalid_file_library_catalog_record');
    await expect(docStore.get('project_file_libraries', 'flib_invalid_write')).resolves.toBeNull();
  });

  it('rejects updates with invalid catalog fields', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const record = buildFileLibraryRecord({
      id: 'flib_invalid_update',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Invalid Update',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_invalid_update',
    });
    await repo.save(record);
    const before = await docStore.get<Record<string, unknown>>(
      'project_file_libraries',
      'flib_invalid_update',
    );

    await expect(repo.update('ws_default', 'proj_1', 'flib_invalid_update', {
      filesystem_name: 'raw-filesystem',
    } as never)).rejects.toThrow('invalid_file_library_catalog_record');
    await expect(repo.update('ws_default', 'proj_1', 'flib_invalid_update', {
      source: 'agent_task_auto',
    } as never)).rejects.toThrow('invalid_file_library_catalog_record');
    await expect(docStore.get('project_file_libraries', 'flib_invalid_update')).resolves.toEqual(before);
  });

  it('persists restore preview typed projection for public records', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestorePreviewRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const record = await repo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpPreviewOperationId: 'op_preview01',
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'ready',
      restorePlanId: 'plan_001',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    });

    expect(repo.toPublic(record)).toMatchObject({
      id: record.id,
      file_library_id: 'flib_restore',
      source_save_point_id: 'flsp_restore',
      status: 'ready',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    });

    const stored = await docStore.get<Record<string, unknown>>(
      'project_file_library_restore_previews',
      record.id,
    );
    expect(stored).toMatchObject({
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    });
  });

  it('classifies restore preview fence save points synced from AFSCP as internal records', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibrarySavePointMappingRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const syncedFence = await repo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpSavePointId: 'sp_restore_preview_fence',
      message: 'Restore preview current state',
      createdAt: '2026-05-09T00:00:00.000Z',
    });
    await repo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpSavePointId: 'sp_user_visible',
      message: 'Before restore',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    expect(syncedFence.purpose).toBe('restore_preview_fence');
    await expect(repo.listByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
    })).resolves.toEqual([
      expect.objectContaining({
        afscp_save_point_id: 'sp_user_visible',
        purpose: 'user',
      }),
    ]);
  });
});
