import { useQuery } from '@tanstack/react-query';
import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import type { Attachment, ChatMessage, ChatSession, Endpoint } from '@/lib/api/types';
import { chatAttachmentsKey, chatMessagesKey, chatSessionsKey } from '@/lib/chat/query-keys';

interface UseChatDataArgs {
  chatAPI: ChatAPI;
  endpointAPI: EndpointAPI;
  workspaceId: string;
  projectId: string;
  currentSessionId: string | null;
  canReadThreads: boolean;
}

interface UseChatDataResult {
  sessions: ChatSession[];
  sessionsLoading: boolean;
  endpoints: Endpoint[];
  messages: ChatMessage[];
  messagesLoading: boolean;
  attachments: Attachment[];
}

export function useChatData(args: UseChatDataArgs): UseChatDataResult {
  const { chatAPI, endpointAPI, workspaceId, projectId, currentSessionId, canReadThreads } = args;

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: chatSessionsKey(workspaceId, projectId),
    queryFn: () => chatAPI.getSessions(workspaceId, projectId, { page: 1, page_size: 1000 }),
    enabled: !!workspaceId && !!projectId && canReadThreads,
    refetchInterval: (query) => {
      const data = query.state.data as { items: ChatSession[] } | undefined;
      const items = data?.items ?? [];
      return items.some((s) =>
        s.execution_status === 'running' ||
        s.execution_status === 'stopping' ||
        s.execution_status === 'terminating'
      ) ? 2000 : false;
    },
  });

  const sessions = sessionsData?.items ?? [];

  const { data: endpointsData } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId, { page: 1, page_size: 500 }),
    enabled: !!workspaceId && !!projectId && canReadThreads,
  });

  const endpoints = (endpointsData?.items ?? []).filter((endpoint) => {
    if (!endpoint.capabilities || endpoint.capabilities.length === 0) return true;
    return endpoint.capabilities.some(
      (capability) =>
        (capability.type === 'chat_completion' || capability.type === 'multimodal_completion') &&
        capability.enabled,
    );
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: chatMessagesKey(workspaceId, projectId, currentSessionId ?? ''),
    queryFn: () => {
      if (!currentSessionId) return { items: [], total: 0, page: 1, page_size: 500, has_more: false };
      return chatAPI.getMessages(workspaceId, projectId, currentSessionId, { page: 1, page_size: 500 });
    },
    enabled: !!currentSessionId && !!workspaceId && !!projectId && canReadThreads,
  });

  const messages = messagesData?.items ?? [];

  const { data: attachmentsData } = useQuery({
    queryKey: chatAttachmentsKey(workspaceId, projectId, currentSessionId ?? ''),
    queryFn: () => {
      if (!currentSessionId) return { items: [], total: 0 };
      return chatAPI.getAttachments(workspaceId, projectId, currentSessionId);
    },
    enabled: !!currentSessionId && !!workspaceId && !!projectId && canReadThreads,
    refetchInterval: (query) => {
      const data = query.state.data as { items: Attachment[]; total: number } | undefined;
      const items = data?.items ?? [];
      return items.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing') ? 2000 : false;
    },
  });

  const attachments = attachmentsData?.items ?? [];

  return {
    sessions,
    sessionsLoading,
    endpoints,
    messages,
    messagesLoading,
    attachments,
  };
}
