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
  status: 'active' | 'removed';
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
  execution_preferences_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectMembership {
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'removed';
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

/** Expected interaction mode: chat, notebook, or both */
export type AgentInteractionMode = 'chat' | 'notebook' | 'both';

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
  execution_preferences_json?: Record<string, unknown>;
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
  visibility?: 'private' | 'public';
  /** Expected interaction: chat, notebook, or both */
  interaction_mode?: AgentInteractionMode;
  capabilities?: {
    streaming_completion?: boolean;
    multimodal_completion?: boolean;
    accepted_mime_types?: string[];
    max_file_count?: number;
    max_total_bytes?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface AgentConfig {
  image?: string;
  env?: Record<string, string>;
  endpoint_id?: string;
  cpu_request?: string;
  cpu_limit?: string;
  memory_request?: string;
  memory_limit?: string;
  idle_timeout_sec?: number;
  max_lifetime_sec?: number;
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
  model: string;
  type: 'openai' | 'anthropic' | 'custom';
  base_url: string;
  status: 'active' | 'disabled';
  credential_ref?: string;
  provider_family?: EndpointProviderFamily;
  protocol?: EndpointProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  health?: EndpointHealth;
  meta?: Record<string, string>;
  model_profile?: EndpointModelProfile;
  limits?: EndpointLimits;
  created_at: string;
  updated_at: string;
}

export type EndpointProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'google'
  | 'glm'
  | 'alibaba'
  | 'custom';
export type EndpointProtocol =
  | 'openai_compatible'
  | 'anthropic_compatible'
  | 'google_gemini'
  | 'glm_native'
  | 'dashscope_native';
export type EndpointCapabilityType =
  | 'chat_completion'
  | 'multimodal_completion'
  | 'embedding'
  | 'rerank'
  | 'image_generation'
  | 'video_generation';

export interface EndpointCapability {
  type: EndpointCapabilityType;
  enabled: boolean;
  default_model_id?: string;
}

export interface EndpointModelBinding {
  capability: EndpointCapabilityType;
  model_id: string;
  display_name?: string;
  context_window?: number;
  pricing?: {
    input_per_million?: number;
    output_per_million?: number;
    unit?: string;
    currency?: string;
  };
}

export interface EndpointDefaults {
  chat_model_id?: string;
  multimodal_model_id?: string;
  embedding_model_id?: string;
  rerank_model_id?: string;
  image_model_id?: string;
  video_model_id?: string;
}

export interface EndpointHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'failed';
  last_checked_at?: string;
  last_error?: string;
}

export interface EndpointLimits {
  max_requests_per_minute?: number;
  max_requests_per_day?: number;
  max_tokens_per_day?: number;
  timeout_seconds?: number;
}

export interface EndpointModelProfile {
  max_context_tokens: number;
  max_output_tokens: number;
  supports_file: boolean;
  supports_tool_call: boolean;
  supports_reasoning: boolean;
  price_input_per_1m: number;
  price_output_per_1m: number;
  cache_read_discount_ratio: number;
  cache_write_discount_ratio?: number;
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
  external_agent_id?: string;
  pinned?: boolean;
  starred?: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
  execution_status?: 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  tokens?: number;
  finish_reason?: string | null;
  message_status?: 'streaming' | 'completed' | 'stopped' | 'failed';
  error_code?: string | null;
  error_message?: string | null;

  // ===== Branch model (v1) =====
  parent_id?: string | null;
  logical_id?: string;
  revision_of?: string | null;
  revision_index?: number;
  variant_group_id?: string;
  variant_index?: number;
  is_stale?: boolean;
  attachment_snapshots?: ChatAttachmentSnapshot[];
}

export interface ChatAttachmentSnapshot {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  input_ref?: ChatAttachmentInputRef;
  source_type?: 'local_upload' | 'library_import';
  source_library_id?: string;
  source_object_key?: string;
}

export interface ChatRequest {
  model: string; // model
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
  input_ref?: ChatAttachmentInputRef;
  source_type?: 'local_upload' | 'library_import';
  source_library_id?: string;
  source_object_key?: string;
  preview_url?: string;
}

// ============================================================
// Notebook (Agent Thread & Turn)
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
  actor_type: 'user' | 'agent' | 'plugin' | string;
  actor_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  result: 'ok' | 'error';
  error_code?: string;
  error_message?: string;
  request_id: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  metadata_json: Record<string, unknown>; // 重命名 metadata -> metadata_json
}

export interface UsageRecord {
  id: string; // 聚合记录的 ID
  time_bucket: string; // YYYY-MM-DD or YYYY-MM-DD HH:mm
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
}

export interface UsageFactRequestDetails {
  provider?: string;
  resolved_model?: string;
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  fallback_hops?: number;
  pricing_source?: string | null;
  estimated_cost?: number | null;
  missing_price?: boolean;
  attempts?: Array<Record<string, unknown>>;
}

export interface UsageFactRecord {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  request_id?: string;
  decision_id?: string;
  requests: number;
  duration_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  result: 'ok' | 'error';
  error_code?: string;
  request_details?: UsageFactRequestDetails;
  metadata_json?: Record<string, unknown>;
}

export interface UsageKPI {
  requests_today: number;
  errors_today: number;
  tokens_today?: number;
  requests_yesterday?: number; // optional, for trend
  errors_yesterday?: number;
  tokens_yesterday?: number; // optional, for trend
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
  request_id?: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  result?: 'ok' | 'error';
  sort_by?: 'timestamp';
  sort_order?: 'asc' | 'desc';
}

export interface UsageListParams extends PaginationParams {
  start_time: string; // ISO 8601, 必选
  end_time: string; // ISO 8601, 必选
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  provider?: string;
  model?: string;
  request_id?: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  result?: 'ok' | 'error';
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  group_by?: 'day' | 'hour' | 'minute';
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
// User External Connections
// ============================================================

export type UserExternalConnectionProvider =
  | 'feishu'
  | 'jira'
  | 'github'
  | 'gitee'
  | 'custom';

export type UserExternalConnectionKind =
  | 'oauth_account'
  | 'secret_bundle'
  | 'ssh_keypair';

export type UserExternalConnectionStatus =
  | 'active'
  | 'expired'
  | 'reauth_required'
  | 'error';

export interface UserExternalConnectionField {
  key: string;
  description?: string | null;
  secret: boolean;
  masked_value?: string | null;
}

export interface UserExternalConnectionFieldInput {
  key: string;
  value: string;
  description?: string | null;
  secret?: boolean;
}

export interface UserExternalConnectionAccountIdentity {
  external_user_id?: string | null;
  external_name?: string | null;
  external_email?: string | null;
  tenant_id?: string | null;
}

export interface UserExternalConnection {
  id: string;
  user_id: string;
  provider: UserExternalConnectionProvider;
  custom_domain?: string | null;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status: UserExternalConnectionStatus;
  fields: UserExternalConnectionField[];
  account_identity?: UserExternalConnectionAccountIdentity | null;
  scopes?: string[] | null;
  expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_used_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserExternalConnectionRequest {
  provider: UserExternalConnectionProvider;
  custom_domain?: string;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status?: UserExternalConnectionStatus;
  fields?: UserExternalConnectionFieldInput[];
  account_identity?: UserExternalConnectionAccountIdentity;
  scopes?: string[];
  expires_at?: string | null;
  last_error?: string | null;
}

export interface UpdateUserExternalConnectionRequest {
  custom_domain?: string | null;
  display_name?: string;
  note?: string | null;
  status?: UserExternalConnectionStatus;
  fields?: UserExternalConnectionFieldInput[];
  account_identity?: UserExternalConnectionAccountIdentity | null;
  scopes?: string[] | null;
  expires_at?: string | null;
  last_error?: string | null;
}

export interface UserExternalConnectionProviderConfig {
  provider: UserExternalConnectionProvider;
  interactive_login_required: boolean;
  refresh_supported: boolean;
  auth_configured?: boolean;
  callback_uri?: string | null;
  auth_url?: string | null;
}

export interface UserExternalConnectionOAuthStartResponse {
  authorization_url: string;
  state: string;
  redirect_uri: string;
  expires_at: string;
  scopes?: string[];
}

// ============================================================
// Files (File Management & AIReady)
// ============================================================

export type AIReadyStatus = 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';

export interface FileItem {
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

export interface FileItemWithAIReady extends FileItem {
  ai_ready?: AIReadyJob;
  ai_ready_usage?: AIReadyUsage;
}

export interface LimitSummary {
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

export interface FilesListParams extends PaginationParams {
  search?: string;
  library_id?: string;
  status?: AIReadyStatus | 'all';
  ai_ready_only?: boolean;
  sort_by?: 'updated_at' | 'file_size' | 'status';
  sort_order?: 'asc' | 'desc';
}

export type FilesListResponse = PaginatedResponse<FileItemWithAIReady>;

export interface FileLibrary {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  visibility: 'shared';
  /** Storage provider backing this library (MVP: S3-compatible, e.g. MinIO). */
  provider?: 's3';
  /** Backend bucket name for ops/debug; not user-facing. */
  bucket?: string;
  /** System-managed library semantic marker (non-user-editable). */
  system_managed_kind?: 'default_personal_uploads';
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Files (Object Browser / MinIO-like File Manager)
// ============================================================

export interface FilePrefixItem {
  kind: 'prefix';
  /** Normalized prefix with trailing slash, e.g. `docs/specs/`. */
  prefix: string;
  /** Last segment name, e.g. `specs`. */
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

export interface LimitOverride {
  endpoint?: {
    daily_token_limit?: number;
  };
  source_library?: {
    max_total_files?: number;
    max_file_size_bytes?: number;
  };
  agent?: {
    max_concurrency?: number;
  };
}

export type PolicyResourceType = 'endpoint' | 'source_library' | 'agent';
export type PolicySubjectType = 'group' | 'user';

export type PolicyRuleKey =
  | 'endpoint.requests_per_minute'
  | 'endpoint.requests_per_5_hours'
  | 'endpoint.requests_per_day'
  | 'endpoint.spending_usd_per_minute'
  | 'endpoint.spending_usd_per_5_hours'
  | 'endpoint.spending_usd_per_day'
  | 'source_library.requests_per_minute'
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

export interface PolicySpendingLimit {
  rules: PolicyRule[];
  [key: string]: unknown;
}

export interface ResourcePolicySubject {
  subject_type: PolicySubjectType;
  subject_id: string;
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
  updated_at?: string;
}

export interface ResourcePolicy {
  resource_type: PolicyResourceType;
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: ResourcePolicySubject[];
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
}

export interface ResourcePolicyUpdateRequest {
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: PolicySubjectType;
    subject_id: string;
    rate_limits?: PolicyRateLimit;
    spending_limits?: PolicySpendingLimit;
  }>;
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
}

export interface ProjectGovernanceDefaults {
  endpoint: {
    access_mode: 'allow_all_members' | 'allow_list';
    rate_limits?: {
      rules: Array<
        PolicyRule<'endpoint.requests_per_minute'>
        | PolicyRule<'endpoint.requests_per_5_hours'>
        | PolicyRule<'endpoint.requests_per_day'>
      >;
    };
    spending_limits?: {
      rules: Array<
        PolicyRule<'endpoint.spending_usd_per_minute'>
        | PolicyRule<'endpoint.spending_usd_per_5_hours'>
        | PolicyRule<'endpoint.spending_usd_per_day'>
      >;
    };
  };
  source_library: {
    access_mode: 'allow_all_members' | 'allow_list';
    rate_limits?: {
      rules: PolicyRule<'source_library.requests_per_minute'>[];
    };
    spending_limits?: {
      rules: Array<
        PolicyRule<'source_library.max_total_files'> | PolicyRule<'source_library.max_file_size_bytes'>
      >;
    };
  };
  agent: {
    access_mode: 'allow_all_members' | 'allow_list';
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
  change_type: 'permissions' | 'resource_policy' | 'role';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}

export interface LimitOverrideHistoryItem {
  id: string;
  created_at: string;
  created_by_user_id: string;
  overrides_json: LimitOverride;
}

export interface LimitTemplate {
  id: string;
  name: string;
  description?: string;
  overrides_json: LimitOverride;
}
import type { ChatAttachmentInputRef } from '@/lib/types/input-ref';

// ============================================================
// Re-export Endpoint Extended Types
// ============================================================

export type {
  CustomEndpointProtocol,
  CustomEndpointConfig,
  EndpointHealthCheck,
  EndpointHealthErrorCategory,
  BatchHealthCheckRequest,
  BatchHealthCheckResponse,
  ModelPricing,
  PricingCurrency,
  PricingUnit,
  UpdatePricingRequest,
  ValidateEndpointRequest,
  ValidateEndpointResponse,
} from './endpoints';
