import { useCallback } from 'react';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain, getGroupIdForMessageId } from '@/lib/chat/branch';
import type { RunChatStreamArgs } from '@/lib/chat/use-chat-streaming';

interface UseChatMessageActionsArgs {
  canUseChat: boolean;
  disabled: boolean;
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  messages: ChatMessage[];
  activeVariantIndexByGroup: Record<string, number>;
  setEditingMessageId: (messageId: string | null) => void;
  editMessage: (args: { sessionId: string; messageId: string; content: string }) => Promise<ChatMessage>;
  upsertStreamAssistantToCache: (sessionId: string, message: ChatMessage) => void;
  applyVariantFromMeta: (groupId: string | undefined, variantIndex: number | undefined) => void;
  markPendingAutoGroup: (groupId: string | null) => void;
  runStream: (args: RunChatStreamArgs) => Promise<void>;
}

interface UseChatMessageActionsResult {
  onEdit: (message: ChatMessage) => void;
  onEditCommit: (message: ChatMessage, nextContent: string) => Promise<void>;
  onRegenerate: (message: ChatMessage) => Promise<void>;
}

export function useChatMessageActions(args: UseChatMessageActionsArgs): UseChatMessageActionsResult {
  const {
    canUseChat,
    disabled,
    currentSessionId,
    activeSession,
    messages,
    activeVariantIndexByGroup,
    setEditingMessageId,
    editMessage,
    upsertStreamAssistantToCache,
    applyVariantFromMeta,
    markPendingAutoGroup,
    runStream,
  } = args;

  const onEdit = useCallback((message: ChatMessage) => {
    if (disabled || !canUseChat || message.role !== 'user') return;
    setEditingMessageId(message.id);
  }, [canUseChat, disabled, setEditingMessageId]);

  const onEditCommit = useCallback(async (message: ChatMessage, nextContent: string) => {
    if (disabled || !canUseChat || !currentSessionId) return;
    const edited = await editMessage({
      sessionId: currentSessionId,
      messageId: message.id,
      content: nextContent,
    });
    upsertStreamAssistantToCache(currentSessionId, edited);
    if (edited.logical_id && typeof edited.revision_index === 'number') {
      applyVariantFromMeta(edited.logical_id, edited.revision_index);
    }
    markPendingAutoGroup(edited.logical_id || (edited.revision_of ? `log_${edited.revision_of}` : null));
    setEditingMessageId(null);
    if (activeSession?.model && activeSession?.endpoint_id) {
      const groups = buildVariantGroups(messages);
      const { chain } = buildVisibleChain(messages, groups, activeVariantIndexByGroup);
      const editedIndex = chain.findIndex((item) => item.id === message.id);
      const previewAssistant =
        editedIndex >= 0
          ? chain.slice(editedIndex + 1).find((item) => item.role === 'assistant')
          : undefined;
      await runStream({
        sessionId: currentSessionId,
        model: activeSession.model,
        endpointId: activeSession.endpoint_id,
        fromMessageId: edited.id,
        displayMessageId: previewAssistant?.id ?? null,
        mode: 'replace',
      });
    }
  }, [
    activeSession,
    activeVariantIndexByGroup,
    applyVariantFromMeta,
    canUseChat,
    currentSessionId,
    disabled,
    editMessage,
    markPendingAutoGroup,
    messages,
    runStream,
    setEditingMessageId,
    upsertStreamAssistantToCache,
  ]);

  const onRegenerate = useCallback(async (message: ChatMessage) => {
    if (disabled || !canUseChat || !activeSession || !currentSessionId) return;
    if (messages.length) {
      const groups = buildVariantGroups(messages);
      markPendingAutoGroup(getGroupIdForMessageId(groups, message.id));
    }
    await runStream({
      sessionId: currentSessionId,
      model: activeSession.model,
      endpointId: activeSession.endpoint_id,
      fromMessageId: message.id,
      mode: 'replace',
    });
  }, [activeSession, canUseChat, currentSessionId, disabled, markPendingAutoGroup, messages, runStream]);

  return {
    onEdit,
    onEditCommit,
    onRegenerate,
  };
}
