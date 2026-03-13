'use client';

import { useCallback } from 'react';

import { toast } from '@/components/ui/toast';

interface UseChatAttachmentActionsArgs {
  addLibraryAttachment: (input: {
    sessionId: string;
    libraryId: string;
    key: string;
    name: string;
    contentType?: string;
  }) => void;
  addUrlAttachment: (
    input: { sessionId: string; url: string },
    options: { onSuccess: () => void },
  ) => void;
  canAttachFiles: boolean;
  canUseChat: boolean;
  currentSessionId: string | null;
  deleteAttachment: (input: { sessionId: string; attachmentId: string }) => void;
  editingMessageId: string | null;
  onAttachFiles: (files: File[]) => Promise<void>;
  onPickFiles: () => void;
  retryAttachment: (input: { sessionId: string; attachmentId: string }) => void;
  setAddUrlOpen: (open: boolean) => void;
  setLibraryPickerOpen: (open: boolean) => void;
  setUrlInput: (value: string) => void;
  t: (key: string) => string;
  urlInput: string;
}

export function useChatAttachmentActions(args: UseChatAttachmentActionsArgs) {
  const {
    addLibraryAttachment,
    addUrlAttachment,
    canAttachFiles,
    canUseChat,
    currentSessionId,
    deleteAttachment,
    editingMessageId,
    onAttachFiles,
    onPickFiles,
    retryAttachment,
    setAddUrlOpen,
    setLibraryPickerOpen,
    setUrlInput,
    t,
    urlInput,
  } = args;

  const handlePickFiles = useCallback(() => {
    if (editingMessageId) {
      toast.info(t('attachments.disabled_while_editing'));
      return;
    }
    if (!canAttachFiles) {
      toast.info(t('attachments.multimodal_required'));
      return;
    }
    onPickFiles();
  }, [canAttachFiles, editingMessageId, onPickFiles, t]);

  const handlePickFromLibrary = useCallback(() => {
    if (editingMessageId) {
      toast.info(t('attachments.disabled_while_editing'));
      return;
    }
    if (!currentSessionId) return;
    if (!canAttachFiles) {
      toast.info(t('attachments.multimodal_required'));
      return;
    }
    setLibraryPickerOpen(true);
  }, [canAttachFiles, currentSessionId, editingMessageId, setLibraryPickerOpen, t]);

  const handlePickUrl = useCallback(() => {
    if (editingMessageId) {
      toast.info(t('attachments.disabled_while_editing'));
      return;
    }
    if (!currentSessionId) return;
    if (!canAttachFiles) {
      toast.info(t('attachments.multimodal_required'));
      return;
    }
    setAddUrlOpen(true);
  }, [canAttachFiles, currentSessionId, editingMessageId, setAddUrlOpen, t]);

  const handleAddLibraryObject = useCallback((input: {
    libraryId: string;
    key: string;
    name: string;
    contentType?: string;
  }) => {
    if (!currentSessionId) return;
    if (!canAttachFiles) {
      toast.info(t('attachments.multimodal_required'));
      return;
    }
    addLibraryAttachment({
      sessionId: currentSessionId,
      libraryId: input.libraryId,
      key: input.key,
      name: input.name,
      contentType: input.contentType,
    });
  }, [addLibraryAttachment, canAttachFiles, currentSessionId, t]);

  const handleAddUrlInput = useCallback(() => {
    const normalized = urlInput.trim();
    if (!currentSessionId) return;
    if (!/^https?:\/\//i.test(normalized)) return;
    addUrlAttachment(
      { sessionId: currentSessionId, url: normalized },
      {
        onSuccess: () => {
          setUrlInput('');
          setAddUrlOpen(false);
        },
      },
    );
  }, [addUrlAttachment, currentSessionId, setAddUrlOpen, setUrlInput, urlInput]);

  const handleAttachFiles = useCallback(async (files: File[]) => {
    if (editingMessageId) {
      toast.info(t('attachments.disabled_while_editing'));
      return;
    }
    if (!currentSessionId) {
      toast.info(t('no_active_thread_description'));
      return;
    }
    if (!canAttachFiles) {
      toast.info(t('attachments.multimodal_required'));
      return;
    }
    await onAttachFiles(files);
  }, [canAttachFiles, currentSessionId, editingMessageId, onAttachFiles, t]);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    if (!canUseChat || !currentSessionId) return;
    deleteAttachment({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, deleteAttachment]);

  const handleRetryAttachment = useCallback((attachmentId: string) => {
    if (!canUseChat || !currentSessionId) return;
    retryAttachment({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, retryAttachment]);

  return {
    handleAddLibraryObject,
    handleAddUrlInput,
    handleAttachFiles,
    handlePickFiles,
    handlePickFromLibrary,
    handlePickUrl,
    handleRemoveAttachment,
    handleRetryAttachment,
  };
}
