/**
 * Task Type Definitions
 *
 * Types for Task, TaskMessage, Artifact and related operations.
 */

export type TaskStatus = 'active' | 'archived';

export type TaskInputRef =
  | {
      id: string;
      kind: 'source';
      source_id: string;
    }
  | {
      id: string;
      kind: 'library_object';
      library_id: string;
      key: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      task_relative_path?: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      name?: string;
      imported_library_id?: string;
      imported_key?: string;
      content_type?: string;
      size_bytes?: number;
    };

export type TaskAttachedInputDetail =
  | {
      id: string;
      kind: 'source';
      source_id: string;
      filename: string;
      file_type: string;
      file_size: number;
      ai_ready?: {
        status: 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';
      };
    }
  | {
      id: string;
      kind: 'library_object';
      library_id: string;
      key: string;
      filename: string;
      file_type: string;
      file_size: number;
    }
  | {
      id: string;
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      filename: string;
      file_type: string;
      file_size: number;
      task_relative_path?: string;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      filename: string;
      file_type: string;
      file_size: number;
      imported_library_id?: string;
      imported_key?: string;
    };

export interface Task {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_id: string; // Fixed after creation, cannot be changed
  agent_name: string; // Redundant field for display
  status: TaskStatus;
  attached_inputs: TaskInputRef[]; // Attached task input references
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  last_activity_at: string; // ISO 8601
}

export interface TaskMessage {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string; // ISO 8601
  referenced_source_ids?: string[]; // Source files referenced by agent
  turn_id?: string; // Associated turn ID (if any)
}

export type ArtifactType = 'text' | 'image' | 'file' | 'other';

export interface Artifact {
  id: string;
  task_id: string;
  turn_id?: string; // Associated turn ID
  type: ArtifactType;
  task_relative_path?: string; // Relative path in notebook task working directory (if applicable)
  title?: string;
  content?: string; // Text content or file URL
  thumbnail_url?: string; // Image thumbnail URL
  file_size?: number;
  mime_type?: string;
  created_at: string; // ISO 8601
}

export type TaskTraceCategory = 'lifecycle' | 'progress' | 'tool' | 'artifact' | 'warning' | 'error' | 'debug';
export type TaskTracePhase = 'start' | 'update' | 'end';
export type TaskTraceStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface TaskTraceEvent {
  id: string;
  task_id: string;
  message_id: string;
  run_id: string;
  seq: number;
  at: string; // ISO8601
  category: TaskTraceCategory;
  phase?: TaskTracePhase;
  status?: TaskTraceStatus;
  name: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface TaskTraceListResponse {
  items: TaskTraceEvent[];
  total: number;
  has_more?: boolean;
  next_after_id?: string | null;
}

export interface CreateTaskRequest {
  title: string;
  agent_id: string;
  initial_inputs?: Array<
    | { kind: 'source'; source_id: string }
    | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
  >;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: TaskStatus;
}

export interface SendMessageRequest {
  task_id: string;
  content: string;
}

export interface SaveArtifactRequest {
  artifact_id: string;
  filename?: string;
  description?: string;
}

export interface TaskListParams {
  status?: TaskStatus;
  search?: string;
  sort_by?: 'created_at' | 'updated_at' | 'last_activity_at';
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
  has_more?: boolean;
}
