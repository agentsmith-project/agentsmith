import { useCallback, type RefObject } from 'react';
import type React from 'react';
import type { Attachment, ChatMessage, ChatSession } from '@/lib/api/types';
import type { ChatMessageInputRef } from '@/lib/types/input-ref';
import { hasEndpointBinding } from '@/lib/chat/composer-state';
import type { RunChatStreamArgs } from '@/lib/chat/use-chat-streaming';

interface UseChatComposerActionsArgs {
  canUseChat: boolean;
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  composerBySession: Record<string, string>;
  setComposerBySession: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  attachments: Attachment[];
  editingMessageId: string | null;
  visibleLeafId: string | null;
  createMessage: (args: {
    sessionId: string;
    content: string;
    inputs?: ChatMessageInputRef[];
    parent_id?: string | null;
  }) => Promise<ChatMessage>;
  runStream: (args: RunChatStreamArgs) => Promise<void>;
  initAttachment: (args: { sessionId: string; file: File }) => Promise<unknown>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

interface UseChatComposerActionsResult {
  handleSend: () => Promise<void>;
  onPickFiles: () => void;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onAttachFiles: (files: File[]) => Promise<void>;
}

export function useChatComposerActions(args: UseChatComposerActionsArgs): UseChatComposerActionsResult {
  const {
    canUseChat,
    currentSessionId,
    activeSession,
    composerBySession,
    setComposerBySession,
    attachments,
    editingMessageId,
    visibleLeafId,
    createMessage,
    runStream,
    initAttachment,
    fileInputRef,
  } = args;

  const handleSend = useCallback(async () => {
    if (!canUseChat) return;
    if (!currentSessionId) return;
    if (!activeSession) return;
    if (!hasEndpointBinding(activeSession)) return;

    const composerValue = composerBySession[currentSessionId] || '';
    const content = composerValue.trim();
    if (!content) return;

    const readyAttachments = attachments.filter((a) => a.upload_status === 'ready');
    const readyInputRefs = readyAttachments.map((a) => a.input_ref).filter((v): v is ChatMessageInputRef => Boolean(v));
    const hasBlocking = attachments.some((a) => a.upload_status !== 'ready');
    if (hasBlocking) return;
    if (readyAttachments.length !== readyInputRefs.length) return;

    if (editingMessageId) return;

    const userMsg = await createMessage({
      sessionId: currentSessionId,
      content,
      inputs: readyInputRefs,
      parent_id: visibleLeafId,
    });
    setComposerBySession((prev) => ({ ...prev, [currentSessionId]: '' }));
    await runStream({
      sessionId: currentSessionId,
      model: activeSession.model,
      endpointId: activeSession.endpoint_id,
      branchLeafMessageId: userMsg.id,
      input: { role: 'user', content, inputs: readyInputRefs },
      mode: 'append',
    });
  }, [
    canUseChat,
    currentSessionId,
    activeSession,
    composerBySession,
    attachments,
    editingMessageId,
    visibleLeafId,
    createMessage,
    runStream,
    setComposerBySession,
  ]);

  const onPickFiles = useCallback(() => {
    if (!canUseChat) return;
    fileInputRef.current?.click();
  }, [canUseChat, fileInputRef]);

  const onAttachFiles = useCallback(async (files: File[]) => {
    if (!canUseChat) return;
    if (!currentSessionId) return;
    if (files.length === 0) return;
    for (const file of files) {
      await initAttachment({ sessionId: currentSessionId, file });
    }
  }, [canUseChat, currentSessionId, initAttachment]);

  const onFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await onAttachFiles(files);
  }, [onAttachFiles]);

  return {
    handleSend,
    onPickFiles,
    onFilePicked,
    onAttachFiles,
  };
}
