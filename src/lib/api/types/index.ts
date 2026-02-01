/**
 * API Type Definitions
 *
 * These types define the contract between frontend and backend.
 * Both MSW mocks and real backend APIs must conform to these types.
 *
 * When updating types:
 * 1. Update the interface here
 * 2. Update MSW fixtures to match
 * 3. Coordinate with backend team to ensure API compliance
 */

// ============================================================
// Common Types
// ============================================================

export interface PaginationParams {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

// ============================================================
// Workspace & Project
// ============================================================

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  join_policy: 'approval_required' | 'open';
  owner_id: string;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface ProjectMembership {
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'blocked' | 'removed';
  joined_at: string;
}

// ============================================================
// Agent
// ============================================================

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  presence: 'online' | 'offline' | 'managed';
  status: 'enabled' | 'disabled';
  config?: AgentConfig;
  created_at: string;
  updated_at: string;
}

export interface AgentConfig {
  image?: string;
  env?: Record<string, string>;
  max_concurrent_sessions_override?: number;
}

export interface AgentServiceKey {
  id: string;
  agent_id: string;
  key_prefix: string; // ask-*** (never show full key)
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

// ============================================================
// Endpoint
// ============================================================

export interface Endpoint {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  openai_model: string; // Unique within project
  type: 'openai' | 'anthropic' | 'custom';
  base_url: string;
  status: 'active' | 'disabled';
  limits?: EndpointLimits;
  created_at: string;
  updated_at: string;
}

export interface EndpointLimits {
  max_requests_per_minute?: number;
  max_requests_per_day?: number;
  max_tokens_per_day?: number;
  timeout_seconds?: number;
}

export interface EndpointACL {
  endpoint_id: string;
  deny_list: DenyEntry[];
}

export interface DenyEntry {
  user_id: string;
  reason?: string;
  added_at: string;
  added_by: string;
}

// ============================================================
// Chat (OpenAI Compatible)
// ============================================================

export interface ChatSession {
  id: string;
  project_id: string;
  title: string;
  model: string;
  endpoint_id: string;
  pinned?: boolean;
  starred?: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  tokens?: number;
  finish_reason?: string | null;

  // ===== Branch model (v1) =====
  parent_id?: string | null;
  logical_id?: string;
  revision_of?: string | null;
  revision_index?: number;
  variant_group_id?: string;
  variant_index?: number;
  is_stale?: boolean;
}

export interface ChatRequest {
  model: string; // openai_model
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface Attachment {
  id: string;
  session_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_status: 'uploading' | 'processing' | 'ready' | 'failed';
  created_at: string;
  error_message?: string;
}

// ============================================================
// Workbench (Agent Thread & Turn)
// ============================================================

export interface AgentThread {
  id: string;
  project_id: string;
  end_user_id: string;
  current_agent_id: string;
  title?: string;
  status: 'active' | 'closed' | 'revoked';
  created_at: string;
  updated_at: string;
}

export interface Turn {
  id: string;
  agent_thread_id: string;
  status: 'queued' | 'started' | 'completed' | 'failed' | 'cancelled';
  input_message?: string;
  output_message?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface TurnEvent {
  id: string;
  turn_id: string;
  event_type: string;
  data: unknown;
  timestamp: string;
}

// ============================================================
// SSE Events
// ============================================================

export interface SSEEvent {
  id: string;
  event: string;
  data: unknown;
  retry?: number;
}

// ============================================================
// Audit & Usage
// ============================================================

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor_type: 'user' | 'agent' | 'plugin';
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  result: 'ok' | 'error';
  error_code?: string;
  request_id: string;
  metadata?: Record<string, unknown>;
}

export interface UsageRecord {
  time_bucket: string; // ISO datetime
  resource_type: string;
  resource_id: string;
  agent_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
}

// ============================================================
// User API Keys (usk)
// ============================================================

export interface UserAPIKey {
  id: string;
  user_id: string;
  key_prefix: string; // usk-***
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  note?: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

// ============================================================
// Error Types
// ============================================================

export interface ErrorResponse {
  error_code: string;
  message: string;
  request_id: string;
  details?: Record<string, unknown>;
}
