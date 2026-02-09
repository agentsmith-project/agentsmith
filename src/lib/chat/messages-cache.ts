import type { QueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@/lib/api/types';

export interface ChatMessagesQueryData {
  items: ChatMessage[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export function upsertChatMessageInCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  message: ChatMessage,
): void {
  queryClient.setQueryData(
    queryKey,
    (prev: ChatMessagesQueryData | undefined) => {
      if (!prev) return prev;
      const index = prev.items.findIndex((item) => item.id === message.id);
      if (index >= 0) {
        const nextItems = [...prev.items];
        nextItems[index] = { ...nextItems[index], ...message };
        return { ...prev, items: nextItems };
      }
      return {
        ...prev,
        items: [...prev.items, message],
        total: prev.total + 1,
      };
    },
  );
}

export function patchChatMessageInCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  messageId: string,
  patch: Partial<Pick<ChatMessage, 'content' | 'finish_reason' | 'tokens'>>,
): void {
  queryClient.setQueryData(
    queryKey,
    (prev: ChatMessagesQueryData | undefined) => {
      if (!prev) return prev;
      const index = prev.items.findIndex((item) => item.id === messageId);
      if (index < 0) return prev;
      const nextItems = [...prev.items];
      nextItems[index] = {
        ...nextItems[index],
        ...patch,
      };
      return { ...prev, items: nextItems };
    },
  );
}
