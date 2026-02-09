/**
 * Chat Page (v1)
 *
 * Two-pane layout:
 * - Left: Threads list
 * - Right: Chat window (header + messages + composer)
 *
 * Style must follow `文档/UXUI/2026-01-31-视觉设计系统-v1.md`.
 */

'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api';
import { ChatAPI } from '@/lib/api/endpoints/chat';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import type { ChatMessage } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain } from '@/lib/chat/branch';
import { patchChatMessageInCache, upsertChatMessageInCache } from '@/lib/chat/messages-cache';
import { chatMessagesKey } from '@/lib/chat/query-keys';
import { useChatStreaming } from '@/lib/chat/use-chat-streaming';
import { useChatMutations } from '@/lib/chat/use-chat-mutations';
import { useChatVariants } from '@/lib/chat/use-chat-variants';
import { useChatData } from '@/lib/chat/use-chat-data';
import { useChatComposerActions } from '@/lib/chat/use-chat-composer-actions';
import { buildChatViewModel } from '@/lib/chat/chat-view-model';
import { useChatMessageActions } from '@/lib/chat/use-chat-message-actions';
import { useChatThreadActions } from '@/lib/chat/use-chat-thread-actions';

import { toast } from '@/components/ui/toast';
import { ThreadsPane } from '@/components/chat/ThreadsPane';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { Markdown } from '@/components/chat/Markdown';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
 

interface ChatPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('chat');
  const tErrors = useTranslations('errors');

  const token = useAuthStore((s) => s.token);
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string } | null>(null);
  const canAccessChat = useHasPermission('project:chat:access');
  const canReadThreads = canAccessChat;
  const canUseChat = canAccessChat;
  const canManageChatSessions = canAccessChat;

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composerBySession, setComposerBySession] = useState<Record<string, string>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [deleteThreadDialogOpen, setDeleteThreadDialogOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<{ id: string; title?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const apiClient = useMemo(() => getApiClient(), []);
  const chatAPI = useMemo(() => new ChatAPI(apiClient), [apiClient]);
  const endpointAPI = useMemo(() => new EndpointAPI(apiClient), [apiClient]);

  const {
    sessions,
    sessionsLoading,
    endpoints,
    messages,
    messagesLoading,
    attachments,
  } = useChatData({
    chatAPI,
    endpointAPI,
    workspaceId,
    projectId,
    currentSessionId,
    canReadThreads,
  });

  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [currentSessionId, sessions]);

  const activeSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  const {
    createSessionMutation,
    updateSessionMutation,
    deleteSessionMutation,
    createMessageMutation,
    editMessageMutation,
    initAttachmentMutation,
    deleteAttachmentMutation,
    retryAttachmentMutation,
  } = useChatMutations({
    chatAPI,
    queryClient,
    workspaceId,
    projectId,
    endpoints,
    currentSessionId,
    onSessionCreated: (sessionId) => {
      setCurrentSessionId(sessionId);
    },
    onSessionDeleted: () => {
      setCurrentSessionId(null);
    },
    onResetSessionUi: () => {
      setSearchQuery('');
      setEditingMessageId(null);
    },
    uploadFailedMessage: t('upload_failed'),
  });

  const upsertStreamAssistantToCache = useCallback((sessionId: string, message: ChatMessage) => {
    upsertChatMessageInCache(
      queryClient,
      chatMessagesKey(workspaceId, projectId, sessionId),
      message,
    );
  }, [projectId, queryClient, workspaceId]);

  const patchStreamAssistantInCache = useCallback((
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'finish_reason' | 'tokens'>>,
  ) => {
    patchChatMessageInCache(
      queryClient,
      chatMessagesKey(workspaceId, projectId, sessionId),
      messageId,
      patch,
    );
  }, [projectId, queryClient, workspaceId]);

  const { streamStateBySession, stopStreamingSession, stopStreaming, runStream } = useChatStreaming({
    token,
    workspaceId,
    projectId,
    sessions,
    currentSessionId,
    chatAPI,
    queryClient,
    messages: {
      streamError: t('stream_error'),
      streamingFailed: t('streaming_failed'),
      stopRequiredBeforeReplaceFailed: t('stream_stop_required_before_replace_failed'),
      stopFailedRetry: t('stream_stop_failed_retry'),
    },
    upsertStreamAssistantToCache,
    patchStreamAssistantInCache,
  });

  const {
    activeVariantIndexByGroup,
    suppressAutoScroll,
    onManualSelectVariant,
    markPendingAutoGroup,
    applyVariantFromMeta,
  } = useChatVariants({
    messages,
    currentSessionId,
    streamStateBySession,
  });

  const {
    activeStreamStatus,
    activeStreamingAssistant,
    mergedStreamingSessionIds,
    disabled,
  } = buildChatViewModel({
    currentSessionId,
    activeSession,
    sessions,
    streamStateBySession,
  });

  const visibleLeafId = useMemo(() => {
    if (messages.length === 0) return null;
    const groups = buildVariantGroups(messages);
    const { chain } = buildVisibleChain(messages, groups, activeVariantIndexByGroup);
    const last = chain[chain.length - 1];
    return last?.id ?? null;
  }, [messages, activeVariantIndexByGroup]);

  const { handleSend, onPickFiles, onFilePicked } = useChatComposerActions({
    canUseChat,
    currentSessionId,
    activeSession,
    composerBySession,
    setComposerBySession,
    attachments,
    editingMessageId,
    visibleLeafId,
    createMessage: (input) => createMessageMutation.mutateAsync(input),
    runStream,
    initAttachment: (input) => initAttachmentMutation.mutateAsync(input),
    fileInputRef,
  });

  const {
    onSelectThread: handleSelectThread,
    onCreateThread: handleCreateThread,
    onRenameThread: handleRenameThread,
    onToggleThreadStar: handleToggleThreadStar,
    onToggleThreadPin: handleToggleThreadPin,
    onDeleteThreadRequest: handleDeleteThreadRequest,
    onRenameActiveSession: handleRenameActiveSession,
    onSelectActiveEndpoint: handleSelectActiveEndpoint,
  } = useChatThreadActions({
    canUseChat,
    canManageChatSessions,
    sessions,
    activeSession,
    createSession: () => createSessionMutation.mutate(),
    updateSession: (input) => updateSessionMutation.mutate(input),
    setCurrentSessionId,
    setEditingMessageId,
    setThreadToDelete,
    setDeleteThreadDialogOpen,
  });

  const handleSelectVariant = useCallback((groupId: string, nextIndex: number) => {
    onManualSelectVariant(groupId, nextIndex);
  }, [onManualSelectVariant]);

  const {
    onEdit: handleEditMessage,
    onEditCommit: handleEditCommit,
    onRegenerate: handleRegenerate,
  } = useChatMessageActions({
    canUseChat,
    disabled,
    currentSessionId,
    activeSession,
    messages,
    activeVariantIndexByGroup,
    setEditingMessageId,
    editMessage: (input) => editMessageMutation.mutateAsync(input),
    upsertStreamAssistantToCache,
    applyVariantFromMeta,
    markPendingAutoGroup,
    runStream,
  });

  const handlePickFiles = useCallback(() => {
    if (editingMessageId) {
      toast.info(t('attachments.disabled_while_editing'));
      return;
    }
    onPickFiles();
  }, [editingMessageId, onPickFiles, t]);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    if (!canUseChat || !currentSessionId) return;
    deleteAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, deleteAttachmentMutation]);

  const handleRetryAttachment = useCallback((attachmentId: string) => {
    if (!canUseChat || !currentSessionId) return;
    retryAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, retryAttachmentMutation]);

  const handleConfirmDeleteThread = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!threadToDelete) return;
    const stopped = await stopStreamingSession(threadToDelete.id, 'replace');
    if (!stopped) return;
    deleteSessionMutation.mutate(threadToDelete.id);
    setDeleteThreadDialogOpen(false);
    setThreadToDelete(null);
  }, [deleteSessionMutation, stopStreamingSession, threadToDelete]);

  if (!resolvedParams) {
    return (
          <PageState state="loading">
        <div className="flex items-center justify-center h-full">
          <div className="text-tertiary">{t('loading')}</div>
        </div>
      </PageState>
    );
  }

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadThreads) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const composerValue = currentSessionId ? composerBySession[currentSessionId] || '' : '';

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth="full"
        header={<PageHeader title={t('title')} />}
      >
        <div className="h-full min-h-0 flex overflow-hidden rounded-md border border-subtle bg-panel/40">
          <ThreadsPane
            sessions={sessions}
            activeSessionId={currentSessionId}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSelect={handleSelectThread}
            streamingSessionIds={mergedStreamingSessionIds}
            onRename={handleRenameThread}
            onToggleStar={handleToggleThreadStar}
            onTogglePin={handleToggleThreadPin}
            onDelete={handleDeleteThreadRequest}
            onCreate={handleCreateThread}
            canCreate={canUseChat}
            createPending={createSessionMutation.isPending}
            isLoading={sessionsLoading}
          />

          <section className="flex-1 flex min-w-0 flex-col bg-background overflow-hidden" data-testid="chat__main-pane">
            <ChatHeader
              session={activeSession}
              endpoints={endpoints}
              streamStatus={activeStreamStatus}
              onRename={handleRenameActiveSession}
              onSelectEndpoint={handleSelectActiveEndpoint}
            />

            <div className="flex-1 min-h-0">
              {!currentSessionId ? (
                <div className="h-full flex items-center justify-center px-4">
                  <div className="mx-auto w-full max-w-[560px] text-center px-6">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
                    <div className="text-foreground font-medium mb-1">{t('no_active_thread_title')}</div>
                    <div className="text-tertiary text-sm">{t('no_active_thread_description')}</div>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={handleCreateThread}
                      disabled={!canUseChat || createSessionMutation.isPending}
                      data-testid="chat__empty-create-btn"
                    >
                      <Plus className="w-4 h-4" />
                      {t('new_thread')}
                    </Button>
                  </div>
                </div>
              ) : messagesLoading ? (
                <div className="h-full flex items-center justify-center px-4">
                  <div className="text-tertiary">{t('loading')}</div>
                </div>
              ) : (
                <MessageList
                  messages={messages}
                  activeVariantIndexByGroup={activeVariantIndexByGroup}
                  editingMessageId={editingMessageId}
                  onSelectVariant={handleSelectVariant}
                  onEdit={handleEditMessage}
                  onEditCommit={handleEditCommit}
                  onEditCancel={() => setEditingMessageId(null)}
                  onRegenerate={handleRegenerate}
                  disabled={disabled}
                  footer={
                    activeStreamingAssistant && activeStreamingAssistant.mode === 'append' ? (
                      <div className="px-4 py-2">
                        <div className="flex justify-start">
                          <div className="max-w-[80%] rounded-md px-4 py-3 border bg-surface-high text-primary border-subtle">
                            <div className="text-xs text-tertiary mb-1">{t('assistant')}</div>
                            <div className="space-y-2">
                              <Markdown content={activeStreamingAssistant.content || '…'} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null
                  }
                  streamingAssistant={activeStreamingAssistant}
                  followOutput={activeStreamingAssistant?.mode !== 'replace'}
                  suppressAutoScroll={suppressAutoScroll}
                />
              )}
            </div>

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />

            {currentSessionId && (
              <Composer
                value={composerValue}
                onChange={(v) => {
                  if (!currentSessionId) return;
                  setComposerBySession((prev) => ({ ...prev, [currentSessionId]: v }));
                }}
                onSend={handleSend}
                onStop={stopStreaming}
                mode="compose"
                autoFocus={!editingMessageId && activeStreamStatus === 'idle'}
                onPickFiles={handlePickFiles}
                attachments={attachments}
                onRemoveAttachment={handleRemoveAttachment}
                onRetryAttachment={handleRetryAttachment}
                disabled={
                  !currentSessionId ||
                  !canUseChat ||
                  createMessageMutation.isPending ||
                  editMessageMutation.isPending ||
                  initAttachmentMutation.isPending ||
                  disabled ||
                  !!editingMessageId
                }
                streaming={disabled}
              />
            )}
          </section>
        </div>
        <AlertDialog open={deleteThreadDialogOpen} onOpenChange={setDeleteThreadDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete_confirm_message', { name: threadToDelete?.title ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                data-testid="chat__delete-thread-confirm"
                onClick={handleConfirmDeleteThread}
                className="bg-error text-white hover:bg-error/90"
              >
                {t('delete_confirm_action')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
