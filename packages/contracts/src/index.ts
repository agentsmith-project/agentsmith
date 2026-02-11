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
    visibility: ProjectVisibilitySchema.optional(),
    join_policy: ProjectJoinPolicySchema.optional(),
    status: ProjectStatusSchema.optional(),
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
export const AIReadyStatusSchema = z.enum(['idle', 'preparing', 'ready', 'failed', 'cancelled']);

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
  ai_ready_status: AIReadyStatusSchema.optional(),
  docdb_bytes: z.number().int().nonnegative().optional(),
  vectordb_bytes: z.number().int().nonnegative().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateSourceRequestSchema = z.object({
  name: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  library_id: z.string().min(1).max(255).optional(),
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

export const AIReadyJobTypeSchema = z.enum(['document_ingest']);
export const AIReadyJobStatusSchema = z.enum([
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
  'dead_lettered',
]);

export const AIReadyJobSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  library_id: z.string().min(1),
  type: AIReadyJobTypeSchema,
  status: AIReadyJobStatusSchema,
  source_ids: z.array(z.string().min(1)),
  idempotency_key: z.string().min(1),
  retry_count: z.number().int().nonnegative(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  created_by_user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateAIReadyJobRequestSchema = z.object({
  source_ids: z.array(z.string().min(1)).min(1),
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
export type AIReadyJobDTO = z.infer<typeof AIReadyJobSchema>;
export type CreateAIReadyJobRequest = z.infer<typeof CreateAIReadyJobRequestSchema>;
