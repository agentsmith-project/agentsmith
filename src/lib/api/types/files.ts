import type { PaginationParams, PaginatedResponse } from './common';

export type FileLibraryStatus = 'creating' | 'ready' | 'degraded' | 'failed' | 'deleting';
export type FileLibraryTaskHomeBindingStatus = 'unbound' | 'bound';
export type FileLibraryBoundTaskStatus = 'active' | 'archived';
export type FileLibrarySource = 'agent_task_files';
export type FileLibraryStorageStatus =
  | 'initializing'
  | 'available'
  | 'degraded'
  | 'unavailable'
  | 'admin_action_required';
export type FileLibraryStorageNextAction = 'wait' | 'retry' | 'contact_admin' | 'contact_support' | null;

export interface FileLibrary {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  visibility?: 'shared';
  source: FileLibrarySource;
  file_library_home_segment: string;
  status: FileLibraryStatus;
  storage_status?: FileLibraryStorageStatus;
  storage_next_action?: FileLibraryStorageNextAction;
  status_reason?: string;
  task_home_binding_status: FileLibraryTaskHomeBindingStatus;
  bound_task_id?: string;
  bound_task_title?: string;
  bound_task_status?: FileLibraryBoundTaskStatus;
  bound_task_visible: boolean;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export type FileLibraryEntry =
  | {
      kind: 'directory';
      path: string;
      name: string;
      modified_at?: string;
    }
  | {
      kind: 'file';
      path: string;
      name: string;
      size_bytes: number;
      content_type?: string;
      modified_at: string;
      etag?: string;
    };

export interface FileLibraryEntriesListParams {
  path?: string;
  page_size?: number;
  continuation_token?: string;
  search?: string;
  sort_by?: 'name' | 'size_bytes' | 'modified_at';
  sort_order?: 'asc' | 'desc';
}

export interface FileLibraryEntriesListResponse {
  path: string;
  items: FileLibraryEntry[];
  next_continuation_token: string | null;
}

export interface CreateFileLibraryRequest {
  name: string;
  description?: string;
}

export interface UpdateFileLibraryRequest {
  name?: string;
  description?: string;
}

export interface DeleteFileLibraryAcceptedResponse {
  file_library_id: string;
  file_library_status: 'deleting';
  operation_id: string;
  operation_status: 'pending';
}

export type DeleteFileLibraryResult =
  | { status: 'deleted' }
  | ({ status: 'accepted' } & DeleteFileLibraryAcceptedResponse);

export interface FileLibraryOperationProjection {
  operation_id: string;
  operation_state: string;
  operation_type?: string;
  resource?: {
    type: string;
  };
  error: {
    code: string;
    retryable?: boolean;
  } | null;
  created_at?: string;
  started_at?: string;
  updated_at?: string;
  finished_at?: string;
}

export interface CreateFileLibraryFolderRequest {
  path: string;
}

export interface DeleteFileLibraryEntriesRequest {
  paths: string[];
}

export interface DeleteFileLibraryEntriesResponse {
  results: Array<{
    path: string;
    status: 'deleted' | 'not_found' | 'error';
    error_code?: string;
    message?: string;
  }>;
}

export interface MoveFileLibraryEntryRequest {
  from_path: string;
  to_path: string;
  overwrite?: boolean;
}

export type FileLibraryRestorePreviewStatus =
  | 'previewing'
  | 'ready'
  | 'failed'
  | 'canceling'
  | 'canceled'
  | 'restoring'
  | 'restored';

export type FileLibraryRestoreRunStatus = 'pending' | 'succeeded' | 'failed';

export interface FileLibraryRestorePreviewChangeSummary {
  count: number;
  samples: string[];
}

export interface FileLibraryRestorePreviewSummary {
  added: FileLibraryRestorePreviewChangeSummary;
  changed: FileLibraryRestorePreviewChangeSummary;
  removed: FileLibraryRestorePreviewChangeSummary;
  destructive: boolean;
}

export type FileLibraryRestorePreviewBlockerCode =
  | 'active_writer_sessions'
  | 'stale_writer_session_uncertain'
  | 'restore_preview_stale'
  | 'restore_plan_requires_recovery';

export interface FileLibraryRestorePreviewBlocker {
  code: FileLibraryRestorePreviewBlockerCode;
  message?: string;
}

export interface FileLibrarySavePoint {
  id: string;
  file_library_id: string;
  message?: string;
  created_at: string;
}

export interface ListFileLibrarySavePointsResponse {
  items: FileLibrarySavePoint[];
}

export interface CreateFileLibrarySavePointRequest {
  message?: string;
}

export interface CreateFileLibraryRestorePreviewRequest {
  save_point_id: string;
}

export interface FileLibraryRestorePreview {
  id: string;
  file_library_id: string;
  source_save_point_id: string;
  message?: string;
  status: FileLibraryRestorePreviewStatus;
  summary?: FileLibraryRestorePreviewSummary;
  blockers?: FileLibraryRestorePreviewBlocker[];
  stale?: boolean;
  created_at: string;
  updated_at: string;
}

export interface GetFileLibraryRestorePreviewResponse {
  restore_preview: FileLibraryRestorePreview | null;
}

export interface RunFileLibraryRestoreRequest {
  restore_preview_id: string;
}

export interface CancelFileLibraryRestoreRequest {
  restore_preview_id: string;
}

export interface FileLibraryRestoreRun {
  id: string;
  file_library_id: string;
  restore_preview_id: string;
  status: FileLibraryRestoreRunStatus;
  created_at: string;
  updated_at: string;
}

export interface ReleaseFileLibraryRuntimeAccessResponse {
  file_library_id: string;
  released: boolean;
  runtime_access_status?: 'released' | 'release_pending';
}

export type TaskFileTemplateStatus = 'unpublished' | 'published' | 'failed';

export interface TaskFileTemplate {
  id: string;
  workspace_id: string;
  project_id: string;
  source_library_id: string;
  source_save_point_id?: string;
  name: string;
  description?: string;
  status: TaskFileTemplateStatus;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ListTaskFileTemplatesResponse {
  items: TaskFileTemplate[];
}

export interface CreateTaskFileTemplateRequest {
  source_library_id: string;
  name: string;
  description?: string;
}

export interface FileItem {
  id: string;
  workspace_id: string;
  project_id: string;
  library_id?: string;
  owner_user_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  object_ref?: {
    key: string;
    etag?: string;
    version?: string;
  };
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LimitSummary {
  storage: {
    used: number;
    limit: number;
  };
  docdb: {
    used: number;
    limit: number;
  };
  vectordb: {
    used: number;
    limit: number;
  };
}

export interface FilesListParams extends PaginationParams {
  search?: string;
  library_id?: string;
  sort_by?: 'updated_at' | 'file_size' | 'status';
  sort_order?: 'asc' | 'desc';
}

export type FilesListResponse = PaginatedResponse<FileItem>;

export interface FilePrefixItem {
  kind: 'prefix';
  prefix: string;
  name: string;
}

export interface FileObjectItem {
  kind: 'object';
  key: string;
  name: string;
  size_bytes: number;
  content_type: string;
  etag?: string;
  last_modified: string;
}

export type FileObjectsListItem = FilePrefixItem | FileObjectItem;

export interface FileObjectsListParams {
  prefix?: string;
  delimiter?: '/';
  page_size?: number;
  continuation_token?: string;
  search?: string;
  sort_by?: 'name' | 'size_bytes' | 'last_modified';
  sort_order?: 'asc' | 'desc';
}

export interface FileObjectsListResponse {
  prefix: string;
  items: FileObjectsListItem[];
  next_continuation_token?: string | null;
}

export interface FileObjectMeta {
  key: string;
  size_bytes: number;
  content_type: string;
  etag?: string;
  last_modified: string;
  user_metadata?: Record<string, string>;
}
