/**
 * Chat Page (v1)
 *
 * Two-pane layout:
 * - Left: Threads list
 * - Right: Chat window (header + messages + composer)
 *
 * Style must follow `DESIGN.md` and the active `docs/UXUI/` interaction specs.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api';
import { ChatAPI } from '@/lib/api/endpoints/chat';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import { FilesAPI } from '@/lib/api/endpoints/files';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain } from '@/lib/chat/branch';
import { patchChatMessageInCache, upsertChatMessageInCache } from '@/lib/chat/messages-cache';
import { chatMessagesKey } from '@/lib/chat/query-keys';
import { useChatStreaming } from '@/lib/chat/use-chat-streaming';
import { useChatMutations } from '@/lib/chat/use-chat-mutations';
import { useChatVariants } from '@/lib/chat/use-chat-variants';
import { useChatData } from '@/lib/chat/use-chat-data';
import { useChatComposerActions } from '@/lib/chat/use-chat-composer-actions';
import { buildChatViewModel } from '@/lib/chat/chat-view-model';
import {
  applyChatSessionUpdate,
  type PendingSessionUpdateOptions,
  type ChatSessionUpdateData,
  doesSessionMatchPatch,
  mergeSessionWithPendingUpdate,
} from '@/lib/chat/chat-session-update';
import { useChatMessageActions } from '@/lib/chat/use-chat-message-actions';
import { useChatThreadActions } from '@/lib/chat/use-chat-thread-actions';
import { useChatDeleteDialog } from '@/lib/chat/use-chat-delete-dialog';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';

import { ThreadsPane } from '@/components/chat/ThreadsPane';
import { ChatMainPane } from '@/components/chat/ChatMainPane';
import { PageLayout } from '@/components/layout/PageLayout';
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
  const pendingSessionUpdateRef = useRef<Record<string, ChatSessionUpdateData>>({});
  const [pendingSessionUpdateBySession, setPendingSessionUpdateBySession] =
    useState<Record<string, ChatSessionUpdateData>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const { layoutMode } = useProjectLayoutMode();

  const apiClient = useMemo(() => getApiClient(), []);
  const chatAPI = useMemo(() => new ChatAPI(apiClient), [apiClient]);
  const endpointAPI = useMemo(() => new EndpointAPI(apiClient), [apiClient]);
  const sourcesAPI = useMemo(() => new FilesAPI(apiClient), [apiClient]);

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
    if (sessions.length === 0) {
      if (currentSessionId !== null) setCurrentSessionId(null);
      return;
    }
    const hasCurrent = currentSessionId ? sessions.some((session) => session.id === currentSessionId) : false;
    if (!hasCurrent) setCurrentSessionId(sessions[0].id);
  }, [currentSessionId, sessions]);

  const setPendingSessionUpdate = useCallback((
    sessionId: string,
    patch: ChatSessionUpdateData | null,
    options?: PendingSessionUpdateOptions,
  ) => {
    if (patch) {
      const next = {
        ...pendingSessionUpdateRef.current,
        [sessionId]: patch,
      };
      pendingSessionUpdateRef.current = next;
      setPendingSessionUpdateBySession(next);
      return;
    }

    const currentPatch = pendingSessionUpdateRef.current[sessionId];
    if (!currentPatch) {
      return;
    }

    if (options?.onlyIfCurrentPatch && currentPatch !== options.onlyIfCurrentPatch) {
      return;
    }

    const { [sessionId]: _removed, ...rest } = pendingSessionUpdateRef.current;
    pendingSessionUpdateRef.current = rest;
    setPendingSessionUpdateBySession(rest);
  }, []);

  useEffect(() => {
    let changed = false;
    const nextPending: Record<string, ChatSessionUpdateData> = {};

    for (const [sessionId, patch] of Object.entries(pendingSessionUpdateRef.current)) {
      const session = sessions.find((candidate) => candidate.id === sessionId) ?? null;
      if (!session) {
        changed = true;
        continue;
      }
      if (!doesSessionMatchPatch(session, patch)) {
        nextPending[sessionId] = patch;
        continue;
      }
      changed = true;
    }

    if (!changed) return;

    pendingSessionUpdateRef.current = nextPending;
    setPendingSessionUpdateBySession(nextPending);
  }, [sessions]);

  const resolveSessionWithPendingUpdate = useCallback((
    sessionId: string | null,
    fallbackSession: ChatSession | null = null,
  ): ChatSession | null => {
    if (!sessionId) return null;
    const baseSession = sessions.find((session) => session.id === sessionId) ?? fallbackSession;
    return mergeSessionWithPendingUpdate(baseSession, pendingSessionUpdateRef.current[sessionId]);
  }, [sessions]);

  const rawActiveSession = sessions.find((session) => session.id === currentSessionId) ?? null;
  const activeSession = useMemo(
    () => mergeSessionWithPendingUpdate(
      rawActiveSession,
      currentSessionId ? pendingSessionUpdateBySession[currentSessionId] : undefined,
    ),
    [currentSessionId, pendingSessionUpdateBySession, rawActiveSession],
  );
  const activeEndpoint = useMemo(() => {
    if (!activeSession) return null;
    return endpoints.find((endpoint) => endpoint.id === activeSession.endpoint_id) ?? null;
  }, [activeSession, endpoints]);
  const canAttachFiles = useMemo(() => {
    if (!activeEndpoint) return false;
    return (
      activeEndpoint.capabilities?.some(
        (capability) => capability.type === 'multimodal_completion' && capability.enabled,
      ) ?? false
    );
  }, [activeEndpoint]);
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

  const updateSession = useCallback(async (input: {
    sessionId: string;
    data: ChatSessionUpdateData;
  }) => {
    await applyChatSessionUpdate({
      input,
      mutateAsync: (nextInput) => updateSessionMutation.mutateAsync(nextInput),
      setPendingSessionUpdate,
    });
  }, [setPendingSessionUpdate, updateSessionMutation]);

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
      streamErrorProviderUnavailable: t('stream_error_provider_unavailable'),
      streamErrorProviderTimeout: t('stream_error_provider_timeout'),
      streamErrorProviderProtocol: t('stream_error_provider_protocol'),
      streamErrorProviderUpstream: t('stream_error_provider_upstream'),
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
  const visibleMessages = useMemo<ChatMessage[]>(() => {
    if (messages.length === 0) return [];
    const groups = buildVariantGroups(messages);
    return buildVisibleChain(messages, groups, activeVariantIndexByGroup).chain;
  }, [messages, activeVariantIndexByGroup]);

  const {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorCode,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  } = buildChatViewModel({
    currentSessionId,
    activeSession,
    sessions,
    messages,
    visibleMessages,
    streamStateBySession,
  });

  const visibleLeafId = visibleMessages[visibleMessages.length - 1]?.id ?? null;

  const { handleSend, onPickFiles, onFilePicked, onAttachFiles } = useChatComposerActions({
    canUseChat,
    disabled,
    currentSessionId,
    activeSession,
    resolveSessionForSend: (sessionId) => resolveSessionWithPendingUpdate(
      sessionId,
      sessionId === currentSessionId ? activeSession : null,
    ),
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
  } = useChatThreadActions({
    canUseChat,
    canManageChatSessions,
    canChangeModel: !disabled,
    sessions,
    activeSession,
    createSession: () => createSessionMutation.mutate(),
    updateSession,
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
        <div
          className={cn(
            'flex h-full min-h-0 flex-1 overflow-hidden rounded-xl border border-subtle bg-surface/90',
          )}
          data-testid="chat__surface"
        >
          <div className="flex h-full min-h-0 flex-1 overflow-hidden">
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
              messages={messages}
              messagesLoading={messagesLoading}
              attachments={attachments}
              activeVariantIndexByGroup={activeVariantIndexByGroup}
              editingMessageId={editingMessageId}
              disabled={disabled}
              activeStreamStatus={activeStreamStatus}
              activeStreamingAssistant={activeStreamingAssistant}
              activeStreamErrorCode={activeStreamErrorCode}
              activeStreamErrorMessage={activeStreamErrorMessage}
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
                noEndpointRecoveryTitle: t('no_active_endpoint_recovery_title'),
                noEndpointRecoveryDescription: t('no_active_endpoint_recovery_description'),
                noEndpointRecoveryHint: t('no_active_endpoint_recovery_hint'),
                streamErrorRecoveryCapacityTitle: t('stream_error_recovery_capacity_title'),
                streamErrorRecoveryCapacityDescription: t('stream_error_recovery_capacity_description'),
                streamErrorRecoveryUpstreamTitle: t('stream_error_recovery_upstream_title'),
                streamErrorRecoveryUpstreamDescription: t('stream_error_recovery_upstream_description'),
                streamErrorRecoveryMessageLabel: t('stream_error_recovery_message_label'),
                streamErrorRecoverySameThreadHint: t('stream_error_recovery_same_thread_hint'),
                streamErrorRecoveryEndpointHint: t('stream_error_recovery_endpoint_hint'),
                selectThreadHint: t('no_active_thread_hint_select'),
                attachmentsDisabledReason: t('attachments.multimodal_required'),
                newThread: t('new_thread'),
                assistant: t('assistant'),
              }}
              onCreateThread={handleCreateThread}
              onRenameActiveSession={handleRenameActiveSession}
              onSelectActiveEndpoint={handleSelectActiveEndpoint}
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
