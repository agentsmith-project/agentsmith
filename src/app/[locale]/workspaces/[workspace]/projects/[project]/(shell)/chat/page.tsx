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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api';
import { ChatAPI } from '@/lib/api/endpoints/chat';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import { FilesAPI } from '@/lib/api/endpoints/files';
import { AgentAPI } from '@/lib/api/endpoints/agents';
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
import { useChatDeleteDialog } from '@/lib/chat/use-chat-delete-dialog';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';

import { toast } from '@/components/ui/toast';
import { ThreadsPane } from '@/components/chat/ThreadsPane';
import { ChatMainPane } from '@/components/chat/ChatMainPane';
import { ChatDeleteDialog } from '@/components/chat/ChatDeleteDialog';
import { ChatLibraryPickerDialog } from '@/components/chat/ChatLibraryPickerDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { cn } from '@/lib/utils';

interface ChatPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('chat');
  const tErrors = useTranslations('errors');

  const token = useAuthStore((s) => s.token);
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const canAccessChat = useHasPermission('project:endpoint:use');
  const canReadThreads = canAccessChat;
  const canUseChat = canAccessChat;
  const canManageChatSessions = canAccessChat;

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composerBySession, setComposerBySession] = useState<Record<string, string>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project, locale: p.locale });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const { layoutMode } = useProjectLayoutMode();

  const apiClient = useMemo(() => getApiClient(), []);
  const chatAPI = useMemo(() => new ChatAPI(apiClient), [apiClient]);
  const endpointAPI = useMemo(() => new EndpointAPI(apiClient), [apiClient]);
  const sourcesAPI = useMemo(() => new FilesAPI(apiClient), [apiClient]);
  const agentAPI = useMemo(() => new AgentAPI(apiClient), [apiClient]);

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
  const { data: agentData } = useQuery({
    queryKey: ['agents', workspaceId, projectId, 'chat'],
    queryFn: () => agentAPI.list(workspaceId, projectId, { page: 1, page_size: 500 }),
    enabled: !!workspaceId && !!projectId && canReadThreads,
  });
  const externalAgents = useMemo(
    () =>
      (agentData?.items ?? []).filter(
        (agent) =>
          agent.mode === 'external'
          && agent.status === 'enabled'
          && (agent.interaction_mode === 'chat' || agent.interaction_mode === 'both' || !agent.interaction_mode),
      ),
    [agentData],
  );

  useEffect(() => {
    if (sessions.length === 0) {
      if (currentSessionId !== null) setCurrentSessionId(null);
      return;
    }
    const hasCurrent = currentSessionId ? sessions.some((session) => session.id === currentSessionId) : false;
    if (!hasCurrent) setCurrentSessionId(sessions[0].id);
  }, [currentSessionId, sessions]);

  const activeSession = sessions.find((s) => s.id === currentSessionId) ?? null;
  const activeEndpoint = useMemo(() => {
    if (!activeSession) return null;
    return endpoints.find((endpoint) => endpoint.id === activeSession.endpoint_id) ?? null;
  }, [activeSession, endpoints]);
  const activeExternalAgent = useMemo(() => {
    if (!activeSession?.external_agent_id) return null;
    return externalAgents.find((agent) => agent.id === activeSession.external_agent_id) ?? null;
  }, [activeSession?.external_agent_id, externalAgents]);
  const canAttachFiles = useMemo(() => {
    if (activeSession?.external_agent_id) {
      return activeExternalAgent?.capabilities?.multimodal_completion ?? false;
    }
    if (!activeEndpoint) return false;
    return (
      activeEndpoint.capabilities?.some(
        (capability) => capability.type === 'multimodal_completion' && capability.enabled,
      ) ?? false
    );
  }, [activeEndpoint, activeExternalAgent?.capabilities?.multimodal_completion, activeSession?.external_agent_id]);
  const {
    createSessionMutation,
    updateSessionMutation,
    deleteSessionMutation,
    createMessageMutation,
    editMessageMutation,
    initAttachmentMutation,
    addLibraryAttachmentMutation,
    addUrlAttachmentMutation,
    deleteAttachmentMutation,
    retryAttachmentMutation,
  } = useChatMutations({
    chatAPI,
    sourcesAPI,
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
      streamErrorEmptyResponse: t('stream_error_empty_response'),
      streamingFailed: t('streaming_failed'),
      stopRequiredBeforeReplaceFailed: t('stream_stop_required_before_replace_failed'),
      stopFailedRetry: t('stream_stop_failed_retry'),
      streamErrorAgentOffline: t('stream_error_agent_offline'),
      streamErrorAgentTimeout: t('stream_error_agent_timeout'),
      streamErrorAgentProtocol: t('stream_error_agent_protocol'),
      streamErrorAgentUpstream: t('stream_error_agent_upstream'),
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

  const { handleSend, onPickFiles, onFilePicked, onAttachFiles } = useChatComposerActions({
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
    deleteThreadDialogOpen,
    setDeleteThreadDialogOpen,
    threadToDelete,
    setThreadToDelete,
    handleConfirmDeleteThread,
  } = useChatDeleteDialog({
    deleteSession: (sessionId) => deleteSessionMutation.mutate(sessionId),
    stopStreamingSession,
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
    onSelectExternalAgent: handleSelectExternalAgent,
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
  }, [canAttachFiles, currentSessionId, editingMessageId, t]);

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
  }, [canAttachFiles, currentSessionId, editingMessageId, t]);

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
    addLibraryAttachmentMutation.mutate({
      sessionId: currentSessionId,
      libraryId: input.libraryId,
      key: input.key,
      name: input.name,
      contentType: input.contentType,
    });
  }, [addLibraryAttachmentMutation, canAttachFiles, currentSessionId, t]);

  const handleAddUrlInput = useCallback(() => {
    const normalized = urlInput.trim();
    if (!currentSessionId) return;
    if (!/^https?:\/\//i.test(normalized)) return;
    addUrlAttachmentMutation.mutate(
      { sessionId: currentSessionId, url: normalized },
      {
        onSuccess: () => {
          setUrlInput('');
          setAddUrlOpen(false);
        },
      },
    );
  }, [addUrlAttachmentMutation, currentSessionId, urlInput]);

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
    deleteAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, deleteAttachmentMutation]);

  const handleRetryAttachment = useCallback((attachmentId: string) => {
    if (!canUseChat || !currentSessionId) return;
    retryAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId });
  }, [canUseChat, currentSessionId, retryAttachmentMutation]);

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
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/notebook`}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="chat__open-notebook"
                >
                  {t('open_notebook')}
                </Link>
                <Link
                  href={`${basePath}/endpoints`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="chat__open-endpoints"
                >
                  {t('open_endpoints')}
                </Link>
                <Link
                  href={`${basePath}/files`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="chat__open-files"
                >
                  {t('open_files')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <div
          className={cn(
            'h-full min-h-0 flex overflow-hidden rounded-md border border-subtle bg-panel/40',
            'w-full',
          )}
        >
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
            layoutMode={layoutMode}
          />

          <ChatMainPane
            currentSessionId={currentSessionId}
            activeSession={activeSession}
            endpoints={endpoints}
            externalAgents={externalAgents}
            messages={messages}
            messagesLoading={messagesLoading}
            attachments={attachments}
            activeVariantIndexByGroup={activeVariantIndexByGroup}
            editingMessageId={editingMessageId}
            disabled={disabled}
            activeStreamStatus={activeStreamStatus}
            activeStreamingAssistant={activeStreamingAssistant}
            suppressAutoScroll={suppressAutoScroll}
            createPending={createSessionMutation.isPending}
            createMessagePending={createMessageMutation.isPending}
            editMessagePending={editMessageMutation.isPending}
            initAttachmentPending={initAttachmentMutation.isPending}
            canUseChat={canUseChat}
            canAttachFiles={canAttachFiles}
            composerValue={composerValue}
            fileInputRef={fileInputRef}
            layoutMode={layoutMode}
            labels={{
              loading: t('loading'),
              noActiveThreadTitle: t('no_active_thread_title'),
              noActiveThreadDescription: t('no_active_thread_description'),
              noActiveThreadHint: t('no_active_thread_hint_create'),
              noEndpointHint: t('no_active_endpoint_hint'),
              selectThreadHint: t('no_active_thread_hint_select'),
              attachmentsDisabledReason: t('attachments.multimodal_required'),
              newThread: t('new_thread'),
              assistant: t('assistant'),
            }}
            onCreateThread={handleCreateThread}
            onRenameActiveSession={handleRenameActiveSession}
            onSelectActiveEndpoint={handleSelectActiveEndpoint}
            onSelectExternalAgent={handleSelectExternalAgent}
            onSelectVariant={handleSelectVariant}
            onEditMessage={handleEditMessage}
            onEditCommit={handleEditCommit}
            onRegenerate={handleRegenerate}
            onComposerChange={(v) => {
              if (!currentSessionId) return;
              setComposerBySession((prev) => ({ ...prev, [currentSessionId]: v }));
            }}
            onSend={handleSend}
            onStop={stopStreaming}
            onPickFiles={handlePickFiles}
            onPickFromLibrary={handlePickFromLibrary}
            onPickUrl={handlePickUrl}
            onFilePicked={onFilePicked}
            onAttachFiles={handleAttachFiles}
            onRemoveAttachment={handleRemoveAttachment}
            onRetryAttachment={handleRetryAttachment}
            onCancelEdit={() => setEditingMessageId(null)}
          />
        </div>
        <ChatDeleteDialog
          open={deleteThreadDialogOpen}
          onOpenChange={setDeleteThreadDialogOpen}
          onConfirm={handleConfirmDeleteThread}
          labels={{
            title: t('delete_confirm_title'),
            message: t('delete_confirm_message', { name: threadToDelete?.title ?? '' }),
            cancel: t('delete_confirm_cancel'),
            confirm: t('delete_confirm_action'),
          }}
        />
        <ChatLibraryPickerDialog
          open={libraryPickerOpen}
          onOpenChange={setLibraryPickerOpen}
          workspaceId={workspaceId}
          projectId={projectId}
          sourcesAPI={sourcesAPI}
          loading={addLibraryAttachmentMutation.isPending}
          onPickObject={handleAddLibraryObject}
        />
        <Dialog open={addUrlOpen} onOpenChange={setAddUrlOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('composer.url_dialog.title')}</DialogTitle>
              <DialogDescription>{t('composer.url_dialog.description')}</DialogDescription>
            </DialogHeader>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t('composer.url_dialog.placeholder')}
              autoFocus
              data-testid="chat__url-input"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddUrlOpen(false)}>
                {t('composer.cancel')}
              </Button>
              <Button
                onClick={handleAddUrlInput}
                disabled={addUrlAttachmentMutation.isPending || !/^https?:\/\//i.test(urlInput.trim())}
                data-testid="chat__url-input-confirm"
              >
                {t('composer.url_dialog.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageLayout>
    </PageState>
  );
}
