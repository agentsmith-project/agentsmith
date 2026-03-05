'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { TaskHeader } from './TaskHeader';
import { AttachedFilesPanel } from './AttachedFilesPanel';
import { ConversationPanel } from './ConversationPanel';
import { NotebookSseDebugPanel } from './NotebookSseDebugPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { FileSelectDialog } from './FileSelectDialog';
import { ArtifactImageViewer } from './ArtifactImageViewer';
import { ArtifactSaveDialog } from './ArtifactSaveDialog';
import { TaskCreateDialog } from './TaskCreateDialog';
import { EditTaskDialog } from './EditTaskDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTask, useTaskMessages, useTaskArtifacts, useSendMessage, useAddFiles, useUpdateTask } from '@/lib/hooks/use-task';
import { useTaskSSE } from '@/lib/hooks/use-task-sse';
import type { TaskSSEDebugEvent } from '@/lib/hooks/use-task-sse';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';
import { TaskAPI, FilesAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import type { Artifact, TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { mapTraceHasMoreByMessageId, pruneTaskTraceMeta, upsertTaskTraceMeta, type TaskTraceMetaByMessageId } from '@/lib/utils/task-trace-meta';
import { ensureDefaultUploadLibrary } from '@/lib/files/default-library';
import { classifyNotebookTraceFailure, type NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { buildAgentDiagnosticsLink, buildBuildDiagnosticsOpsQuery } from '@/lib/build-diagnostics-context';
import { AgentAPI } from '@/lib/api/endpoints/agents';
import { ApiError } from '@/lib/api/client';
import { toast } from '@/components/ui/toast';

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
  type PendingMessage = { id: string; content: string; createdAt: string };
  const t = useTranslations('notebook.attached_files.url_dialog');
  const tTask = useTranslations('notebook.task');
  const tConversation = useTranslations('notebook.conversation');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const basePath = diagnosticsBasePath ?? `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const [fileSelectOpen, setFileSelectOpen] = React.useState(false);
  const [imageViewerOpen, setImageViewerOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [addUrlOpen, setAddUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');
  const [addingInput, setAddingInput] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [streamingContent, setStreamingContent] = React.useState<string>('');
  const [isAgentTurnRunning, setIsAgentTurnRunning] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [lastRunActionSummary, setLastRunActionSummary] = React.useState<string | null>(null);
  const [runClockNow, setRunClockNow] = React.useState<number>(Date.now());
  const [showExecutionDetails, setShowExecutionDetails] = React.useState(false);
  const [traceFocusMessageId, setTraceFocusMessageId] = React.useState<string | null>(null);
  const [traceFocusName, setTraceFocusName] = React.useState<string | null>(null);
  const [traceFocusToken, setTraceFocusToken] = React.useState(0);
  const [pendingMessages, setPendingMessages] = React.useState<PendingMessage[]>([]);
  const [_taskUpdateCountForCurrentTurn, setTaskUpdateCountForCurrentTurn] = React.useState(0);
  const [traceEventsByMessageId, setTraceEventsByMessageId] = React.useState<Record<string, TaskTraceEvent[]>>({});
  const [traceMetaByMessageId, setTraceMetaByMessageId] = React.useState<TaskTraceMetaByMessageId>({});
  const [traceLoadingByMessageId, setTraceLoadingByMessageId] = React.useState<Record<string, boolean>>({});
  const [traceLoadMoreLoadingByMessageId, setTraceLoadMoreLoadingByMessageId] = React.useState<Record<string, boolean>>({});
  const [traceErrorByMessageId, setTraceErrorByMessageId] = React.useState<Record<string, { kind: NotebookTraceFailureKind; message: string }>>({});
  const [sseDebugEvents, setSseDebugEvents] = React.useState<TaskSSEDebugEvent[]>([]);
  const [traceBackfillRefreshNonce, setTraceBackfillRefreshNonce] = React.useState(0);
  const [realtimeFailureCode, setRealtimeFailureCode] = React.useState<string | null>(null);
  const [realtimeFailureMessage, setRealtimeFailureMessage] = React.useState<string | null>(null);

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const filesAPI = React.useMemo(() => new FilesAPI(getApiClient()), []);
  const taskAPI = React.useMemo(() => new TaskAPI(getApiClient()), []);
  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);
  const localFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingFlushInFlightRef = React.useRef(false);
  const traceBackfillRequestedMessageIdsRef = React.useRef<Set<string>>(new Set());
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

  // Query keys for this task — used by both useQuery hooks and SSE cache writes
  const messagesKey = queryKeys.tasks.messages(workspaceId, projectId, taskId);
  const artifactsKey = queryKeys.tasks.artifacts(workspaceId, projectId, taskId);
  const taskDetailKey = queryKeys.tasks.detail(workspaceId, projectId, taskId);
  const diagnosticsQuery = buildBuildDiagnosticsOpsQuery();
  // WP-03: Updated to new runtime-console route with appropriate tabs
  const notebookDiagnosticsLinks = React.useMemo(() => ({
    runtime: `${basePath}/runtime-console?tab=monitoring${diagnosticsQuery}`,
    releaseOps: `${basePath}/runtime-console?tab=control${diagnosticsQuery}`,
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
  const lastTraceEventIdRef = React.useRef<string | null>(null);
  const syntheticTraceSeqRef = React.useRef(1_000_000);

  const mergeTraceEvents = React.useCallback((items: TaskTraceEvent[]) => {
    if (items.length === 0) return;
    setTraceEventsByMessageId((prev) => {
      let changed = false;
      const next: Record<string, TaskTraceEvent[]> = { ...prev };
      for (const evt of items) {
        const arr = next[evt.message_id] ?? [];
        if (arr.some((item) => item.id === evt.id)) continue;
        next[evt.message_id] = [...arr, evt];
        changed = true;
      }
      const latest = items[items.length - 1];
      if (latest?.id) {
        lastTraceEventIdRef.current = latest.id;
      }
      return changed ? next : prev;
    });
  }, []);

  const activeTraceMessageId = React.useMemo(() => {
    if (streamingMessageId) return streamingMessageId;
    const latestAgentMessage = [...(messages ?? [])].reverse().find((message) => message.role === 'agent');
    return latestAgentMessage?.id ?? null;
  }, [messages, streamingMessageId]);

  const appendSseDebugEvent = React.useCallback((event: TaskSSEDebugEvent, messageId?: string | null) => {
    setSseDebugEvents((prev) => [...prev.slice(-4), event]);

    const targetMessageId = messageId ?? activeTraceMessageId;
    if (!targetMessageId) return;

    const buildTransportTraceEvent = (
      transportKind: 'gap_fill' | 'reconcile',
      transportPhase: 'start' | 'done' | 'error',
    ): TaskTraceEvent => ({
      id: `transport:${transportKind}:${transportPhase}:${event.at}:${targetMessageId}`,
      task_id: taskId,
      message_id: targetMessageId,
      run_id: 'transport',
      seq: syntheticTraceSeqRef.current++,
      at: event.at,
      category: 'debug',
      phase: transportPhase === 'start' ? 'start' : 'end',
      status:
        transportPhase === 'start'
          ? 'running'
          : transportPhase === 'done'
            ? 'success'
            : 'error',
      name: `transport.${transportKind}`,
      summary: event.summary,
      details: {
        transport_kind: transportKind,
        transport_phase: transportPhase,
        debug_phase: event.phase,
      },
    });

    if (event.phase === 'trace_gap_fill_start') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'start')]);
    } else if (event.phase === 'trace_gap_fill_done') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'done')]);
    } else if (event.phase === 'trace_gap_fill_error') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'error')]);
    } else if (event.phase === 'trace_reconcile_start') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'start')]);
    } else if (event.phase === 'trace_reconcile_done') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'done')]);
    } else if (event.phase === 'trace_reconcile_error') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'error')]);
    }
  }, [activeTraceMessageId, mergeTraceEvents, taskId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const storage = window.localStorage as Storage | undefined;
    if (!storage || typeof storage.getItem !== 'function') return;
    const saved = storage.getItem('notebook.showExecutionDetails');
    if (saved === '1') setShowExecutionDetails(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const storage = window.localStorage as Storage | undefined;
    if (!storage || typeof storage.setItem !== 'function') return;
    storage.setItem('notebook.showExecutionDetails', showExecutionDetails ? '1' : '0');
  }, [showExecutionDetails]);

  React.useEffect(() => {
    if (!(sendMessage.isPending || isAgentTurnRunning)) return;
    const timer = setInterval(() => {
      setRunClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isAgentTurnRunning, sendMessage.isPending]);

  const fetchTracesForMessage = React.useCallback(async (messageId: string) => {
    if (!messageId) return;
    if (traceBackfillRequestedMessageIdsRef.current.has(messageId)) return;
    traceBackfillRequestedMessageIdsRef.current.add(messageId);
    setTraceLoadingByMessageId((prev) => ({ ...prev, [messageId]: true }));
    try {
      const resp = await taskAPI.listTraces(workspaceId, projectId, taskId, {
        message_id: messageId,
        page_size: 500,
      });
      mergeTraceEvents(resp.items);
      setTraceMetaByMessageId((prev) => upsertTaskTraceMeta(prev, messageId, resp));
      setTraceErrorByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err) {
      traceBackfillRequestedMessageIdsRef.current.delete(messageId);
      setTraceErrorByMessageId((prev) => ({
        ...prev,
        [messageId]: {
          kind: classifyNotebookTraceFailure(err),
          message: err instanceof Error ? err.message : 'Task trace details could not be loaded.',
        },
      }));
      handleError(err, { logContext: 'TaskPage.traceMessageBackfill' });
    } finally {
      setTraceLoadingByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  }, [handleError, mergeTraceEvents, projectId, taskAPI, taskId, workspaceId]);

  const loadMoreTracesForMessage = React.useCallback(async (messageId: string) => {
    const meta = traceMetaByMessageId[messageId];
    const beforeId = meta?.nextAfterId;
    if (!messageId || !beforeId) return;
    if (traceLoadMoreLoadingByMessageId[messageId]) return;
    setTraceLoadMoreLoadingByMessageId((prev) => ({ ...prev, [messageId]: true }));
    try {
      const resp = await taskAPI.listTraces(workspaceId, projectId, taskId, {
        message_id: messageId,
        before_id: beforeId,
        page_size: 500,
      });
      mergeTraceEvents(resp.items);
      setTraceMetaByMessageId((prev) => upsertTaskTraceMeta(prev, messageId, resp));
      setTraceErrorByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err) {
      setTraceErrorByMessageId((prev) => ({
        ...prev,
        [messageId]: {
          kind: classifyNotebookTraceFailure(err),
          message: err instanceof Error ? err.message : 'Task trace details could not be loaded.',
        },
      }));
      handleError(err, { logContext: 'TaskPage.traceMessageLoadMore' });
    } finally {
      setTraceLoadMoreLoadingByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  }, [handleError, mergeTraceEvents, projectId, taskAPI, taskId, traceLoadMoreLoadingByMessageId, traceMetaByMessageId, workspaceId]);

  React.useEffect(() => {
    if (!messages || messages.length === 0) return;
    const messageIds = new Set(messages.map((m) => m.id));
    traceBackfillRequestedMessageIdsRef.current = new Set(
      [...traceBackfillRequestedMessageIdsRef.current].filter((id) => messageIds.has(id)),
    );
    setTraceMetaByMessageId((prev) => pruneTaskTraceMeta(prev, messageIds));
    setTraceLoadingByMessageId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, loading] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = loading;
      }
      return changed ? next : prev;
    });
    setTraceLoadMoreLoadingByMessageId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, loading] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = loading;
      }
      return changed ? next : prev;
    });
    setTraceErrorByMessageId((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [id, value] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = value;
      }
      return changed ? next : prev;
    });
  }, [messages, traceBackfillRefreshNonce]);

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
      if (isAgentTurnRunning && streamingMessageId) {
        const hasTraceForCurrentTurn = (traceEventsByMessageId[streamingMessageId] ?? []).length > 0;
        if (!hasTraceForCurrentTurn) {
          setTaskUpdateCountForCurrentTurn((prev) => {
            const next = prev + 1;
            if (next >= 2) {
              resetCurrentRunUiState();
              return 0;
            }
            return next;
          });
        }
      }
      queryClient.setQueryData(taskDetailKey, updatedTask);
    },
    onTraceEvent: (traceEvent) => {
      setLastRunActionSummary(traceEvent.summary || traceEvent.name);
      lastTraceEventIdRef.current = traceEvent.id;
      setTraceEventsByMessageId((prev) => {
        const existing = prev[traceEvent.message_id] ?? [];
        if (existing.some((item) => item.id === traceEvent.id)) return prev;
        return {
          ...prev,
          [traceEvent.message_id]: [...existing, traceEvent],
        };
      });
      if (
        streamingMessageId === traceEvent.message_id
        && (traceEvent.status === 'success' || traceEvent.status === 'error' || traceEvent.status === 'cancelled')
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
    onDebug: appendSseDebugEvent,
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
        traceBackfillRequestedMessageIdsRef.current.clear();
        setTraceMetaByMessageId({});
        setTraceLoadingByMessageId({});
        setTraceLoadMoreLoadingByMessageId({});
        setTraceBackfillRefreshNonce((prev) => prev + 1);
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
  }, [appendSseDebugEvent, connectionStatus, handleError, mergeTraceEvents, projectId, taskAPI, taskId, workspaceId]);

  const buildPendingMessage = React.useCallback((content: string): PendingMessage => ({
    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    createdAt: new Date().toISOString(),
  }), []);

  const enqueuePendingMessage = React.useCallback((content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    setPendingMessages((prev) => [...prev, buildPendingMessage(normalized)]);
  }, [buildPendingMessage]);

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
            setPendingMessages((prev) => [buildPendingMessage(content), ...prev]);
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
          || errorCode === 'RESOURCE_POLICY_QUOTA_EXCEEDED'
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
    buildPendingMessage,
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

  const handleAddFiles = async (inputs: Array<
    | { kind: 'source'; source_id: string }
    | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
    | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
  >) => {
    await addFiles.mutateAsync({
      workspaceId,
      projectId,
      taskId,
      inputs,
    });
  };

  const handleAttachArtifactAsInput = async (artifact: Artifact) => {
    if (addingInput) return;
    setAddingInput(true);
    try {
      await handleAddFiles([{
        kind: 'artifact',
        task_id: taskId,
        artifact_id: artifact.id,
        ...(artifact.task_relative_path ? { task_relative_path: artifact.task_relative_path } : {}),
        ...(artifact.title ? { name: artifact.title } : {}),
        ...(artifact.mime_type ? { content_type: artifact.mime_type } : {}),
        ...(typeof artifact.file_size === 'number' ? { size_bytes: artifact.file_size } : {}),
      }]);
    } finally {
      setAddingInput(false);
    }
  };

  const uploadAndAttachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAddingInput(true);
    try {
      const library = await ensureDefaultUploadLibrary({
        sourcesAPI: filesAPI,
        workspaceId,
        projectId,
      });
      const uploadedInputs: Array<{
        kind: 'library_object';
        library_id: string;
        key: string;
        name?: string;
        content_type?: string;
        size_bytes?: number;
      }> = [];
      for (const file of files) {
        const uploaded = await filesAPI.uploadObject(
          workspaceId,
          projectId,
          library.id,
          file,
          `notebook/${taskId}/inputs`,
          true,
        );
        uploadedInputs.push({
          kind: 'library_object',
          library_id: library.id,
          key: uploaded.key,
          name: uploaded.name,
          content_type: uploaded.content_type,
          size_bytes: uploaded.size_bytes,
        });
      }
      if (uploadedInputs.length > 0) {
        await handleAddFiles(uploadedInputs);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
        });
      }
    } finally {
      setAddingInput(false);
    }
  };

  const handleLocalInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadAndAttachFiles(files);
  };

  const handleSubmitUrlInput = async () => {
    const normalized = urlInput.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) return;

    const fileSafeName = normalized
      .replace(/^https?:\/\//i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 64);
    const filename = `${fileSafeName || 'url_input'}.url.txt`;
    const content = `URL input\n${normalized}\n`;
    const file = new File([content], filename, { type: 'text/plain' });
    setAddingInput(true);
    try {
      const library = await ensureDefaultUploadLibrary({
        sourcesAPI: filesAPI,
        workspaceId,
        projectId,
      });
      const uploaded = await filesAPI.uploadObject(
        workspaceId,
        projectId,
        library.id,
        file,
        `notebook/${taskId}/inputs`,
        true,
      );
      await handleAddFiles([{
        kind: 'url',
        url: normalized,
        name: uploaded.name,
        imported_library_id: library.id,
        imported_key: uploaded.key,
        content_type: uploaded.content_type,
        size_bytes: uploaded.size_bytes,
      }]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
      });
    } finally {
      setAddingInput(false);
    }
    setUrlInput('');
    setAddUrlOpen(false);
  };

  const handleViewArtifact = (artifact: Artifact) => {
    if (artifact.type === 'image') {
      setSelectedArtifact(artifact);
      setImageViewerOpen(true);
    }
  };

  const handleSaveArtifact = (artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setSaveDialogOpen(true);
  };

  const handleDownloadArtifact = async (artifact: Artifact) => {
    try {
      const blob = await taskAPI.downloadArtifact(workspaceId, projectId, taskId, artifact.id);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.title || `artifact-${artifact.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.downloadArtifact' });
    }
  };

  const handleSaveArtifactToLibrary = async (filename?: string, description?: string) => {
    if (!selectedArtifact) return;

    try {
      await taskAPI.saveArtifact(
        workspaceId,
        projectId,
        taskId,
        selectedArtifact.id,
        {
          artifact_id: selectedArtifact.id,
          filename: filename || selectedArtifact.title,
          description,
        },
      );

      // Show success notification (you could add a toast here)
      setSaveDialogOpen(false);

      // Refresh files list
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(workspaceId, projectId),
      });
    } catch (err) {
      handleError(err, { logContext: 'TaskPage.saveArtifactToLibrary' });
    }
  };

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
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-tertiary">{tTask('loading')}</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">{tTask('not_found_title')}</h2>
          <p className="text-sm text-tertiary mb-4">{tTask('not_found_description')}</p>
          <button
            onClick={() => router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`)}
            className="text-sm text-accent hover:underline"
          >
            {tTask('back_to_notebook')}
          </button>
        </div>
      </div>
    );
  }

  const isDisabled = task.status === 'archived';
  const isExternalAgentOffline = taskAgent?.mode === 'external' && taskAgent.presence !== 'online';
  const runElapsedSeconds = runStartedAt
    ? Math.max(0, Math.floor((runClockNow - runStartedAt) / 1000))
    : 0;
  const activeTraceEvents = streamingMessageId ? (traceEventsByMessageId[streamingMessageId] ?? []) : [];
  type RunActionKind = 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';
  const toRunAction = (evt: TaskTraceEvent | undefined): { kind: RunActionKind; summary: string } => {
    if (!evt) {
      return {
        kind: 'system',
        summary: lastRunActionSummary || tConversation('run_active_default_action'),
      };
    }
    if (evt.name === 'codex.command') {
      const command = typeof evt.details?.command === 'string' ? evt.details.command.trim() : '';
      return {
        kind: 'command',
        summary: command || evt.summary || tConversation('run_active_default_action'),
      };
    }
    if (evt.name === 'codex.tool') {
      const toolName = typeof evt.details?.tool_name === 'string' ? evt.details.tool_name.trim() : '';
      return {
        kind: 'tool',
        summary: toolName ? `tool: ${toolName}` : (evt.summary || tConversation('run_active_default_action')),
      };
    }
    if (evt.name === 'runner.artifact') {
      const filename = typeof evt.details?.filename === 'string' ? evt.details.filename.trim() : '';
      return {
        kind: 'artifact',
        summary: filename || evt.summary || tConversation('run_active_default_action'),
      };
    }
    if (evt.name === 'run.lifecycle') {
      return {
        kind: 'lifecycle',
        summary: evt.summary || tConversation('run_active_default_action'),
      };
    }
    if (evt.category === 'error' || evt.status === 'error') {
      return {
        kind: 'error',
        summary: evt.summary || tConversation('run_active_default_action'),
      };
    }
    if (evt.name === 'codex.output' || evt.category === 'progress') {
      return {
        kind: 'output',
        summary: evt.summary || tConversation('run_active_default_action'),
      };
    }
    return {
      kind: 'system',
      summary: evt.summary || tConversation('run_active_default_action'),
    };
  };
  const sortedActions = [...activeTraceEvents].sort((a, b) => (a.seq !== b.seq ? b.seq - a.seq : b.at.localeCompare(a.at)));
  const latestRunAction = toRunAction(sortedActions.find((evt) => evt.name !== 'run.summary') ?? sortedActions[0]);
  const recentRunActions = (() => {
    const now = Date.now();
    const allowKinds: RunActionKind[] = ['command', 'tool', 'artifact', 'lifecycle', 'error'];
    const selected: Array<{ id: string; kind: RunActionKind; summary: string; ageSeconds: number; traceName: string }> = [];
    for (const evt of sortedActions) {
      const mapped = toRunAction(evt);
      if (!allowKinds.includes(mapped.kind)) continue;
      if (mapped.summary.trim().length === 0) continue;
      if (selected.some((item) => item.summary === mapped.summary && item.kind === mapped.kind)) continue;
      const at = Date.parse(evt.at);
      const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : 0;
      selected.push({
        id: evt.id,
        kind: mapped.kind,
        summary: mapped.summary,
        ageSeconds,
        traceName: evt.name,
      });
      if (selected.length >= 3) break;
    }
    return selected;
  })();
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
        canDeleteTask={canDeleteTask}
        onCreateNew={canCreateTask ? handleCreateNew : undefined}
        onEdit={canUpdateTask ? () => setEditDialogOpen(true) : undefined}
        onDeleted={handleTaskDeleted}
        onLeave={handleLeave}
      />
      <div className="flex-1 flex min-h-0">
        <div className="w-[232px] flex-shrink-0">
          <AttachedFilesPanel
            workspaceId={workspaceId}
            projectId={projectId}
            taskId={taskId}
            attachedInputIds={task.attached_inputs.map((item) => item.id)}
            addingInput={addingInput}
            onAddFromFiles={() => {
              if (!canUpdateTask) return;
              setFileSelectOpen(true);
            }}
            onAddFromLocal={() => {
              if (!canUpdateTask || addingInput) return;
              localFileInputRef.current?.click();
            }}
            onAddFromUrl={() => {
              if (!canUpdateTask || addingInput) return;
              setAddUrlOpen(true);
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          {showSseDebugPanel && <NotebookSseDebugPanel events={sseDebugEvents} />}
          <ConversationPanel
            messages={messages || []}
            streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          connectionStatus={connectionStatus}
          connectionErrorCode={realtimeFailureCode}
          connectionErrorMessage={realtimeFailureMessage}
          traceEventsByMessageId={traceEventsByMessageId}
          traceHasMoreByMessageId={mapTraceHasMoreByMessageId(traceMetaByMessageId)}
          traceLoadingByMessageId={traceLoadingByMessageId}
          traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
          traceErrorByMessageId={traceErrorByMessageId}
          diagnosticsLinks={notebookDiagnosticsLinks}
          onTraceExpand={fetchTracesForMessage}
          onTraceLoadMore={loadMoreTracesForMessage}
          onSendMessage={handleSendMessage}
          agentRunning={sendMessage.isPending || isAgentTurnRunning}
          pendingQueue={pendingMessages}
          onPendingUpdate={handlePendingUpdate}
          onPendingRemove={handlePendingRemove}
          runActivity={{
            active: sendMessage.isPending || isAgentTurnRunning,
            elapsedSeconds: runElapsedSeconds,
            lastSummary: latestRunAction.summary,
            lastKind: latestRunAction.kind,
            recentActions: recentRunActions,
          }}
          onRunActionClick={(action) => {
            if (!action.traceName || !activeTraceMessageId) return;
            setShowExecutionDetails(true);
            setTraceFocusMessageId(activeTraceMessageId);
            setTraceFocusName(action.traceName);
            setTraceFocusToken((prev) => prev + 1);
          }}
          focusTraceMessageId={traceFocusMessageId}
          focusTraceName={traceFocusName}
          focusTraceToken={traceFocusToken}
          showExecutionDetails={showExecutionDetails}
          onToggleExecutionDetails={() => setShowExecutionDetails((prev) => !prev)}
          sandboxStarting={showSandboxStarting}
            disabled={isConversationInputDisabled}
            sending={sendMessage.isPending}
          />
        </div>
        <div className="w-[288px] flex-shrink-0">
          <ArtifactsPanel
            artifacts={artifacts || []}
            onView={handleViewArtifact}
            onSave={handleSaveArtifact}
            onDownload={handleDownloadArtifact}
            onAttachAsInput={canUpdateTask && !isDisabled ? handleAttachArtifactAsInput : undefined}
            disabled={isDisabled || !canUpdateTask}
          />
        </div>
      </div>

      <FileSelectDialog
        open={fileSelectOpen}
        onOpenChange={setFileSelectOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onConfirm={handleAddFiles}
        excludeIds={task.attached_inputs.filter((item) => item.kind === 'source').map((item) => item.source_id)}
      />

      <input
        ref={localFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleLocalInputChange}
      />

      <Dialog open={addUrlOpen} onOpenChange={setAddUrlOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={t('placeholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddUrlOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleSubmitUrlInput}
              disabled={addingInput || !/^https?:\/\//i.test(urlInput.trim())}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ArtifactImageViewer
        open={imageViewerOpen}
        onOpenChange={setImageViewerOpen}
        artifact={selectedArtifact}
        onDownload={selectedArtifact ? () => handleDownloadArtifact(selectedArtifact) : undefined}
      />

      <ArtifactSaveDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        artifact={selectedArtifact}
        onSave={handleSaveArtifactToLibrary}
      />

      <TaskCreateDialog
        open={canCreateTask && createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleTaskCreated}
      />

      <EditTaskDialog
        open={canUpdateTask && editDialogOpen}
        onOpenChange={setEditDialogOpen}
        task={task}
        saving={updateTask.isPending}
        onSubmit={handleTaskUpdated}
      />
    </div>
  );
}
