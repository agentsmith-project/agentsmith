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
export type AIReadyJobDTO = z.infer<typeof AIReadyJobSchema>;
export type CreateAIReadyJobRequest = z.infer<typeof CreateAIReadyJobRequestSchema>;
