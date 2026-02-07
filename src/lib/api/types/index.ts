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

export interface WorkspaceMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  governance_group?: 'wheel' | 'user';
  permissions?: string[];
  status: 'active' | 'blocked' | 'removed';
  joined_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  join_policy?: 'approval_required' | 'open';
  owner_id: string;
  status: 'active' | 'archived' | 'deleted';
  governance_json?: Record<string, unknown>;
  runtime_preferences_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
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

/** Runtime stats for external agents (source IP, connection duration, QPM) */
export interface AgentExternalStats {
  source_ip?: string;
  connection_duration_sec?: number;
  qpm?: number; // queries per minute, turn-based
}

/** Runtime stats for internal agents (pod count, etc.) */
export interface AgentInternalStats {
  pod_count?: number;
  desired_replicas?: number;
}

export interface AgentDiagnostics {
  last_error?: string;
  last_error_at?: string;
  retry_backoff_sec?: number;
  restarts?: number;
  queue_depth?: number;
  cpu_percent?: number;
  memory_mb?: number;
}

/** Expected interaction mode: chat, workbench, or both */
export type AgentInteractionMode = 'chat' | 'workbench' | 'both';

export interface Agent {
  id: string;
  project_id: string;
  workspace_id?: string;
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  presence?: 'online' | 'offline' | 'managed';
  status: 'enabled' | 'disabled';
  config?: AgentConfig;
  config_json?: Record<string, unknown>;
  runtime_preferences_json?: Record<string, unknown>;
  internal_config_json?: Record<string, unknown>;
  /** External agents: source IP, connection duration, QPM */
  external_stats?: AgentExternalStats;
  /** Internal agents: pod count, etc. */
  internal_stats?: AgentInternalStats;
  /** Creator (owner) */
  owner_id?: string;
  owner_name?: string;
  /** Maintainer (admin) */
  admin_id?: string;
  admin_name?: string;
  /** Expected interaction: chat, workbench, or both */
  interaction_mode?: AgentInteractionMode;
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
  key_prefix: string; // ask-***
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

/** Create response includes full key only once - never stored or shown again */
export interface CreateAgentKeyResponse extends AgentServiceKey {
  key?: string; // Full key (ask_xxx...), returned only on create
}

// ============================================================
// Credential
// ============================================================

export interface Credential {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  type: 'api_key';
  fingerprint: string;
  created_at: string;
  last_rotated_at?: string;
}

export interface CreateCredentialRequest {
  name: string;
  type: 'api_key';
  value: string;
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
  credential_ref?: string;
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
  timestamp: string; // ISO 8601
  workspace_id: string;
  project_id: string;
  actor_type: 'user' | 'agent' | 'plugin';
  actor_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  result: 'ok' | 'error';
  error_code?: string;
  error_message?: string;
  request_id: string;
  metadata_json: Record<string, unknown>; // 重命名 metadata -> metadata_json
}

export interface UsageRecord {
  id: string; // 聚合记录的 ID
  time_bucket: string; // YYYY-MM-DD or YYYY-MM-DD HH:mm
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  agent_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
}

export interface UsageKPI {
  requests_today: number;
  errors_today: number;
  tokens_today?: number;
  userdata_bytes?: number;
  requests_yesterday?: number; // optional, for trend
  errors_yesterday?: number;
  tokens_yesterday?: number; // optional, for trend
}

export interface UserdataSummary {
  total_bytes: number;
  docdb_collections: number;
  vectordb_indexes: number;
}

export interface UserdataEndUser {
  id: string;
  storage_bytes: number;
  docdb_collections: number;
  vectordb_indexes: number;
}

export interface AuditListParams extends PaginationParams {
  start_time: string; // ISO 8601, 必选
  end_time: string; // ISO 8601, 必选
  action?: string;
  actor_type?: 'user' | 'agent' | 'plugin';
  actor_id?: string;
  end_user_id?: string;
  resource_type?: string;
  resource_id?: string;
  result?: 'ok' | 'error';
  sort_by?: 'timestamp';
  sort_order?: 'asc' | 'desc';
}

export interface UsageListParams extends PaginationParams {
  start_time: string; // ISO 8601, 必选
  end_time: string; // ISO 8601, 必选
  resource_type?: string;
  agent_id?: string;
  end_user_id?: string;
  group_by?: 'day' | 'hour';
  sort_by?: 'time_bucket' | 'resource_type' | 'requests';
  sort_order?: 'asc' | 'desc';
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

/** Create response includes full key only once - never stored or shown again */
export interface CreateUserKeyResponse extends UserAPIKey {
  key?: string; // Full key (usk_xxx...), returned only on create
}

// ============================================================
// Sources (File Management & AIReady)
// ============================================================

export type AIReadyStatus = 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';

export interface SourceFile {
  id: string;
  workspace_id: string;
  project_id: string;
  library_id?: string;
  owner_user_id: string;
  filename: string;
  file_type: string; // MIME type
  file_size: number; // bytes
  object_ref: {
    bucket: string;
    key: string;
    etag?: string;
    version?: string;
  };
  version: number; // version number (incremental)
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface AIReadyJob {
  id: string;
  source_file_id: string;
  status: AIReadyStatus;
  progress?: number; // 0-100, optional
  error_message?: string; // failure reason
  created_at: string;
  updated_at: string;
}

export interface AIReadyUsage {
  docdb_bytes: number;
  vectordb_bytes: number;
  chunks_count: number;
  embedding_tokens?: number;
}

export interface SourceFileWithAIReady extends SourceFile {
  ai_ready?: AIReadyJob;
  ai_ready_usage?: AIReadyUsage;
}

export interface QuotaSummary {
  storage: {
    used: number; // bytes
    limit: number; // bytes
  };
  docdb: {
    used: number; // bytes
    limit: number; // bytes
  };
  vectordb: {
    used: number; // bytes
    limit: number; // bytes
  };
}

export interface SourcesListParams extends PaginationParams {
  search?: string;
  library_id?: string;
  status?: AIReadyStatus | 'all';
  ai_ready_only?: boolean;
  sort_by?: 'updated_at' | 'file_size' | 'status';
  sort_order?: 'asc' | 'desc';
}

export type SourcesListResponse = PaginatedResponse<SourceFileWithAIReady>;

export interface SourceLibrary {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  visibility: 'shared';
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
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

// ============================================================
// Members & Permissions
// ============================================================

export interface MemberPermissions {
  platform_permissions: string[];
  resource_permissions?: {
    endpoint?: string[];
  };
}

export interface QuotaOverride {
  userdata?: {
    storage?: {
      bytes_per_end_user?: number;
      objects_per_end_user?: number;
      max_object_bytes?: number;
    };
    docdb?: {
      max_collections_per_scope?: number;
      max_document_bytes?: number;
      query_timeout_ms?: number;
      page_size_max?: number;
    };
    vectordb?: {
      max_indexes_per_scope?: number;
      top_k_max?: number;
      upsert_records_max?: number;
    };
  };
  endpoint?: {
    requests_per_day_per_end_user?: number;
    requests_per_min_per_end_user?: number;
  };
}

export type PolicyResourceType = 'endpoint' | 'source_library' | 'agent';
export type PolicySubjectType = 'group' | 'user';

export type PolicyRuleKey =
  | 'agent.max_concurrency'
  | 'endpoint.daily_token_limit'
  | 'source_library.max_total_files'
  | 'source_library.max_file_size_bytes';

export interface PolicyRule<K extends PolicyRuleKey = PolicyRuleKey> {
  key: K;
  value: number;
  // Reserved for future rolling windows; use `day` for daily caps in MVP.
  window?: 'day' | null;
}

export interface PolicyRateLimit {
  rules: PolicyRule[];
  [key: string]: unknown;
}

export interface PolicyQuotaLimit {
  rules: PolicyRule[];
  [key: string]: unknown;
}

export interface ResourcePolicySubject {
  subject_type: PolicySubjectType;
  subject_id: string;
  rate_limits?: PolicyRateLimit;
  quota_limits?: PolicyQuotaLimit;
  updated_at?: string;
}

export interface ResourcePolicy {
  resource_type: PolicyResourceType;
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: ResourcePolicySubject[];
  rate_limits?: PolicyRateLimit;
  quota_limits?: PolicyQuotaLimit;
}

export interface ResourcePolicyUpdateRequest {
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: PolicySubjectType;
    subject_id: string;
    rate_limits?: PolicyRateLimit;
    quota_limits?: PolicyQuotaLimit;
  }>;
  rate_limits?: PolicyRateLimit;
  quota_limits?: PolicyQuotaLimit;
}

export interface ProjectGovernanceDefaults {
  endpoint: {
    access_mode: 'allow_all_members' | 'allow_list';
    quota_limits?: {
      rules: PolicyRule<'endpoint.daily_token_limit'>[];
    };
  };
  source_library: {
    access_mode: 'allow_all_members' | 'allow_list';
    quota_limits?: {
      rules: Array<
        PolicyRule<'source_library.max_total_files'> | PolicyRule<'source_library.max_file_size_bytes'>
      >;
    };
  };
  agent: {
    access_mode: 'allow_all_members' | 'allow_list';
    rate_limits?: {
      rules: PolicyRule<'agent.max_concurrency'>[];
    };
  };
}

export interface PermissionTemplate {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_default: boolean;
  is_readonly: boolean;
}

export interface ChangeHistoryEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'quota' | 'resource_policy' | 'role';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}

export interface QuotaOverrideHistoryItem {
  id: string;
  created_at: string;
  created_by_user_id: string;
  overrides_json: QuotaOverride;
}

export interface QuotaTemplate {
  id: string;
  name: string;
  description?: string;
  overrides_json: QuotaOverride;
}
