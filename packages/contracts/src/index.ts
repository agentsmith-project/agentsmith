import { z } from 'zod';

export const INTERNAL_AGENT_KEEPALIVE_INTERVAL_SECONDS = 60;
export const INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS = 180;
export const INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS = 300;
export const INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS = 600;
export const INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS = 3600;

export const ProjectVisibilitySchema = z.enum(['public', 'private']);
export const ProjectJoinPolicySchema = z.enum(['approval_required', 'open']);
export const ProjectStatusSchema = z.enum(['active', 'archived', 'deleted']);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: ProjectVisibilitySchema,
  join_policy: ProjectJoinPolicySchema.optional(),
  owner_id: z.string().min(1),
  status: ProjectStatusSchema,
  governance_json: z.record(z.string(), z.unknown()).optional(),
  limits_json: z.record(z.string(), z.unknown()).optional(),
  admin_member_ids: z.array(z.string().min(1)).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  visibility: ProjectVisibilitySchema.default('private'),
  join_policy: ProjectJoinPolicySchema.default('approval_required'),
}).strict();

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
    owner_id: z.string().min(1).optional(),
    visibility: ProjectVisibilitySchema.optional(),
    join_policy: ProjectJoinPolicySchema.optional(),
    status: ProjectStatusSchema.optional(),
    governance_json: z.record(z.string(), z.unknown()).optional(),
    limits_json: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  });

export const ListProjectsResponseSchema = z.object({
  items: z.array(ProjectSchema),
});

export const ErrorResponseSchema = z.object({
  error_code: z.string(),
  message: z.string(),
  request_id: z.string().optional(),
});

export const FileLibraryBoundTaskStatusSchema = z.enum(['active', 'archived']);
export const FileLibraryTaskHomeBindingStatusSchema = z.enum(['unbound', 'bound']);

type BoundTaskSafeFields = {
  bound_task_visible?: boolean;
  bound_task_id?: string;
  bound_task_title?: string;
  bound_task_status?: z.infer<typeof FileLibraryBoundTaskStatusSchema>;
};

function validateBoundTaskSafeFields(
  value: BoundTaskSafeFields,
  ctx: z.RefinementCtx,
): void {
  const hasSummary =
    value.bound_task_id !== undefined ||
    value.bound_task_title !== undefined ||
    value.bound_task_status !== undefined;

  if (value.bound_task_visible === false && hasSummary) {
    ctx.addIssue({
      code: 'custom',
      message: 'bound_task_summary_must_be_redacted',
      path: ['bound_task_visible'],
    });
    return;
  }

  if (value.bound_task_visible === true) {
    for (const field of ['bound_task_id', 'bound_task_title', 'bound_task_status'] as const) {
      if (value[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'bound_task_summary_required_when_visible',
          path: [field],
        });
      }
    }
  }
}

export const AgentTaskWorkspaceModeInvalidErrorSchema = z.object({
  error_code: z.literal('AGENT_TASK_WORKSPACE_MODE_INVALID'),
  message: z.literal('agent_task_workspace_mode_invalid'),
  field: z.literal('workspace_mode'),
  workspace_mode: z.string().optional(),
  request_id: z.string().optional(),
}).strict();

export const AgentTaskWorkspaceFileLibraryRequiredErrorSchema = z.object({
  error_code: z.literal('AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED'),
  message: z.literal('agent_task_workspace_file_library_required'),
  field: z.literal('workspace_file_library_id'),
  request_id: z.string().optional(),
}).strict();

export const FileLibraryNotFoundErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_NOT_FOUND'),
  message: z.literal('file_library_not_found'),
  file_library_id: z.string().min(1).optional(),
  request_id: z.string().optional(),
}).strict();

export const FileLibraryForbiddenErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_FORBIDDEN'),
  message: z.literal('file_library_forbidden'),
  file_library_id: z.string().min(1).optional(),
  request_id: z.string().optional(),
}).strict();

export const FileLibraryNotReadyErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_NOT_READY'),
  message: z.literal('file_library_not_ready'),
  file_library_id: z.string().min(1),
  file_library_status: z.string().min(1),
  request_id: z.string().optional(),
}).strict();

export const FileLibraryDeletingErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_DELETING'),
  message: z.literal('file_library_deleting'),
  file_library_id: z.string().min(1),
  file_library_status: z.string().min(1),
  request_id: z.string().optional(),
}).strict();

export const AgentTaskFileLibraryInUseErrorSchema = z.object({
  error_code: z.literal('AGENT_TASK_FILE_LIBRARY_IN_USE'),
  message: z.literal('workspace_file_library_in_use'),
  field: z.literal('workspace_file_library_id'),
  file_library_id: z.string().min(1),
  bound_task_visible: z.boolean(),
  bound_task_id: z.string().min(1).optional(),
  bound_task_title: z.string().min(1).optional(),
  bound_task_status: FileLibraryBoundTaskStatusSchema.optional(),
  request_id: z.string().optional(),
}).strict().superRefine(validateBoundTaskSafeFields);

export const FileLibraryTaskInUseErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_TASK_IN_USE'),
  message: z.literal('file_library_task_in_use'),
  file_library_id: z.string().min(1),
  bound_task_visible: z.boolean(),
  bound_task_id: z.string().min(1).optional(),
  bound_task_title: z.string().min(1).optional(),
  bound_task_status: FileLibraryBoundTaskStatusSchema.optional(),
  request_id: z.string().optional(),
}).strict().superRefine(validateBoundTaskSafeFields);

export const FileLibraryNotEmptyErrorSchema = z.object({
  error_code: z.literal('FILE_LIBRARY_NOT_EMPTY'),
  message: z.literal('file_library_not_empty'),
  file_library_id: z.string().min(1),
  request_id: z.string().optional(),
}).strict();

export const AgentTaskDeleteBlockedErrorSchema = z.object({
  error_code: z.literal('AGENT_TASK_DELETE_BLOCKED'),
  message: z.literal('agent_task_delete_blocked'),
  task_id: z.string().min(1),
  blockers: z.array(z.string().min(1)).min(1),
  retry_after_seconds: z.number().int().positive().optional(),
  request_id: z.string().optional(),
}).strict();

export const AgentTaskWorkspaceBindingConflictErrorSchema = z.object({
  error_code: z.literal('AGENT_TASK_WORKSPACE_BINDING_CONFLICT'),
  message: z.literal('agent_task_workspace_binding_conflict'),
  task_id: z.string().min(1),
  file_library_id: z.string().min(1),
  holder_id: z.string().min(1).optional(),
  binding_generation: z.string().min(1).optional(),
  lease_epoch: z.string().min(1).optional(),
  request_id: z.string().optional(),
}).strict();

export const AgentTaskFileLibraryErrorSchema = z.union([
  AgentTaskWorkspaceModeInvalidErrorSchema,
  AgentTaskWorkspaceFileLibraryRequiredErrorSchema,
  FileLibraryNotFoundErrorSchema,
  FileLibraryForbiddenErrorSchema,
  FileLibraryNotReadyErrorSchema,
  FileLibraryDeletingErrorSchema,
  AgentTaskFileLibraryInUseErrorSchema,
  FileLibraryTaskInUseErrorSchema,
  FileLibraryNotEmptyErrorSchema,
  AgentTaskDeleteBlockedErrorSchema,
  AgentTaskWorkspaceBindingConflictErrorSchema,
]);

export const FileLibraryCatalogSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: z.literal('shared'),
  provider: z.literal('s3').optional(),
  bucket: z.string().min(1).optional(),
  object_prefix: z.string().min(1).optional(),
  doc_namespace: z.string().min(1).optional(),
  vector_namespace: z.string().min(1).optional(),
  created_by_user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ListFileLibraryCatalogsResponseSchema = z.object({
  items: z.array(FileLibraryCatalogSchema),
});

export const CreateFileLibraryCatalogRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visibility: z.literal('shared').default('shared'),
});

export const UpdateFileLibraryCatalogRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  });

export const FileLibraryObjectListPrefixItemSchema = z.object({
  kind: z.literal('prefix'),
  prefix: z.string().min(1),
  name: z.string().min(1),
});

export const FileLibraryObjectListObjectItemSchema = z.object({
  kind: z.literal('object'),
  key: z.string().min(1),
  name: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
});

export const FileLibraryObjectListItemSchema = z.union([
  FileLibraryObjectListPrefixItemSchema,
  FileLibraryObjectListObjectItemSchema,
]);

export const ListFileLibraryObjectsResponseSchema = z.object({
  prefix: z.string(),
  items: z.array(FileLibraryObjectListItemSchema),
  next_continuation_token: z.string().nullable(),
});

export const ListFileLibraryObjectsQuerySchema = z.object({
  prefix: z.string().optional(),
  delimiter: z.literal('/').default('/'),
  page_size: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional(),
  continuation_token: z.string().optional(),
  search: z.string().trim().min(1).max(256).optional(),
  sort_by: z.enum(['name', 'size_bytes', 'last_modified']).default('name'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
});

export const CreateFileLibraryObjectFolderRequestSchema = z.object({
  prefix: z.string().min(1),
});

export const UploadFileLibraryObjectResponseSchema = z.object({
  key: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
});

export const DeleteFileLibraryObjectsRequestSchema = z.object({
  keys: z.array(z.string().min(1)).min(1),
});

export const DeleteFileLibraryObjectsResponseSchema = z.object({
  results: z.array(
    z.object({
      key: z.string().min(1),
      status: z.enum(['deleted', 'not_found', 'error']),
      error_code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export const MoveFileLibraryObjectRequestSchema = z.object({
  from_key: z.string().min(1),
  to_key: z.string().min(1),
  overwrite: z.boolean().optional(),
});

export const FileLibraryObjectMetaResponseSchema = z.object({
  key: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
  user_metadata: z.record(z.string(), z.string()).optional(),
});

export const FileLibraryObjectDownloadQuerySchema = z.object({
  key: z.string().min(1),
});

export const FileLibraryObjectShareLinkCreateRequestSchema = z.object({
  key: z.string().min(1),
  expires_in_seconds: z
    .number()
    .int()
    .min(60)
    .max(604800)
    .optional(),
});

export const FileLibraryObjectShareLinkResponseSchema = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  expires_at: z.string().datetime(),
  expires_in_seconds: z.number().int().min(60).max(604800),
});

export const FileLibraryStatusSchema = z.enum([
  'creating',
  'ready',
  'degraded',
  'failed',
  'deleting',
]);

export const FileLibrarySchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: FileLibraryStatusSchema,
  task_home_binding_status: FileLibraryTaskHomeBindingStatusSchema,
  bound_task_id: z.string().min(1).optional(),
  bound_task_title: z.string().min(1).optional(),
  bound_task_status: FileLibraryBoundTaskStatusSchema.optional(),
  bound_task_visible: z.boolean(),
  filesystem_name: z.string().min(1),
  created_by_user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).superRefine((value, ctx) => {
  validateBoundTaskSafeFields(value, ctx);
  if (value.task_home_binding_status === 'unbound' && value.bound_task_visible) {
    ctx.addIssue({
      code: 'custom',
      message: 'unbound_library_cannot_expose_bound_task',
      path: ['bound_task_visible'],
    });
  }
});

export const ListFileLibrariesResponseSchema = z.object({
  items: z.array(FileLibrarySchema),
});

export const CreateFileLibraryRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

export const UpdateFileLibraryRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'at_least_one_field_required',
});

export const TaskInputRefInputSchema = z.object({
  kind: z.enum(['library_object', 'artifact', 'url']),
}).passthrough();

export const TaskWorkspaceModeSchema = z.enum(['create_new', 'use_existing']);

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(255),
  prompt: z.string().optional(),
  bound_runner_id: z.string().min(1).optional(),
  input_refs: z.array(TaskInputRefInputSchema).optional(),
  initial_inputs: z.array(TaskInputRefInputSchema).optional(),
  workspace_mode: TaskWorkspaceModeSchema.optional(),
  workspace_name: z.string().min(1).max(255).optional(),
  workspace_file_library_id: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  const workspaceMode = value.workspace_mode ?? 'create_new';
  if (workspaceMode === 'create_new' && value.workspace_file_library_id) {
    ctx.addIssue({
      code: 'custom',
      message: 'agent_task_workspace_mode_invalid',
      path: ['workspace_mode'],
    });
  }
  if (workspaceMode === 'use_existing' && !value.workspace_file_library_id) {
    ctx.addIssue({
      code: 'custom',
      message: 'agent_task_workspace_file_library_required',
      path: ['workspace_file_library_id'],
    });
  }
});

export const FileLibraryGatewayStatusSchema = z.enum([
  'not_started',
  'starting',
  'ready',
  'degraded',
  'failed',
  'stopped',
]);

export const FileLibraryBackendSchema = z.object({
  library_id: z.string().min(1),
  filesystem_name: z.string().min(1),
  provisioning_status: FileLibraryStatusSchema,
  gateway_status: FileLibraryGatewayStatusSchema,
  postgres: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    username: z.string().min(1),
  }),
  minio: z.object({
    endpoint: z.string().min(1),
    bucket: z.string().min(1),
    region: z.string().min(1).optional(),
  }),
  gateway: z.object({
    loopback_url: z.string().url().optional(),
    port: z.number().int().positive().optional(),
    last_started_at: z.string().datetime().optional(),
  }).optional(),
  last_error: z.string().optional(),
});

export const FileLibraryEntrySchema = z.union([
  z.object({
    kind: z.literal('directory'),
    path: z.string().min(1),
    name: z.string().min(1),
    modified_at: z.string().datetime().optional(),
  }),
  z.object({
    kind: z.literal('file'),
    path: z.string().min(1),
    name: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
    content_type: z.string().min(1).optional(),
    modified_at: z.string().datetime(),
    etag: z.string().optional(),
  }),
]);

export const ListFileLibraryEntriesQuerySchema = z.object({
  path: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(1000).optional(),
  continuation_token: z.string().optional(),
  search: z.string().trim().min(1).max(256).optional(),
  sort_by: z.enum(['name', 'size_bytes', 'modified_at']).default('name'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
});

export const ListFileLibraryEntriesResponseSchema = z.object({
  path: z.string(),
  items: z.array(FileLibraryEntrySchema),
  next_continuation_token: z.string().nullable(),
});

export const CreateFileLibraryFolderRequestSchema = z.object({
  path: z.string().min(1),
});

export const DeleteFileLibraryEntriesRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});

export const DeleteFileLibraryEntriesResponseSchema = z.object({
  results: z.array(z.object({
    path: z.string().min(1),
    status: z.enum(['deleted', 'not_found', 'error']),
    error_code: z.string().optional(),
    message: z.string().optional(),
  })),
});

export const MoveFileLibraryEntryRequestSchema = z.object({
  from_path: z.string().min(1),
  to_path: z.string().min(1),
  overwrite: z.boolean().optional(),
});

export const FileLibraryDownloadQuerySchema = z.object({
  path: z.string().min(1),
});

export const CreateFileLibraryShareLinkRequestSchema = z.object({
  path: z.string().min(1),
  expires_in_seconds: z.number().int().positive().max(60 * 60 * 24 * 7).optional(),
});

export const FileLibraryClientMountAccessSchema = z.object({
  filesystem_name: z.string().min(1),
  metadata_url: z.string().min(1),
  storage_bucket_url: z.string().min(1).optional(),
  recommended_mount_path: z.string().min(1),
  platform_notes: z.array(z.string().min(1)).default([]),
  recommended_mount_commands: z.object({
    linux: z.string().min(1),
    macos: z.string().min(1),
    windows: z.string().min(1),
  }),
  created_at: z.string().datetime(),
});

export const StorageCredentialExchangeResponseSchema = z.object({
  client_mount_access: FileLibraryClientMountAccessSchema,
});

export const WorkspaceFoundationInitializationRequestSchema = z.object({
  workspace_id: z.string().min(1),
  workspace_name: z.string().min(1),
  workspace_admin: z.string().min(1),
  project_creators: z.array(z.string().min(1)).default([]),
  idp: z.object({
    kind: z.literal('keycloak'),
    url: z.string().url(),
    realm: z.string().min(1),
    client_id: z.string().min(1),
  }),
  tenant: z.object({
    substrate_label: z.string().min(1).optional(),
    database_name: z.string().min(1),
    collection_prefix: z.string().min(1),
    key_prefix: z.string().min(1),
  }),
});

export const WorkspaceFoundationInitializationResultSchema = z.object({
  status: z.enum(['ready', 'failed']),
  initialized_at: z.string().datetime().nullable(),
  init_error: z.string().nullable(),
  failed_domain: z
    .enum([
      'model_config',
      'endpoints',
      'chat',
      'agents',
      'audit_usage',
      'agent_task',
      'governance',
    ])
    .nullable(),
  tenant_materialized: z.boolean(),
  idp_config_applied: z.boolean(),
  data_config_applied: z.boolean(),
  data_foundations: z.object({
    database_name: z.string().min(1),
    collection_prefix: z.string().min(1),
    key_prefix: z.string().min(1),
    domains: z.array(
      z.object({
        domain: z.enum([
          'model_config',
          'endpoints',
          'chat',
          'agents',
          'audit_usage',
          'agent_task',
          'governance',
        ]),
        status: z.enum(['ready', 'failed', 'not_started']),
        init_error: z.string().nullable(),
        collections: z.array(z.string().min(1)).min(1),
      }),
    ),
    materialized_collections: z.array(z.string().min(1)),
  }),
});

export type ProjectDTO = z.infer<typeof ProjectSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type AgentTaskWorkspaceModeInvalidError = z.infer<typeof AgentTaskWorkspaceModeInvalidErrorSchema>;
export type AgentTaskWorkspaceFileLibraryRequiredError = z.infer<typeof AgentTaskWorkspaceFileLibraryRequiredErrorSchema>;
export type FileLibraryNotFoundError = z.infer<typeof FileLibraryNotFoundErrorSchema>;
export type FileLibraryForbiddenError = z.infer<typeof FileLibraryForbiddenErrorSchema>;
export type FileLibraryNotReadyError = z.infer<typeof FileLibraryNotReadyErrorSchema>;
export type FileLibraryDeletingError = z.infer<typeof FileLibraryDeletingErrorSchema>;
export type AgentTaskFileLibraryInUseError = z.infer<typeof AgentTaskFileLibraryInUseErrorSchema>;
export type FileLibraryTaskInUseError = z.infer<typeof FileLibraryTaskInUseErrorSchema>;
export type FileLibraryNotEmptyError = z.infer<typeof FileLibraryNotEmptyErrorSchema>;
export type AgentTaskDeleteBlockedError = z.infer<typeof AgentTaskDeleteBlockedErrorSchema>;
export type AgentTaskWorkspaceBindingConflictError = z.infer<typeof AgentTaskWorkspaceBindingConflictErrorSchema>;
export type AgentTaskFileLibraryError = z.infer<typeof AgentTaskFileLibraryErrorSchema>;
export type FileLibraryCatalogDTO = z.infer<typeof FileLibraryCatalogSchema>;
export type ListFileLibraryCatalogsResponse = z.infer<typeof ListFileLibraryCatalogsResponseSchema>;
export type CreateFileLibraryCatalogRequest = z.infer<typeof CreateFileLibraryCatalogRequestSchema>;
export type UpdateFileLibraryCatalogRequest = z.infer<typeof UpdateFileLibraryCatalogRequestSchema>;
export type ListFileLibraryObjectsResponse = z.infer<typeof ListFileLibraryObjectsResponseSchema>;
export type ListFileLibraryObjectsQuery = z.infer<typeof ListFileLibraryObjectsQuerySchema>;
export type CreateFileLibraryObjectFolderRequest = z.infer<typeof CreateFileLibraryObjectFolderRequestSchema>;
export type UploadFileLibraryObjectResponse = z.infer<typeof UploadFileLibraryObjectResponseSchema>;
export type DeleteFileLibraryObjectsRequest = z.infer<typeof DeleteFileLibraryObjectsRequestSchema>;
export type DeleteFileLibraryObjectsResponse = z.infer<typeof DeleteFileLibraryObjectsResponseSchema>;
export type MoveFileLibraryObjectRequest = z.infer<typeof MoveFileLibraryObjectRequestSchema>;
export type FileLibraryObjectMetaResponse = z.infer<typeof FileLibraryObjectMetaResponseSchema>;
export type FileLibraryObjectDownloadQuery = z.infer<typeof FileLibraryObjectDownloadQuerySchema>;
export type FileLibraryObjectShareLinkCreateRequest = z.infer<typeof FileLibraryObjectShareLinkCreateRequestSchema>;
export type FileLibraryObjectShareLinkResponse = z.infer<typeof FileLibraryObjectShareLinkResponseSchema>;
export type FileLibraryDTO = z.infer<typeof FileLibrarySchema>;
export type ListFileLibrariesResponse = z.infer<typeof ListFileLibrariesResponseSchema>;
export type CreateFileLibraryRequest = z.infer<typeof CreateFileLibraryRequestSchema>;
export type UpdateFileLibraryRequest = z.infer<typeof UpdateFileLibraryRequestSchema>;
export type TaskInputRefInput = z.infer<typeof TaskInputRefInputSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type FileLibraryBackendDTO = z.infer<typeof FileLibraryBackendSchema>;
export type ListFileLibraryEntriesQuery = z.infer<typeof ListFileLibraryEntriesQuerySchema>;
export type ListFileLibraryEntriesResponse = z.infer<typeof ListFileLibraryEntriesResponseSchema>;
export type CreateFileLibraryFolderRequest = z.infer<typeof CreateFileLibraryFolderRequestSchema>;
export type DeleteFileLibraryEntriesRequest = z.infer<typeof DeleteFileLibraryEntriesRequestSchema>;
export type DeleteFileLibraryEntriesResponse = z.infer<typeof DeleteFileLibraryEntriesResponseSchema>;
export type MoveFileLibraryEntryRequest = z.infer<typeof MoveFileLibraryEntryRequestSchema>;
export type FileLibraryDownloadQuery = z.infer<typeof FileLibraryDownloadQuerySchema>;
export type CreateFileLibraryShareLinkRequest = z.infer<typeof CreateFileLibraryShareLinkRequestSchema>;
export type FileLibraryClientMountAccess = z.infer<typeof FileLibraryClientMountAccessSchema>;
export type StorageCredentialExchangeResponse = z.infer<typeof StorageCredentialExchangeResponseSchema>;
export type WorkspaceFoundationInitializationRequest = z.infer<typeof WorkspaceFoundationInitializationRequestSchema>;
export type WorkspaceFoundationInitializationResult = z.infer<typeof WorkspaceFoundationInitializationResultSchema>;
