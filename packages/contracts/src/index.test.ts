import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  AgentTaskDeleteBlockedErrorSchema,
  AgentTaskFileTemplateRequiredErrorSchema,
  AgentTaskFileLibraryInUseErrorSchema,
  AgentTaskWorkspaceBindingConflictErrorSchema,
  AgentTaskWorkspaceFileLibraryRequiredErrorSchema,
  AgentTaskWorkspaceModeInvalidErrorSchema,
  CreateFileLibraryRestoreRequestSchema,
  CreateTaskRequestSchema,
  CreateTaskFileTemplateRequestSchema,
  FileLibraryEntrySchema,
  FileLibrarySchema,
  FileLibrarySavePointSchema,
  FileLibraryRestoreOperationSchema,
  FileLibraryRestoreActiveWriterBlockedErrorSchema,
  FileLibraryRuntimeAccessReleaseBlockedErrorSchema,
  ReleaseFileLibraryRuntimeAccessResponseSchema,
  FileLibraryTaskInUseErrorSchema,
  TaskFileTemplateNotFoundErrorSchema,
  TaskFileTemplateUnpublishedErrorSchema,
  TaskFileTemplateSchema,
} from './index';
import * as contractExports from './index';

const baseFileLibrary = {
  id: 'lib_a',
  workspace_id: 'ws_default',
  project_id: 'proj_001',
  name: 'Workspace A',
  description: 'Task files workspace',
  status: 'ready',
  source: 'agent_task_files',
  created_by_user_id: 'user_001',
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
};

describe('agent task persistent HOME contracts', () => {
  it('accepts the CreateTask workspace_mode matrix for create_new, use_existing, and use_template', () => {
    expect(CreateTaskRequestSchema.safeParse({
      title: 'Fresh task',
    }).success).toBe(true);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Fresh task',
      workspace_mode: 'create_new',
    }).success).toBe(true);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Reuse workspace',
      workspace_mode: 'use_existing',
      workspace_file_library_id: 'lib_released',
    }).success).toBe(true);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Task from template',
      workspace_mode: 'use_template',
      task_file_template_id: 'tftpl_release_notes',
    }).success).toBe(true);
  });

  it('rejects invalid CreateTask workspace_mode combinations before backend execution', () => {
    expect(CreateTaskRequestSchema.safeParse({
      title: 'Invalid implicit create_new',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Invalid explicit create_new',
      workspace_mode: 'create_new',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Missing existing library',
      workspace_mode: 'use_existing',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Unknown mode',
      workspace_mode: 'reuse_any',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Missing template',
      workspace_mode: 'use_template',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Mixed template and existing library',
      workspace_mode: 'use_template',
      task_file_template_id: 'tftpl_a',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);
  });

  it('models CreateTask workspace and task-file-template errors with stable wire literals', () => {
    expect(AgentTaskWorkspaceModeInvalidErrorSchema.parse({
      error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID',
      message: 'agent_task_workspace_mode_invalid',
      field: 'workspace_mode',
      workspace_mode: 'use_template',
    })).toMatchObject({
      error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID',
      message: 'agent_task_workspace_mode_invalid',
    });
    expect(AgentTaskWorkspaceModeInvalidErrorSchema.safeParse({
      error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID',
      message: 'workspace_mode_invalid',
      field: 'workspace_mode',
    }).success).toBe(false);

    expect(AgentTaskWorkspaceFileLibraryRequiredErrorSchema.parse({
      error_code: 'AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED',
      message: 'agent_task_workspace_file_library_required',
      field: 'workspace_file_library_id',
    })).toMatchObject({
      message: 'agent_task_workspace_file_library_required',
    });
    expect(AgentTaskFileTemplateRequiredErrorSchema.parse({
      error_code: 'AGENT_TASK_FILE_TEMPLATE_REQUIRED',
      message: 'agent_task_file_template_required',
      field: 'task_file_template_id',
    })).toMatchObject({
      message: 'agent_task_file_template_required',
    });
    expect(TaskFileTemplateNotFoundErrorSchema.parse({
      error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND',
      message: 'task_file_template_not_found',
      task_file_template_id: 'tftpl_missing',
    })).toMatchObject({
      task_file_template_id: 'tftpl_missing',
    });
    expect(TaskFileTemplateUnpublishedErrorSchema.parse({
      error_code: 'TASK_FILE_TEMPLATE_UNPUBLISHED',
      message: 'task_file_template_unpublished',
      task_file_template_id: 'tftpl_draft',
    })).toMatchObject({
      task_file_template_id: 'tftpl_draft',
    });
  });

  it('keeps save point, direct restore operation, and task file template DTOs product-safe', () => {
    expect(FileLibrarySavePointSchema.parse({
      id: 'flsp_safe',
      file_library_id: 'flib_a',
      message: 'Before migration',
      created_at: '2026-05-09T00:00:00.000Z',
    })).toMatchObject({
      id: 'flsp_safe',
      file_library_id: 'flib_a',
    });

    expect(FileLibraryRestoreOperationSchema.parse({
      id: 'flro_safe',
      file_library_id: 'flib_a',
      source_save_point_id: 'flsp_safe',
      status: 'restoring',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    })).toMatchObject({
      id: 'flro_safe',
      source_save_point_id: 'flsp_safe',
      status: 'restoring',
    });
    expect(FileLibraryRestoreOperationSchema.safeParse({
      id: 'flro_raw_summary',
      file_library_id: 'flib_a',
      source_save_point_id: 'flsp_safe',
      status: 'ready',
      summary: 'raw restore summary',
      blockers: ['raw blocker'],
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    }).success).toBe(false);

    expect(CreateFileLibraryRestoreRequestSchema.parse({
      save_point_id: 'flsp_safe',
    })).toEqual({
      save_point_id: 'flsp_safe',
    });
    expect(CreateFileLibraryRestoreRequestSchema.safeParse({
      save_point_id: 'flsp_safe',
      [`discard_${'unsaved'}_changes_confirmed`]: true,
    }).success).toBe(false);

    expect(TaskFileTemplateSchema.parse({
      id: 'tftpl_safe',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
      name: 'Release task files',
      status: 'published',
      source_library_id: 'flib_a',
      source_save_point_id: 'flsp_safe',
      created_by_user_id: 'user_001',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    })).toMatchObject({
      id: 'tftpl_safe',
      status: 'published',
    });

    for (const schema of [FileLibrarySavePointSchema, FileLibraryRestoreOperationSchema, TaskFileTemplateSchema]) {
      const parsed = schema.safeParse({
        id: 'safe_id',
        file_library_id: 'flib_a',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        name: 'Bad DTO',
        status: 'published',
        source_library_id: 'flib_a',
        created_by_user_id: 'user_001',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
        repo_id: 'repo_raw',
        template_id: 'tmpl_raw',
        save_point_id: 'sp_raw',
        control_root: '/var/lib/afscp',
        storage_credential: 'secret',
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('validates task file template create requests without user or group sharing fields', () => {
    expect(CreateTaskFileTemplateRequestSchema.safeParse({
      name: 'Template from library',
      source_library_id: 'flib_ready',
    }).success).toBe(true);

    expect(CreateTaskFileTemplateRequestSchema.safeParse({
      name: 'Template from library',
      source_library_id: 'flib_ready',
      share_user_ids: ['user_2'],
    }).success).toBe(false);
  });

  it('requires safe task HOME binding fields on FileLibrary DTOs', () => {
    expect(FileLibrarySchema.parse({
      ...baseFileLibrary,
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    })).toMatchObject({
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    });

    expect(FileLibrarySchema.parse({
      ...baseFileLibrary,
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_id: 'task_archived',
      bound_task_title: 'Archived task',
      bound_task_status: 'archived',
    })).toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_status: 'archived',
    });
  });

  it('rejects redacted FileLibrary DTOs that leak bound task metadata', () => {
    const parsed = FileLibrarySchema.safeParse({
      ...baseFileLibrary,
      task_home_binding_status: 'bound',
      bound_task_visible: false,
      bound_task_title: 'Secret task',
      bound_task_status: 'active',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects file library DTOs that leak raw storage implementation fields', () => {
    const parsed = FileLibrarySchema.safeParse({
      ...baseFileLibrary,
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
      filesystem_name: 'legacy_storage_name',
      provider: 'legacy_provider',
      bucket: 'legacy_storage_location',
      metadata_url: 'legacy_metadata_endpoint',
      storage_bucket_url: 'legacy_storage_endpoint',
    });

    expect(parsed.success).toBe(false);
  });

  it('keeps public file-library DTOs and entries free of HOME path bindings and proof fields', () => {
    expect(FileLibrarySchema.safeParse({
      ...baseFileLibrary,
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
      file_library_home_segment: 'task-home-lib-a',
    }).success).toBe(false);

    expect(FileLibraryEntrySchema.safeParse({
      kind: 'file',
      path: 'workspace/readme.md',
      name: 'readme.md',
      size_bytes: 12,
      content_type: 'text/markdown',
      modified_at: '2026-05-09T00:00:00.000Z',
      etag: '"proof-like-value"',
    }).success).toBe(false);
  });

  it('does not export removed file-library connector public schemas', () => {
    for (const exportName of [
      'FileLibraryBackendSchema',
      'FileLibraryConnectorUnsupportedErrorSchema',
      'FileLibraryConnectorCapabilitySchema',
      'FileLibraryConnectorUnsupportedReasonSchema',
      'FileLibraryClientMountAccessSchema',
      'StorageCredentialExchangeResponseSchema',
    ]) {
      expect(contractExports).not.toHaveProperty(exportName);
    }
  });

  it('parses typed binding conflict errors with only display-safe fields', () => {
    expect(AgentTaskFileLibraryInUseErrorSchema.parse({
      error_code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      message: 'workspace_file_library_in_use',
      field: 'workspace_file_library_id',
      file_library_id: 'lib_a',
      bound_task_visible: false,
    })).toMatchObject({
      bound_task_visible: false,
    });

    expect(FileLibraryTaskInUseErrorSchema.parse({
      error_code: 'FILE_LIBRARY_TASK_IN_USE',
      message: 'file_library_task_in_use',
      file_library_id: 'lib_a',
      bound_task_visible: true,
      bound_task_id: 'task_archived',
      bound_task_title: 'Archived task',
      bound_task_status: 'archived',
    })).toMatchObject({
      bound_task_status: 'archived',
    });

    expect(FileLibraryTaskInUseErrorSchema.safeParse({
      error_code: 'FILE_LIBRARY_TASK_IN_USE',
      message: 'file_library_task_in_use',
      file_library_id: 'lib_a',
      bound_task_visible: false,
      bound_task_title: 'Secret task',
    }).success).toBe(false);

    expect(FileLibraryRestoreActiveWriterBlockedErrorSchema.parse({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: 'lib_a',
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: 'task_restore',
      bound_task_title: 'Restore task',
      bound_task_status: 'active',
    })).toMatchObject({
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
    });

    expect(FileLibraryRuntimeAccessReleaseBlockedErrorSchema.parse({
      error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      message: 'file_library_runtime_access_release_blocked',
      file_library_id: 'lib_a',
      blockers: [{ code: 'workspace_holder' }],
      bound_task_visible: false,
    })).toMatchObject({
      blockers: [{ code: 'workspace_holder' }],
      bound_task_visible: false,
    });

    expect(ReleaseFileLibraryRuntimeAccessResponseSchema.parse({
      file_library_id: 'lib_a',
      released: true,
      runtime_access_status: 'released',
    })).toEqual({
      file_library_id: 'lib_a',
      released: true,
      runtime_access_status: 'released',
    });
    expect(ReleaseFileLibraryRuntimeAccessResponseSchema.parse({
      file_library_id: 'lib_a',
      released: false,
      runtime_access_status: 'release_pending',
    })).toMatchObject({
      released: false,
      runtime_access_status: 'release_pending',
    });
  });

  it('keeps task delete and workspace binding conflict error fences contract-safe', () => {
    expect(AgentTaskDeleteBlockedErrorSchema.parse({
      error_code: 'AGENT_TASK_DELETE_BLOCKED',
      message: 'agent_task_delete_blocked',
      task_id: 'task_busy',
      blockers: ['active_run', 'active_terminal'],
    })).toMatchObject({
      task_id: 'task_busy',
      blockers: ['active_run', 'active_terminal'],
    });

    expect(AgentTaskWorkspaceBindingConflictErrorSchema.parse({
      error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      message: 'agent_task_workspace_binding_conflict',
      task_id: 'task_stale',
      file_library_id: 'lib_a',
      binding_generation: '1778300000000001',
      lease_epoch: 'lease_1',
      holder_id: 'holder_1',
    })).toMatchObject({
      binding_generation: '1778300000000001',
      lease_epoch: 'lease_1',
      holder_id: 'holder_1',
    });
  });

  it('keeps OpenAPI task binding conflict schemas satisfiable and strict without allOf traps', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const schemas = openapi.components?.schemas ?? {};

    for (const schemaName of ['AgentTaskFileLibraryInUseError', 'FileLibraryTaskInUseError']) {
      const schema = schemas[schemaName];
      expect(schema).toBeTruthy();
      expect(schema.allOf).toBeUndefined();
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).toMatchObject({
        bound_task_visible: { type: 'boolean' },
        bound_task_id: { type: 'string' },
        bound_task_title: { type: 'string' },
      });
      expect(schema.required).toEqual(expect.arrayContaining([
        'error_code',
        'message',
        'file_library_id',
        'bound_task_visible',
      ]));
    }
    expect(schemas.AgentTaskDeleteBlockedError?.properties).toMatchObject({
      task_id: { type: 'string' },
      blockers: {
        type: 'array',
        items: { type: 'string' },
      },
    });
    expect(schemas.AgentTaskWorkspaceBindingConflictError?.properties).toMatchObject({
      binding_generation: { type: 'string' },
      lease_epoch: { type: 'string' },
      holder_id: { type: 'string' },
    });
  });

  it('keeps typed error branches disjoint from ApiError fallback branches', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const schemas = openapi.components?.schemas ?? {};
    const apiErrorSchema = schemas.ApiError;
    const apiErrorCodes = readErrorCodeEnum(apiErrorSchema, schemas);

    expect(apiErrorSchema).toBeTruthy();
    expect(apiErrorSchema.additionalProperties).toBe(false);

    const overlaps: string[] = [];
    for (const response of findOneOfResponsesWithApiError(openapi.paths ?? {})) {
      for (const schemaName of response.schemaNames) {
        if (schemaName === 'ApiError') continue;
        const typedCodes = readErrorCodeEnum(schemas[schemaName], schemas);
        for (const code of typedCodes) {
          if (apiErrorCodes.includes(code)) {
            overlaps.push(`${response.path} ${response.method} ${response.status} ${schemaName}.${code}`);
          }
        }
      }
    }

    expect(overlaps).toEqual([]);
  });

  it('models CreateTask template and AFSCP control endpoint errors in OpenAPI', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const schemas = openapi.components?.schemas ?? {};
    const apiErrorCodes = readErrorCodeEnum(schemas.ApiError, schemas);

    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks',
      'post',
      '422',
    )).toEqual(expect.arrayContaining([
      'AgentTaskWorkspaceModeInvalidError',
      'AgentTaskWorkspaceFileLibraryRequiredError',
      'AgentTaskFileTemplateRequiredError',
    ]));
    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks',
      'post',
      '404',
    )).toEqual(expect.arrayContaining([
      'FileLibraryNotFoundError',
      'TaskFileTemplateNotFoundError',
    ]));
    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks',
      'post',
      '409',
    )).toEqual(expect.arrayContaining([
      'TaskFileTemplateUnpublishedError',
      'ApiError',
    ]));

    for (const path of [
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/save-points',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates',
    ]) {
      expect(readResponseSchemaNames(openapi.paths ?? {}, path, 'post', '409')).toEqual(expect.arrayContaining([
        'FileLibraryDeletingError',
        'FileLibraryNotReadyError',
        'ApiError',
      ]));
    }

    expect(openapi.paths?.[
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore'
    ]).not.toHaveProperty('get');

    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/operations/active',
      'get',
      '200',
    )).toEqual(['GetFileLibraryActiveOperationResponse']);

    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore',
      'post',
      '200',
    )).toEqual(['FileLibraryRestoreOperation']);
    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates',
      'post',
      '200',
    )).toEqual(['TaskFileTemplate']);
    expect(readResponseSchemaNames(
      openapi.paths ?? {},
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates',
      'post',
      '422',
    )).toEqual(['ApiError']);
    expect(asRecord(
      asRecord(openapi.paths?.[
        '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates'
      ])?.post,
    )?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      }),
    ]));

    for (const path of [
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}/publish',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}/unpublish',
    ]) {
      expect(readResponseSchemaNames(openapi.paths ?? {}, path, path.endsWith('taskFileTemplateId}') ? 'delete' : 'post', '404'))
        .toEqual(['TaskFileTemplateNotFoundError']);
    }

    expect(apiErrorCodes).toEqual(expect.arrayContaining([
      'SERVICE_UNAVAILABLE',
      'PROJECT_STORAGE_PENDING',
      'PROJECT_STORAGE_BLOCKED',
      'FILE_LIBRARY_PROVISIONING_FAILED',
      'FILE_LIBRARY_OPERATION_PENDING',
      'FILE_LIBRARY_STORAGE_NOT_READY',
      'FILE_LIBRARY_SAVE_POINT_LIST_FAILED',
      'FILE_LIBRARY_SAVE_POINT_CREATE_FAILED',
      'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
      'FILE_LIBRARY_RESTORE_FAILED',
      'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      'FILE_LIBRARY_NAMESPACE_PROJECT_MISMATCH',
      'FILE_LIBRARY_TEMPLATE_CLONE_NOT_ALLOWED',
      'FILE_LIBRARY_CAPABILITY_DENIED',
      'FILE_LIBRARY_STORAGE_ADMIN_ACTION_REQUIRED',
      'TASK_FILE_TEMPLATE_CREATE_FAILED',
    ]));
  });

  it('models File Library active route error responses in OpenAPI', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const paths = openapi.paths ?? {};
    const schemas = openapi.components?.schemas ?? {};
    const apiErrorCodes = readErrorCodeEnum(schemas.ApiError, schemas);

    const expectedStatusesByOperation: Array<{
      path: string;
      method: string;
      statuses: string[];
    }> = [
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries',
        method: 'get',
        statuses: ['200', '401', '403'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries',
        method: 'post',
        statuses: ['201', '400', '401', '403', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}',
        method: 'get',
        statuses: ['200', '401', '403', '404'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}',
        method: 'patch',
        statuses: ['200', '400', '401', '403', '404', '409'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}',
        method: 'delete',
        statuses: ['204', '401', '403', '404', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/entries',
        method: 'get',
        statuses: ['200', '400', '401', '403', '404', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/folders',
        method: 'post',
        statuses: ['204', '400', '401', '403', '404', '409', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/delete',
        method: 'post',
        statuses: ['200', '400', '401', '403', '404', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/move',
        method: 'post',
        statuses: ['204', '400', '401', '403', '404', '409', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/upload',
        method: 'post',
        statuses: ['201', '400', '401', '403', '404', '409', '415', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/download',
        method: 'get',
        statuses: ['200', '400', '401', '403', '404', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/meta',
        method: 'get',
        statuses: ['200', '400', '401', '403', '404', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/save-points',
        method: 'get',
        statuses: ['200', '401', '403', '404', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/save-points',
        method: 'post',
        statuses: ['202', '400', '401', '403', '404', '409', '422', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore',
        method: 'post',
        statuses: ['200', '400', '401', '403', '404', '409', '422', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/operations/active',
        method: 'get',
        statuses: ['200', '401', '403', '404', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/runtime-access/release',
        method: 'post',
        statuses: ['200', '401', '403', '404', '409', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates',
        method: 'get',
        statuses: ['200', '401', '403'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates',
        method: 'post',
        statuses: ['200', '201', '400', '401', '403', '404', '409', '422', '502', '503'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}',
        method: 'delete',
        statuses: ['204', '401', '403', '404'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}/publish',
        method: 'post',
        statuses: ['200', '401', '403', '404'],
      },
      {
        path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates/{taskFileTemplateId}/unpublish',
        method: 'post',
        statuses: ['200', '401', '403', '404'],
      },
    ];

    for (const operation of expectedStatusesByOperation) {
      expect(readResponseStatuses(paths, operation.path, operation.method), `${operation.method.toUpperCase()} ${operation.path}`)
        .toEqual(expect.arrayContaining(operation.statuses));
    }

    for (const path of [
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/entries',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/folders',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/delete',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/move',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/upload',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/download',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/meta',
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/save-points',
    ]) {
      expect(readResponseSchemaNames(paths, path, readFileLibrary404ProbeMethod(path), '404'))
        .toEqual(expect.arrayContaining(['ApiError']));
    }

    expect(readResponseSchemaNames(
      paths,
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/move',
      'post',
      '409',
    )).toEqual(expect.arrayContaining(['FileLibraryDeletingError', 'FileLibraryNotReadyError', 'ApiError']));
    expect(readResponseSchemaNames(
      paths,
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/upload',
      'post',
      '409',
    )).toEqual(expect.arrayContaining(['FileLibraryDeletingError', 'FileLibraryNotReadyError', 'ApiError']));
    expect(readResponseSchemaNames(
      paths,
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/upload',
      'post',
      '415',
    )).toEqual(['ApiError']);

    expect(apiErrorCodes).toEqual(expect.arrayContaining([
      'UNSUPPORTED_MEDIA_TYPE',
      'FILE_LIBRARY_DELETE_FAILED',
      'FILE_LIBRARY_UPLOAD_FAILED',
      'FILE_LIBRARY_MOVE_FAILED',
      'FILE_LIBRARY_FOLDER_CREATE_FAILED',
      'FILE_LIBRARY_LIST_FAILED',
      'destination_exists',
    ]));
  });

  it('keeps removed file-library connector and legacy restore paths and schemas out of OpenAPI', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    const serializedPaths = JSON.stringify(openapi.paths ?? {});
    const schemas = openapi.components?.schemas ?? {};

    expect(serializedPaths).not.toContain('/backend');
    expect(serializedPaths).not.toContain('/storage-credential-exchange');
    expect(serializedPaths).not.toContain('/desktop-mount-access');
    expect(serializedPaths).not.toContain('/share-link');
    expect(serializedPaths).not.toContain(`/restore-${'preview'}`);
    expect(serializedPaths).not.toContain(`/restore-${'run'}`);
    expect(serializedPaths).not.toContain(`/restore-${'cancel'}`);
    expect(serializedPaths).not.toContain(`restore_${'preview'}_id`);
    expect(serializedPaths).not.toContain('createFileLibraryV2');
    expect(serializedPaths).not.toContain('updateFileLibraryV2');
    expect(serializedPaths).not.toContain('deleteFileLibraryV2');
    expect(serializedPaths).toContain('createFileLibrary');
    expect(serializedPaths).toContain('updateFileLibrary');
    expect(serializedPaths).toContain('deleteFileLibrary');
    for (const schemaName of [
      'FileLibraryBackend',
      'StorageCredentialExchangeResponse',
      'FileLibraryDesktopMountAccess',
      'FileLibraryDesktopMountAccessResponse',
      'FileLibraryConnectorUnsupportedError',
      'CreateFileLibraryShareLinkRequest',
      'FileLibraryObject',
      'FileLibraryRestorePreview',
      'GetFileLibraryRestorePreviewResponse',
      'CreateFileLibraryRestorePreviewRequest',
      'RunFileLibraryRestoreRequest',
      'CancelFileLibraryRestoreRequest',
      'FileLibraryRestoreRun',
      'FileLibraryRestoreRunConflictError',
    ]) {
      expect(schemas).not.toHaveProperty(schemaName);
    }
  });

  it('keeps active route-kind map on direct file-library restore only', () => {
    const routeKindMapPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi-route-kind-map.json'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi-route-kind-map.json'),
    ].find((candidate) => existsSync(candidate));
    if (!routeKindMapPath) {
      throw new Error('openapi-route-kind-map.json not found from contract test cwd');
    }
    const routeKindMap = JSON.parse(readFileSync(routeKindMapPath, 'utf8')) as Record<string, { path?: string; method?: string; methods?: string[] }>;
    const serialized = JSON.stringify(routeKindMap);

    expect(routeKindMap.fileLibraryRestore?.path).toBe(
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore',
    );
    expect(routeKindMap.fileLibraryRestore?.method).toBe('post');
    expect(routeKindMap.fileLibraryRestore?.methods).toBeUndefined();
    expect(routeKindMap).not.toHaveProperty('fileLibraryRestorePreview');
    expect(routeKindMap).not.toHaveProperty('fileLibraryRestoreRun');
    expect(routeKindMap).not.toHaveProperty('fileLibraryRestoreCancel');
    expect(serialized).not.toContain(`/restore-${'preview'}`);
    expect(serialized).not.toContain(`/restore-${'run'}`);
    expect(serialized).not.toContain(`/restore-${'cancel'}`);
  });
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRefSchemaName(value: unknown): string | null {
  const ref = asRecord(value)?.$ref;
  if (typeof ref !== 'string') return null;
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  return match?.[1] ?? null;
}

function readStringEnum(value: unknown): string[] {
  const enumValues = asRecord(value)?.enum;
  return Array.isArray(enumValues)
    ? enumValues.filter((item): item is string => typeof item === 'string')
    : [];
}

function readErrorCodeEnum(
  schema: Record<string, unknown> | undefined,
  schemas: Record<string, Record<string, unknown>>,
): string[] {
  const errorCode = asRecord(asRecord(schema?.properties)?.error_code);
  const directEnum = readStringEnum(errorCode);
  if (directEnum.length > 0) return directEnum;

  const refName = readRefSchemaName(errorCode);
  if (!refName) return [];
  return readStringEnum(schemas[refName]);
}

function readResponseSchemaNames(
  paths: Record<string, unknown>,
  path: string,
  method: string,
  status: string,
): string[] {
  const schema = asRecord(
    asRecord(
      asRecord(
        asRecord(
          asRecord(
            asRecord(paths[path])?.[method],
          )?.responses,
        )?.[status],
      )?.content,
    )?.['application/json'],
  )?.schema;
  const directRef = readRefSchemaName(schema);
  if (directRef) return [directRef];
  const oneOf = asRecord(schema)?.oneOf;
  if (!Array.isArray(oneOf)) return [];
  return oneOf
    .map(readRefSchemaName)
    .filter((name): name is string => typeof name === 'string');
}

function readResponseStatuses(
  paths: Record<string, unknown>,
  path: string,
  method: string,
): string[] {
  const responses = asRecord(asRecord(asRecord(paths[path])?.[method])?.responses);
  return responses ? Object.keys(responses) : [];
}

function readFileLibrary404ProbeMethod(path: string): 'get' | 'post' {
  if (
    path.endsWith('{libraryId}')
    || path.endsWith('/entries')
    || path.endsWith('/download')
    || path.endsWith('/meta')
    || path.endsWith('/save-points')
  ) {
    return 'get';
  }
  return 'post';
}

function findOneOfResponsesWithApiError(paths: Record<string, unknown>): Array<{
  path: string;
  method: string;
  status: string;
  schemaNames: string[];
}> {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const matches: Array<{
    path: string;
    method: string;
    status: string;
    schemaNames: string[];
  }> = [];

  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemValue);
    if (!pathItem) continue;
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      const responses = asRecord(asRecord(operationValue)?.responses);
      if (!responses) continue;
      for (const [status, responseValue] of Object.entries(responses)) {
        const schema = asRecord(
          asRecord(
            asRecord(
              asRecord(responseValue)?.content,
            )?.['application/json'],
          )?.schema,
        );
        const oneOf = schema?.oneOf;
        if (!Array.isArray(oneOf)) continue;
        const schemaNames = oneOf
          .map(readRefSchemaName)
          .filter((name): name is string => typeof name === 'string');
        if (schemaNames.includes('ApiError')) {
          matches.push({ path, method, status, schemaNames });
        }
      }
    }
  }

  return matches;
}
