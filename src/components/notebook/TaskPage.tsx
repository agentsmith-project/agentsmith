"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { TaskHeader } from "./TaskHeader";
import {
  TaskTerminalPanel,
  clearTaskTerminalPanelSessionStateForScope,
  storeTaskTerminalPanelSessionIdForScope,
} from "./TaskTerminalPanel";
import {
  useTask,
  useTaskMessages,
  useTaskArtifacts,
  useSendMessage,
  useUpdateTask,
} from "@/lib/hooks/use-task";
import { useTaskSSE } from "@/lib/hooks/use-task-sse";
import { useErrorHandler } from "@/lib/hooks/use-error-handler";
import { TaskAPI } from "@/lib/api";
import { getApiClient } from "@/lib/api";
import type { Artifact, Task, TaskMessage } from "@/lib/types/task";
import { useRouter, useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  buildAgentDiagnosticsLink,
  buildBuildDiagnosticsOpsQuery,
} from "@/lib/build-diagnostics-context";
import { AgentAPI } from "@/lib/api/endpoints/agents";
import { ApiError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast";
import {
  collectRecentRunActions,
  createPendingMessage,
  deriveRunAction,
} from "@/components/notebook/task-page/run-activity";
import { TaskPageContent } from "@/components/notebook/task-page/TaskPageContent";
import { TaskPageDialogs } from "@/components/notebook/task-page/TaskPageDialogs";
import {
  TaskPageLoadingState,
  TaskPageNotFoundState,
} from "@/components/notebook/task-page/TaskPageStates";
import { useTaskTraceState } from "@/components/notebook/task-page/useTaskTraceState";
import { useTaskInputActions } from "@/components/notebook/task-page/useTaskInputActions";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { makeClientId } from "@/lib/chat/ids";
import type { TerminalStatus } from "./TaskTerminalPanel";

type TerminalViewMode = "conversation" | "terminal";

interface TerminalWorkspaceTab {
  id: string;
  label: string;
  status: TerminalStatus;
  closeRequestToken: number;
  sessionId?: string | null;
}

interface PersistedTerminalWorkspacePreferences {
  preferredViewMode: TerminalViewMode;
  preferredActiveSessionId: string | null;
  artifactsDrawerOpen: boolean;
}

type ListedTerminalSession = Awaited<
  ReturnType<TaskAPI["listTerminalSessions"]>
>["items"][number];

type TerminalWorkspaceHydrationState = "pending" | "ready" | "unavailable";

function mapListedTerminalSessionStatusToTabStatus(
  status: ListedTerminalSession["status"],
): TerminalStatus {
  if (status === "pending") return "preparing";
  if (status === "disconnected") return "connecting";
  if (status === "failed") return "failed";
  if (status === "closed") return "closed";
  return "active";
}

function getTaskTerminalWorkspaceStorageKey(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  return `agentsmith-terminal-workspace:${workspaceId}:${projectId}:${taskId}`;
}

function readStoredTerminalWorkspaceState(
  workspaceId: string,
  projectId: string,
  taskId: string,
): PersistedTerminalWorkspacePreferences | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(
    getTaskTerminalWorkspaceStorageKey(workspaceId, projectId, taskId),
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedTerminalWorkspacePreferences;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredTerminalWorkspaceState(
  workspaceId: string,
  projectId: string,
  taskId: string,
  state: PersistedTerminalWorkspacePreferences,
) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    getTaskTerminalWorkspaceStorageKey(workspaceId, projectId, taskId),
    JSON.stringify(state),
  );
}

export interface TaskPageProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canCreateTask: boolean;
  canUpdateTask: boolean;
  canDeleteTask: boolean;
  canUseTerminal?: boolean;
  diagnosticsBasePath?: string;
}

export function TaskPage({
  workspaceId,
  projectId,
  taskId,
  canCreateTask,
  canUpdateTask,
  canDeleteTask,
  canUseTerminal = false,
  diagnosticsBasePath,
}: TaskPageProps) {
  type PendingMessage = ReturnType<typeof createPendingMessage>;
  const initialStoredTerminalWorkspaceStateRef =
    React.useRef<PersistedTerminalWorkspacePreferences | null>(null);
  if (initialStoredTerminalWorkspaceStateRef.current === null) {
    initialStoredTerminalWorkspaceStateRef.current = readStoredTerminalWorkspaceState(
      workspaceId,
      projectId,
      taskId,
    );
  }
  const initialStoredTerminalWorkspaceState =
    initialStoredTerminalWorkspaceStateRef.current;
  const tTask = useTranslations("notebook.task");
  const tConversation = useTranslations("notebook.conversation");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en-US";
  const basePath =
    diagnosticsBasePath ??
    `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const taskScopeKey = React.useMemo(
    () => `${workspaceId}:${projectId}:${taskId}`,
    [projectId, taskId, workspaceId],
  );
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [streamingMessageId, setStreamingMessageId] = React.useState<
    string | null
  >(null);
  const [streamingContent, setStreamingContent] = React.useState<string>("");
  const [isAgentTurnRunning, setIsAgentTurnRunning] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [lastRunActionSummary, setLastRunActionSummary] = React.useState<
    string | null
  >(null);
  const [runClockNow, setRunClockNow] = React.useState<number>(Date.now());
  const [pendingMessages, setPendingMessages] = React.useState<
    PendingMessage[]
  >([]);
  const [optimisticUserMessages, setOptimisticUserMessages] = React.useState<
    TaskMessage[]
  >([]);
  const [_taskUpdateCountForCurrentTurn, setTaskUpdateCountForCurrentTurn] =
    React.useState(0);
  const [realtimeFailureCode, setRealtimeFailureCode] = React.useState<
    string | null
  >(null);
  const [realtimeFailureMessage, setRealtimeFailureMessage] = React.useState<
    string | null
  >(null);
  const [viewMode, setViewMode] = React.useState<TerminalViewMode>(
    "conversation",
  );
  const [terminalTabs, setTerminalTabs] = React.useState<TerminalWorkspaceTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = React.useState<string | null>(null);
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = React.useState(
    initialStoredTerminalWorkspaceState?.artifactsDrawerOpen ?? true,
  );
  const [terminalWorkspaceHydrationState, setTerminalWorkspaceHydrationState] =
    React.useState<TerminalWorkspaceHydrationState>("pending");
  const nextTerminalTabOrdinalRef = React.useRef(1);
  const terminalTabsRef = React.useRef<TerminalWorkspaceTab[]>([]);
  const activeTerminalTabIdRef = React.useRef<string | null>(null);
  const viewModeRef = React.useRef<TerminalViewMode>("conversation");
  const artifactsDrawerOpenRef = React.useRef(
    initialStoredTerminalWorkspaceState?.artifactsDrawerOpen ?? true,
  );
  const hydratedTerminalTaskScopeRef = React.useRef<string | null>(null);
  const terminalWorkspaceHydrationRequestRef = React.useRef(0);

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const taskAPI = React.useMemo(() => new TaskAPI(getApiClient()), []);
  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);
  const pendingFlushInFlightRef = React.useRef(false);
  const { data: task, isLoading: taskLoading } = useTask(
    workspaceId,
    projectId,
    taskId,
  );
  const { data: taskAgent } = useQuery({
    queryKey: ["task-agent", workspaceId, projectId, task?.agent_id],
    queryFn: () => agentAPI.get(workspaceId, projectId, task?.agent_id ?? ""),
    enabled: !!task?.agent_id,
    staleTime: 10_000,
    retry: false,
  });
  const { data: messages } = useTaskMessages(workspaceId, projectId, taskId);
  const sendMessage = useSendMessage();
  const artifactsRefreshInterval = (
    task?.run_state === "running" || sendMessage.isPending || isAgentTurnRunning
  ) ? 5000 : false;
  const {
    data: artifacts,
    refetch: refetchArtifacts,
    isRefetching: artifactsRefreshing,
  } = useTaskArtifacts(workspaceId, projectId, taskId, {
    refetchInterval: artifactsRefreshInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const updateTask = useUpdateTask();
  const cancelActiveRun = useMutation({
    mutationFn: () => taskAPI.cancelRun(workspaceId, projectId, taskId),
    onSuccess: () => {
      setLastRunActionSummary(tConversation("run_cancel_requested"));
      toast.info(tConversation("run_cancel_requested"));
    },
    onError: (err) => {
      handleError(err, {
        logContext: "TaskPage.cancelActiveRun",
        showToast: true,
      });
    },
  });

  // Query keys for this task — used by both useQuery hooks and SSE cache writes
  const messagesKey = queryKeys.tasks.messages(workspaceId, projectId, taskId);
  const artifactsKey = queryKeys.tasks.artifacts(
    workspaceId,
    projectId,
    taskId,
  );
  const taskDetailKey = queryKeys.tasks.detail(workspaceId, projectId, taskId);
  const diagnosticsQuery = buildBuildDiagnosticsOpsQuery();
  const messagesForDisplay = React.useMemo(() => {
    const combined = [...(messages ?? [])];
    for (const optimisticMessage of optimisticUserMessages) {
      if (!combined.some((message) => message.id === optimisticMessage.id)) {
        combined.push(optimisticMessage);
      }
    }
    return combined.sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
  }, [messages, optimisticUserMessages]);
  // Diagnostics jump to the unified audit surface.
  const notebookDiagnosticsLinks = React.useMemo(
    () => ({
      audit: `${basePath}/audit${diagnosticsQuery}`,
      usage: `${basePath}/usage${diagnosticsQuery}`,
      agent: buildAgentDiagnosticsLink(basePath, task?.agent_id ?? null),
    }),
    [basePath, diagnosticsQuery, task?.agent_id],
  );

  const resetCurrentRunUiState = React.useCallback(() => {
    setStreamingMessageId(null);
    setStreamingContent("");
    setIsAgentTurnRunning(false);
    setRunStartedAt(null);
    setRunClockNow(Date.now());
    setLastRunActionSummary(null);
  }, []);

  React.useEffect(() => {
    if (!optimisticUserMessages.length || !(messages?.length ?? 0)) return;
    setOptimisticUserMessages((prev) => {
      const unmatchedServerMessages = [...(messages ?? [])].filter(
        (message) => message.role === "user",
      );
      return prev.filter((optimisticMessage) => {
        const optimisticCreatedAt = Date.parse(optimisticMessage.created_at);
        const matchedIndex = unmatchedServerMessages.findIndex(
          (message) =>
            message.content === optimisticMessage.content &&
            Date.parse(message.created_at) >= optimisticCreatedAt - 10_000,
        );
        if (matchedIndex < 0) return true;
        unmatchedServerMessages.splice(matchedIndex, 1);
        return false;
      });
    });
  }, [messages, optimisticUserMessages.length]);

  const activeTraceMessageId = React.useMemo(() => {
    if (streamingMessageId) return streamingMessageId;
    const latestAgentMessage = [...(messages ?? [])]
      .reverse()
      .find((message) => message.role === "agent");
    return latestAgentMessage?.id ?? null;
  }, [messages, streamingMessageId]);

  const latestAgentMessageId = React.useMemo(() => {
    const latestAgentMessage = [...(messages ?? [])]
      .reverse()
      .find((message) => message.role === "agent");
    return latestAgentMessage?.id ?? null;
  }, [messages]);

  const {
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
    lastTraceEventIdRef,
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
    imageViewerOpen,
    setImageViewerOpen,
    selectedArtifact,
    handleViewArtifact,
    handleDownloadArtifact,
  } = useTaskInputActions({
    workspaceId,
    projectId,
    taskId,
    taskAPI,
    handleError,
  });

  React.useEffect(() => {
    if (!(sendMessage.isPending || isAgentTurnRunning)) return;
    const timer = setInterval(() => {
      setRunClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isAgentTurnRunning, sendMessage.isPending]);

  React.useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  React.useEffect(() => {
    activeTerminalTabIdRef.current = activeTerminalTabId;
  }, [activeTerminalTabId]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    artifactsDrawerOpenRef.current = artifactsDrawerOpen;
  }, [artifactsDrawerOpen]);

  React.useEffect(() => {
    const preferredActiveSessionId =
      terminalTabs.find((tab) => tab.id === activeTerminalTabId)?.sessionId ?? null;
    writeStoredTerminalWorkspaceState(workspaceId, projectId, taskId, {
      preferredViewMode: viewMode,
      preferredActiveSessionId,
      artifactsDrawerOpen,
    });
  }, [
    activeTerminalTabId,
    artifactsDrawerOpen,
    projectId,
    taskId,
    terminalTabs,
    viewMode,
    workspaceId,
  ]);

  // SSE connection for real-time updates
  const isDev = process.env.NODE_ENV === "development";
  const showSseDebugPanel =
    isDev && getPublicRuntimeConfig().notebookSseDebugPanel;
  const { connectionStatus, connectionErrorCode, connectionErrorMessage } =
    useTaskSSE(workspaceId, projectId, taskId, {
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
          streamingMessageId === traceEvent.message_id &&
          ((traceEvent.name === "run.lifecycle" &&
            traceEvent.phase === "end" &&
            (traceEvent.status === "success" ||
              traceEvent.status === "error" ||
              traceEvent.status === "cancelled")) ||
            (traceEvent.name === "run.summary" && traceEvent.phase === "end"))
        ) {
          setTaskUpdateCountForCurrentTurn(0);
          resetCurrentRunUiState();
        }
      },
      onError: (error) => {
        setTaskUpdateCountForCurrentTurn(0);
        resetCurrentRunUiState();
        setRealtimeFailureCode(
          typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
            ? error.code
            : null,
        );
        setRealtimeFailureMessage(error.message);
      },
      onDebug: (event) => appendSseDebugEvent(event, activeTraceMessageId),
      enabled: !!taskId && !taskLoading,
    });

  const previousConnectionStatusRef = React.useRef<
    typeof connectionStatus | null
  >(null);
  React.useEffect(() => {
    if (connectionErrorCode || connectionErrorMessage) {
      setRealtimeFailureCode(connectionErrorCode ?? null);
      setRealtimeFailureMessage(connectionErrorMessage ?? null);
    } else if (connectionStatus === "connected") {
      setRealtimeFailureCode(null);
      setRealtimeFailureMessage(null);
    }
  }, [connectionErrorCode, connectionErrorMessage, connectionStatus]);

  React.useEffect(() => {
    const prev = previousConnectionStatusRef.current;
    previousConnectionStatusRef.current = connectionStatus;
    if (!connectionStatus) return;
    if (connectionStatus !== "connected") return;
    if (
      prev === "reconnecting" ||
      prev === "error" ||
      prev === "disconnected"
    ) {
      const afterId = lastTraceEventIdRef.current;
      if (!afterId) {
        appendSseDebugEvent({
          at: new Date().toISOString(),
          phase: "trace_reconcile_start",
          summary: "mode=refetch after_id=none",
        });
        resetTraceBackfillState();
        return;
      }
      // Refill only missing trace tail after reconnect to reduce payload size for long tasks.
      appendSseDebugEvent({
        at: new Date().toISOString(),
        phase: "trace_reconcile_start",
        summary: `mode=after_id after_id=${afterId}`,
      });
      void taskAPI
        .listTraces(workspaceId, projectId, taskId, {
          after_id: afterId,
          page_size: 500,
        })
        .then((resp) => {
          setRealtimeFailureCode(null);
          setRealtimeFailureMessage(null);
          appendSseDebugEvent({
            at: new Date().toISOString(),
            phase: "trace_reconcile_done",
            summary: `items=${resp.items.length}`,
          });
          mergeTraceEvents(resp.items);
        })
        .catch((err) => {
          setRealtimeFailureCode("TRACE_RECONCILE_FAILED");
          setRealtimeFailureMessage(
            err instanceof Error ? err.message : "Task trace reconcile failed.",
          );
          appendSseDebugEvent({
            at: new Date().toISOString(),
            phase: "trace_reconcile_error",
            summary: "task_traces_reconcile_failed",
          });
          handleError(err, { logContext: "TaskPage.traceGapFill" });
        });
    }
  }, [
    appendSseDebugEvent,
    connectionStatus,
    handleError,
    lastTraceEventIdRef,
    mergeTraceEvents,
    projectId,
    resetTraceBackfillState,
    taskAPI,
    taskId,
    workspaceId,
  ]);

  const enqueuePendingMessage = React.useCallback((content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    setPendingMessages((prev) => [...prev, createPendingMessage(normalized)]);
  }, []);

  const sendMessageNow = React.useCallback(
    async (content: string, source: "direct" | "queue") => {
      if (taskAgent?.mode === "external" && taskAgent.presence !== "online") {
        setRealtimeFailureCode("AGENT_OFFLINE");
        setRealtimeFailureMessage(tConversation("agent_offline"));
        toast.error(tConversation("agent_offline_send_blocked"));
        return;
      }
      try {
        const optimisticUserMessage: TaskMessage = {
          id: makeClientId("optimistic-user"),
          task_id: taskId,
          role: "user",
          content,
          created_at: new Date().toISOString(),
        };
        setOptimisticUserMessages((prev) => [...prev, optimisticUserMessage]);

        // Clear previous streaming state
        setStreamingMessageId(null);
        setStreamingContent("");
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
        if (response.role === "agent") {
          queryClient.setQueryData(
            messagesKey,
            (old: TaskMessage[] | undefined) => {
              const next = old ? [...old] : [];
              if (!next.some((message) => message.id === response.id)) {
                next.push(response);
              }
              return next;
            },
          );
          queryClient.setQueryData(taskDetailKey, (old: Task | undefined) =>
            old
              ? {
                  ...old,
                  run_state: "running",
                  last_activity_at: new Date().toISOString(),
                }
              : old,
          );
          setStreamingMessageId(response.id);
          setStreamingContent("");
          setIsAgentTurnRunning(true);
          setRunStartedAt(Date.now());
          setRunClockNow(Date.now());
          setLastRunActionSummary(tConversation("run_active_default_action"));
          setTaskUpdateCountForCurrentTurn(0);
        }
      } catch (err) {
        setOptimisticUserMessages((prev) =>
          prev.filter((message) => message.content !== content),
        );
        setIsAgentTurnRunning(false);
        setRunStartedAt(null);
        setRunClockNow(Date.now());
        setLastRunActionSummary(null);
        setTaskUpdateCountForCurrentTurn(0);
        if (err instanceof ApiError) {
          const errorCode = err.errorCode?.toUpperCase();
          if (errorCode === "TASK_STREAM_CONFLICT") {
            if (source === "queue") {
              setPendingMessages((prev) => [
                createPendingMessage(content),
                ...prev,
              ]);
            } else {
              enqueuePendingMessage(content);
              toast.info(tConversation("pending_enqueued"));
            }
            return;
          }
          if (
            err.statusCode === 429 ||
            errorCode === "RATE_LIMIT_EXCEEDED" ||
            errorCode === "RESOURCE_POLICY_RATE_LIMITED" ||
            errorCode === "RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED"
          ) {
            toast.error(
              `${tConversation("send_rate_limited_title")}: ${tConversation("send_rate_limited_description")}`,
            );
            return;
          }
          if (errorCode === "AGENT_OFFLINE") {
            toast.error(tConversation("agent_offline_send_blocked"));
            return;
          }
        }
        handleError(err, {
          logContext: "TaskPage.sendMessage",
          showToast: true,
        });
      }
    },
    [
      enqueuePendingMessage,
      handleError,
      messagesKey,
      projectId,
      queryClient,
      sendMessage,
      tConversation,
      taskAgent?.mode,
      taskAgent?.presence,
      taskDetailKey,
      taskId,
      workspaceId,
    ],
  );

  const handleSendMessage = async (content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    if (hasTerminalSessions) {
      toast.info(tTask("terminal_agent_run_blocked"));
      return;
    }
    if (isAgentTurnRunning || sendMessage.isPending) {
      enqueuePendingMessage(normalized);
      toast.info(tConversation("pending_enqueued"));
      return;
    }
    await sendMessageNow(normalized, "direct");
  };

  const handlePendingUpdate = React.useCallback(
    (id: string, content: string) => {
      setPendingMessages((prev) =>
        prev.map((item) => (item.id === id ? { ...item, content } : item)),
      );
    },
    [],
  );

  const handlePendingRemove = React.useCallback((id: string) => {
    setPendingMessages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const backendRunActive = task?.run_state === "running";

  const handleCancelActiveRun = React.useCallback(() => {
    if (!(isAgentTurnRunning || sendMessage.isPending || backendRunActive))
      return;
    if (cancelActiveRun.isPending) return;
    void cancelActiveRun.mutateAsync();
  }, [
    backendRunActive,
    cancelActiveRun,
    isAgentTurnRunning,
    sendMessage.isPending,
  ]);

  // Keep local streaming state consistent with backend authoritative run_state.
  React.useEffect(() => {
    if (task?.run_state !== "idle") return;
    if (sendMessage.isPending || cancelActiveRun.isPending) return;
    if (!isAgentTurnRunning && !streamingMessageId && !streamingContent) return;
    const graceMs = 1000;
    const elapsedMs = runStartedAt ? Date.now() - runStartedAt : graceMs;
    if (elapsedMs >= graceMs) {
      resetCurrentRunUiState();
      return;
    }
    const timer = window.setTimeout(
      () => resetCurrentRunUiState(),
      graceMs - elapsedMs,
    );
    return () => window.clearTimeout(timer);
  }, [
    cancelActiveRun.isPending,
    isAgentTurnRunning,
    resetCurrentRunUiState,
    runStartedAt,
    sendMessage.isPending,
    streamingContent,
    streamingMessageId,
    task?.run_state,
  ]);

  React.useEffect(() => {
    const isAgentUnavailable =
      taskAgent?.mode === "external" && taskAgent.presence !== "online";
    const taskArchived = task?.status === "archived";
    if (isAgentUnavailable || taskArchived || !canUpdateTask) return;
    if (isAgentTurnRunning || sendMessage.isPending) return;
    if (pendingFlushInFlightRef.current) return;
    const next = pendingMessages[0];
    if (!next) return;
    const content = next.content.trim();
    setPendingMessages((prev) => prev.slice(1));
    if (!content) return;
    pendingFlushInFlightRef.current = true;
    void sendMessageNow(content, "queue").finally(() => {
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
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${newTaskId}`,
    );
  };

  const handleTaskDeleted = () => {
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`,
    );
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
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`,
    );
  };
  const handleSetViewMode = React.useCallback((mode: TerminalViewMode) => {
    if (mode === "terminal" && terminalTabs.length === 0) return;
    setViewMode(mode);
    setArtifactsDrawerOpen(mode === "conversation");
  }, [terminalTabs.length]);
  const hasTask = task != null;
  const taskStatus = task?.status ?? "active";
  const taskLastActivityAt = task?.last_activity_at ?? null;
  const isDisabled = taskStatus === "archived";
  const isExternalAgentOffline =
    taskAgent?.mode === "external" && taskAgent.presence !== "online";
  const agentIsBusy =
    sendMessage.isPending || isAgentTurnRunning || backendRunActive;
  const fallbackRunStartedAt = backendRunActive
    ? (() => {
        const parsed = taskLastActivityAt ? Date.parse(taskLastActivityAt) : NaN;
        return Number.isFinite(parsed) ? parsed : Date.now();
      })()
    : null;
  const effectiveRunStartedAt = runStartedAt ?? fallbackRunStartedAt;
  const runElapsedSeconds = effectiveRunStartedAt
    ? Math.max(0, Math.floor((runClockNow - effectiveRunStartedAt) / 1000))
    : 0;
  const activeTraceEvents = streamingMessageId
    ? (traceEventsByMessageId[streamingMessageId] ?? [])
    : [];
  const runActionFallbackSummary =
    lastRunActionSummary || tConversation("run_active_default_action");
  const sortedActions = [...activeTraceEvents].sort((a, b) =>
    a.seq !== b.seq ? b.seq - a.seq : b.at.localeCompare(a.at),
  );
  const latestRunAction = deriveRunAction({
    event:
      sortedActions.find((evt) => evt.name !== "run.summary") ??
      sortedActions[0],
    fallbackSummary: runActionFallbackSummary,
  });
  const recentRunActions = collectRecentRunActions({
    sortedActions,
    fallbackSummary: runActionFallbackSummary,
    now: Date.now(),
  });
  const showSandboxStarting =
    isAgentTurnRunning &&
    activeTraceEvents.some((item) => item.name === "sandbox_starting") &&
    (streamingContent ?? "").trim().length === 0 &&
    !activeTraceEvents.some(
      (item) =>
        item.status === "success" ||
        item.status === "error" ||
        item.status === "cancelled",
    );
  const hasTerminalSessions = terminalTabs.length > 0;
  const terminalBootstrapPending =
    hasTask &&
    taskStatus === "active" &&
    terminalWorkspaceHydrationState === "pending";
  const terminalTruthUnavailable =
    hasTask &&
    taskStatus === "active" &&
    terminalWorkspaceHydrationState === "unavailable";
  const effectiveViewMode =
    terminalTruthUnavailable && !hasTerminalSessions ? "conversation" : viewMode;
  const terminalHasRecovery = terminalTabs.some((tab) => tab.status === "failed");
  const isConversationInputDisabled =
    isDisabled ||
    !canUpdateTask ||
    isExternalAgentOffline ||
    terminalBootstrapPending ||
    terminalTruthUnavailable ||
    hasTerminalSessions;
  const terminalDisabledReason = terminalTabs.length >= 3
    ? tTask("terminal_max_sessions_reached")
    : !canUseTerminal
      ? tTask("terminal_unavailable_permission")
      : taskStatus !== "active"
        ? tTask("terminal_unavailable_task_inactive")
        : agentIsBusy
          ? tTask("terminal_unavailable_agent_busy")
          : null;
  const canCreateTerminalSession =
    canUseTerminal &&
    canUpdateTask &&
    taskStatus === "active" &&
    !terminalBootstrapPending &&
    !terminalTruthUnavailable &&
    !agentIsBusy &&
    terminalTabs.length < 3;
  const deleteBlockedReason = terminalBootstrapPending
    ? tTask("delete_blocked_terminal_sessions_pending")
    : terminalTruthUnavailable
      ? tTask("delete_blocked_terminal_sessions_unavailable")
    : hasTerminalSessions
      ? tTask("delete_blocked_terminal_sessions")
      : null;

  const resetTerminalWorkspaceState = React.useCallback(() => {
    terminalTabsRef.current.forEach((tab) => {
      clearTaskTerminalPanelSessionStateForScope(
        workspaceId,
        projectId,
        taskId,
        tab.id,
      );
    });
    terminalTabsRef.current = [];
    setTerminalTabs([]);
    setActiveTerminalTabId(null);
    activeTerminalTabIdRef.current = null;
    setViewMode("conversation");
    setArtifactsDrawerOpen(true);
    nextTerminalTabOrdinalRef.current = 1;
    initialStoredTerminalWorkspaceStateRef.current = {
      preferredViewMode: "conversation",
      preferredActiveSessionId: null,
      artifactsDrawerOpen: true,
    };
  }, [projectId, taskId, workspaceId]);

  const clearTerminalWorkspaceStateFromBackend = React.useCallback(
    (artifactsDrawerPreference?: boolean) => {
      const currentTabs = terminalTabsRef.current;
      currentTabs.forEach((tab) => {
        clearTaskTerminalPanelSessionStateForScope(
          workspaceId,
          projectId,
          taskId,
          tab.id,
        );
      });
      terminalTabsRef.current = [];
      if (currentTabs.length > 0) {
        setTerminalTabs([]);
      }
      if (activeTerminalTabIdRef.current !== null) {
        setActiveTerminalTabId(null);
        activeTerminalTabIdRef.current = null;
      }
      if (viewModeRef.current !== "conversation") {
        setViewMode("conversation");
      }
      const nextArtifactsDrawerOpen = artifactsDrawerPreference ?? true;
      if (artifactsDrawerOpenRef.current !== nextArtifactsDrawerOpen) {
        setArtifactsDrawerOpen(nextArtifactsDrawerOpen);
      }
      nextTerminalTabOrdinalRef.current = 1;
      initialStoredTerminalWorkspaceStateRef.current = {
        preferredViewMode: "conversation",
        preferredActiveSessionId: null,
        artifactsDrawerOpen: nextArtifactsDrawerOpen,
      };
    },
    [projectId, taskId, workspaceId],
  );

  const reconcileTerminalTabsWithSessionIds = (liveSessionIds: Set<string>) => {
    if (liveSessionIds.size === 0) {
      resetTerminalWorkspaceState();
      return;
    }
    const currentTabs = terminalTabsRef.current;
    const nextTabs = currentTabs.filter(
      (tab) => tab.sessionId && liveSessionIds.has(tab.sessionId),
    );
    currentTabs
      .filter((tab) => !nextTabs.some((nextTab) => nextTab.id === tab.id))
      .forEach((tab) => {
        clearTaskTerminalPanelSessionStateForScope(
          workspaceId,
          projectId,
          taskId,
          tab.id,
        );
      });
    terminalTabsRef.current = nextTabs;
    setTerminalTabs(nextTabs);
    if (nextTabs.length === 0) {
      resetTerminalWorkspaceState();
      return;
    }
    const currentActiveTerminalTabId = activeTerminalTabIdRef.current;
    if (!nextTabs.some((tab) => tab.id === currentActiveTerminalTabId)) {
      const nextActiveTerminalTabId = nextTabs[0]?.id ?? null;
      setActiveTerminalTabId(nextActiveTerminalTabId);
      activeTerminalTabIdRef.current = nextActiveTerminalTabId;
    }
  };

  const hydrateTerminalWorkspaceFromBackendSessions = React.useCallback(
    (
      sessions: ListedTerminalSession[],
      options?: {
        modeStrategy?: "restore-initial" | "preserve-current";
      },
    ) => {
      const liveSessions = sessions
        .filter((session) => session.status !== "closed")
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
      const currentTabs = terminalTabsRef.current;
      const currentTabsBySessionId = new Map(
        currentTabs
          .filter(
            (tab): tab is TerminalWorkspaceTab & { sessionId: string } =>
              typeof tab.sessionId === "string" && tab.sessionId.length > 0,
          )
          .map((tab) => [tab.sessionId, tab]),
      );
      const preferredActiveSessionId =
        initialStoredTerminalWorkspaceStateRef.current?.preferredActiveSessionId ??
        null;
      const modeStrategy = options?.modeStrategy ?? "restore-initial";
      const shouldRestoreTerminalMode =
        modeStrategy === "preserve-current"
          ? viewModeRef.current === "terminal"
          : initialStoredTerminalWorkspaceStateRef.current?.preferredViewMode ===
            "terminal";

      const nextTabs = liveSessions.map((session) => {
        const existingTab = currentTabsBySessionId.get(session.id);
        if (existingTab) {
          return {
            ...existingTab,
            status: mapListedTerminalSessionStatusToTabStatus(session.status),
            sessionId: session.id,
          };
        }
        const nextOrdinal = nextTerminalTabOrdinalRef.current;
        nextTerminalTabOrdinalRef.current += 1;
        return {
          id: `terminal-session-${nextOrdinal}`,
          label: `${tTask("terminal_session")} ${nextOrdinal}`,
          status: mapListedTerminalSessionStatusToTabStatus(session.status),
          closeRequestToken: 0,
          sessionId: session.id,
        };
      });

      const nextTabIds = new Set(nextTabs.map((tab) => tab.id));
      currentTabs
        .filter((tab) => !nextTabIds.has(tab.id))
        .forEach((tab) => {
          clearTaskTerminalPanelSessionStateForScope(
            workspaceId,
            projectId,
            taskId,
            tab.id,
          );
        });

      nextTabs.forEach((tab) => {
        if (typeof tab.sessionId === "string" && tab.sessionId.length > 0) {
          storeTaskTerminalPanelSessionIdForScope(
            workspaceId,
            projectId,
            taskId,
            tab.id,
            tab.sessionId,
          );
        }
      });

      if (nextTabs.length === 0) {
        clearTerminalWorkspaceStateFromBackend(
          initialStoredTerminalWorkspaceStateRef.current?.artifactsDrawerOpen ??
            artifactsDrawerOpenRef.current,
        );
        return;
      }

      terminalTabsRef.current = nextTabs;
      setTerminalTabs(nextTabs);
      nextTerminalTabOrdinalRef.current = nextTabs.length + 1;
      const nextActiveTerminalTabId =
        nextTabs.find((tab) => tab.sessionId === preferredActiveSessionId)?.id ??
        nextTabs.find((tab) => tab.id === activeTerminalTabIdRef.current)?.id ??
        nextTabs[0]?.id ??
        null;
      setActiveTerminalTabId(nextActiveTerminalTabId);
      activeTerminalTabIdRef.current = nextActiveTerminalTabId;
      setViewMode(shouldRestoreTerminalMode ? "terminal" : "conversation");
      setArtifactsDrawerOpen(
        shouldRestoreTerminalMode
          ? false
          : (initialStoredTerminalWorkspaceStateRef.current?.artifactsDrawerOpen ??
            true),
      );
    },
    [
      clearTerminalWorkspaceStateFromBackend,
      projectId,
      tTask,
      taskId,
      workspaceId,
    ],
  );

  const syncTerminalWorkspaceFromBackend = React.useCallback(async () => {
    const listedSessions = await taskAPI.listTerminalSessions(
      workspaceId,
      projectId,
      taskId,
    );
    hydrateTerminalWorkspaceFromBackendSessions(listedSessions.items, {
      modeStrategy: "preserve-current",
    });
    return listedSessions;
  }, [
    hydrateTerminalWorkspaceFromBackendSessions,
    projectId,
    taskAPI,
    taskId,
    workspaceId,
  ]);

  const hydrateTerminalWorkspace = React.useCallback(
    async (logContext: string = "TaskPage.hydrateTerminalWorkspace") => {
      const requestId = terminalWorkspaceHydrationRequestRef.current + 1;
      terminalWorkspaceHydrationRequestRef.current = requestId;
      hydratedTerminalTaskScopeRef.current = taskScopeKey;
      setTerminalWorkspaceHydrationState("pending");
      try {
        const listedSessions = await taskAPI.listTerminalSessions(
          workspaceId,
          projectId,
          taskId,
        );
        if (terminalWorkspaceHydrationRequestRef.current !== requestId) {
          return null;
        }
        hydrateTerminalWorkspaceFromBackendSessions(listedSessions.items);
        hydratedTerminalTaskScopeRef.current = taskScopeKey;
        setTerminalWorkspaceHydrationState("ready");
        return listedSessions;
      } catch (error) {
        if (terminalWorkspaceHydrationRequestRef.current !== requestId) {
          return null;
        }
        hydratedTerminalTaskScopeRef.current = taskScopeKey;
        setTerminalWorkspaceHydrationState("unavailable");
        handleError(error, {
          logContext,
        });
        throw error;
      }
    },
    [
      handleError,
      hydrateTerminalWorkspaceFromBackendSessions,
      projectId,
      taskAPI,
      taskId,
      taskScopeKey,
      workspaceId,
    ],
  );

  React.useEffect(() => {
    if (taskLoading || !hasTask) {
      hydratedTerminalTaskScopeRef.current = null;
      setTerminalWorkspaceHydrationState("ready");
      return;
    }
    if (taskStatus !== "active") {
      hydratedTerminalTaskScopeRef.current = null;
      setTerminalWorkspaceHydrationState("ready");
      return;
    }
    if (hydratedTerminalTaskScopeRef.current === taskScopeKey) return;
    void hydrateTerminalWorkspace().catch(() => {});
  }, [
    hydrateTerminalWorkspace,
    projectId,
    taskLoading,
    taskStatus,
    hasTask,
    taskScopeKey,
  ]);

  if (taskLoading) {
    return <TaskPageLoadingState text={tTask("loading")} />;
  }

  if (!task) {
    return (
      <TaskPageNotFoundState
        title={tTask("not_found_title")}
        description={tTask("not_found_description")}
        backLabel={tTask("back_to_notebook")}
        onBack={() =>
          router.push(
            `/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`,
          )
        }
        actions={[
          {
            label: tCommon("open_files"),
            onClick: () =>
              router.push(
                `/${locale}/workspaces/${workspaceId}/projects/${projectId}/files`,
              ),
            testId: "notebook-task__open-files",
            variant: "outline",
          },
          {
            label: tCommon("open_chat"),
            onClick: () =>
              router.push(
                `/${locale}/workspaces/${workspaceId}/projects/${projectId}/chat`,
              ),
            testId: "notebook-task__open-chat",
            variant: "outline",
          },
        ]}
      />
    );
  }

  const createTerminalSessionTab = () => {
    if (!canCreateTerminalSession) {
      if (terminalTabs.length >= 3) {
        toast.info(tTask("terminal_max_sessions_reached"));
      }
      return;
    }
    const nextOrdinal = nextTerminalTabOrdinalRef.current;
    nextTerminalTabOrdinalRef.current += 1;
    const tabId = `terminal-session-${nextOrdinal}`;
    const newTab: TerminalWorkspaceTab = {
      id: tabId,
      label: `${tTask("terminal_session")} ${nextOrdinal}`,
      status: "idle",
      closeRequestToken: 0,
      sessionId: null,
    };
    setTerminalTabs((prev) => [...prev, newTab]);
    terminalTabsRef.current = [...terminalTabsRef.current, newTab];
    setActiveTerminalTabId(tabId);
    activeTerminalTabIdRef.current = tabId;
    setViewMode("terminal");
    setArtifactsDrawerOpen(false);
  };

  const handleTerminalTabStatusChange = (tabId: string, status: TerminalStatus) => {
    setTerminalTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, status } : tab)),
    );
    terminalTabsRef.current = terminalTabsRef.current.map((tab) =>
      tab.id === tabId ? { ...tab, status } : tab,
    );
  };

  const handleTerminalTabSessionResolved = (tabId: string, sessionId: string) => {
    setTerminalTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, sessionId } : tab)),
    );
    terminalTabsRef.current = terminalTabsRef.current.map((tab) =>
      tab.id === tabId ? { ...tab, sessionId } : tab,
    );
  };

  const closeTerminalTab = (tabId: string) => {
    setTerminalTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? { ...tab, closeRequestToken: tab.closeRequestToken + 1 }
          : tab,
      ),
    );
    terminalTabsRef.current = terminalTabsRef.current.map((tab) =>
      tab.id === tabId
        ? { ...tab, closeRequestToken: tab.closeRequestToken + 1 }
        : tab,
    );
  };

  const closeAllTerminalTabs = async () => {
    if (terminalTabsRef.current.length === 0) return;
    try {
      const listedSessions = await taskAPI.listTerminalSessions(workspaceId, projectId, taskId);
      const sessionIdsToClose = new Set<string>([
        ...listedSessions.items.map((session) => session.id),
        ...terminalTabsRef.current
          .map((tab) => tab.sessionId)
          .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0),
      ]);
      if (sessionIdsToClose.size === 0) {
        resetTerminalWorkspaceState();
        return;
      }
      await Promise.allSettled(
        [...sessionIdsToClose].map((sessionId) =>
          taskAPI.closeTerminalSession(workspaceId, projectId, taskId, sessionId),
        ),
      );
      const remainingSessions = await taskAPI.listTerminalSessions(workspaceId, projectId, taskId);
      reconcileTerminalTabsWithSessionIds(
        new Set(remainingSessions.items.map((session) => session.id)),
      );
    } catch (error) {
      handleError(error, {
        logContext: "TaskPage.closeAllTerminalTabs",
      });
    }
  };

  const handleTerminalTabCreateRejected = async () => {
    try {
      await syncTerminalWorkspaceFromBackend();
    } catch (error) {
      handleError(error, {
        logContext: "TaskPage.handleTerminalTabCreateRejected",
      });
    }
  };

  const handleRetryTerminalWorkspaceHydration = () => {
    void hydrateTerminalWorkspace("TaskPage.retryTerminalWorkspaceHydration").catch(
      () => {},
    );
  };

  const handleTerminalTabOpenChange = (tabId: string, open: boolean) => {
    if (open) return;
    const currentTabs = terminalTabsRef.current;
    const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
    terminalTabsRef.current = nextTabs;
    setTerminalTabs(nextTabs);
    if (nextTabs.length === 0) {
      resetTerminalWorkspaceState();
      return;
    }
    const currentActiveTerminalTabId = activeTerminalTabIdRef.current;
    if (
      currentActiveTerminalTabId === tabId ||
      !nextTabs.some((tab) => tab.id === currentActiveTerminalTabId)
    ) {
      const fallbackIndex = Math.max(0, Math.min(closingIndex - 1, nextTabs.length - 1));
      const nextActiveTerminalTabId =
        nextTabs[fallbackIndex]?.id ?? nextTabs[0]?.id ?? null;
      setActiveTerminalTabId(nextActiveTerminalTabId);
      activeTerminalTabIdRef.current = nextActiveTerminalTabId;
    }
  };

  const terminalWorkspace = hasTerminalSessions ? (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="notebook__task-terminal-workspace"
      data-active-terminal-tab-id={activeTerminalTabId ?? undefined}
    >
      <div className="flex items-center justify-between gap-3 border-b border-subtle px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2">
          {terminalTabs.map((tab) => {
            const isActive = tab.id === activeTerminalTabId;
            const statusVariant =
              tab.status === "failed"
                ? "destructive"
                : tab.status === "active"
                  ? "secondary"
                  : "outline";
            return (
              <div
                key={tab.id}
                className={`inline-flex items-center rounded-md border px-1 py-1 ${
                  isActive
                    ? "border-border/40 bg-surface-low/60"
                    : "border-border/18 bg-transparent"
                }`}
                data-testid={`notebook__task-terminal-tab-${tab.id}`}
              >
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-sm px-2 py-1 text-[12px] transition-colors ${
                    isActive ? "text-foreground" : "text-secondary hover:text-foreground"
                  }`}
                  onClick={() => {
                    setActiveTerminalTabId(tab.id);
                    setViewMode("terminal");
                    setArtifactsDrawerOpen(false);
                  }}
                >
                  <span className="truncate">{tab.label}</span>
                  <span className="hidden sm:inline-flex">
                    <span className="sr-only">{tab.status}</span>
                    <span
                      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] ${
                        statusVariant === "destructive"
                          ? "bg-error/12 text-error"
                          : statusVariant === "secondary"
                            ? "bg-accent/12 text-accent"
                            : "bg-surface-low/60 text-tertiary"
                      }`}
                    >
                      {tTask(`terminal_status_${tab.status}`)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-secondary transition-colors hover:bg-surface-low/50 hover:text-foreground"
                  onClick={() => closeTerminalTab(tab.id)}
                  data-testid={`notebook__task-terminal-close-${tab.id}`}
                  aria-label={`${tTask("terminal_close")} ${tab.label}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={createTerminalSessionTab}
            disabled={!canCreateTerminalSession}
            title={!canCreateTerminalSession ? terminalDisabledReason ?? undefined : undefined}
            data-testid="notebook__task-terminal-create"
          >
            {tTask("terminal_new_session")}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
            onClick={() => {
              void closeAllTerminalTabs();
            }}
            data-testid="notebook__task-terminal-end-all"
          >
            {tTask("terminal_end_all")}
          </button>
        </div>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 overflow-hidden">
        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            className={`min-h-0 flex-1 overflow-hidden ${tab.id === activeTerminalTabId ? "block" : "hidden"}`}
          >
            <TaskTerminalPanel
              open
              visible={tab.id === activeTerminalTabId}
              tabId={tab.id}
              sessionStorageScope={tab.id}
              workspaceId={workspaceId}
              projectId={projectId}
              taskId={taskId}
              taskTitle={task.title}
              taskApi={taskAPI}
              closeRequestToken={tab.closeRequestToken}
              onSessionResolved={(sessionId) => handleTerminalTabSessionResolved(tab.id, sessionId)}
              onStatusChange={(status) => handleTerminalTabStatusChange(tab.id, status)}
              onSessionCreateRejected={handleTerminalTabCreateRejected}
              onOpenChange={(open) => handleTerminalTabOpenChange(tab.id, open)}
            />
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const terminalStatusStrip =
    terminalTruthUnavailable ||
    (effectiveViewMode === "conversation" && hasTerminalSessions) ? (
      terminalTruthUnavailable ? (
        <div
          className="mt-3 flex items-start justify-between gap-3 rounded-md border border-error/30 bg-error/5 px-4 py-3 shadow-ambient"
          data-testid="notebook__task-terminal-truth-unavailable"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {tTask("terminal_truth_unavailable_title")}
            </div>
            <div className="mt-1 text-xs text-secondary">
              {tTask("terminal_truth_unavailable_description")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={handleRetryTerminalWorkspaceHydration}
              disabled={terminalBootstrapPending}
            >
              {tTask("terminal_truth_unavailable_action")}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="mt-3 flex items-start justify-between gap-3 rounded-md border border-subtle bg-surface/72 px-4 py-3 shadow-ambient"
          data-testid="notebook__task-terminal-status-strip"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {terminalHasRecovery
                ? tTask("terminal_status_strip_recovery", {
                    count: terminalTabs.length,
                  })
                : tTask("terminal_status_strip_active", {
                    count: terminalTabs.length,
                  })}
            </div>
            <div className="mt-1 text-xs text-secondary">
              {tTask("terminal_agent_run_blocked")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
              onClick={() => handleSetViewMode("terminal")}
            >
              {tTask("terminal_workspace_open")}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
              onClick={() => {
                void closeAllTerminalTabs();
              }}
            >
              {tTask("terminal_end_all")}
            </button>
          </div>
        </div>
      )
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TaskHeader
        task={task}
        workspaceId={workspaceId}
        projectId={projectId}
        agentMode={taskAgent?.mode ?? null}
        agentPresence={taskAgent?.presence ?? null}
        agentRunActivity={{
          active: agentIsBusy,
          elapsedSeconds: runElapsedSeconds,
        }}
        canDeleteTask={canDeleteTask}
        deleteBlockedReason={deleteBlockedReason}
        viewMode={effectiveViewMode}
        canCreateTerminalSession={canCreateTerminalSession}
        terminalSessionCount={terminalTabs.length}
        terminalHasRecovery={terminalHasRecovery}
        terminalDisabledReason={terminalDisabledReason}
        onSetViewMode={handleSetViewMode}
        onCreateTerminalSession={
          !hasTerminalSessions &&
          !terminalBootstrapPending &&
          !terminalTruthUnavailable
            ? createTerminalSessionTab
            : undefined
        }
        onCreateNew={canCreateTask ? handleCreateNew : undefined}
        onEdit={canUpdateTask ? () => setEditDialogOpen(true) : undefined}
        onDeleted={handleTaskDeleted}
        onLeave={handleLeave}
      />
      <TaskPageContent
        agentIsBusy={agentIsBusy}
        activeAgentMessageId={streamingMessageId ?? (agentIsBusy ? latestAgentMessageId : null)}
        artifacts={artifacts || []}
        artifactsRefreshing={artifactsRefreshing}
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
        handleCancelActiveRun={handleCancelActiveRun}
        handleDownloadArtifact={handleDownloadArtifact}
        handlePendingRemove={handlePendingRemove}
        handleRefreshArtifacts={async () => {
          await refetchArtifacts();
        }}
        handlePendingUpdate={handlePendingUpdate}
        handleSendMessage={handleSendMessage}
        handleViewArtifact={handleViewArtifact}
        isDisabled={isDisabled}
        loadMoreTracesForMessage={loadMoreTracesForMessage}
        messages={messagesForDisplay}
        onRunActionClick={(action) => {
          if (!action.traceName || !activeTraceMessageId) return;
          setTraceFocusMessageId(activeTraceMessageId);
          setTraceFocusName(action.traceName);
          setTraceFocusToken((prev) => prev + 1);
        }}
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
        showSseDebugPanel={showSseDebugPanel}
        sseDebugEvents={sseDebugEvents}
        streamingContent={streamingContent}
        streamingMessageId={streamingMessageId}
        viewMode={effectiveViewMode}
        terminalWorkspace={terminalWorkspace}
        terminalStatusStrip={terminalStatusStrip}
        artifactsDrawerOpen={artifactsDrawerOpen}
        onToggleArtifactsDrawer={() => setArtifactsDrawerOpen((current) => !current)}
        artifactsShowLabel={tTask("artifacts_show")}
        artifactsHideLabel={tTask("artifacts_hide")}
        inputPlaceholder={hasTerminalSessions ? tTask("terminal_input_blocked_placeholder") : undefined}
        taskId={taskId}
        traceErrorByMessageId={traceErrorByMessageId}
        traceEventsByMessageId={traceEventsByMessageId}
        traceHasMoreByMessageId={traceHasMoreByMessageId}
        traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
        traceLoadingByMessageId={traceLoadingByMessageId}
        workspaceId={workspaceId}
      />

      <TaskPageDialogs
        canCreateTask={canCreateTask}
        canUpdateTask={canUpdateTask}
        createDialogOpen={createDialogOpen}
        editDialogOpen={editDialogOpen}
        imageViewerOpen={imageViewerOpen}
        projectId={projectId}
        savingTask={updateTask.isPending}
        selectedArtifact={selectedArtifact}
        tCommon={tCommon}
        task={task}
        workspaceId={workspaceId}
        onArtifactDownload={handleDownloadArtifact}
        onEditDialogOpenChange={setEditDialogOpen}
        onHandleTaskUpdated={handleTaskUpdated}
        onImageViewerOpenChange={setImageViewerOpen}
        onSetCreateDialogOpen={setCreateDialogOpen}
        onTaskCreated={handleTaskCreated}
      />
    </div>
  );
}
