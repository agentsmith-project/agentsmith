/**
 * Task Type Definitions
 *
 * Types for Task, activity, artifacts and related operations.
 */

export type TaskStatus = 'active' | 'archived';
export type TaskRunState =
  | 'running'
  | 'cancelling'
  | 'terminating'
  | 'finalizing'
  | 'idle';

export function isTaskRunStateActive(
  runState: TaskRunState | null | undefined,
): runState is Exclude<TaskRunState, 'idle'> {
  return runState != null && runState !== 'idle';
}

export function isTaskRunStateRunning(
  runState: TaskRunState | null | undefined,
): runState is 'running' {
  return runState === 'running';
}

export function isTaskRunStateStoppingOrFinalizing(
  runState: TaskRunState | null | undefined,
): runState is 'cancelling' | 'terminating' | 'finalizing' {
  return (
    runState === 'cancelling' ||
    runState === 'terminating' ||
    runState === 'finalizing'
  );
}

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
  source?: 'runner_test';
  runner_test?: true;
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  bound_runner_id?: string;
  bound_runner_kind?: TaskRunnerBindingKind;
  runner_binding_source?: TaskRunnerBindingSource;
  bound_at?: string; // ISO 8601
  bound_by_user_id?: string;
  status: TaskStatus;
  attached_inputs: TaskInputRef[]; // Attached task input references
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  last_activity_at: string; // ISO 8601
  runner_status?: 'draft' | 'connected' | 'ready' | 'degraded' | 'offline' | 'unknown';
  agent_presence?: 'online' | 'offline' | 'managed' | 'unknown';
  run_state?: TaskRunState;
  active_run?: {
    id: string;
    status: 'queued' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'canceled';
    runner_id: string;
    source?: 'runner_test';
    runner_test?: true;
    started_at?: string;
    finished_at?: string;
  };
  active_run_started_at?: string; // ISO 8601, present when backend has active run truth
  stop_mode?: 'cancel' | 'terminate';
  can_escalate?: boolean;
  escalation_reason?: string | null;
  stats?: {
    user_turn_count: number;
    message_count: number;
    artifact_count: number;
    attached_input_count: number;
  };
}

export interface TaskActivityItem {
  id: string;
  task_id: string;
  kind: 'user_intent' | 'runner_output';
  actor: 'user' | 'runner';
  content: string;
  created_at: string; // ISO 8601
  run_id?: string; // Associated run ID (if any)
  source?: 'runner_test';
  runner_test?: true;
}

export type ArtifactType = 'text' | 'image' | 'file' | 'other';

export interface Artifact {
  id: string;
  task_id: string;
  turn_id?: string; // Associated turn ID
  type: ArtifactType;
  task_relative_path?: string; // Relative path in task working directory (if applicable)
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
  bound_runner_id?: string;
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

export type TaskRunnerBindingKind = 'managed' | 'developer';

export type TaskRunnerBindingSource = 'default_managed' | 'explicit';

export type TaskRunnerBindingReasonCode =
  | 'agent_runner_unavailable'
  | 'agent_runner_model_unconfigured'
  | 'agent_runner_capability_mismatch'
  | 'agent_runner_default_conflict'
  | 'permission_denied'
  | 'agent_runner_disconnected'
  | 'agent_runner_stale';

export interface TaskRunnerBindingSummary {
  state: string;
  summary: string;
  reason_code?: TaskRunnerBindingReasonCode;
}

export interface TaskRunnerBindingAction {
  operation: 'bind_to_task';
  visible: boolean;
  allowed: boolean;
  reason_code?: TaskRunnerBindingReasonCode;
  required_permissions: string[];
  danger_level: 'none';
}

export interface TaskRunnerBindingOption {
  option_id: string;
  label: string;
  bound_runner_kind: TaskRunnerBindingKind;
  runner_binding_source: TaskRunnerBindingSource;
  agent_runner_id?: string;
  readiness: TaskRunnerBindingSummary;
  capability: TaskRunnerBindingSummary;
  freshness?: TaskRunnerBindingSummary;
  disabled_reason_code?: TaskRunnerBindingReasonCode;
  actions: {
    bind_to_task: TaskRunnerBindingAction;
  };
}

export interface TaskRunnerBindingOptionsResponse {
  options: TaskRunnerBindingOption[];
  generated_at: string;
}

export interface StartTaskRunRequest {
  intent: string;
  input_refs?: Array<
    | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
  >;
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

export type TaskTerminalSessionStatusValue =
  | 'pending'
  | 'active'
  | 'disconnected'
  | 'recovering'
  | 'closing'
  | 'closed'
  | 'failed';

export type TaskTerminalLifecycleStatus =
  | 'pending'
  | 'starting'
  | 'active'
  | 'recovering'
  | 'closing'
  | 'closed'
  | 'failed';

export type TaskTerminalRunnerConnectionStatus =
  | 'dispatching'
  | 'attached'
  | 'transport_lost'
  | 'adopting'
  | 'missing'
  | 'closed';

export type TaskTerminalBrowserConnectionStatus =
  | 'attached'
  | 'browser_disconnected'
  | 'none';

export type TaskTerminalFailureKind =
  | 'process_start_failed'
  | 'process_exited_unexpectedly'
  | 'protocol_error'
  | 'permission_revoked'
  | 'runner_recovery_timeout'
  | 'terminal_process_lost'
  | 'runner_process_exited'
  | 'terminal_runtime_session_mismatch';

export type TaskTerminalCloseState =
  | 'none'
  | 'requested'
  | 'delivered'
  | 'acked'
  | 'expired';

export type TaskTerminalCloseResult = 'closed' | 'not_found';

export type TaskTerminalReplayStatus = 'complete' | 'partial' | 'unavailable';

export interface TaskTerminalSessionCreateResponse {
  terminal_session_id: string;
  runner_id?: string;
  runner_session_id?: string;
  status: TaskTerminalSessionStatusValue;
  lifecycle_status?: TaskTerminalLifecycleStatus;
  runner_connection_status?: TaskTerminalRunnerConnectionStatus;
  browser_connection_status?: TaskTerminalBrowserConnectionStatus;
  input_enabled?: boolean;
  recoverable?: boolean;
  recovery_deadline_at?: string | null;
  failure_kind?: TaskTerminalFailureKind | null;
  close_state?: TaskTerminalCloseState | null;
  close_result?: TaskTerminalCloseResult | null;
  close_reason?: string | null;
  close_deadline_at?: string | null;
  replay_status?: TaskTerminalReplayStatus | null;
  replay_gap?: boolean | null;
  latest_seq?: number | null;
  ws_url: string | null;
}

export interface TaskTerminalSessionStatus {
  terminal_session_id: string;
  runner_id?: string;
  runner_session_id?: string;
  status: TaskTerminalSessionStatusValue;
  lifecycle_status?: TaskTerminalLifecycleStatus;
  runner_connection_status?: TaskTerminalRunnerConnectionStatus;
  browser_connection_status?: TaskTerminalBrowserConnectionStatus;
  input_enabled?: boolean;
  recoverable?: boolean;
  recovery_deadline_at?: string | null;
  failure_kind?: TaskTerminalFailureKind | null;
  close_state?: TaskTerminalCloseState | null;
  close_result?: TaskTerminalCloseResult | null;
  close_deadline_at?: string | null;
  replay_status?: TaskTerminalReplayStatus | null;
  replay_gap?: boolean | null;
  latest_seq?: number | null;
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
  | {
      type: 'terminal.replay_start';
      terminal_session_id: string;
      earliest_seq?: number | null;
      latest_seq?: number | null;
      next_seq?: number | null;
      after_seq?: number | null;
      gap?: boolean;
      status?: TaskTerminalReplayStatus | string;
      replay_status?: TaskTerminalReplayStatus | string;
    }
  | {
      type: 'terminal.output';
      terminal_session_id: string;
      seq: number;
      encoding?: 'utf8' | 'base64';
      data?: string;
      chunk?: string;
    }
  | {
      type: 'terminal.replay_end';
      terminal_session_id: string;
      latest_seq?: number | null;
      next_seq?: number | null;
      gap?: boolean;
      status?: TaskTerminalReplayStatus | string;
      replay_status?: TaskTerminalReplayStatus | string;
      input_enabled?: boolean;
    }
  | {
      type: 'terminal.state';
      terminal_session_id: string;
      state?: string;
      status?: string;
      input_enabled?: boolean;
      reason?: string | null;
      close_reason?: string | null;
      failure_kind?: TaskTerminalFailureKind | null;
      replay_status?: TaskTerminalReplayStatus | string;
      recovery_deadline_at?: string | null;
    }
  | {
      type: 'terminal.error';
      terminal_session_id: string;
      error_code?: string;
      error_message?: string;
      reason?: string | null;
      close_reason?: string | null;
      failure_kind?: TaskTerminalFailureKind | null;
    };
