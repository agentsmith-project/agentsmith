/**
 * Task Type Definitions
 *
 * Types for Task, TaskMessage, Artifact and related operations.
 */

export type TaskStatus = 'active' | 'archived';

export type TaskInputRef =
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
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  status: TaskStatus;
  attached_inputs: TaskInputRef[]; // Attached task input references
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  last_activity_at: string; // ISO 8601
  agent_presence?: 'online' | 'offline' | 'managed' | 'unknown';
  run_state?: 'running' | 'idle';
  stats?: {
    user_turn_count: number;
    message_count: number;
    artifact_count: number;
    attached_input_count: number;
  };
}

export interface TaskMessage {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string; // ISO 8601
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
  workspace_file_library_id?: string;
  workspace_mode?: 'create_new';
  workspace_name?: string;
  initial_inputs?: Array<
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

export interface CreateTaskTerminalSessionRequest {
  cols?: number;
  rows?: number;
  shell?: string;
}

export interface TaskTerminalSessionCreateResponse {
  session_id: string;
  status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
  ws_url: string;
}

export interface TaskTerminalSessionStatus {
  id: string;
  status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
  cols: number;
  rows: number;
  created_at: string;
  last_activity_at: string;
  ended_at?: string | null;
  close_reason?: string | null;
  exit_code?: number | null;
  ws_url?: string | null;
}

export type TaskTerminalServerEvent =
  | { type: 'started'; session_id: string; cols?: number; rows?: number }
  | { type: 'output'; session_id: string; chunk: string }
  | { type: 'exited'; session_id: string; exit_code: number | null; signal: string | null }
  | { type: 'error'; session_id?: string; error_code: string; error_message: string };
