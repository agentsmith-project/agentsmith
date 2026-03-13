'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { TaskHeader } from './TaskHeader';
import { useTask, useTaskMessages, useTaskArtifacts, useSendMessage, useAddFiles, useUpdateTask } from '@/lib/hooks/use-task';
import { useTaskSSE } from '@/lib/hooks/use-task-sse';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';
import { TaskAPI, FilesAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import type { Artifact, TaskMessage } from '@/lib/types/task';
import { useRouter, useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { buildAgentDiagnosticsLink, buildBuildDiagnosticsOpsQuery } from '@/lib/build-diagnostics-context';
import { AgentAPI } from '@/lib/api/endpoints/agents';
import { ApiError } from '@/lib/api/client';
import { toast } from '@/components/ui/toast';
import {
  collectRecentRunActions,
  createPendingMessage,
  deriveRunAction,
} from '@/components/notebook/task-page/run-activity';
import { TaskPageContent } from '@/components/notebook/task-page/TaskPageContent';
import { TaskPageDialogs } from '@/components/notebook/task-page/TaskPageDialogs';
import { TaskPageLoadingState, TaskPageNotFoundState } from '@/components/notebook/task-page/TaskPageStates';
import { useTaskTraceState } from '@/components/notebook/task-page/useTaskTraceState';
import { useTaskInputActions } from '@/components/notebook/task-page/useTaskInputActions';

export interface TaskPageProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canCreateTask: boolean;
  canUpdateTask: boolean;
  canDeleteTask: boolean;
  diagnosticsBasePath?: string;
}

export function TaskPage({
  workspaceId,
  projectId,
  taskId,
  canCreateTask,
  canUpdateTask,
  canDeleteTask,
  diagnosticsBasePath,
}: TaskPageProps) {
  type PendingMessage = ReturnType<typeof createPendingMessage>;
  const t = useTranslations('notebook.attached_files.url_dialog');
  const tTask = useTranslations('notebook.task');
  const tConversation = useTranslations('notebook.conversation');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const basePath = diagnosticsBasePath ?? `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [streamingContent, setStreamingContent] = React.useState<string>('');
  const [isAgentTurnRunning, setIsAgentTurnRunning] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [lastRunActionSummary, setLastRunActionSummary] = React.useState<string | null>(null);
  const [runClockNow, setRunClockNow] = React.useState<number>(Date.now());
  const [pendingMessages, setPendingMessages] = React.useState<PendingMessage[]>([]);
  const [_taskUpdateCountForCurrentTurn, setTaskUpdateCountForCurrentTurn] = React.useState(0);
  const [realtimeFailureCode, setRealtimeFailureCode] = React.useState<string | null>(null);
  const [realtimeFailureMessage, setRealtimeFailureMessage] = React.useState<string | null>(null);

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const filesAPI = React.useMemo(() => new FilesAPI(getApiClient()), []);
  const taskAPI = React.useMemo(() => new TaskAPI(getApiClient()), []);
  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);
  const pendingFlushInFlightRef = React.useRef(false);
  const { data: task, isLoading: taskLoading } = useTask(workspaceId, projectId, taskId);
  const { data: taskAgent } = useQuery({
    queryKey: ['task-agent', workspaceId, projectId, task?.agent_id],
    queryFn: () => agentAPI.get(workspaceId, projectId, task?.agent_id ?? ''),
    enabled: !!task?.agent_id,
    staleTime: 10_000,
    retry: false,
  });
  const { data: messages } = useTaskMessages(workspaceId, projectId, taskId);
  const { data: artifacts } = useTaskArtifacts(workspaceId, projectId, taskId);
  const sendMessage = useSendMessage();
  const addFiles = useAddFiles();
  const updateTask = useUpdateTask();
  const cancelActiveRun = useMutation({
    mutationFn: () => taskAPI.cancelRun(workspaceId, projectId, taskId),
    onSuccess: () => {
      setLastRunActionSummary(tConversation('run_cancel_requested'));
      toast.info(tConversation('run_cancel_requested'));
    },
    onError: (err) => {
      handleError(err, { logContext: 'TaskPage.cancelActiveRun', showToast: true });
    },
  });

  // Query keys for this task — used by both useQuery hooks and SSE cache writes
  const messagesKey = queryKeys.tasks.messages(workspaceId, projectId, taskId);
  const artifactsKey = queryKeys.tasks.artifacts(workspaceId, projectId, taskId);
  const taskDetailKey = queryKeys.tasks.detail(workspaceId, projectId, taskId);
  const diagnosticsQuery = buildBuildDiagnosticsOpsQuery();
  // Diagnostics jump to the unified audit surface.
  const notebookDiagnosticsLinks = React.useMemo(() => ({
    audit: `${basePath}/audit${diagnosticsQuery}`,
    usage: `${basePath}/usage${diagnosticsQuery}`,
    agent: buildAgentDiagnosticsLink(basePath, task?.agent_id ?? null),
  }), [basePath, diagnosticsQuery, task?.agent_id]);

  const resetCurrentRunUiState = React.useCallback(() => {
    setStreamingMessageId(null);
    setStreamingContent('');
    setIsAgentTurnRunning(false);
    setRunStartedAt(null);
    setRunClockNow(Date.now());
    setLastRunActionSummary(null);
  }, []);

  const activeTraceMessageId = React.useMemo(() => {
    if (streamingMessageId) return streamingMessageId;
    const latestAgentMessage = [...(messages ?? [])].reverse().find((message) => message.role === 'agent');
    return latestAgentMessage?.id ?? null;
  }, [messages, streamingMessageId]);

  const {
    showExecutionDetails,
    setShowExecutionDetails,
    traceFocusMessageId,
    setTraceFocusMessageId,
    traceFocusName,
    setTraceFocusName,
    traceFocusToken,
    setTraceFocusToken,
    traceEventsByMessageId,
    traceLoadingByMessageId,
    traceLoadMoreLoadingByMessageId,
    traceErrorByMessageId,
    sseDebugEvents,
    setTraceBackfillRefreshNonce,
    lastTraceEventIdRef,
    traceBackfillRequestedMessageIdsRef,
    mergeTraceEvents,
    appendSseDebugEvent,
    fetchTracesForMessage,
    loadMoreTracesForMessage,
    resetTraceBackfillState,
    traceHasMoreByMessageId,
  } = useTaskTraceState({
    workspaceId,
    projectId,
    taskId,
    messages,
    taskAPI,
    handleError,
  });

  const {
    fileSelectOpen,
    setFileSelectOpen,
    imageViewerOpen,
    setImageViewerOpen,
    saveDialogOpen,
    setSaveDialogOpen,
    addUrlOpen,
    setAddUrlOpen,
    urlInput,
    setUrlInput,
    addingInput,
    selectedArtifact,
    localFileInputRef,
    handleAddFiles,
    handleAttachArtifactAsInput,
    handleLocalInputChange,
    handleSubmitUrlInput,
    handleViewArtifact,
    handleSaveArtifact,
    handleDownloadArtifact,
    handleSaveArtifactToLibrary,
  } = useTaskInputActions({
    workspaceId,
    projectId,
    taskId,
    filesAPI,
    taskAPI,
    queryClient,
    addFiles,
    handleError,
  });

  React.useEffect(() => {
    if (!(sendMessage.isPending || isAgentTurnRunning)) return;
    const timer = setInterval(() => {
      setRunClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isAgentTurnRunning, sendMessage.isPending]);

  // SSE connection for real-time updates
  const isDev = process.env.NODE_ENV === 'development';
  const showSseDebugPanel = isDev && process.env.NEXT_PUBLIC_NOTEBOOK_SSE_DEBUG_PANEL === '1';
  const { connectionStatus, connectionErrorCode, connectionErrorMessage } = useTaskSSE(workspaceId, projectId, taskId, {
    onMessage: (message: TaskMessage) => {
      // Update streaming content for the active streaming message
      if (streamingMessageId === message.id) {
        setStreamingContent(message.content);
      }

      queryClient.setQueryData(
        messagesKey,
        (old: TaskMessage[] | undefined) => {
          if (!old) return [message];
          if (old.some((m) => m.id === message.id)) {
            return old.map((m) => (m.id === message.id ? message : m));
          }
          return [...old, message];
        },
      );
    },
    onArtifact: (artifact: Artifact) => {
      queryClient.setQueryData(
        artifactsKey,
        (old: Artifact[] | undefined) => {
          if (!old) return [artifact];
          if (old.some((a) => a.id === artifact.id)) {
            return old.map((a) => (a.id === artifact.id ? artifact : a));
          }
          return [...old, artifact];
        },
      );
    },
    onTaskUpdate: (updatedTask) => {
      queryClient.setQueryData(taskDetailKey, updatedTask);
    },
    onTraceEvent: (traceEvent) => {
      setLastRunActionSummary(traceEvent.summary || traceEvent.name);
      mergeTraceEvents([traceEvent]);
      if (
        streamingMessageId === traceEvent.message_id
        && (
          (traceEvent.name === 'run.lifecycle'
            && traceEvent.phase === 'end'
            && (traceEvent.status === 'success' || traceEvent.status === 'error' || traceEvent.status === 'cancelled'))
          || (traceEvent.name === 'run.summary' && traceEvent.phase === 'end')
        )
      ) {
        setTaskUpdateCountForCurrentTurn(0);
        resetCurrentRunUiState();
      }
    },
    onError: (error) => {
      setTaskUpdateCountForCurrentTurn(0);
      resetCurrentRunUiState();
      setRealtimeFailureCode(
        typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null,
      );
      setRealtimeFailureMessage(error.message);
    },
    onDebug: (event) => appendSseDebugEvent(event, activeTraceMessageId),
    enabled: !!taskId && !taskLoading,
  });

  const previousConnectionStatusRef = React.useRef<typeof connectionStatus | null>(null);
  React.useEffect(() => {
    if (connectionErrorCode || connectionErrorMessage) {
      setRealtimeFailureCode(connectionErrorCode ?? null);
      setRealtimeFailureMessage(connectionErrorMessage ?? null);
    } else if (connectionStatus === 'connected') {
      setRealtimeFailureCode(null);
      setRealtimeFailureMessage(null);
    }
  }, [connectionErrorCode, connectionErrorMessage, connectionStatus]);

  React.useEffect(() => {
    const prev = previousConnectionStatusRef.current;
    previousConnectionStatusRef.current = connectionStatus;
    if (!connectionStatus) return;
    if (connectionStatus !== 'connected') return;
    if (prev === 'reconnecting' || prev === 'error' || prev === 'disconnected') {
      const afterId = lastTraceEventIdRef.current;
      if (!afterId) {
        appendSseDebugEvent({
          at: new Date().toISOString(),
          phase: 'trace_reconcile_start',
          summary: 'mode=refetch after_id=none',
        });
        resetTraceBackfillState();
        return;
      }
      // Refill only missing trace tail after reconnect to reduce payload size for long tasks.
      appendSseDebugEvent({
        at: new Date().toISOString(),
        phase: 'trace_reconcile_start',
        summary: `mode=after_id after_id=${afterId}`,
      });
      void taskAPI.listTraces(workspaceId, projectId, taskId, {
        after_id: afterId,
        page_size: 500,
      }).then((resp) => {
        setRealtimeFailureCode(null);
        setRealtimeFailureMessage(null);
        appendSseDebugEvent({
          at: new Date().toISOString(),
          phase: 'trace_reconcile_done',
          summary: `items=${resp.items.length}`,
        });
        mergeTraceEvents(resp.items);
      }).catch((err) => {
        setRealtimeFailureCode('TRACE_RECONCILE_FAILED');
        setRealtimeFailureMessage(err instanceof Error ? err.message : 'Task trace reconcile failed.');
        appendSseDebugEvent({
          at: new Date().toISOString(),
          phase: 'trace_reconcile_error',
          summary: 'task_traces_reconcile_failed',
        });
        handleError(err, { logContext: 'TaskPage.traceGapFill' });
      });
    }
  }, [appendSseDebugEvent, connectionStatus, handleError, mergeTraceEvents, projectId, resetTraceBackfillState, taskAPI, taskId, workspaceId]);

  const enqueuePendingMessage = React.useCallback((content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    setPendingMessages((prev) => [...prev, createPendingMessage(normalized)]);
  }, []);

  const sendMessageNow = React.useCallback(async (content: string, source: 'direct' | 'queue') => {
    if (taskAgent?.mode === 'external' && taskAgent.presence !== 'online') {
      setRealtimeFailureCode('AGENT_OFFLINE');
      setRealtimeFailureMessage(tConversation('agent_offline'));
      toast.error(tConversation('agent_offline_send_blocked'));
      return;
    }
    try {
      // Clear previous streaming state
      setStreamingMessageId(null);
      setStreamingContent('');
      setIsAgentTurnRunning(false);
      setRunStartedAt(null);
      setRunClockNow(Date.now());
      setLastRunActionSummary(null);
      setTaskUpdateCountForCurrentTurn(0);

      // Send message and get response
      const response = await sendMessage.mutateAsync({
        workspaceId,
        projectId,
        taskId,
        data: {
          task_id: taskId,
          content,
        },
      });

      // If response indicates streaming, set up streaming state
      // The actual streaming content will come through SSE
      if (response.role === 'agent') {
        setStreamingMessageId(response.id);
        setStreamingContent('');
        setIsAgentTurnRunning(true);
        setRunStartedAt(Date.now());
        setRunClockNow(Date.now());
        setLastRunActionSummary(tConversation('run_active_default_action'));
        setTaskUpdateCountForCurrentTurn(0);
      }
    } catch (err) {
      setIsAgentTurnRunning(false);
      setRunStartedAt(null);
      setRunClockNow(Date.now());
      setLastRunActionSummary(null);
      setTaskUpdateCountForCurrentTurn(0);
      if (err instanceof ApiError) {
        const errorCode = err.errorCode?.toUpperCase();
        if (errorCode === 'TASK_STREAM_CONFLICT') {
          if (source === 'queue') {
            setPendingMessages((prev) => [createPendingMessage(content), ...prev]);
          } else {
            enqueuePendingMessage(content);
            toast.info(tConversation('pending_enqueued'));
          }
          return;
        }
        if (
          err.statusCode === 429
          || errorCode === 'RATE_LIMIT_EXCEEDED'
          || errorCode === 'RESOURCE_POLICY_RATE_LIMITED'
          || errorCode === 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED'
        ) {
          toast.error(
            `${tConversation('send_rate_limited_title')}: ${tConversation('send_rate_limited_description')}`,
          );
          return;
        }
        if (errorCode === 'AGENT_OFFLINE') {
          toast.error(tConversation('agent_offline_send_blocked'));
          return;
        }
      }
      handleError(err, { logContext: 'TaskPage.sendMessage', showToast: true });
    }
  }, [
    enqueuePendingMessage,
    handleError,
    projectId,
    sendMessage,
    tConversation,
    taskAgent?.mode,
    taskAgent?.presence,
    taskId,
    workspaceId,
  ]);

  const handleSendMessage = async (content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    if (isAgentTurnRunning || sendMessage.isPending) {
      enqueuePendingMessage(normalized);
      toast.info(tConversation('pending_enqueued'));
      return;
    }
    await sendMessageNow(normalized, 'direct');
  };

  const handlePendingUpdate = React.useCallback((id: string, content: string) => {
    setPendingMessages((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)));
  }, []);

  const handlePendingRemove = React.useCallback((id: string) => {
    setPendingMessages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const backendRunActive = task?.run_state === 'running';

  const handleCancelActiveRun = React.useCallback(() => {
    if (!(isAgentTurnRunning || sendMessage.isPending || backendRunActive)) return;
    if (cancelActiveRun.isPending) return;
    void cancelActiveRun.mutateAsync();
  }, [backendRunActive, cancelActiveRun, isAgentTurnRunning, sendMessage.isPending]);

  // Keep local streaming state consistent with backend authoritative run_state.
  React.useEffect(() => {
    if (task?.run_state !== 'idle') return;
    if (sendMessage.isPending || cancelActiveRun.isPending) return;
    if (!isAgentTurnRunning && !streamingMessageId && !streamingContent) return;
    resetCurrentRunUiState();
  }, [
    cancelActiveRun.isPending,
    isAgentTurnRunning,
    resetCurrentRunUiState,
    sendMessage.isPending,
    streamingContent,
    streamingMessageId,
    task?.run_state,
  ]);

  React.useEffect(() => {
    const isAgentUnavailable = taskAgent?.mode === 'external' && taskAgent.presence !== 'online';
    const taskArchived = task?.status === 'archived';
    if (isAgentUnavailable || taskArchived || !canUpdateTask) return;
    if (isAgentTurnRunning || sendMessage.isPending) return;
    if (pendingFlushInFlightRef.current) return;
    const next = pendingMessages[0];
    if (!next) return;
    const content = next.content.trim();
    setPendingMessages((prev) => prev.slice(1));
    if (!content) return;
    pendingFlushInFlightRef.current = true;
    void sendMessageNow(content, 'queue').finally(() => {
      pendingFlushInFlightRef.current = false;
    });
  }, [
    canUpdateTask,
    isAgentTurnRunning,
    pendingMessages,
    sendMessage.isPending,
    sendMessageNow,
    task?.status,
    taskAgent?.mode,
    taskAgent?.presence,
  ]);

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
  };

  const handleTaskCreated = (newTaskId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${newTaskId}`);
  };

  const handleTaskDeleted = () => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  };

  const handleTaskUpdated = async (data: { title: string }) => {
    await updateTask.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      data,
    });
  };

  const handleLeave = () => {
    // Navigate to notebook list
    // SSE connection will be automatically cleaned up when component unmounts
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  };

  if (taskLoading) {
    return <TaskPageLoadingState text={tTask('loading')} />;
  }

  if (!task) {
    return (
      <TaskPageNotFoundState
        title={tTask('not_found_title')}
        description={tTask('not_found_description')}
        backLabel={tTask('back_to_notebook')}
        onBack={() => router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`)}
      />
    );
  }

  const isDisabled = task.status === 'archived';
  const isExternalAgentOffline = taskAgent?.mode === 'external' && taskAgent.presence !== 'online';
  const agentIsBusy = sendMessage.isPending || isAgentTurnRunning || backendRunActive;
  const fallbackRunStartedAt = backendRunActive
    ? (() => {
        const parsed = Date.parse(task.last_activity_at);
        return Number.isFinite(parsed) ? parsed : Date.now();
      })()
    : null;
  const effectiveRunStartedAt = runStartedAt ?? fallbackRunStartedAt;
  const runElapsedSeconds = effectiveRunStartedAt
    ? Math.max(0, Math.floor((runClockNow - effectiveRunStartedAt) / 1000))
    : 0;
  const activeTraceEvents = streamingMessageId ? (traceEventsByMessageId[streamingMessageId] ?? []) : [];
  const runActionFallbackSummary = lastRunActionSummary || tConversation('run_active_default_action');
  const sortedActions = [...activeTraceEvents].sort((a, b) => (a.seq !== b.seq ? b.seq - a.seq : b.at.localeCompare(a.at)));
  const latestRunAction = deriveRunAction({
    event: sortedActions.find((evt) => evt.name !== 'run.summary') ?? sortedActions[0],
    fallbackSummary: runActionFallbackSummary,
  });
  const recentRunActions = collectRecentRunActions({
    sortedActions,
    fallbackSummary: runActionFallbackSummary,
    now: Date.now(),
  });
  const showSandboxStarting = isAgentTurnRunning
    && activeTraceEvents.some((item) => item.name === 'sandbox_starting')
    && (streamingContent ?? '').trim().length === 0
    && !activeTraceEvents.some((item) => item.status === 'success' || item.status === 'error' || item.status === 'cancelled');
  const isConversationInputDisabled = isDisabled || !canUpdateTask || isExternalAgentOffline;

  return (
    <div className="h-full flex flex-col">
      <TaskHeader
        task={task}
        workspaceId={workspaceId}
        projectId={projectId}
        agentPresence={taskAgent?.presence ?? null}
        agentRunActivity={{ active: agentIsBusy, elapsedSeconds: runElapsedSeconds }}
        canDeleteTask={canDeleteTask}
        onCreateNew={canCreateTask ? handleCreateNew : undefined}
        onEdit={canUpdateTask ? () => setEditDialogOpen(true) : undefined}
        onDeleted={handleTaskDeleted}
        onLeave={handleLeave}
      />
      <TaskPageContent
        addingInput={addingInput}
        agentIsBusy={agentIsBusy}
        artifacts={artifacts || []}
        canUpdateTask={canUpdateTask}
        connectionErrorCode={realtimeFailureCode}
        connectionErrorMessage={realtimeFailureMessage}
        connectionStatus={connectionStatus}
        diagnosticsLinks={notebookDiagnosticsLinks}
        disabled={isConversationInputDisabled}
        fetchTracesForMessage={fetchTracesForMessage}
        focusTraceMessageId={traceFocusMessageId}
        focusTraceName={traceFocusName}
        focusTraceToken={traceFocusToken}
        handleAttachArtifactAsInput={canUpdateTask && !isDisabled ? handleAttachArtifactAsInput : undefined}
        handleCancelActiveRun={handleCancelActiveRun}
        handleDownloadArtifact={handleDownloadArtifact}
        handlePendingRemove={handlePendingRemove}
        handlePendingUpdate={handlePendingUpdate}
        handleSaveArtifact={handleSaveArtifact}
        handleSendMessage={handleSendMessage}
        handleViewArtifact={handleViewArtifact}
        isDisabled={isDisabled}
        loadMoreTracesForMessage={loadMoreTracesForMessage}
        localFileInputRef={localFileInputRef}
        messages={messages || []}
        onRunActionClick={(action) => {
          if (!action.traceName || !activeTraceMessageId) return;
          setShowExecutionDetails(true);
          setTraceFocusMessageId(activeTraceMessageId);
          setTraceFocusName(action.traceName);
          setTraceFocusToken((prev) => prev + 1);
        }}
        onSetAddUrlOpen={setAddUrlOpen}
        onSetFileSelectOpen={setFileSelectOpen}
        onToggleExecutionDetails={() => setShowExecutionDetails((prev) => !prev)}
        pendingMessages={pendingMessages}
        projectId={projectId}
        runActivity={{
          active: agentIsBusy,
          elapsedSeconds: runElapsedSeconds,
          cancelling: cancelActiveRun.isPending,
          lastSummary: latestRunAction.summary,
          lastKind: latestRunAction.kind,
          recentActions: recentRunActions,
        }}
        sandboxStarting={showSandboxStarting}
        sending={sendMessage.isPending}
        showExecutionDetails={showExecutionDetails}
        showSseDebugPanel={showSseDebugPanel}
        sseDebugEvents={sseDebugEvents}
        streamingContent={streamingContent}
        streamingMessageId={streamingMessageId}
        taskAttachedInputIds={task.attached_inputs.map((item) => item.id)}
        taskId={taskId}
        traceErrorByMessageId={traceErrorByMessageId}
        traceEventsByMessageId={traceEventsByMessageId}
        traceHasMoreByMessageId={traceHasMoreByMessageId}
        traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
        traceLoadingByMessageId={traceLoadingByMessageId}
        workspaceId={workspaceId}
      />

      <TaskPageDialogs
        addUrlOpen={addUrlOpen}
        addingInput={addingInput}
        canCreateTask={canCreateTask}
        canUpdateTask={canUpdateTask}
        createDialogOpen={createDialogOpen}
        editDialogOpen={editDialogOpen}
        fileSelectOpen={fileSelectOpen}
        imageViewerOpen={imageViewerOpen}
        localFileInputRef={localFileInputRef}
        projectId={projectId}
        saveDialogOpen={saveDialogOpen}
        savingTask={updateTask.isPending}
        selectedArtifact={selectedArtifact}
        t={t}
        tCommon={tCommon}
        task={task}
        urlInput={urlInput}
        workspaceId={workspaceId}
        onAddFilesConfirm={handleAddFiles}
        onArtifactDownload={handleDownloadArtifact}
        onArtifactSaveToLibrary={handleSaveArtifactToLibrary}
        onEditDialogOpenChange={setEditDialogOpen}
        onFileSelectOpenChange={setFileSelectOpen}
        onHandleTaskUpdated={handleTaskUpdated}
        onImageViewerOpenChange={setImageViewerOpen}
        onLocalInputChange={handleLocalInputChange}
        onSaveDialogOpenChange={setSaveDialogOpen}
        onSetAddUrlOpen={setAddUrlOpen}
        onSetCreateDialogOpen={setCreateDialogOpen}
        onSetUrlInput={setUrlInput}
        onSubmitUrlInput={handleSubmitUrlInput}
        onTaskCreated={handleTaskCreated}
      />
    </div>
  );
}
