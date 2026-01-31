/**
 * Chat API Endpoints
 *
 * API functions for chat sessions and messages.
 */

import type { ApiClient } from '../client';
import type {
  ChatSession,
  ChatMessage,
  Attachment,
} from '../types';

export interface CreateSessionRequest {
  end_user_id?: string;
  agent_id?: string;
  title?: string;
}

export interface CreateMessageRequest {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatAPI {
  constructor(private client: ApiClient) {}

  /**
   * Get all chat sessions for a project
   */
  async getSessions(
    workspaceId: string,
    projectId: string
  ): Promise<{ items: ChatSession[]; total: number }> {
    return this.client.get<{ items: ChatSession[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`
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
   * Get messages for a session
   */
  async getMessages(
    workspaceId: string,
    projectId: string,
    sessionId: string
  ): Promise<{ items: ChatMessage[]; total: number }> {
    return this.client.get<{ items: ChatMessage[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`
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
   * Get attachments for a session
   */
  async getAttachments(
    workspaceId: string,
    projectId: string,
    sessionId: string
  ): Promise<{ items: Attachment[]; total: number }> {
    return this.client.get<{ items: Attachment[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/attachments`
    );
  }
}
