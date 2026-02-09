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
  openai_model: string;
  source_model?: string;
  type: 'openai' | 'anthropic' | 'custom';
  mode?: 'openai';
  base_url: string;
  status: 'active' | 'disabled';
  credential_ref?: string;
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface EndpointImportItem {
  model: string;
  source_model?: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface EndpointImportPayload {
  reranker?: EndpointImportItem;
  embedding?: EndpointImportItem;
  completion?: EndpointImportItem;
}

export interface ChatSessionRecord {
  id: string;
  workspace_id: string;
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
  runtime_status?: 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
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
}
