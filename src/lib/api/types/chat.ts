import type { ChatAttachmentInputRef } from '@/lib/types/input-ref';

export type ChatStopMode = 'cancel' | 'terminate';
export type ChatExecutionStatus =
  | 'running'
  | 'stopping'
  | 'terminating'
  | 'completed'
  | 'stopped'
  | 'failed';

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
  execution_status?: ChatExecutionStatus;
  stop_mode?: ChatStopMode;
  can_escalate?: boolean;
  escalation_reason?: string | null;
  status?: 'running' | 'stopping' | 'terminating';
  termination_state?: 'terminating' | null;
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
  file_library_id?: string;
  source_object_key?: string;
}

export interface ChatRequest {
  model: string;
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
  file_library_id?: string;
  source_object_key?: string;
  preview_url?: string;
}
