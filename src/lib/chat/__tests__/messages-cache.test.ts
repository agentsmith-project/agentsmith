import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@/lib/api/types';
import {
  type ChatMessagesQueryData,
  upsertChatMessageInCache,
} from '@/lib/chat/messages-cache';

describe('messages-cache', () => {
  it('creates the messages query when inserting a streaming assistant into an empty cache', () => {
    const queryClient = new QueryClient();
    const queryKey = ['chat', 'messages', 'ws_1', 'proj_1', 'session_1'] as const;
    const message: ChatMessage = {
      id: 'msg_assistant_1',
      session_id: 'session_1',
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      finish_reason: null,
    };

    upsertChatMessageInCache(queryClient, queryKey, message);

    expect(queryClient.getQueryData<ChatMessagesQueryData>(queryKey)).toEqual({
      items: [message],
      total: 1,
      page: 1,
      page_size: 1,
      has_more: false,
    });
  });
});
