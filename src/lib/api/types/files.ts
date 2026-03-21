import type { PaginationParams, PaginatedResponse } from './common';

export type FileLibraryStatus = 'creating' | 'ready' | 'degraded' | 'failed' | 'deleting';

export type FileLibraryGatewayStatus =
  | 'not_started'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopped';

export interface FileLibrary {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  visibility?: 'shared';
  provider?: 's3' | 'juicefs';
  bucket?: string;
  object_prefix?: string;
  status: FileLibraryStatus;
  filesystem_name: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface FileLibraryBackend {
  library_id: string;
  filesystem_name: string;
  provisioning_status: FileLibraryStatus;
  gateway_status: FileLibraryGatewayStatus;
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
  };
  minio: {
    endpoint: string;
    bucket: string;
    region?: string;
  };
  gateway?: {
    loopback_url?: string;
    port?: number;
    last_started_at?: string;
  };
  last_error?: string;
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

export interface StorageCredentialExchangeResponse {
  filesystem_name: string;
  metadata_url: string;
  storage_bucket_url?: string;
  recommended_mount_path: string;
  platform_notes: string[];
  recommended_mount_commands: {
    linux: string;
    macos: string;
    windows: string;
  };
  created_at: string;
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
  object_ref: {
    bucket: string;
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

export interface FileObjectShareLink {
  key: string;
  url: string;
  expires_at: string;
  expires_in_seconds: number;
}
