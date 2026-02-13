import { useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { SourcesAPI } from '@/lib/api/endpoints/sources';
import type { ChatSession, Endpoint } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { chatAttachmentsKey, chatMessagesKey, chatSessionsKey } from '@/lib/chat/query-keys';

interface UseChatMutationsArgs {
  chatAPI: ChatAPI;
  sourcesAPI: SourcesAPI;
  queryClient: QueryClient;
  workspaceId: string;
  projectId: string;
  endpoints: Endpoint[];
  currentSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  onResetSessionUi: () => void;
  uploadFailedMessage: string;
}

export function useChatMutations(args: UseChatMutationsArgs) {
  const {
    chatAPI,
    sourcesAPI,
    queryClient,
    workspaceId,
    projectId,
    endpoints,
    currentSessionId,
    onSessionCreated,
    onSessionDeleted,
    onResetSessionUi,
    uploadFailedMessage,
  } = args;

  const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  };

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const firstActive = endpoints.find((e) => e.status === 'active') || null;
      return chatAPI.createSession(
        workspaceId,
        projectId,
        firstActive ? { endpoint_id: firstActive.id, model: firstActive.openai_model } : {},
      );
    },
    onSuccess: (data: ChatSession) => {
      onSessionCreated(data.id);
      onResetSessionUi();
      queryClient.setQueryData<ChatSession[]>(chatSessionsKey(workspaceId, projectId), (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const withoutCurrent = list.filter((session) => session.id !== data.id);
        return [data, ...withoutCurrent];
      });
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      data: Partial<Pick<ChatSession, 'title' | 'model' | 'endpoint_id' | 'pinned' | 'starred'>>;
    }) => chatAPI.updateSession(workspaceId, projectId, input.sessionId, input.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => chatAPI.deleteSession(workspaceId, projectId, sessionId),
    onSuccess: (_data, sessionId) => {
      if (currentSessionId === sessionId) {
        onSessionDeleted(sessionId);
      }
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, sessionId) });
    },
  });

  const createMessageMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      content: string;
      attachments?: string[];
      parent_id?: string | null;
    }) =>
      chatAPI.createMessage(workspaceId, projectId, input.sessionId, {
        role: 'user',
        content: input.content,
        attachments: input.attachments,
        parent_id: input.parent_id ?? null,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, input.sessionId) });
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async (input: { sessionId: string; messageId: string; content: string }) =>
      chatAPI.editMessage(workspaceId, projectId, input.sessionId, input.messageId, { content: input.content }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, input.sessionId) });
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
    },
  });

  const initAttachmentMutation = useMutation({
    mutationFn: async (input: { sessionId: string; file: File }) => {
      const contentBase64 = await blobToBase64(input.file);
      const res = await chatAPI.initAttachment(workspaceId, projectId, input.sessionId, {
        file_name: input.file.name,
        file_type: input.file.type || 'application/octet-stream',
        file_size: input.file.size,
        content_base64: contentBase64,
        source_type: 'local_upload',
      });
      return { ...res, sessionId: input.sessionId, file: input.file };
    },
    onSuccess: async ({ attachment, upload_url, sessionId, file }) => {
      queryClient.invalidateQueries({ queryKey: chatAttachmentsKey(workspaceId, projectId, sessionId) });
      if (!upload_url) return;
      try {
        const put = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await chatAPI.completeAttachment(workspaceId, projectId, sessionId, attachment.id, {});
        queryClient.invalidateQueries({ queryKey: chatAttachmentsKey(workspaceId, projectId, sessionId) });
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : uploadFailedMessage);
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : uploadFailedMessage);
    },
  });

  const addLibraryAttachmentMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      libraryId: string;
      key: string;
      name: string;
      contentType?: string;
    }) => {
      const blob = await sourcesAPI.downloadObject(
        workspaceId,
        projectId,
        input.libraryId,
        input.key,
      );
      const contentBase64 = await blobToBase64(blob);
      const fileType = input.contentType || blob.type || 'application/octet-stream';
      const attachment = await chatAPI.initAttachment(workspaceId, projectId, input.sessionId, {
        file_name: input.name,
        file_type: fileType,
        file_size: blob.size,
        content_base64: contentBase64,
        source_type: 'library_import',
        source_library_id: input.libraryId,
        source_object_key: input.key,
      });
      return { ...attachment, sessionId: input.sessionId };
    },
    onSuccess: ({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: chatAttachmentsKey(workspaceId, projectId, sessionId) });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : uploadFailedMessage);
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (input: { sessionId: string; attachmentId: string }) =>
      chatAPI.deleteAttachment(workspaceId, projectId, input.sessionId, input.attachmentId),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: chatAttachmentsKey(workspaceId, projectId, input.sessionId) }),
  });

  const retryAttachmentMutation = useMutation({
    mutationFn: async (input: { sessionId: string; attachmentId: string }) =>
      chatAPI.retryAttachment(workspaceId, projectId, input.sessionId, input.attachmentId),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: chatAttachmentsKey(workspaceId, projectId, input.sessionId) }),
  });

  return {
    createSessionMutation,
    updateSessionMutation,
    deleteSessionMutation,
    createMessageMutation,
    editMessageMutation,
    initAttachmentMutation,
    addLibraryAttachmentMutation,
    deleteAttachmentMutation,
    retryAttachmentMutation,
  };
}
