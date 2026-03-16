import { z } from 'zod';

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
  execution_preferences_json: z.record(z.string(), z.unknown()).optional(),
  limits_json: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  visibility: ProjectVisibilitySchema.default('private'),
  join_policy: ProjectJoinPolicySchema.default('approval_required'),
});

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
    owner_id: z.string().min(1).optional(),
    visibility: ProjectVisibilitySchema.optional(),
    join_policy: ProjectJoinPolicySchema.optional(),
    status: ProjectStatusSchema.optional(),
    governance_json: z.record(z.string(), z.unknown()).optional(),
    execution_preferences_json: z.record(z.string(), z.unknown()).optional(),
    limits_json: z.record(z.string(), z.unknown()).optional(),
  })
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

export const SourceStatusSchema = z.enum(['ready', 'deleted']);

export const SourceSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  library_id: z.string().min(1).optional(),
  name: z.string().min(1),
  object_key: z.string().min(1),
  content_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  status: SourceStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateSourceRequestSchema = z.object({
  name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  library_id: z.string().min(1).max(255),
});

export const ListSourcesResponseSchema = z.object({
  items: z.array(SourceSchema),
});

export const SourceLibrarySchema = z.object({
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

export const ListSourceLibrariesResponseSchema = z.object({
  items: z.array(SourceLibrarySchema),
});

export const CreateSourceLibraryRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visibility: z.literal('shared').default('shared'),
});

export const UpdateSourceLibraryRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  });

export const SourceObjectListPrefixItemSchema = z.object({
  kind: z.literal('prefix'),
  prefix: z.string().min(1),
  name: z.string().min(1),
});

export const SourceObjectListObjectItemSchema = z.object({
  kind: z.literal('object'),
  key: z.string().min(1),
  name: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
});

export const SourceObjectListItemSchema = z.union([
  SourceObjectListPrefixItemSchema,
  SourceObjectListObjectItemSchema,
]);

export const ListSourceObjectsResponseSchema = z.object({
  prefix: z.string(),
  items: z.array(SourceObjectListItemSchema),
  next_continuation_token: z.string().nullable(),
});

export const ListSourceObjectsQuerySchema = z.object({
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

export const CreateSourceFolderRequestSchema = z.object({
  prefix: z.string().min(1),
});

export const UploadSourceObjectResponseSchema = z.object({
  key: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
});

export const DeleteSourceObjectsRequestSchema = z.object({
  keys: z.array(z.string().min(1)).min(1),
});

export const DeleteSourceObjectsResponseSchema = z.object({
  results: z.array(
    z.object({
      key: z.string().min(1),
      status: z.enum(['deleted', 'not_found', 'error']),
      error_code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export const MoveSourceObjectRequestSchema = z.object({
  from_key: z.string().min(1),
  to_key: z.string().min(1),
  overwrite: z.boolean().optional(),
});

export const SourceObjectMetaResponseSchema = z.object({
  key: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  etag: z.string().optional(),
  last_modified: z.string().datetime(),
  user_metadata: z.record(z.string(), z.string()).optional(),
});

export const SourceObjectDownloadQuerySchema = z.object({
  key: z.string().min(1),
});

export const SourceObjectShareLinkCreateRequestSchema = z.object({
  key: z.string().min(1),
  expires_in_seconds: z
    .number()
    .int()
    .min(60)
    .max(604800)
    .optional(),
});

export const SourceObjectShareLinkResponseSchema = z.object({
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
  filesystem_name: z.string().min(1),
  created_by_user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
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

export const StorageCredentialExchangeResponseSchema = z.object({
  filesystem_name: z.string().min(1),
  metadata_url: z.string().min(1),
  recommended_mount_path: z.string().min(1),
  platform_notes: z.array(z.string().min(1)).default([]),
  recommended_mount_commands: z.object({
    linux: z.string().min(1),
    macos: z.string().min(1),
    windows: z.string().min(1),
  }),
  created_at: z.string().datetime(),
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
      'notebook',
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
          'notebook',
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
export type SourceDTO = z.infer<typeof SourceSchema>;
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;
export type ListSourcesResponse = z.infer<typeof ListSourcesResponseSchema>;
export type SourceLibraryDTO = z.infer<typeof SourceLibrarySchema>;
export type ListSourceLibrariesResponse = z.infer<typeof ListSourceLibrariesResponseSchema>;
export type CreateSourceLibraryRequest = z.infer<typeof CreateSourceLibraryRequestSchema>;
export type UpdateSourceLibraryRequest = z.infer<typeof UpdateSourceLibraryRequestSchema>;
export type ListSourceObjectsResponse = z.infer<typeof ListSourceObjectsResponseSchema>;
export type ListSourceObjectsQuery = z.infer<typeof ListSourceObjectsQuerySchema>;
export type CreateSourceFolderRequest = z.infer<typeof CreateSourceFolderRequestSchema>;
export type UploadSourceObjectResponse = z.infer<typeof UploadSourceObjectResponseSchema>;
export type DeleteSourceObjectsRequest = z.infer<typeof DeleteSourceObjectsRequestSchema>;
export type DeleteSourceObjectsResponse = z.infer<typeof DeleteSourceObjectsResponseSchema>;
export type MoveSourceObjectRequest = z.infer<typeof MoveSourceObjectRequestSchema>;
export type SourceObjectMetaResponse = z.infer<typeof SourceObjectMetaResponseSchema>;
export type SourceObjectDownloadQuery = z.infer<typeof SourceObjectDownloadQuerySchema>;
export type SourceObjectShareLinkCreateRequest = z.infer<typeof SourceObjectShareLinkCreateRequestSchema>;
export type SourceObjectShareLinkResponse = z.infer<typeof SourceObjectShareLinkResponseSchema>;
export type FileLibraryDTO = z.infer<typeof FileLibrarySchema>;
export type ListFileLibrariesResponse = z.infer<typeof ListFileLibrariesResponseSchema>;
export type CreateFileLibraryRequest = z.infer<typeof CreateFileLibraryRequestSchema>;
export type UpdateFileLibraryRequest = z.infer<typeof UpdateFileLibraryRequestSchema>;
export type FileLibraryBackendDTO = z.infer<typeof FileLibraryBackendSchema>;
export type ListFileLibraryEntriesQuery = z.infer<typeof ListFileLibraryEntriesQuerySchema>;
export type ListFileLibraryEntriesResponse = z.infer<typeof ListFileLibraryEntriesResponseSchema>;
export type CreateFileLibraryFolderRequest = z.infer<typeof CreateFileLibraryFolderRequestSchema>;
export type DeleteFileLibraryEntriesRequest = z.infer<typeof DeleteFileLibraryEntriesRequestSchema>;
export type DeleteFileLibraryEntriesResponse = z.infer<typeof DeleteFileLibraryEntriesResponseSchema>;
export type MoveFileLibraryEntryRequest = z.infer<typeof MoveFileLibraryEntryRequestSchema>;
export type FileLibraryDownloadQuery = z.infer<typeof FileLibraryDownloadQuerySchema>;
export type CreateFileLibraryShareLinkRequest = z.infer<typeof CreateFileLibraryShareLinkRequestSchema>;
export type StorageCredentialExchangeResponse = z.infer<typeof StorageCredentialExchangeResponseSchema>;
export type WorkspaceFoundationInitializationRequest = z.infer<typeof WorkspaceFoundationInitializationRequestSchema>;
export type WorkspaceFoundationInitializationResult = z.infer<typeof WorkspaceFoundationInitializationResultSchema>;
