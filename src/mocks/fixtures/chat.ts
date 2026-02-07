/**
 * Chat Fixtures
 *
 * Mock chat session, message, and attachment data for development and testing.
 */

import type { ChatMessage } from '@/lib/api/types';

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

export interface ChatMessageWithMeta extends ChatMessage {
  id: string;
  session_id: string;
  created_at: string;
  tokens?: number;
  finish_reason?: string | null;
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

export const chatSessionFixtures: ChatSession[] = [
  {
    id: 'chat_001',
    project_id: 'proj_001',
    title: 'GPT-4o Chat',
    model: 'gpt-4o',
    endpoint_id: 'endpoint_001',
    starred: true,
    created_at: '2026-01-28T10:00:00Z',
    updated_at: '2026-01-28T14:30:00Z',
    message_count: 15,
    total_tokens: 4580,
  },
  {
    id: 'chat_002',
    project_id: 'proj_001',
    title: 'Claude Discussion',
    model: 'claude-3.5-sonnet',
    endpoint_id: 'endpoint_002',
    pinned: true,
    created_at: '2026-01-28T11:30:00Z',
    updated_at: '2026-01-28T13:45:00Z',
    message_count: 8,
    total_tokens: 2340,
  },
  {
    id: 'chat_003',
    project_id: 'proj_001',
    title: 'Code Review Session',
    model: 'gpt-4o',
    endpoint_id: 'endpoint_001',
    created_at: '2026-01-27T16:00:00Z',
    updated_at: '2026-01-27T18:20:00Z',
    message_count: 22,
    total_tokens: 6750,
  },
  {
    id: 'chat_004',
    project_id: 'proj_002',
    title: 'Research Questions',
    model: 'gpt-4-turbo',
    endpoint_id: 'endpoint_004',
    created_at: '2026-01-26T09:00:00Z',
    updated_at: '2026-01-26T14:15:00Z',
    message_count: 6,
    total_tokens: 1890,
  },
];

export const chatMessageFixtures: ChatMessageWithMeta[] = [
  {
    id: 'msg_001',
    session_id: 'chat_001',
    role: 'system',
    content: 'You are a helpful AI assistant.',
    created_at: '2026-01-28T10:00:00Z',
    tokens: 8,
    finish_reason: null,
  },
  {
    id: 'msg_002',
    session_id: 'chat_001',
    role: 'user',
    content: 'Hello! Can you help me with a question?',
    created_at: '2026-01-28T10:01:00Z',
    tokens: 12,
    finish_reason: null,
  },
  {
    id: 'msg_003',
    session_id: 'chat_001',
    role: 'assistant',
    content: 'Of course! I\'d be happy to help. What would you like to know?',
    created_at: '2026-01-28T10:01:05Z',
    tokens: 18,
    finish_reason: 'stop',
  },
  {
    id: 'msg_004',
    session_id: 'chat_001',
    role: 'user',
    content: 'Can you explain what MBOS is?',
    created_at: '2026-01-28T10:02:00Z',
    tokens: 10,
    finish_reason: null,
  },
  {
    id: 'msg_005',
    session_id: 'chat_001',
    role: 'assistant',
    content: 'MBOS (Microservices-Based Operating System) is a platform for building and managing AI agents. It provides a flexible architecture for creating external and internal agents, managing endpoints, and handling multi-turn conversations through workbenches.',
    created_at: '2026-01-28T10:02:08Z',
    tokens: 45,
    finish_reason: 'stop',
  },
  {
    id: 'msg_006',
    session_id: 'chat_001',
    role: 'user',
    content: 'That sounds interesting. What are the key features?',
    created_at: '2026-01-28T10:03:00Z',
    tokens: 11,
    finish_reason: null,
  },
  {
    id: 'msg_007',
    session_id: 'chat_001',
    role: 'assistant',
    content: 'Key features include:\n\n1. **Agent Management**: Create and manage external and internal agents\n2. **Endpoint Configuration**: Connect to various LLM providers (OpenAI, Anthropic, custom)\n3. **Workbench**: Multi-turn conversations with SSE streaming\n4. **Source Libraries**: Manage project file libraries for agent context\n5. **Access Control**: Role-based permissions and audit logging\n6. **Usage Tracking**: Monitor API usage and set limits',
    created_at: '2026-01-28T10:03:15Z',
    tokens: 78,
    finish_reason: 'stop',
  },
];

export const attachmentFixtures: Attachment[] = [
  {
    id: 'att_001',
    session_id: 'chat_001',
    file_name: 'requirements.pdf',
    file_type: 'application/pdf',
    file_size: 256000,
    upload_status: 'ready',
    created_at: '2026-01-28T10:05:00Z',
  },
  {
    id: 'att_002',
    session_id: 'chat_001',
    file_name: 'architecture-diagram.png',
    file_type: 'image/png',
    file_size: 128500,
    upload_status: 'ready',
    created_at: '2026-01-28T10:06:00Z',
  },
  {
    id: 'att_003',
    session_id: 'chat_002',
    file_name: 'research-notes.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 45000,
    upload_status: 'uploading',
    created_at: '2026-01-28T11:45:00Z',
  },
  {
    id: 'att_004',
    session_id: 'chat_002',
    file_name: 'data-analysis.xlsx',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size: 89000,
    upload_status: 'ready',
    created_at: '2026-01-28T11:50:00Z',
  },
  {
    id: 'att_005',
    session_id: 'chat_003',
    file_name: 'code-review.py',
    file_type: 'text/x-python',
    file_size: 12500,
    upload_status: 'failed',
    created_at: '2026-01-27T16:30:00Z',
    error_message: 'Upload failed: network error',
  },
];
