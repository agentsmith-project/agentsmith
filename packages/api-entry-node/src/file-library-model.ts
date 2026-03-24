export type FileLibraryStatus =
  | 'creating'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'deleting';

export type FileLibraryGatewayStatus =
  | 'not_started'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopped';

export interface FileLibraryRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  status: FileLibraryStatus;
  filesystem_name: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface FileLibraryBackendRecord {
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

export interface FileLibraryClientMountAccess {
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

export type FileLibraryMountAccess = FileLibraryClientMountAccess;
