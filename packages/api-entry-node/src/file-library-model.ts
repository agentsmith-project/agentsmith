export type FileLibraryStatus =
  | 'creating'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'deleting'
  | 'deleted';

export interface FileLibraryLastRestore {
  source_save_point_id: string;
  source_save_point_label: string;
  source_save_point_created_at: string;
  restored_at: string;
  restore_operation_id: string;
}

export interface FileLibraryRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  status: FileLibraryStatus;
  version: number;
  file_library_home_segment: string;
  source: 'agent_task_files';
  delete_correlation_id?: string;
  last_restore?: FileLibraryLastRestore | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}
