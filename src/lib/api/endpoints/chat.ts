/**
 * Chat API Endpoints
 *
 * API functions for chat sessions and messages.
 */

import type { ApiClient } from '../client';
import type {
  ChatSession,
  ChatStopMode,
  ChatMessage,
  Attachment,
  PaginatedResponse,
  PaginationParams,
} from '../types';
import type { ChatAttachmentInputRef, ChatMessageInputRef } from '@/lib/types/input-ref';

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  endpoint_id?: string;
}

export interface CreateMessageRequest {
  role: 'user';
  content: string;
  inputs?: ChatMessageInputRef[];
  parent_id?: string | null;
}

export interface UpdateSessionRequest {
  title?: string;
  pinned?: boolean;
  starred?: boolean;
  model?: string;
  endpoint_id?: string;
}

export interface EditMessageRequest {
  content: string;
}

export interface RegenerateRequest {
  from_message_id: string;
  model?: string;
  endpoint_id?: string;
}

export interface InitAttachmentRequest {
  file_name: string;
  file_type: string;
  file_size: number;
  content_base64?: string;
  input_ref?: ChatAttachmentInputRef;
}

export interface InitAttachmentResponse {
  attachment: Attachment;
  upload_url?: string;
}

export interface CompleteAttachmentRequest {
  etag?: string;
  size?: number;
}

export interface StopStreamOptions {
  mode?: ChatStopMode;
}

function buildStopStreamRequest(options?: StopStreamOptions) {
  const stopMode = options?.mode ?? 'cancel';
  return { mode: stopMode };
}

export type StopStreamResponse = {
  success: true;
  stream_id: string;
  state: 'stopping' | 'terminating' | 'not_found_or_finished';
  status?: 'stopping' | 'terminating' | 'not_found_or_finished';
  mode: ChatStopMode;
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

export type StopSessionStreamResponse = {
  success: true;
  session_id: string;
  state: 'stopping' | 'terminating' | 'not_found_or_finished';
  status?: 'stopping' | 'terminating' | 'not_found_or_finished';
  mode: ChatStopMode;
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

export class ChatAPI {
  constructor(private client: ApiClient) {}

  /**
   * Get all chat sessions for a project
   */
  async getSessions(
    workspaceId: string,
    projectId: string,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<ChatSession>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);
    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<ChatSession>>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get a specific chat session
   */
  async getSession(
    workspaceId: string,
    projectId: string,
    sessionId: string
  ): Promise<ChatSession> {
    return this.client.get<ChatSession>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}`
    );
  }

  /**
   * Create a new chat session
   */
  async createSession(
    workspaceId: string,
    projectId: string,
    data?: CreateSessionRequest
  ): Promise<ChatSession> {
    return this.client.post<ChatSession>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`,
      data || {}
    );
  }

  /**
   * Update a chat session (rename, pin/star, model switch)
   */
  async updateSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    data: UpdateSessionRequest,
  ): Promise<ChatSession> {
    return this.client.patch<ChatSession>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}`,
      data,
    );
  }

  /**
   * Delete a chat session
   */
  async deleteSession(workspaceId: string, projectId: string, sessionId: string): Promise<{ success: true }> {
    return this.client.delete<{ success: true }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}`,
    );
  }

  /**
   * Get messages for a session
   */
  async getMessages(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    params?: PaginationParams,
  ): Promise<PaginatedResponse<ChatMessage>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);
    const query = searchParams.toString();

    return this.client.get<PaginatedResponse<ChatMessage>>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Send a message in a session
   */
  async createMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    data: CreateMessageRequest
  ): Promise<ChatMessage> {
    return this.client.post<ChatMessage>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
      data
    );
  }

  /**
   * Edit a message (creates a new revision; backend keeps old message)
   */
  async editMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
    data: EditMessageRequest,
  ): Promise<ChatMessage> {
    return this.client.patch<ChatMessage>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/${messageId}`,
      data,
    );
  }

  /**
   * Start regenerate (may return stream id; streaming handled via fetch)
   */
  async regenerate(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    data: RegenerateRequest,
  ): Promise<{ stream_id?: string }> {
    return this.client.post<{ stream_id?: string }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/regenerate`,
      data,
    );
  }

  /**
   * Get attachments for a session
   */
  async getAttachments(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<{ items: Attachment[]; total: number }> {
    return this.client.get<{ items: Attachment[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments`
    );
  }

  /**
   * Init attachment (returns upload URL if using direct/edge proxy upload)
   */
  async initAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    data: InitAttachmentRequest,
  ): Promise<InitAttachmentResponse> {
    return this.client.post<InitAttachmentResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments/init`,
      data,
    );
  }

  async completeAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
    data?: CompleteAttachmentRequest,
  ): Promise<Attachment> {
    return this.client.post<Attachment>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments/${attachmentId}/complete`,
      data || {},
    );
  }

  async deleteAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<{ success: true }> {
    return this.client.delete<{ success: true }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments/${attachmentId}`,
    );
  }

  async retryAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    return this.client.post<Attachment>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments/${attachmentId}/retry`,
      {},
    );
  }

  async stopStream(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    streamId: string,
    options?: StopStreamOptions,
  ): Promise<StopStreamResponse> {
    return this.client.post<StopStreamResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/streams/${streamId}/stop`,
      buildStopStreamRequest(options),
    );
  }

  async stopSessionStream(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    options?: StopStreamOptions,
  ): Promise<StopSessionStreamResponse> {
    return this.client.post<StopSessionStreamResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/stop`,
      buildStopStreamRequest(options),
    );
  }

  async getSessionStreams(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<{ items: Array<{ stream_id: string; status: 'running' | 'stopping' | 'terminating'; started_at: string }>; total: number }> {
    return this.client.get<{ items: Array<{ stream_id: string; status: 'running' | 'stopping' | 'terminating'; started_at: string }>; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/streams`,
    );
  }
}
