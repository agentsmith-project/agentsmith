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

import { ThreadsPane } from '@/components/chat/ThreadsPane';
import { ChatMainPane } from '@/components/chat/ChatMainPane';
import { PageLayout } from '@/components/layout/PageLayout';
import { ProjectWorkbenchBar } from '@/components/layout/ProjectWorkbenchBar';
import { PageState } from '@/components/layout/PageState';
import { useCanAccessChat } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { cn } from '@/lib/utils';
import { ChatDialogs } from './_components/ChatDialogs';
import {
  ChatPageLoadingState,
  ChatPagePermissionErrorState,
  ChatPageValidationErrorState,
} from './_components/ChatPageState';
import { useChatAttachmentActions } from './useChatAttachmentActions';

interface ChatPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('chat');
  const tErrors = useTranslations('errors');

  const token = useAuthStore((s) => s.token);
  const resolvedParams = useResolvedProjectRoute(params);
  const canAccessChat = useCanAccessChat();
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
          && agent.interaction_kind === 'chat',
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
      streamWarningSessionWorkspaceRecreated: t('stream_warning_session_workspace_recreated'),
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

  const {
    handleAddLibraryObject,
    handleAddUrlInput,
    handleAttachFiles,
    handlePickFiles,
    handlePickFromLibrary,
    handlePickUrl,
    handleRemoveAttachment,
    handleRetryAttachment,
  } = useChatAttachmentActions({
    addLibraryAttachment: (input) => addLibraryAttachmentMutation.mutate(input),
    addUrlAttachment: (input, options) => addUrlAttachmentMutation.mutate(input, options),
    canAttachFiles,
    canUseChat,
    currentSessionId,
    deleteAttachment: (input) => deleteAttachmentMutation.mutate(input),
    editingMessageId,
    onAttachFiles,
    onPickFiles,
    retryAttachment: (input) => retryAttachmentMutation.mutate(input),
    setAddUrlOpen,
    setLibraryPickerOpen,
    setUrlInput,
    t,
    urlInput,
  });

  if (!resolvedParams || !resolvedParams.isReady) {
    return <ChatPageLoadingState message={t('loading')} />;
  }

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
    return (
      <ChatPageValidationErrorState
        title={tErrors('validation_error')}
        description={tErrors('badRequest.description')}
      />
    );
  }

  if (!canReadThreads) {
    return (
      <ChatPagePermissionErrorState
        title={tErrors('permission_denied_title')}
        description={tErrors('permission_denied_hint')}
      />
    );
  }

  const composerValue = currentSessionId ? composerBySession[currentSessionId] || '' : '';
  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
      >
        <div className="flex h-full min-h-0 flex-col gap-4">
          <ProjectWorkbenchBar
            title={t('title')}
            meta={(
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
                <span className="font-medium text-foreground">{activeSession?.title ?? t('new_thread')}</span>
                <span className="text-tertiary">{t('threads_title')} {sessions.length}</span>
                {activeEndpoint ? <span className="truncate text-tertiary">{activeEndpoint.name}</span> : null}
              </div>
            )}
          />

          <div
            className={cn(
              'h-full min-h-0 flex overflow-hidden rounded-[22px] border border-subtle bg-panel/40 shadow-[0_18px_40px_rgba(0,0,0,0.16)]',
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
        </div>
        <ChatDialogs
          addLibraryAttachmentPending={addLibraryAttachmentMutation.isPending}
          addUrlOpen={addUrlOpen}
          addUrlPending={addUrlAttachmentMutation.isPending}
          deleteThreadDialogOpen={deleteThreadDialogOpen}
          libraryPickerOpen={libraryPickerOpen}
          localeLabels={{
            title: t('delete_confirm_title'),
            message: t('delete_confirm_message', { name: threadToDelete?.title ?? '' }),
            cancel: t('delete_confirm_cancel'),
            confirm: t('delete_confirm_action'),
          }}
          projectId={projectId}
          sourcesAPI={sourcesAPI}
          t={t}
          urlInput={urlInput}
          workspaceId={workspaceId}
          onConfirmDeleteThread={handleConfirmDeleteThread}
          onLibraryPickerOpenChange={setLibraryPickerOpen}
          onOpenAddUrlChange={setAddUrlOpen}
          onOpenDeleteThreadChange={setDeleteThreadDialogOpen}
          onPickLibraryObject={handleAddLibraryObject}
          onSubmitUrl={handleAddUrlInput}
          onUrlInputChange={setUrlInput}
        />
      </PageLayout>
    </PageState>
  );
}
