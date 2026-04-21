export interface WorkspaceRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CredentialRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  type: 'api_key';
  fingerprint: string;
  created_at: string;
  last_rotated_at?: string;
}

export interface CredentialSecretRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  value: string;
  updated_at: string;
}

export interface EndpointRecord {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  model: string;
  type: 'catalog' | 'custom';
  mode?: 'openai';
  base_url: string;
  status: 'active' | 'disabled';
  credential_ref?: string;
  provider_family?: EndpointProviderFamily;
  upstream_protocol: EndpointUpstreamProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  health?: EndpointHealth;
  meta?: Record<string, string>;
  model_profile?: EndpointModelProfile;
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
  created_at: string;
  updated_at: string;
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
export type EndpointUpstreamProtocol =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages';
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

export interface EndpointBulkImportItem {
  model: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface EndpointBulkImportPayload {
  reranker?: EndpointBulkImportItem;
  embedding?: EndpointBulkImportItem;
  completion?: EndpointBulkImportItem;
  image_generation?: EndpointBulkImportItem;
  video_generation?: EndpointBulkImportItem;
}

export interface ChatSessionRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  model: string;
  endpoint_id: string;
  external_agent_id?: string;
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  pinned?: boolean;
  starred?: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
  execution_status?: 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
}

export interface AgentRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  presence?: 'online' | 'offline' | 'managed';
  status: 'enabled' | 'disabled';
  config?: {
    image?: string;
    env?: Record<string, string>;
    endpoint_id?: string;
    cpu_request?: string;
    cpu_limit?: string;
    memory_request?: string;
    memory_limit?: string;
    idle_timeout_sec?: number;
    max_lifetime_sec?: number;
    _internal_key_id?: string;
    _internal_raw_key?: string;
    runner_runtime?: 'dev_direct' | 'docker_manual' | 'compose_managed' | 'k8s_internal';
    max_concurrent_sessions_override?: number;
  };
  execution_preferences_json?: Record<string, unknown>;
  interaction_kind?: 'chat' | 'notebook';
  owner_id?: string;
  admin_id?: string;
  visibility?: 'private' | 'public';
  capabilities?: {
    streaming_completion?: boolean;
    multimodal_completion?: boolean;
    accepted_mime_types?: string[];
    max_file_count?: number;
    max_total_bytes?: number;
  };
  created_at: string;
  updated_at: string;
  last_seen_at?: string;
}

export interface AgentServiceKeyRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  agent_id: string;
  key_prefix: string;
  key_hash: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

export interface ChatMessageRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  tokens?: number;
  finish_reason?: string | null;
  message_status?: 'streaming' | 'completed' | 'stopped' | 'failed';
  error_code?: string | null;
  error_message?: string | null;
  parent_id?: string | null;
  logical_id?: string;
  revision_of?: string | null;
  revision_index?: number;
  variant_group_id?: string;
  variant_index?: number;
  is_stale?: boolean;
  attachment_snapshots?: ChatAttachmentSnapshotRecord[];
}

export interface ChatAttachmentSnapshotRecord {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  input_ref?: {
    kind: 'library_object' | 'url';
    library_id?: string;
    key?: string;
    url?: string;
    imported_library_id?: string;
    imported_key?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
  source_type?: 'local_upload' | 'library_import';
  file_library_id?: string;
  source_object_key?: string;
}

export interface ChatAttachmentRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_status: 'uploading' | 'processing' | 'ready' | 'failed';
  created_at: string;
  error_message?: string;
  input_ref?: {
    kind: 'library_object' | 'url';
    library_id?: string;
    key?: string;
    url?: string;
    imported_library_id?: string;
    imported_key?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
  source_type?: 'local_upload' | 'library_import';
  file_library_id?: string;
  source_object_key?: string;
  content_base64?: string;
  preview_url?: string;
}
