import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { JsonDocConditionalCreateResult } from '@mbos/ports';
import {
  buildFileLibraryRecord,
  JsonDocFileLibraryRestoreOperationRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocFileLibraryVersionOperationRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectTaskFileTemplateRepo,
} from './file-library-persistence.js';

class RestoreOperationCreateFailureDocStore extends InMemoryJsonDocStore {
  private failedOperationCreate = false;

  override async createIfAbsent<T>(
    collection: string,
    id: string,
    doc: T,
  ): Promise<JsonDocConditionalCreateResult<T>> {
    if (
      collection === 'project_file_library_restore_operations'
      && !this.failedOperationCreate
    ) {
      this.failedOperationCreate = true;
      throw new Error('operation_create_failed');
    }
    return super.createIfAbsent(collection, id, doc);
  }
}

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

  it('persists restore source as flat catalog fields and projects public nested last_restore', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const record = buildFileLibraryRecord({
      id: 'flib_restore_projection',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Restore projection',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_restore_projection',
    });

    await repo.save(record);

    await expect(repo.recordSuccessfulRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_projection',
      sourceSavePointId: 'flsp_safe',
      sourceSavePointLabel: 'Before restore',
      sourceSavePointCreatedAt: '2026-05-09T00:01:00.000Z',
      restoredAt: '2026-05-09T00:02:00.000Z',
      restoreOperationId: 'flro_restore_success',
    })).resolves.toMatchObject({
      id: 'flib_restore_projection',
      last_restore: {
        source_save_point_id: 'flsp_safe',
        source_save_point_label: 'Before restore',
        source_save_point_created_at: '2026-05-09T00:01:00.000Z',
        restored_at: '2026-05-09T00:02:00.000Z',
        restore_operation_id: 'flro_restore_success',
      },
    });

    await expect(docStore.get<Record<string, unknown>>(
      'project_file_libraries',
      'flib_restore_projection',
    )).resolves.toMatchObject({
      last_restored_save_point_id: 'flsp_safe',
      last_restored_save_point_label: 'Before restore',
      last_restored_save_point_created_at: '2026-05-09T00:01:00.000Z',
      last_restored_at: '2026-05-09T00:02:00.000Z',
      last_restore_operation_id: 'flro_restore_success',
    });
    const stored = await docStore.get<Record<string, unknown>>(
      'project_file_libraries',
      'flib_restore_projection',
    );
    expect(stored).not.toHaveProperty('last_restore');

    await expect(repo.getById('ws_default', 'proj_1', 'flib_restore_projection')).resolves.toMatchObject({
      id: 'flib_restore_projection',
      last_restore: {
        source_save_point_id: 'flsp_safe',
        source_save_point_label: 'Before restore',
        source_save_point_created_at: '2026-05-09T00:01:00.000Z',
        restored_at: '2026-05-09T00:02:00.000Z',
        restore_operation_id: 'flro_restore_success',
      },
    });
  });

  it('does not roll back last_restore when an older restore completion is replayed', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    await repo.save(buildFileLibraryRecord({
      id: 'flib_restore_replay_guard',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Restore replay guard',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_restore_replay_guard',
    }));

    await repo.recordSuccessfulRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_replay_guard',
      sourceSavePointId: 'flsp_newer',
      sourceSavePointLabel: 'Newer restore',
      sourceSavePointCreatedAt: '2026-05-09T00:03:00.000Z',
      restoredAt: '2026-05-09T00:05:00.000Z',
      restoreOperationId: 'flro_restore_newer',
    });

    await expect(repo.recordSuccessfulRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_replay_guard',
      sourceSavePointId: 'flsp_older',
      sourceSavePointLabel: 'Older replay',
      sourceSavePointCreatedAt: '2026-05-09T00:01:00.000Z',
      restoredAt: '2026-05-09T00:02:00.000Z',
      restoreOperationId: 'flro_restore_older',
    })).resolves.toMatchObject({
      last_restore: {
        source_save_point_id: 'flsp_newer',
        restored_at: '2026-05-09T00:05:00.000Z',
        restore_operation_id: 'flro_restore_newer',
      },
    });
  });

  it('persists direct restore operation typed projection for public records', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const record = await repo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpOperationId: 'op_restore_direct',
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'restoring',
      idempotencyKey: 'restore-key-1',
      createdByUserId: 'user_1',
    });

    expect(repo.toPublic(record)).toMatchObject({
      id: record.id,
      file_library_id: 'flib_restore',
      source_save_point_id: 'flsp_restore',
      status: 'restoring',
      created_at: '2026-05-09T12:00:00.000Z',
      updated_at: '2026-05-09T12:00:00.000Z',
    });

    const stored = await docStore.get<Record<string, unknown>>(
      'project_file_library_restore_operations',
      record.id,
    );
    expect(stored).toMatchObject({
      afscp_operation_id: 'op_restore_direct',
      source_afscp_save_point_id: 'sp_restore',
      idempotency_key: 'restore-key-1',
      created_by_user_id: 'user_1',
    });
    await expect(repo.findByIdempotencyKey(
      'ws_default',
      'proj_1',
      'flib_restore',
      'restore-key-1',
    )).resolves.toMatchObject({ id: record.id });
    await expect(repo.findActiveByLibrary('ws_default', 'proj_1', 'flib_restore'))
      .resolves.toMatchObject({ id: record.id });
  });

  it('supports a durable pre-start direct restore operation before the AFSCP operation id is assigned', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const record = await repo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_prestart',
      afscpOperationId: null,
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'pending',
      idempotencyKey: 'restore-key-prestart',
      createdByUserId: 'user_1',
    });

    expect(repo.toPublic(record)).toEqual({
      id: record.id,
      file_library_id: 'flib_restore_prestart',
      source_save_point_id: 'flsp_restore',
      status: 'pending',
      created_at: '2026-05-09T12:00:00.000Z',
      updated_at: '2026-05-09T12:00:00.000Z',
    });
    await expect(docStore.get<Record<string, unknown>>(
      'project_file_library_restore_operations',
      record.id,
    )).resolves.toMatchObject({
      afscp_operation_id: null,
      idempotency_key: 'restore-key-prestart',
    });

    await expect(repo.updateStatus({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_prestart',
      operationId: record.id,
      status: 'restoring',
      afscpOperationId: 'op_restore_direct',
    })).resolves.toMatchObject({
      id: record.id,
      status: 'restoring',
      afscp_operation_id: 'op_restore_direct',
    });
  });

  it('persists recovery-required direct restore operations as terminal product state', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const record = await repo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_recovery',
      afscpOperationId: 'op_restore_recovery',
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'recovery_required',
      idempotencyKey: 'restore-key-recovery',
      createdByUserId: 'user_1',
      failureReason: 'file_library_storage_admin_action_required',
    });

    expect(repo.toPublic(record)).toMatchObject({
      id: record.id,
      file_library_id: 'flib_restore_recovery',
      source_save_point_id: 'flsp_restore',
      status: 'recovery_required',
      failure_reason: 'file_library_storage_admin_action_required',
    });
    await expect(repo.findActiveByLibrary('ws_default', 'proj_1', 'flib_restore_recovery'))
      .resolves.toBeNull();
  });

  it('creates or reuses one restore operation for a scoped idempotency key', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_idempotent',
      afscpOperationId: null,
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'pending' as const,
      idempotencyKey: 'restore-key-stable',
      createdByUserId: 'user_1',
    };

    const [first, second] = await Promise.all([
      repo.createOrReuseByIdempotencyKey(input),
      repo.createOrReuseByIdempotencyKey(input),
    ]);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.operation.id).toBe(first.operation.id);
    expect(first.operation.id).toMatch(/^flro_/);
    await expect(docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: 'flib_restore_idempotent',
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: first.operation.id,
        idempotency_key: 'restore-key-stable',
      }),
    ]);

    await expect(new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:01:00.000Z',
    ).createOrReuseByIdempotencyKey({
      ...input,
      sourceSavePointId: 'flsp_restore_other',
      sourceAfscpSavePointId: 'sp_restore_other',
    })).rejects.toThrow('file_library_restore_operation_idempotency_conflict');
  });

  it('creates or reuses one file-library version operation for a stable save-point idempotency key', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryVersionOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_save_idempotent',
      kind: 'save_point_create' as const,
      status: 'accepted' as const,
      afscpOperationId: 'op_save_point_same',
      idempotencyKey: 'save-point-key-stable',
      createdByUserId: 'user_1',
      message: 'Before edits',
    };

    const first = await repo.createOrReuseByIdempotencyKey(input);
    await expect(new JsonDocFileLibraryVersionOperationRepo(
      docStore,
      () => '2026-05-09T12:01:00.000Z',
    ).createOrReuseByIdempotencyKey({
      ...input,
      status: 'running',
      message: 'Changed retry body that must not replace original',
    })).rejects.toThrow('file_library_version_operation_idempotency_conflict');

    expect(first.created).toBe(true);
    await expect(docStore.list<Record<string, unknown>>(
      'project_file_library_version_operations',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: 'flib_save_idempotent',
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: first.operation.id,
        idempotency_key: 'save-point-key-stable',
      }),
    ]);
    expect(repo.toPublic(first.operation)).not.toHaveProperty('idempotency_key');
  });

  it('projects save point create operation terminal result with a public save point id only', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryVersionOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const record = await repo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_save_result',
      kind: 'save_point_create',
      status: 'succeeded',
      afscpOperationId: 'op_raw_save_point_result',
      resultSavePointId: 'flsp_public_result',
      idempotencyKey: 'save-result-key',
      createdByUserId: 'user_1',
      message: 'Before restore',
    });

    expect(repo.toPublic(record)).toMatchObject({
      id: record.id,
      kind: 'save_point_create',
      status: 'succeeded',
      file_library_id: 'flib_save_result',
      result_save_point_id: 'flsp_public_result',
    });
    expect(JSON.stringify(repo.toPublic(record))).not.toMatch(/op_raw_save_point_result|sp_raw/);
    await expect(docStore.get<Record<string, unknown>>(
      'project_file_library_version_operations',
      record.id,
    )).resolves.toMatchObject({
      afscp_operation_id: 'op_raw_save_point_result',
      result_save_point_id: 'flsp_public_result',
    });
  });

  it('reuses one task file template only when the idempotency request body matches', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocProjectTaskFileTemplateRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sourceLibraryId: 'flib_template_source',
      name: 'Starter files',
      sourceSavePointId: 'flsp_template_source',
      sourceAfscpSavePointId: 'sp_template_source',
      createdByUserId: 'user_1',
      afscpTemplateId: 'tmpl_template_source',
      afscpCreateOperationId: 'op_template_source',
      idempotencyKey: 'task-template-key-stable',
    };

    const first = await repo.createOrReuseByIdempotencyKey(input);
    const replay = await new JsonDocProjectTaskFileTemplateRepo(
      docStore,
      () => '2026-05-09T12:01:00.000Z',
    ).createOrReuseByIdempotencyKey(input);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.template).toMatchObject({
      id: first.template.id,
      name: 'Starter files',
      idempotency_key: 'task-template-key-stable',
      afscp_template_id: 'tmpl_template_source',
    });
    await expect(new JsonDocProjectTaskFileTemplateRepo(
      docStore,
      () => '2026-05-09T12:02:00.000Z',
    ).createOrReuseByIdempotencyKey({
      ...input,
      name: 'Changed retry body',
      afscpTemplateId: 'tmpl_retry',
    })).rejects.toThrow('task_file_template_idempotency_conflict');
    await expect(repo.findByIdempotencyKey({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sourceLibraryId: 'flib_template_source',
      idempotencyKey: 'task-template-key-stable',
    })).resolves.toMatchObject({
      id: first.template.id,
    });
    expect(repo.toPublic(first.template)).not.toHaveProperty('idempotency_key');
  });

  it('creates or reuses one active restore operation for a library across different idempotency keys', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_active_mutex',
      afscpOperationId: null,
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'pending' as const,
      createdByUserId: 'user_1',
    };

    const first = await repo.createOrReuseActiveByLibrary({
      ...input,
      idempotencyKey: 'restore-key-active-a',
    });
    const second = await repo.createOrReuseActiveByLibrary({
      ...input,
      idempotencyKey: 'restore-key-active-b',
      sourceSavePointId: 'flsp_restore_other',
    });

    expect(first).toMatchObject({
      created: true,
      reason: 'created',
      operation: {
        idempotency_key: 'restore-key-active-a',
        source_save_point_id: 'flsp_restore',
      },
    });
    expect(second).toMatchObject({
      created: false,
      reason: 'active',
      operation: {
        id: first.operation.id,
        idempotency_key: 'restore-key-active-a',
        source_save_point_id: 'flsp_restore',
      },
    });
    await expect(docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: 'flib_restore_active_mutex',
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: first.operation.id,
        idempotency_key: 'restore-key-active-a',
      }),
    ]);
  });

  it('releases the active restore lock when operation creation fails after lock acquisition', async () => {
    const docStore = new RestoreOperationCreateFailureDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_lock_failure',
      afscpOperationId: null,
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'pending' as const,
      idempotencyKey: 'restore-key-lock-failure',
      createdByUserId: 'user_1',
    };

    await expect(repo.createOrReuseActiveByLibrary(input)).rejects.toThrow('operation_create_failed');
    await expect(docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operation_active_locks',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: 'flib_restore_lock_failure',
      },
    )).resolves.toEqual([]);

    await expect(repo.createOrReuseActiveByLibrary(input)).resolves.toMatchObject({
      created: true,
      reason: 'created',
      operation: {
        library_id: 'flib_restore_lock_failure',
        idempotency_key: 'restore-key-lock-failure',
      },
    });
  });

  it('cleans stale active restore locks whose operation record is missing', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibraryRestoreOperationRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );
    const input = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore_stale_lock',
      afscpOperationId: null,
      sourceSavePointId: 'flsp_restore',
      sourceAfscpSavePointId: 'sp_restore',
      status: 'pending' as const,
      idempotencyKey: 'restore-key-stale-lock',
      createdByUserId: 'user_1',
    };

    const first = await repo.createOrReuseActiveByLibrary(input);
    await docStore.delete('project_file_library_restore_operations', first.operation.id);

    await expect(repo.findActiveByLibrary(
      'ws_default',
      'proj_1',
      'flib_restore_stale_lock',
    )).resolves.toBeNull();
    await expect(docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operation_active_locks',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: 'flib_restore_stale_lock',
      },
    )).resolves.toEqual([]);

    await expect(repo.createOrReuseActiveByLibrary({
      ...input,
      idempotencyKey: 'restore-key-after-stale-lock',
    })).resolves.toMatchObject({
      created: true,
      reason: 'created',
      operation: {
        library_id: 'flib_restore_stale_lock',
        idempotency_key: 'restore-key-after-stale-lock',
      },
    });
  });

  it('keeps AFSCP history save points public without direct restore fence classification', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibrarySavePointMappingRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    const syncedHistoryPoint = await repo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpSavePointId: 'sp_direct_restore_history',
      message: 'Direct restore historical checkpoint',
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

    expect(syncedHistoryPoint.purpose).toBe('user');
    await expect(repo.listByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
    })).resolves.toEqual([
      expect.objectContaining({
        afscp_save_point_id: 'sp_direct_restore_history',
        purpose: 'user',
      }),
      expect.objectContaining({
        afscp_save_point_id: 'sp_user_visible',
        purpose: 'user',
      }),
    ]);
  });

  it('keeps template source save points out of the default user restore point list', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocFileLibrarySavePointMappingRepo(
      docStore,
      () => '2026-05-09T12:00:00.000Z',
    );

    await repo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpSavePointId: 'sp_template_source',
      message: 'Template source: Starter',
      createdAt: '2026-05-09T00:00:00.000Z',
      purpose: 'template_source',
    });
    await repo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      afscpSavePointId: 'sp_user_visible',
      message: 'Before restore',
      createdAt: '2026-05-09T00:01:00.000Z',
      purpose: 'user',
    });

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
    await expect(repo.listByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_restore',
      includeTemplateSources: true,
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        afscp_save_point_id: 'sp_template_source',
        purpose: 'template_source',
      }),
    ]));
  });
});
