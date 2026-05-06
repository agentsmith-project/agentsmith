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
  useCreateTask,
  useTask,
  useTaskActivity,
  useTaskArtifacts,
  useStartTaskRun,
  useUpdateTask,
} from "@/lib/hooks/use-task";
import { useTaskSSE } from "@/lib/hooks/use-task-sse";
import { useErrorHandler } from "@/lib/hooks/use-error-handler";
import { TaskAPI } from "@/lib/api";
import { getApiClient } from "@/lib/api";
import {
  isTaskRunStateActive,
  isTaskRunStateRunning,
  isTaskRunStateStoppingOrFinalizing,
} from "@/lib/types/task";
import type {
  Artifact,
  CreateTaskRequest,
  StartTaskRunRequest,
  Task,
  TaskActivityItem,
  TaskInputRef,
  TaskRunState,
  TaskTraceEvent,
} from "@/lib/types/task";
import { useRouter, useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { buildBuildDiagnosticsOpsQuery } from "@/lib/build-diagnostics-context";
import { ApiError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast";
import {
  collectRecentRunActions,
  createPendingMessage,
  deriveRunAction,
  type ActiveRunView,
} from "@/components/agent-tasks/task-page/run-activity";
import { TaskPageContent } from "@/components/agent-tasks/task-page/TaskPageContent";
import { TaskPageDialogs } from "@/components/agent-tasks/task-page/TaskPageDialogs";
import {
  TaskPageLoadingState,
  TaskPageNotFoundState,
} from "@/components/agent-tasks/task-page/TaskPageStates";
import { useTaskTraceState } from "@/components/agent-tasks/task-page/useTaskTraceState";
import { useTaskInputActions } from "@/components/agent-tasks/task-page/useTaskInputActions";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { makeClientId } from "@/lib/chat/ids";
import { deriveDefaultTaskWorkspaceName } from "./TaskCreateDialog";
import type {
  TerminalCloseReconcileResult,
  TerminalStatus,
} from "./TaskTerminalPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getTerminalSessionSummaryLabel } from "./terminal-session-summary";
import { isEditableFocusOwner } from "./task-terminal-protocol";

type TerminalViewMode = "conversation" | "terminal";

interface TerminalWorkspaceTab {
  id: string;
  label: string;
  status: TerminalStatus;
  closeRequestToken: number;
  focusRequestToken?: number;
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

type TaskTranslationFn = ReturnType<typeof useTranslations>;
type RecoveryCreateTaskRequest = CreateTaskRequest & {
  prompt?: string;
};
type TaskWithPrompt = Task & {
  prompt?: unknown;
};

export const NOTEBOOK_CANCEL_ESCALATION_PROMPT_DELAY_MS = 30_000;

function normalizeCancelEscalationReason(
  reason: string | null | undefined,
): string | null {
  return typeof reason === "string" && reason.trim().length > 0
    ? reason.trim()
    : null;
}

function getPendingActiveRunMessageId(taskId: string) {
  return `pending-active-run:${taskId}`;
}

function parseIsoTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMessageCreatedAtMs(
  messages: TaskActivityItem[],
  messageId: string | null,
): number | null {
  if (!messageId) return null;
  return parseIsoTimestampMs(
    messages.find((message) => message.id === messageId)?.created_at,
  );
}

function getEarliestTraceTimestampMs(events: TaskTraceEvent[]): number | null {
  let earliest: number | null = null;
  for (const event of events) {
    const parsed = parseIsoTimestampMs(event.at);
    if (parsed == null) continue;
    earliest = earliest == null ? parsed : Math.min(earliest, parsed);
  }
  return earliest;
}

function getEarliestDefinedTimestampMs(
  values: Array<number | null | undefined>,
): number | null {
  let earliest: number | null = null;
  for (const value of values) {
    if (value == null) continue;
    earliest = earliest == null ? value : Math.min(earliest, value);
  }
  return earliest;
}

function getTaskRunStartedAtMs(task: Task | null | undefined): number | null {
  if (!task) return null;
  return parseIsoTimestampMs(task.active_run_started_at);
}

function getAuthoritativeRunInputPlaceholder(
  tConversation: ReturnType<typeof useTranslations>,
  runState: TaskRunState | null,
) {
  if (runState === "cancelling") {
    return tConversation("input_placeholder_cancelling");
  }
  if (runState === "terminating") {
    return tConversation("input_placeholder_terminating");
  }
  if (runState === "finalizing") {
    return tConversation("input_placeholder_finalizing");
  }
  return null;
}

function hasDeveloperBoundRunnerIssue(task: Task | null | undefined) {
  return task?.bound_runner_kind === "developer" && task.agent_presence !== "online";
}

function getRecoveryTaskPrompt(task: Task): string | undefined {
  const prompt = (task as TaskWithPrompt).prompt;
  return typeof prompt === "string" && prompt.trim().length > 0
    ? prompt.trim()
    : undefined;
}

function toReusableInitialInput(
  input: TaskInputRef,
): NonNullable<CreateTaskRequest["initial_inputs"]>[number] | null {
  if (input.kind === "library_object") {
    return {
      kind: "library_object",
      library_id: input.library_id,
      key: input.key,
      ...(input.name ? { name: input.name } : {}),
      ...(input.content_type ? { content_type: input.content_type } : {}),
      ...(typeof input.size_bytes === "number" ? { size_bytes: input.size_bytes } : {}),
    };
  }
  if (input.kind === "url") {
    return {
      kind: "url",
      url: input.url,
      ...(input.name ? { name: input.name } : {}),
      ...(input.imported_library_id ? { imported_library_id: input.imported_library_id } : {}),
      ...(input.imported_key ? { imported_key: input.imported_key } : {}),
      ...(input.content_type ? { content_type: input.content_type } : {}),
      ...(typeof input.size_bytes === "number" ? { size_bytes: input.size_bytes } : {}),
    };
  }
  return null;
}

function getReusableRecoveryInitialInputs(
  task: Task,
): NonNullable<CreateTaskRequest["initial_inputs"]> {
  return task.attached_inputs.flatMap((input) => {
    const reusableInput = toReusableInitialInput(input);
    return reusableInput ? [reusableInput] : [];
  });
}

function mapListedTerminalSessionStatusToTabStatus(
  status: ListedTerminalSession["status"],
): TerminalStatus {
  if (status === "pending") return "preparing";
  if (status === "disconnected") return "recovering";
  if (status === "failed") return "failed";
  if (status === "closed") return "closed";
  return "active";
}

function getTerminalSessionIdentityForSessionId(sessionId: string): string {
  return `session:${sessionId}`;
}

function getTerminalSessionIdentityForTab(tab: TerminalWorkspaceTab): string {
  return typeof tab.sessionId === "string" && tab.sessionId.length > 0
    ? getTerminalSessionIdentityForSessionId(tab.sessionId)
    : `tab:${tab.id}`;
}

function isListedTerminalSessionRecovering(
  status: ListedTerminalSession["status"],
): boolean {
  return status === "failed" || status === "disconnected";
}

function isTerminalTabRecovering(status: TerminalStatus): boolean {
  return status === "failed" || status === "recovering";
}

function getTerminalSessionOccupancySnapshot({
  terminalTruthResolved,
  terminalTruthSessions,
  terminalTabs,
}: {
  terminalTruthResolved: boolean;
  terminalTruthSessions: ListedTerminalSession[] | null;
  terminalTabs: TerminalWorkspaceTab[];
}): { count: number; recoveryCount: number } {
  const entries = new Map<string, { recovering: boolean }>();
  if (terminalTruthResolved) {
    for (const session of terminalTruthSessions ?? []) {
      if (session.status === "closed") continue;
      entries.set(getTerminalSessionIdentityForSessionId(session.terminal_session_id), {
        recovering: isListedTerminalSessionRecovering(session.status),
      });
    }
  }
  for (const tab of terminalTabs) {
    if (tab.status === "closed") continue;
    const identity = getTerminalSessionIdentityForTab(tab);
    const existing = entries.get(identity);
    entries.set(identity, {
      recovering:
        (existing?.recovering ?? false) || isTerminalTabRecovering(tab.status),
    });
  }
  return {
    count: entries.size,
    recoveryCount: Array.from(entries.values()).filter(
      (entry) => entry.recovering,
    ).length,
  };
}

export function mergeTerminalTabStatus(
  currentStatus: TerminalStatus,
  nextStatus: ListedTerminalSession["status"],
): TerminalStatus {
  const mappedNextStatus = mapListedTerminalSessionStatusToTabStatus(nextStatus);
  if (nextStatus === "failed" || nextStatus === "closed" || nextStatus === "active") {
    return mappedNextStatus;
  }
  const localStatusIsStrongerLiveTruth =
    currentStatus === "connecting" || currentStatus === "active";
  if (localStatusIsStrongerLiveTruth) {
    return currentStatus;
  }
  return mappedNextStatus;
}

function isTerminalRunTraceEvent(event: {
  name: string;
  phase?: string | null;
  status?: string | null;
}) {
  if (event.name === "run.user_cancel") return true;
  if (event.name === "execution.terminal") {
    return (
      event.phase === "end" ||
      event.status === "success" ||
      event.status === "error" ||
      event.status === "cancelled"
    );
  }
  if (event.name === "run.summary") {
    return event.phase === "end";
  }
  if (event.name === "run.lifecycle") {
    return (
      event.phase === "end" &&
      (event.status === "success" ||
        event.status === "error" ||
        event.status === "cancelled")
    );
  }
  return false;
}

interface VisibleActiveRunTraceSnapshot {
  messageId: string;
  startedAtMs: number;
  latestAtMs: number;
}

function getVisibleActiveRunTraceSnapshot(
  traceEventsByMessageId: Record<string, TaskTraceEvent[]>,
): VisibleActiveRunTraceSnapshot | null {
  const runs = new Map<
    string,
    {
      messageId: string;
      startedAtMs: number;
      latestAtMs: number;
      hasTerminalEvent: boolean;
      hasRunObservation: boolean;
    }
  >();

  for (const events of Object.values(traceEventsByMessageId)) {
    for (const event of events) {
      if (!event.run_id || event.run_id === "transport") continue;
      if (event.name.startsWith("transport.")) continue;
      const eventAtMs = parseIsoTimestampMs(event.at);
      if (eventAtMs == null) continue;
      const existing = runs.get(event.run_id);
      const hasTerminalEvent = isTerminalRunTraceEvent(event);
      const hasRunObservation = !hasTerminalEvent;
      if (!existing) {
        runs.set(event.run_id, {
          messageId: event.message_id,
          startedAtMs: eventAtMs,
          latestAtMs: eventAtMs,
          hasTerminalEvent,
          hasRunObservation,
        });
        continue;
      }
      runs.set(event.run_id, {
        messageId:
          eventAtMs < existing.startedAtMs
            ? event.message_id
            : existing.messageId,
        startedAtMs: Math.min(existing.startedAtMs, eventAtMs),
        latestAtMs: Math.max(existing.latestAtMs, eventAtMs),
        hasTerminalEvent: existing.hasTerminalEvent || hasTerminalEvent,
        hasRunObservation: existing.hasRunObservation || hasRunObservation,
      });
    }
  }

  const candidates = [...runs.values()]
    .filter((run) => run.hasRunObservation && !run.hasTerminalEvent)
    .sort((left, right) =>
      right.latestAtMs !== left.latestAtMs
        ? right.latestAtMs - left.latestAtMs
        : left.startedAtMs - right.startedAtMs,
    );
  const selected = candidates[0];
  return selected
    ? {
        messageId: selected.messageId,
        startedAtMs: selected.startedAtMs,
        latestAtMs: selected.latestAtMs,
      }
    : null;
}

function getVisibleActiveRunMessage(
  messages: TaskActivityItem[],
): TaskActivityItem | null {
  const latestMessage = [...messages].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  ).at(-1);
  if (!latestMessage || latestMessage.actor !== "runner") return null;
  return latestMessage.content.trim().length === 0 ? latestMessage : null;
}

function getLatestUnansweredUserMessageStartedAtMs(
  messages: TaskActivityItem[],
): number | null {
  const sortedMessages = [...messages].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
  const latestMessage = sortedMessages.at(-1);
  if (!latestMessage || latestMessage.actor !== "user") return null;
  return parseIsoTimestampMs(latestMessage.created_at);
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

function getTerminalWorkspaceTabLabel(
  tTask: TaskTranslationFn,
  displayIndex: number,
) {
  return `${tTask("terminal_session")} ${displayIndex}`;
}

function relabelTerminalWorkspaceTabs(
  tTask: TaskTranslationFn,
  tabs: TerminalWorkspaceTab[],
): TerminalWorkspaceTab[] {
  return tabs.map((tab, index) => ({
    ...tab,
    label: getTerminalWorkspaceTabLabel(tTask, index + 1),
  }));
}

function getNextTerminalTabOrdinal(tabs: TerminalWorkspaceTab[]) {
  return (
    tabs.reduce((maxOrdinal, tab) => {
      const suffix = Number.parseInt(tab.id.replace("terminal-session-", ""), 10);
      return Number.isFinite(suffix) ? Math.max(maxOrdinal, suffix) : maxOrdinal;
    }, 0) + 1
  );
}

function getReconcileRefetchError(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") {
    return result.reason instanceof Error
      ? result.reason
      : new Error("Task runtime reconcile failed.");
  }
  if (typeof result.value !== "object" || result.value === null) {
    return null;
  }
  if (!("error" in result.value) || result.value.error == null) {
    return null;
  }
  return result.value.error instanceof Error
    ? result.value.error
    : new Error(String(result.value.error));
}

function isTerminalRecoveryTab(tab: TerminalWorkspaceTab) {
  return tab.status === "failed" || tab.status === "recovering";
}

function isListedTerminalSessionRecoveryStatus(
  status: ListedTerminalSession["status"],
) {
  return status === "failed" || status === "disconnected";
}

export function getPreferredRecoveryTerminalTabId(
  tabs: TerminalWorkspaceTab[],
  terminalTruthSessions: ListedTerminalSession[] | null,
  activeTerminalTabId: string | null,
) {
  const recoverySessionIds = new Set(
    (terminalTruthSessions ?? [])
      .filter((session) => isListedTerminalSessionRecoveryStatus(session.status))
      .map((session) => session.terminal_session_id),
  );
  const recoveryTabIds = new Set(
    tabs
      .filter(
        (tab) =>
          isTerminalRecoveryTab(tab) ||
          (typeof tab.sessionId === "string" &&
            recoverySessionIds.has(tab.sessionId)),
      )
      .map((tab) => tab.id),
  );
  const activeTabId =
    tabs.find((tab) => tab.id === activeTerminalTabId)?.id ?? null;
  return (
    (activeTabId && recoveryTabIds.has(activeTabId) ? activeTabId : null) ??
    tabs.find((tab) => recoveryTabIds.has(tab.id))?.id ??
    activeTabId ??
    tabs[0]?.id ??
    null
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
  const tTask = useTranslations("agent_tasks.task");
  const tConversation = useTranslations("agent_tasks.conversation");
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
  const [activeRunTraceMessageId, setActiveRunTraceMessageId] =
    React.useState<string | null>(null);
  const [isAgentTurnRunning, setIsAgentTurnRunning] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [runServerStartedAt, setRunServerStartedAt] = React.useState<
    number | null
  >(null);
  const [lastRunActionSummary, setLastRunActionSummary] = React.useState<
    string | null
  >(null);
  const [runClockNow, setRunClockNow] = React.useState<number>(Date.now());
  const [pendingMessages, setPendingMessages] = React.useState<
    PendingMessage[]
  >([]);
  const [optimisticUserMessages, setOptimisticUserMessages] = React.useState<
    TaskActivityItem[]
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
  const [terminalTruthSessions, setTerminalTruthSessions] = React.useState<ListedTerminalSession[] | null>(null);
  const [preferredArtifactsDrawerOpen, setPreferredArtifactsDrawerOpen] = React.useState(
    initialStoredTerminalWorkspaceState?.artifactsDrawerOpen ?? true,
  );
  const [terminalWorkspaceHydrationState, setTerminalWorkspaceHydrationState] =
    React.useState<TerminalWorkspaceHydrationState>("pending");
  const [endAllTerminalDialogOpen, setEndAllTerminalDialogOpen] = React.useState(false);
  const [endAllTerminalPending, setEndAllTerminalPending] = React.useState(false);
  const [cancelEscalationDialogOpen, setCancelEscalationDialogOpen] =
    React.useState(false);
  const [cancelEscalationReason, setCancelEscalationReason] =
    React.useState<string | null>(null);
  const nextTerminalTabOrdinalRef = React.useRef(1);
  const terminalTabsRef = React.useRef<TerminalWorkspaceTab[]>([]);
  const activeTerminalTabIdRef = React.useRef<string | null>(null);
  const terminalTruthSessionsRef = React.useRef<ListedTerminalSession[] | null>(null);
  const viewModeRef = React.useRef<TerminalViewMode>("conversation");
  const preferredArtifactsDrawerOpenRef = React.useRef(
    initialStoredTerminalWorkspaceState?.artifactsDrawerOpen ?? true,
  );
  const hydratedTerminalTaskScopeRef = React.useRef<string | null>(null);
  const terminalWorkspaceHydrationRequestRef = React.useRef(0);
  const terminalWorkspaceTruthRequestRef = React.useRef(0);
  const closingTerminalTabIdsRef = React.useRef<Set<string>>(new Set());
  const closingTerminalSessionIdsRef = React.useRef<Set<string>>(new Set());
  const terminalSessionIdsAwaitingBackendTruthRef = React.useRef<Set<string>>(
    new Set(),
  );
  const terminalSessionIdsWithPreservedEmptyTruthRef = React.useRef<Set<string>>(
    new Set(),
  );
  const commitViewMode = React.useCallback((mode: TerminalViewMode) => {
    viewModeRef.current = mode;
    setViewMode(mode);
  }, []);

  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();
  const taskAPI = React.useMemo(() => new TaskAPI(getApiClient()), []);
  const pendingFlushInFlightRef = React.useRef(false);
  const runtimeIdleReconcileKeyRef = React.useRef<string | null>(null);
  const runtimeIdleReconcileInFlightRef = React.useRef(false);
  const cancelEscalationTimerRef = React.useRef<number | null>(null);
  const cancelEscalationPromptedRef = React.useRef(false);
  const cancelEscalationCheckInFlightRef = React.useRef(false);
  const activeRunMessageIdRef = React.useRef<string | null>(null);
  const [runtimeReconciliationActive, setRuntimeReconciliationActive] =
    React.useState(false);
  const sendMessage = useStartTaskRun();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: task, isLoading: taskLoading, refetch: refetchTask } = useTask(
    workspaceId,
    projectId,
    taskId,
    {
      refetchInterval: (query) => {
        const currentTask = query.state.data as Task | undefined;
        return (
          isTaskRunStateActive(currentTask?.run_state) ||
            sendMessage.isPending ||
            isAgentTurnRunning ||
            runtimeReconciliationActive
        )
          ? 5000
          : false;
      },
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  );
  const { data: messages, refetch: refetchMessages } = useTaskActivity(
    workspaceId,
    projectId,
    taskId,
  );
  const artifactsRefreshInterval = (
    isTaskRunStateActive(task?.run_state) ||
    sendMessage.isPending ||
    isAgentTurnRunning ||
    runtimeReconciliationActive
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

  // Query keys for this task — used by both useQuery hooks and SSE cache writes
  const messagesKey = queryKeys.tasks.activity(workspaceId, projectId, taskId);
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
  const agentTaskDiagnosticsLinks = React.useMemo(
    () => ({
      audit: `${basePath}/audit${diagnosticsQuery}`,
      usage: `${basePath}/usage${diagnosticsQuery}`,
    }),
    [basePath, diagnosticsQuery],
  );

  const resetCurrentRunUiState = React.useCallback(() => {
    setStreamingMessageId(null);
    setStreamingContent("");
    setActiveRunTraceMessageId(null);
    setIsAgentTurnRunning(false);
    setRunStartedAt(null);
    setRunServerStartedAt(null);
    setRunClockNow(Date.now());
    setLastRunActionSummary(null);
  }, []);
  const clearRealtimeFailure = React.useCallback(() => {
    setRealtimeFailureCode(null);
    setRealtimeFailureMessage(null);
  }, []);
  const beginTerminalWorkspaceTruthRequest = React.useCallback(() => {
    const requestId = terminalWorkspaceTruthRequestRef.current + 1;
    terminalWorkspaceTruthRequestRef.current = requestId;
    return requestId;
  }, []);
  const isLatestTerminalWorkspaceTruthRequest = React.useCallback(
    (requestId: number) =>
      terminalWorkspaceTruthRequestRef.current === requestId,
    [],
  );

  React.useEffect(() => {
    if (!optimisticUserMessages.length || !(messages?.length ?? 0)) return;
    setOptimisticUserMessages((prev) => {
      const unmatchedServerMessages = [...(messages ?? [])].filter(
        (message) => message.actor === "user",
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
      .find((message) => message.actor === "runner");
    return latestAgentMessage?.id ?? null;
  }, [messages, streamingMessageId]);

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

  const reconcileTaskRuntime = React.useCallback(
    async (reason: string) => {
      setRuntimeReconciliationActive(true);
      const afterId = lastTraceEventIdRef.current;
      appendSseDebugEvent(
        {
          at: new Date().toISOString(),
          phase: "trace_reconcile_start",
          summary: `reason=${reason} mode=${afterId ? "after_id" : "refetch"} after_id=${afterId ?? "none"}`,
        },
        activeTraceMessageId,
      );
      const [taskRefetchResult, messagesRefetchResult, artifactsRefetchResult] =
        await Promise.allSettled([
        refetchTask(),
        refetchMessages(),
        refetchArtifacts(),
      ]);
      const reconcileRefetchError =
        getReconcileRefetchError(taskRefetchResult) ??
        getReconcileRefetchError(messagesRefetchResult);
      void artifactsRefetchResult;
      try {
        const resp = await taskAPI.listTraces(workspaceId, projectId, taskId, {
          ...(afterId ? { after_id: afterId } : {}),
          page_size: 500,
        });
        mergeTraceEvents(resp.items);
        if (reconcileRefetchError) {
          throw reconcileRefetchError;
        }
        appendSseDebugEvent(
          {
            at: new Date().toISOString(),
            phase: "trace_reconcile_done",
            summary: `reason=${reason} items=${resp.items.length}`,
          },
          activeTraceMessageId,
        );
        clearRealtimeFailure();
      } catch (err) {
        setRealtimeFailureCode("TRACE_RECONCILE_FAILED");
        setRealtimeFailureMessage(
          err instanceof Error ? err.message : "Task trace reconcile failed.",
        );
        appendSseDebugEvent(
          {
            at: new Date().toISOString(),
            phase: "trace_reconcile_error",
            summary: `reason=${reason} task_traces_reconcile_failed`,
          },
          activeTraceMessageId,
        );
        handleError(err, { logContext: "TaskPage.traceGapFill" });
      }
    },
    [
      activeTraceMessageId,
      appendSseDebugEvent,
      clearRealtimeFailure,
      handleError,
      lastTraceEventIdRef,
      mergeTraceEvents,
      projectId,
      refetchArtifacts,
      refetchMessages,
      refetchTask,
      taskAPI,
      taskId,
      workspaceId,
    ],
  );

  const authoritativeRunState = task?.run_state ?? null;
  const authoritativeLastActivityAt = task?.last_activity_at ?? null;
  const backendRunActive = isTaskRunStateRunning(authoritativeRunState);
  const backendRunBusy = isTaskRunStateActive(authoritativeRunState);
  const backendRunStoppingOrFinalizing =
    isTaskRunStateStoppingOrFinalizing(authoritativeRunState);
  const effectiveRunState: TaskRunState =
    backendRunBusy
      ? authoritativeRunState
      : sendMessage.isPending || isAgentTurnRunning
        ? "running"
        : "idle";

  const cancelActiveRun = useMutation({
    mutationFn: (options?: { mode?: "cancel" | "terminate" }) =>
      options
        ? taskAPI.cancelRun(workspaceId, projectId, taskId, options)
        : taskAPI.cancelRun(workspaceId, projectId, taskId),
    onSuccess: (response) => {
      const nextRunState =
        response.status === "terminating" ? "terminating" : "cancelling";
      if (nextRunState === "terminating") {
        setCancelEscalationDialogOpen(false);
      }
      queryClient.setQueryData(taskDetailKey, (old: Task | undefined) =>
        old
          ? {
              ...old,
              run_state: nextRunState,
              stop_mode: response.stop_mode,
              can_escalate: response.can_escalate,
              escalation_reason:
                response.escalation_reason !== undefined
                  ? response.escalation_reason
                  : null,
            }
          : old,
      );
      setLastRunActionSummary(
        nextRunState === "terminating"
          ? tConversation("run_terminating_description")
          : tConversation("run_cancel_requested"),
      );
      toast.info(
        nextRunState === "terminating"
          ? tConversation("run_terminating_description")
          : tConversation("run_cancel_requested"),
      );
      void reconcileTaskRuntime("cancel_request");
    },
    onError: (err) => {
      handleError(err, {
        logContext: "TaskPage.cancelActiveRun",
        showToast: true,
      });
    },
  });

  const clearCancelEscalationTimer = React.useCallback(() => {
    if (cancelEscalationTimerRef.current !== null) {
      window.clearTimeout(cancelEscalationTimerRef.current);
      cancelEscalationTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      clearCancelEscalationTimer();
    };
  }, [clearCancelEscalationTimer]);

  React.useEffect(() => {
    if (authoritativeRunState !== "cancelling") {
      clearCancelEscalationTimer();
      cancelEscalationPromptedRef.current = false;
      cancelEscalationCheckInFlightRef.current = false;
      setCancelEscalationDialogOpen(false);
      setCancelEscalationReason(null);
      return;
    }
    if (
      cancelEscalationTimerRef.current !== null ||
      cancelEscalationPromptedRef.current ||
      cancelEscalationCheckInFlightRef.current
    ) {
      return;
    }
    cancelEscalationTimerRef.current = window.setTimeout(() => {
      cancelEscalationTimerRef.current = null;
      if (cancelEscalationPromptedRef.current) return;
      cancelEscalationCheckInFlightRef.current = true;
      void refetchTask()
        .then((result) => {
          const authoritativeTask = result.data ?? null;
          if (authoritativeTask?.run_state !== "cancelling") {
            return;
          }
          if (authoritativeTask.can_escalate !== true) {
            return;
          }
          const escalationReason = authoritativeTask.escalation_reason ?? null;
          cancelEscalationPromptedRef.current = true;
          setCancelEscalationReason(
            normalizeCancelEscalationReason(escalationReason),
          );
          setCancelEscalationDialogOpen(true);
        })
        .finally(() => {
          cancelEscalationCheckInFlightRef.current = false;
        });
    }, NOTEBOOK_CANCEL_ESCALATION_PROMPT_DELAY_MS);
  }, [
    authoritativeRunState,
    clearCancelEscalationTimer,
    refetchTask,
  ]);

  React.useEffect(() => {
    if (effectiveRunState === "idle") return;
    const timer = setInterval(() => {
      setRunClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveRunState]);

  React.useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  React.useEffect(() => {
    activeTerminalTabIdRef.current = activeTerminalTabId;
  }, [activeTerminalTabId]);

  React.useEffect(() => {
    terminalTruthSessionsRef.current = terminalTruthSessions;
  }, [terminalTruthSessions]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    preferredArtifactsDrawerOpenRef.current = preferredArtifactsDrawerOpen;
  }, [preferredArtifactsDrawerOpen]);

  React.useEffect(() => {
    const preferredActiveSessionId =
      terminalTabs.find((tab) => tab.id === activeTerminalTabId)?.sessionId ?? null;
    writeStoredTerminalWorkspaceState(workspaceId, projectId, taskId, {
      preferredViewMode: viewMode,
      preferredActiveSessionId,
      artifactsDrawerOpen: preferredArtifactsDrawerOpen,
    });
  }, [
    activeTerminalTabId,
    preferredArtifactsDrawerOpen,
    projectId,
    taskId,
    terminalTabs,
    viewMode,
    workspaceId,
  ]);

  // SSE connection for real-time updates
  const isDev = process.env.NODE_ENV === "development";
  const showSseDebugPanel =
    isDev && getPublicRuntimeConfig().agentTaskSseDebugPanel;
  const { connectionStatus, connectionErrorCode, connectionErrorMessage } =
    useTaskSSE(workspaceId, projectId, taskId, {
      onMessage: (message: TaskActivityItem) => {
        // Update streaming content for the active streaming message
        if (streamingMessageId === message.id) {
          setStreamingContent(message.content);
        }

        queryClient.setQueryData(
          messagesKey,
          (old: TaskActivityItem[] | undefined) => {
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
        setLastRunActionSummary(
          deriveRunAction({
            event: traceEvent,
            fallbackSummary: traceEvent.name,
          }).summary,
        );
        mergeTraceEvents([traceEvent]);
        if (effectiveRunState !== "idle") {
          setActiveRunTraceMessageId(traceEvent.message_id);
        }
        const terminalTraceMatchesActiveRun =
          isTerminalRunTraceEvent(traceEvent) &&
          (
            streamingMessageId === traceEvent.message_id ||
            (
              !streamingMessageId &&
              (
                activeRunTraceMessageId === traceEvent.message_id ||
                activeRunMessageIdRef.current === traceEvent.message_id
              )
            )
          );
        if (
          terminalTraceMatchesActiveRun
        ) {
          setTaskUpdateCountForCurrentTurn(0);
          resetCurrentRunUiState();
          void reconcileTaskRuntime(traceEvent.name);
        }
      },
      onError: (error) => {
        setTaskUpdateCountForCurrentTurn(0);
        resetCurrentRunUiState();
        setRuntimeReconciliationActive(true);
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
      watchdogEnabled:
        backendRunBusy ||
        sendMessage.isPending ||
        isAgentTurnRunning ||
        runtimeReconciliationActive,
      watchdogTimeoutMs: 20_000,
    });
  const effectiveRealtimeFailureCode =
    connectionErrorCode ?? realtimeFailureCode;
  const effectiveRealtimeFailureMessage =
    connectionErrorMessage ?? realtimeFailureMessage;

  const previousConnectionStatusRef = React.useRef<
    typeof connectionStatus | null
  >(null);

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
      resetTraceBackfillState();
      void reconcileTaskRuntime("stream_recovered");
    }
  }, [
    connectionStatus,
    resetTraceBackfillState,
    reconcileTaskRuntime,
  ]);

  const enqueuePendingMessage = React.useCallback((content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    setPendingMessages((prev) => [...prev, createPendingMessage(normalized)]);
  }, []);

  const buildStartRunRequest = React.useCallback(
    (content: string): StartTaskRunRequest => ({ intent: content }),
    [],
  );

  const sendMessageNow = React.useCallback(
    async (content: string, source: "direct" | "queue") => {
      try {
        const optimisticUserMessage: TaskActivityItem = {
          id: makeClientId("optimistic-user"),
          task_id: taskId,
          kind: "user_intent",
          actor: "user",
          content,
          created_at: new Date().toISOString(),
        };
        setOptimisticUserMessages((prev) => [...prev, optimisticUserMessage]);

        // Clear previous streaming state
        setStreamingMessageId(null);
        setStreamingContent("");
        setActiveRunTraceMessageId(null);
        setIsAgentTurnRunning(false);
        setRunStartedAt(null);
        setRunServerStartedAt(null);
        setRunClockNow(Date.now());
        setLastRunActionSummary(null);
        setTaskUpdateCountForCurrentTurn(0);

        // Send message and get response
        const response = await sendMessage.mutateAsync({
          workspaceId,
          projectId,
          taskId,
          data: buildStartRunRequest(content),
        });

        // If response indicates streaming, set up streaming state
        // The actual streaming content will come through SSE
        if (response.actor === "runner") {
          const responseCreatedAtMs =
            parseIsoTimestampMs(response.created_at) ?? Date.now();
          queryClient.setQueryData(
            messagesKey,
            (old: TaskActivityItem[] | undefined) => {
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
                  last_activity_at: response.created_at,
                }
              : old,
          );
          setStreamingMessageId(response.id);
          setStreamingContent("");
          setIsAgentTurnRunning(true);
          setRunStartedAt(Date.now());
          setRunServerStartedAt(responseCreatedAtMs);
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
        setRunServerStartedAt(null);
        setRunClockNow(Date.now());
        setLastRunActionSummary(null);
        setTaskUpdateCountForCurrentTurn(0);
        if (err instanceof ApiError) {
          const errorCode = err.errorCode?.toUpperCase();
          if (errorCode === "TASK_STREAM_CONFLICT") {
            setRuntimeReconciliationActive(true);
            const refetchedTask = await refetchTask()
              .then((result) => result.data ?? null)
              .catch(() => null);
            void reconcileTaskRuntime("send_conflict");
            const conflictRunState = refetchedTask?.run_state ?? null;
            const conflictRunStoppingOrFinalizing =
              isTaskRunStateStoppingOrFinalizing(conflictRunState);
            if (conflictRunStoppingOrFinalizing) {
              const stoppingInputPlaceholder = getAuthoritativeRunInputPlaceholder(
                tConversation,
                conflictRunState,
              );
              if (stoppingInputPlaceholder) {
                toast.info(stoppingInputPlaceholder);
              }
              return;
            }
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
        }
        handleError(err, {
          logContext: "TaskPage.sendMessage",
          showToast: true,
        });
      }
    },
    [
      buildStartRunRequest,
      enqueuePendingMessage,
      handleError,
      messagesKey,
      projectId,
      queryClient,
      reconcileTaskRuntime,
      refetchTask,
      sendMessage,
      setRuntimeReconciliationActive,
      tConversation,
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
    if (backendRunStoppingOrFinalizing) {
      const stoppingInputPlaceholder = getAuthoritativeRunInputPlaceholder(
        tConversation,
        authoritativeRunState,
      );
      if (stoppingInputPlaceholder) {
        toast.info(stoppingInputPlaceholder);
      }
      return;
    }
    if (
      isAgentTurnRunning ||
      sendMessage.isPending ||
      backendRunActive ||
      runtimeReconciliationActive
    ) {
      if (backendRunActive || runtimeReconciliationActive) {
        setRuntimeReconciliationActive(true);
      }
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

  const handleCancelActiveRun = React.useCallback(() => {
    if (!(isAgentTurnRunning || sendMessage.isPending || backendRunActive))
      return;
    if (cancelActiveRun.isPending) return;
    void cancelActiveRun.mutateAsync(undefined);
  }, [
    backendRunActive,
    cancelActiveRun,
    isAgentTurnRunning,
    sendMessage.isPending,
  ]);

  const handleConfirmCancelEscalation = React.useCallback(() => {
    if (cancelActiveRun.isPending) return;
    void cancelActiveRun.mutateAsync({ mode: "terminate" });
  }, [cancelActiveRun]);

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
    if (isTaskRunStateActive(authoritativeRunState) || !runtimeReconciliationActive) {
      runtimeIdleReconcileKeyRef.current = null;
      runtimeIdleReconcileInFlightRef.current = false;
    }
  }, [authoritativeRunState, runtimeReconciliationActive]);

  React.useEffect(() => {
    if (!runtimeReconciliationActive) return;
    if (authoritativeRunState == null) return;
    if (authoritativeRunState !== "idle") return;
    if (sendMessage.isPending || isAgentTurnRunning || cancelActiveRun.isPending) {
      return;
    }
    const reconcileKey = [
      authoritativeLastActivityAt ?? "none",
      activeTraceMessageId ?? "none",
      effectiveRealtimeFailureCode ?? "none",
    ].join(":");
    if (runtimeIdleReconcileInFlightRef.current) {
      return;
    }
    if (runtimeIdleReconcileKeyRef.current === reconcileKey) {
      setRuntimeReconciliationActive(false);
      return;
    }
    runtimeIdleReconcileKeyRef.current = reconcileKey;
    runtimeIdleReconcileInFlightRef.current = true;
    void reconcileTaskRuntime("backend_idle_truth").finally(() => {
      runtimeIdleReconcileInFlightRef.current = false;
      setRuntimeReconciliationActive(false);
    });
  }, [
    activeTraceMessageId,
    cancelActiveRun.isPending,
    effectiveRealtimeFailureCode,
    isAgentTurnRunning,
    reconcileTaskRuntime,
    runtimeReconciliationActive,
    sendMessage.isPending,
    authoritativeLastActivityAt,
    authoritativeRunState,
  ]);

  React.useEffect(() => {
    if (task?.run_state !== "running") return;
    if (sendMessage.isPending || isAgentTurnRunning || runtimeReconciliationActive) {
      return;
    }
    void reconcileTaskRuntime("backend_run_truth");
  }, [
    isAgentTurnRunning,
    reconcileTaskRuntime,
    runtimeReconciliationActive,
    sendMessage.isPending,
    task?.run_state,
  ]);

  React.useEffect(() => {
    const taskArchived = task?.status === "archived";
    if (taskArchived || !canUpdateTask) return;
    if (
      isAgentTurnRunning ||
      sendMessage.isPending ||
      backendRunBusy ||
      runtimeReconciliationActive
    ) return;
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
    backendRunBusy,
    isAgentTurnRunning,
    pendingMessages,
    runtimeReconciliationActive,
    sendMessage.isPending,
    sendMessageNow,
    task?.status,
  ]);

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
  };

  const handleTaskCreated = React.useCallback((newTaskId: string) => {
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/${newTaskId}`,
    );
  }, [locale, projectId, router, workspaceId]);

  const handleCreateBoundRunnerRecoveryTask = React.useCallback(async () => {
    if (!task || !canCreateTask) return;
    try {
      const reusableInitialInputs = getReusableRecoveryInitialInputs(task);
      const prompt = getRecoveryTaskPrompt(task);
      const data: RecoveryCreateTaskRequest = {
        title: task.title,
        workspace_mode: "create_new",
        workspace_name: deriveDefaultTaskWorkspaceName(task.title),
        ...(prompt ? { prompt } : {}),
        ...(reusableInitialInputs.length > 0
          ? { initial_inputs: reusableInitialInputs }
          : {}),
      };
      const newTask = await createTask.mutateAsync({
        workspaceId,
        projectId,
        data,
      });
      handleTaskCreated(newTask.id);
    } catch (error) {
      handleError(error, {
        logContext: "TaskPage.createBoundRunnerRecoveryTask",
        showToast: true,
      });
    }
  }, [
    createTask,
    handleError,
    handleTaskCreated,
    canCreateTask,
    projectId,
    task,
    workspaceId,
  ]);

  const handleTaskDeleted = () => {
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`,
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
    // Navigate to the agent task list.
    // SSE connection will be automatically cleaned up when component unmounts
    router.push(
      `/${locale}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`,
    );
  };
  const requestTerminalTabFocus = React.useCallback((tabId: string | null) => {
    if (!tabId) return;
    let found = false;
    const nextTabs = terminalTabsRef.current.map((tab) => {
      if (tab.id !== tabId) return tab;
      found = true;
      return {
        ...tab,
        focusRequestToken: (tab.focusRequestToken ?? 0) + 1,
      };
    });
    if (!found) return;
    terminalTabsRef.current = nextTabs;
    setTerminalTabs(nextTabs);
  }, []);
  const handleSetViewMode = React.useCallback((mode: TerminalViewMode) => {
    const currentTerminalSessionCount = getTerminalSessionOccupancySnapshot({
      terminalTruthResolved: terminalWorkspaceHydrationState === "ready",
      terminalTruthSessions,
      terminalTabs,
    }).count;
    if (mode === "terminal" && currentTerminalSessionCount === 0) return;
    commitViewMode(mode);
    if (mode === "terminal") {
      const nextActiveTerminalTabId =
        terminalTabs.find((tab) => tab.id === activeTerminalTabIdRef.current)
          ?.id ??
        terminalTabs[0]?.id ??
        null;
      requestTerminalTabFocus(nextActiveTerminalTabId);
    }
  }, [
    commitViewMode,
    requestTerminalTabFocus,
    terminalTabs,
    terminalTruthSessions,
    terminalWorkspaceHydrationState,
  ]);
  const hasTask = task != null;
  const taskStatus = task?.status ?? "active";
  const isDisabled = taskStatus === "archived";
  const agentIsBusy =
    sendMessage.isPending || isAgentTurnRunning || backendRunBusy;
  const pendingActiveRunMessageId = getPendingActiveRunMessageId(taskId);
  const visibleActiveTraceRun = React.useMemo(
    () => getVisibleActiveRunTraceSnapshot(traceEventsByMessageId),
    [traceEventsByMessageId],
  );
  const visibleActiveRunMessage = React.useMemo(
    () => getVisibleActiveRunMessage(messagesForDisplay),
    [messagesForDisplay],
  );
  const activeRunMessageId =
    effectiveRunState !== "idle"
      ? (streamingMessageId ??
        activeRunTraceMessageId ??
        visibleActiveTraceRun?.messageId ??
        visibleActiveRunMessage?.id ??
        pendingActiveRunMessageId)
      : null;
  React.useEffect(() => {
    activeRunMessageIdRef.current = activeRunMessageId;
  }, [activeRunMessageId]);
  const activeTraceEvents = activeRunMessageId
    ? (traceEventsByMessageId[activeRunMessageId] ?? [])
    : [];
  const activeRunMessageStartedAt =
    activeRunMessageId && activeRunMessageId !== pendingActiveRunMessageId
      ? getMessageCreatedAtMs(messagesForDisplay, activeRunMessageId)
      : null;
  const activeTraceStartedAt =
    activeRunMessageId === visibleActiveTraceRun?.messageId
      ? visibleActiveTraceRun.startedAtMs
      : getEarliestTraceTimestampMs(activeTraceEvents);
  const latestUnansweredUserStartedAt =
    activeRunMessageStartedAt == null && activeTraceStartedAt == null
      ? getLatestUnansweredUserMessageStartedAtMs(messagesForDisplay)
      : null;
  const serverObservedRunStartedAt =
    effectiveRunState !== "idle"
      ? (getTaskRunStartedAtMs(task) ??
        getEarliestDefinedTimestampMs([
          activeTraceStartedAt,
          activeRunMessageStartedAt,
        ]) ??
        latestUnansweredUserStartedAt)
      : null;
  const effectiveRunStartedAt =
    effectiveRunState !== "idle"
      ? (serverObservedRunStartedAt ??
        runServerStartedAt ??
        runStartedAt ??
        Date.now())
      : null;
  const runElapsedSeconds = effectiveRunStartedAt
    ? Math.max(0, Math.floor((runClockNow - effectiveRunStartedAt) / 1000))
    : 0;
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
  const activeRunStartedAtIso =
    effectiveRunStartedAt != null
      ? new Date(effectiveRunStartedAt).toISOString()
      : null;
  const activeRunView: ActiveRunView | null =
    activeRunMessageId && effectiveRunState !== "idle"
      ? {
          messageId: activeRunMessageId,
          runState: effectiveRunState,
          latestAction: latestRunAction,
          recentActions: recentRunActions,
          startedAt: activeRunStartedAtIso,
          elapsedSeconds: runElapsedSeconds,
          cancelPending: cancelActiveRun.isPending,
          onCancel: handleCancelActiveRun,
          realtimeHealth: {
            status: connectionStatus ?? "connected",
            code: effectiveRealtimeFailureCode,
            message: effectiveRealtimeFailureMessage,
          },
        }
      : null;
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
  const terminalTruthResolved = terminalWorkspaceHydrationState === "ready";
  const terminalOccupancySnapshot = getTerminalSessionOccupancySnapshot({
    terminalTruthResolved,
    terminalTruthSessions,
    terminalTabs,
  });
  const terminalSessionCount = terminalOccupancySnapshot.count;
  const hasTerminalSessions = terminalSessionCount > 0;
  const terminalBootstrapPending =
    hasTask &&
    taskStatus === "active" &&
    terminalWorkspaceHydrationState === "pending";
  const terminalTruthUnavailable =
    hasTask &&
    taskStatus === "active" &&
    terminalWorkspaceHydrationState === "unavailable";
  const artifactsList = artifacts ?? [];
  const hasArtifacts = artifactsList.length > 0;
  const effectiveViewMode =
    (terminalTruthResolved || terminalTruthUnavailable) && terminalSessionCount === 0
      ? "conversation"
      : viewMode;
  const artifactsDrawerOpen =
    hasArtifacts && effectiveViewMode === "conversation"
      ? preferredArtifactsDrawerOpen
      : false;
  const showArtifactsToggle =
    hasArtifacts && effectiveViewMode === "conversation";
  const terminalRecoveryCount = terminalOccupancySnapshot.recoveryCount;
  const terminalHasRecovery = terminalRecoveryCount > 0;
  const terminalHasRecoveryOnly =
    terminalHasRecovery && terminalRecoveryCount >= terminalSessionCount;
  const terminalHasMixedRecovery =
    terminalHasRecovery && terminalRecoveryCount < terminalSessionCount;
  const terminalSessionSummaryLabel = getTerminalSessionSummaryLabel(tTask, {
    count: terminalSessionCount,
    recoveryCount: terminalRecoveryCount,
    hasRecovery: terminalHasRecovery,
  });
  React.useEffect(() => {
    if (terminalSessionCount === 0 && endAllTerminalDialogOpen) {
      setEndAllTerminalDialogOpen(false);
    }
  }, [endAllTerminalDialogOpen, terminalSessionCount]);
  const terminalHiddenStateDescription = terminalHasRecoveryOnly
    ? tTask("terminal_hidden_failed_description", {
        count: terminalSessionCount,
      })
    : terminalHasMixedRecovery
      ? tTask("terminal_hidden_mixed_description", {
          count: terminalSessionCount,
          recoveryCount: terminalRecoveryCount,
        })
      : tTask("terminal_hidden_active_description", {
          count: terminalSessionCount,
        });
  const terminalWorkspaceActionLabel = terminalHasRecovery
    ? tTask("terminal_recovery_show")
    : tTask("terminal_workspace_open");
  const developerBoundRunnerIssue =
    canCreateTask && hasDeveloperBoundRunnerIssue(task);
  const boundRunnerRecoveryActionLabel = developerBoundRunnerIssue
    ? tTask("runner_binding_issue_action")
    : null;
  const isConversationInputDisabled =
    isDisabled ||
    !canUpdateTask ||
    terminalBootstrapPending ||
    terminalTruthUnavailable ||
    hasTerminalSessions ||
    backendRunStoppingOrFinalizing;
  const runStateInputPlaceholder =
    getAuthoritativeRunInputPlaceholder(tConversation, authoritativeRunState);
  const terminalDisabledReason = terminalSessionCount >= 3
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
    terminalSessionCount < 3;
  const deleteBlockedReason = terminalBootstrapPending
    ? tTask("delete_blocked_terminal_sessions_pending")
    : terminalTruthUnavailable
      ? tTask("delete_blocked_terminal_sessions_unavailable")
    : hasTerminalSessions
      ? tTask("delete_blocked_terminal_sessions")
      : null;
  const handleOpenTerminalWorkspace = React.useCallback(
    (preferRecovery: boolean = false) => {
      if (terminalTabsRef.current.length === 0) {
        return;
      }
      const nextActiveTerminalTabId = preferRecovery
        ? getPreferredRecoveryTerminalTabId(
            terminalTabsRef.current,
            terminalTruthSessions,
            activeTerminalTabIdRef.current,
          )
        : terminalTabsRef.current.find(
            (tab) => tab.id === activeTerminalTabIdRef.current,
          )?.id ??
          terminalTabsRef.current[0]?.id ??
          null;
      if (nextActiveTerminalTabId !== activeTerminalTabIdRef.current) {
        setActiveTerminalTabId(nextActiveTerminalTabId);
        activeTerminalTabIdRef.current = nextActiveTerminalTabId;
      }
      commitViewMode("terminal");
      requestTerminalTabFocus(nextActiveTerminalTabId);
    },
    [commitViewMode, requestTerminalTabFocus, terminalTruthSessions],
  );

  const resetTerminalWorkspaceState = React.useCallback(() => {
    const nextArtifactsDrawerOpen = preferredArtifactsDrawerOpenRef.current;
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
    commitViewMode("conversation");
    setTerminalTruthSessions([]);
    closingTerminalTabIdsRef.current.clear();
    closingTerminalSessionIdsRef.current.clear();
    terminalSessionIdsAwaitingBackendTruthRef.current.clear();
    terminalSessionIdsWithPreservedEmptyTruthRef.current.clear();
    nextTerminalTabOrdinalRef.current = 1;
    initialStoredTerminalWorkspaceStateRef.current = {
      preferredViewMode: "conversation",
      preferredActiveSessionId: null,
      artifactsDrawerOpen: nextArtifactsDrawerOpen,
    };
  }, [
    commitViewMode,
    preferredArtifactsDrawerOpenRef,
    projectId,
    taskId,
    workspaceId,
  ]);

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
        commitViewMode("conversation");
      }
      closingTerminalTabIdsRef.current.clear();
      closingTerminalSessionIdsRef.current.clear();
      terminalSessionIdsAwaitingBackendTruthRef.current.clear();
      terminalSessionIdsWithPreservedEmptyTruthRef.current.clear();
      const nextArtifactsDrawerOpen =
        artifactsDrawerPreference ?? preferredArtifactsDrawerOpenRef.current;
      if (preferredArtifactsDrawerOpenRef.current !== nextArtifactsDrawerOpen) {
        setPreferredArtifactsDrawerOpen(nextArtifactsDrawerOpen);
      }
      nextTerminalTabOrdinalRef.current = 1;
      initialStoredTerminalWorkspaceStateRef.current = {
        preferredViewMode: "conversation",
        preferredActiveSessionId: null,
        artifactsDrawerOpen: nextArtifactsDrawerOpen,
      };
      setTerminalTruthSessions([]);
    },
    [commitViewMode, projectId, taskId, workspaceId],
  );

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
      setTerminalTruthSessions(liveSessions);
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
      const preferredArtifactsDrawerOpen =
        modeStrategy === "preserve-current"
          ? preferredArtifactsDrawerOpenRef.current
          : (initialStoredTerminalWorkspaceStateRef.current?.artifactsDrawerOpen ??
            true);
      const shouldRestoreTerminalMode =
        modeStrategy === "preserve-current"
          ? viewModeRef.current === "terminal"
          : initialStoredTerminalWorkspaceStateRef.current?.preferredViewMode ===
            "terminal";
      const listedSessionIds = new Set(sessions.map((session) => session.terminal_session_id));
      listedSessionIds.forEach((sessionId) => {
        terminalSessionIdsAwaitingBackendTruthRef.current.delete(sessionId);
        terminalSessionIdsWithPreservedEmptyTruthRef.current.delete(sessionId);
      });
      const isTerminalTabClosing = (tab: TerminalWorkspaceTab) =>
        closingTerminalTabIdsRef.current.has(tab.id) ||
        (typeof tab.sessionId === "string" &&
          tab.sessionId.length > 0 &&
          closingTerminalSessionIdsRef.current.has(tab.sessionId));
      const shouldPreserveLocalTabsForStaleEmptySnapshot =
        modeStrategy === "preserve-current" &&
        sessions.length === 0 &&
        currentTabs.some((tab) => {
          if (tab.status === "closed") return false;
          if (isTerminalTabClosing(tab)) return false;
          if (typeof tab.sessionId !== "string" || tab.sessionId.length === 0) {
            return false;
          }
          return (
            terminalSessionIdsAwaitingBackendTruthRef.current.has(tab.sessionId) &&
            !terminalSessionIdsWithPreservedEmptyTruthRef.current.has(tab.sessionId)
          );
        });

      if (shouldPreserveLocalTabsForStaleEmptySnapshot) {
        const preservedTabs = relabelTerminalWorkspaceTabs(
          tTask,
          currentTabs.filter(
            (tab) => tab.status !== "closed" && !isTerminalTabClosing(tab),
          ),
        );
        const preservedTabIds = new Set(preservedTabs.map((tab) => tab.id));
        currentTabs
          .filter((tab) => !preservedTabIds.has(tab.id))
          .forEach((tab) => {
            clearTaskTerminalPanelSessionStateForScope(
              workspaceId,
              projectId,
              taskId,
              tab.id,
            );
            if (typeof tab.sessionId === "string" && tab.sessionId.length > 0) {
              terminalSessionIdsAwaitingBackendTruthRef.current.delete(tab.sessionId);
              terminalSessionIdsWithPreservedEmptyTruthRef.current.delete(tab.sessionId);
            }
          });
        preservedTabs.forEach((tab) => {
          if (typeof tab.sessionId !== "string" || tab.sessionId.length === 0) {
            return;
          }
          storeTaskTerminalPanelSessionIdForScope(
            workspaceId,
            projectId,
            taskId,
            tab.id,
            tab.sessionId,
          );
          if (terminalSessionIdsAwaitingBackendTruthRef.current.has(tab.sessionId)) {
            terminalSessionIdsAwaitingBackendTruthRef.current.delete(tab.sessionId);
            terminalSessionIdsWithPreservedEmptyTruthRef.current.add(tab.sessionId);
          }
        });
        const nextActiveTerminalTabId =
          preservedTabs.find((tab) => tab.id === activeTerminalTabIdRef.current)
            ?.id ??
          preservedTabs[0]?.id ??
          null;
        terminalTabsRef.current = preservedTabs;
        setTerminalTabs(preservedTabs);
        nextTerminalTabOrdinalRef.current = getNextTerminalTabOrdinal(preservedTabs);
        setActiveTerminalTabId(nextActiveTerminalTabId);
        activeTerminalTabIdRef.current = nextActiveTerminalTabId;
        commitViewMode(shouldRestoreTerminalMode ? "terminal" : "conversation");
        setPreferredArtifactsDrawerOpen(preferredArtifactsDrawerOpen);
        return;
      }

      const nextTabs = liveSessions.map((session) => {
        const existingTab = currentTabsBySessionId.get(session.terminal_session_id);
        if (existingTab) {
          return {
            ...existingTab,
            status: mergeTerminalTabStatus(existingTab.status, session.status),
            sessionId: session.terminal_session_id,
          };
        }
        const nextOrdinal = nextTerminalTabOrdinalRef.current;
        nextTerminalTabOrdinalRef.current += 1;
        return {
          id: `terminal-session-${nextOrdinal}`,
          label: getTerminalWorkspaceTabLabel(tTask, nextOrdinal),
          status: mapListedTerminalSessionStatusToTabStatus(session.status),
          closeRequestToken: 0,
          focusRequestToken: 0,
          sessionId: session.terminal_session_id,
        };
      });
      const relabeledTabs = relabelTerminalWorkspaceTabs(tTask, nextTabs);

      const nextTabIds = new Set(relabeledTabs.map((tab) => tab.id));
      currentTabs
        .filter((tab) => !nextTabIds.has(tab.id))
        .forEach((tab) => {
          clearTaskTerminalPanelSessionStateForScope(
            workspaceId,
            projectId,
            taskId,
            tab.id,
          );
          if (typeof tab.sessionId === "string" && tab.sessionId.length > 0) {
            terminalSessionIdsAwaitingBackendTruthRef.current.delete(tab.sessionId);
            terminalSessionIdsWithPreservedEmptyTruthRef.current.delete(tab.sessionId);
          }
        });

      relabeledTabs.forEach((tab) => {
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
        clearTerminalWorkspaceStateFromBackend(preferredArtifactsDrawerOpen);
        return;
      }

      const nextActiveTerminalTabId =
        modeStrategy === "preserve-current"
          ? (relabeledTabs.find((tab) => tab.id === activeTerminalTabIdRef.current)
              ?.id ??
            relabeledTabs[0]?.id ??
            null)
          : (relabeledTabs.find((tab) => tab.sessionId === preferredActiveSessionId)
              ?.id ??
            relabeledTabs.find((tab) => tab.id === activeTerminalTabIdRef.current)
              ?.id ??
            relabeledTabs[0]?.id ??
            null);
      const shouldRequestRestoreFocus =
        modeStrategy === "restore-initial" &&
        shouldRestoreTerminalMode &&
        nextActiveTerminalTabId !== null &&
        !isEditableFocusOwner(
          typeof document === "undefined" ? null : document.activeElement,
        );
      const nextRelabeledTabs = shouldRequestRestoreFocus
        ? relabeledTabs.map((tab) =>
            tab.id === nextActiveTerminalTabId
              ? {
                  ...tab,
                  focusRequestToken: (tab.focusRequestToken ?? 0) + 1,
                }
              : tab,
          )
        : relabeledTabs;
      terminalTabsRef.current = nextRelabeledTabs;
      setTerminalTabs(nextRelabeledTabs);
      nextTerminalTabOrdinalRef.current = getNextTerminalTabOrdinal(nextRelabeledTabs);
      setActiveTerminalTabId(nextActiveTerminalTabId);
      activeTerminalTabIdRef.current = nextActiveTerminalTabId;
      commitViewMode(shouldRestoreTerminalMode ? "terminal" : "conversation");
      setPreferredArtifactsDrawerOpen(preferredArtifactsDrawerOpen);
    },
    [
      clearTerminalWorkspaceStateFromBackend,
      commitViewMode,
      preferredArtifactsDrawerOpenRef,
      projectId,
      tTask,
      taskId,
      workspaceId,
    ],
  );

  const syncTerminalWorkspaceFromBackend = React.useCallback(async () => {
    const requestId = beginTerminalWorkspaceTruthRequest();
    const listedSessions = await taskAPI.listTerminalSessions(
      workspaceId,
      projectId,
      taskId,
    );
    if (!isLatestTerminalWorkspaceTruthRequest(requestId)) {
      return null;
    }
    hydrateTerminalWorkspaceFromBackendSessions(listedSessions.items, {
      modeStrategy: "preserve-current",
    });
    hydratedTerminalTaskScopeRef.current = taskScopeKey;
    setTerminalWorkspaceHydrationState("ready");
    return listedSessions;
  }, [
    beginTerminalWorkspaceTruthRequest,
    hydrateTerminalWorkspaceFromBackendSessions,
    isLatestTerminalWorkspaceTruthRequest,
    projectId,
    taskAPI,
    taskId,
    taskScopeKey,
    workspaceId,
  ]);

  const hydrateTerminalWorkspace = React.useCallback(
    async (logContext: string = "TaskPage.hydrateTerminalWorkspace") => {
      const requestId = beginTerminalWorkspaceTruthRequest();
      terminalWorkspaceHydrationRequestRef.current = requestId;
      hydratedTerminalTaskScopeRef.current = taskScopeKey;
      setTerminalWorkspaceHydrationState("pending");
      try {
        const listedSessions = await taskAPI.listTerminalSessions(
          workspaceId,
          projectId,
          taskId,
        );
        if (
          terminalWorkspaceHydrationRequestRef.current !== requestId ||
          !isLatestTerminalWorkspaceTruthRequest(requestId)
        ) {
          return null;
        }
        hydrateTerminalWorkspaceFromBackendSessions(listedSessions.items);
        hydratedTerminalTaskScopeRef.current = taskScopeKey;
        setTerminalWorkspaceHydrationState("ready");
        return listedSessions;
      } catch (error) {
        if (
          terminalWorkspaceHydrationRequestRef.current !== requestId ||
          !isLatestTerminalWorkspaceTruthRequest(requestId)
        ) {
          return null;
        }
        hydratedTerminalTaskScopeRef.current = taskScopeKey;
        setTerminalWorkspaceHydrationState("unavailable");
        handleError(error, {
          logContext,
          showToast: false,
        });
        throw error;
      }
    },
    [
      beginTerminalWorkspaceTruthRequest,
      handleError,
      hydrateTerminalWorkspaceFromBackendSessions,
      isLatestTerminalWorkspaceTruthRequest,
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

  React.useEffect(() => {
    if (taskStatus !== "active") return;
    if (terminalWorkspaceHydrationState !== "ready") return;
    const hasTerminalTabsPendingBackendTruth = terminalTabs.some((tab) => {
      if (tab.status === "closed") return false;
      if (closingTerminalTabIdsRef.current.has(tab.id)) return false;
      if (typeof tab.sessionId !== "string" || tab.sessionId.length === 0) {
        return false;
      }
      if (closingTerminalSessionIdsRef.current.has(tab.sessionId)) return false;
      return (
        terminalSessionIdsAwaitingBackendTruthRef.current.has(tab.sessionId) ||
        terminalSessionIdsWithPreservedEmptyTruthRef.current.has(tab.sessionId)
      );
    });
    if (
      (terminalTruthSessions?.length ?? 0) === 0 &&
      !hasTerminalTabsPendingBackendTruth
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void syncTerminalWorkspaceFromBackend().catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    syncTerminalWorkspaceFromBackend,
    taskStatus,
    terminalTabs,
    terminalTruthSessions,
    terminalWorkspaceHydrationState,
  ]);

  const closeAllTerminalTabs = React.useCallback(async () => {
    if (terminalTabsRef.current.length === 0) return;
    try {
      const listedSessions = await taskAPI.listTerminalSessions(
        workspaceId,
        projectId,
        taskId,
      );
      const sessionIdsToClose = new Set<string>([
        ...listedSessions.items.map((session) => session.terminal_session_id),
        ...terminalTabsRef.current
          .map((tab) => tab.sessionId)
          .filter(
            (sessionId): sessionId is string =>
              typeof sessionId === "string" && sessionId.length > 0,
          ),
      ]);
      if (sessionIdsToClose.size === 0) {
        resetTerminalWorkspaceState();
        return;
      }
      await Promise.allSettled(
        [...sessionIdsToClose].map((sessionId) =>
          taskAPI.closeTerminalSession(
            workspaceId,
            projectId,
            taskId,
            sessionId,
          ),
        ),
      );
      const requestId = beginTerminalWorkspaceTruthRequest();
      const remainingSessions = await taskAPI.listTerminalSessions(
        workspaceId,
        projectId,
        taskId,
      );
      if (!isLatestTerminalWorkspaceTruthRequest(requestId)) {
        return;
      }
      hydrateTerminalWorkspaceFromBackendSessions(remainingSessions.items, {
        modeStrategy: "preserve-current",
      });
    } catch (error) {
      handleError(error, {
        logContext: "TaskPage.closeAllTerminalTabs",
      });
    }
  }, [
    beginTerminalWorkspaceTruthRequest,
    handleError,
    hydrateTerminalWorkspaceFromBackendSessions,
    isLatestTerminalWorkspaceTruthRequest,
    projectId,
    resetTerminalWorkspaceState,
    taskAPI,
    taskId,
    workspaceId,
  ]);

  const handleRequestCloseAllTerminalTabs = React.useCallback(() => {
    if (terminalSessionCount === 0 || endAllTerminalPending) {
      return;
    }
    setEndAllTerminalDialogOpen(true);
  }, [endAllTerminalPending, terminalSessionCount]);

  const handleConfirmCloseAllTerminalTabs = React.useCallback(async () => {
    if (endAllTerminalPending) {
      return;
    }
    setEndAllTerminalPending(true);
    try {
      await closeAllTerminalTabs();
      setEndAllTerminalDialogOpen(false);
    } finally {
      setEndAllTerminalPending(false);
    }
  }, [closeAllTerminalTabs, endAllTerminalPending]);

  const reconcileTerminalWorkspaceAfterSessionClose = React.useCallback(
    async (
      sessionId: string | null,
      logContext: string,
    ): Promise<TerminalCloseReconcileResult> => {
      try {
        const listedSessions = await syncTerminalWorkspaceFromBackend();
        if (!listedSessions) {
          return "unavailable";
        }
        const liveSessions = listedSessions.items.filter(
          (session) => session.status !== "closed",
        );
        if (
          sessionId &&
          liveSessions.some((session) => session.terminal_session_id === sessionId)
        ) {
          return "retained";
        }
        return "closed";
      } catch (error) {
        hydratedTerminalTaskScopeRef.current = taskScopeKey;
        setTerminalWorkspaceHydrationState("unavailable");
        handleError(error, {
          logContext,
        });
        return "unavailable";
      }
    },
    [
      handleError,
      syncTerminalWorkspaceFromBackend,
      taskScopeKey,
    ],
  );

  const removeTerminalTabLocally = React.useCallback(
    (tabId: string) => {
      const currentTabs = terminalTabsRef.current;
      const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      if (closingIndex < 0) {
        return;
      }
      const closingTab = currentTabs[closingIndex];
      if (typeof closingTab.sessionId === "string" && closingTab.sessionId.length > 0) {
        return;
      }
      const nextTabs = relabelTerminalWorkspaceTabs(
        tTask,
        currentTabs.filter((tab) => tab.id !== tabId),
      );
      const nextTerminalTruthSessions = terminalTruthSessionsRef.current;
      clearTaskTerminalPanelSessionStateForScope(
        workspaceId,
        projectId,
        taskId,
        tabId,
      );
      if (
        nextTabs.length === 0
        && nextTerminalTruthSessions !== null
        && nextTerminalTruthSessions.length > 0
      ) {
        hydrateTerminalWorkspaceFromBackendSessions(nextTerminalTruthSessions, {
          modeStrategy: "preserve-current",
        });
        return;
      }
      terminalTabsRef.current = nextTabs;
      setTerminalTabs(nextTabs);
      nextTerminalTabOrdinalRef.current = getNextTerminalTabOrdinal(nextTabs);
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
        requestTerminalTabFocus(nextActiveTerminalTabId);
      }
    },
    [
      hydrateTerminalWorkspaceFromBackendSessions,
      projectId,
      requestTerminalTabFocus,
      resetTerminalWorkspaceState,
      tTask,
      taskId,
      workspaceId,
    ],
  );

  if (taskLoading) {
    return <TaskPageLoadingState text={tTask("loading")} />;
  }

  if (!task) {
    return (
      <TaskPageNotFoundState
        title={tTask("not_found_title")}
        description={tTask("not_found_description")}
        backLabel={tTask("back_to_agent_tasks")}
        onBack={() =>
          router.push(
            `/${locale}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`,
          )
        }
        actions={[
          {
            label: tCommon("open_files"),
            onClick: () =>
              router.push(
                `/${locale}/workspaces/${workspaceId}/projects/${projectId}/files`,
              ),
            testId: "agent-task__open-files",
            variant: "outline",
          },
          {
            label: tCommon("open_chat"),
            onClick: () =>
              router.push(
                `/${locale}/workspaces/${workspaceId}/projects/${projectId}/chat`,
              ),
            testId: "agent-task__open-chat",
            variant: "outline",
          },
        ]}
      />
    );
  }

  const createTerminalSessionTab = () => {
    if (!canCreateTerminalSession) {
      if (terminalSessionCount >= 3) {
        toast.info(tTask("terminal_max_sessions_reached"));
      }
      return;
    }
    const currentOpenTabs = terminalTabsRef.current.filter((tab) => {
      if (tab.status !== "closed") return true;
      clearTaskTerminalPanelSessionStateForScope(
        workspaceId,
        projectId,
        taskId,
        tab.id,
      );
      if (typeof tab.sessionId === "string" && tab.sessionId.length > 0) {
        terminalSessionIdsAwaitingBackendTruthRef.current.delete(tab.sessionId);
        terminalSessionIdsWithPreservedEmptyTruthRef.current.delete(tab.sessionId);
        closingTerminalSessionIdsRef.current.delete(tab.sessionId);
      }
      closingTerminalTabIdsRef.current.delete(tab.id);
      return false;
    });
    const nextOrdinal = nextTerminalTabOrdinalRef.current;
    nextTerminalTabOrdinalRef.current += 1;
    const tabId = `terminal-session-${nextOrdinal}`;
    const newTab: TerminalWorkspaceTab = {
      id: tabId,
      label: getTerminalWorkspaceTabLabel(tTask, nextOrdinal),
      status: "idle",
      closeRequestToken: 0,
      focusRequestToken: 1,
      sessionId: null,
    };
    const nextTabs = relabelTerminalWorkspaceTabs(tTask, [
      ...currentOpenTabs,
      newTab,
    ]);
    setTerminalTabs(nextTabs);
    terminalTabsRef.current = nextTabs;
    setActiveTerminalTabId(tabId);
    activeTerminalTabIdRef.current = tabId;
    commitViewMode("terminal");
  };

  const handleTerminalTabStatusChange = (tabId: string, status: TerminalStatus) => {
    if (status === "closed") {
      const tab = terminalTabsRef.current.find((item) => item.id === tabId);
      const hasResolvedSession =
        typeof tab?.sessionId === "string" && tab.sessionId.length > 0;
      if (!hasResolvedSession) {
        removeTerminalTabLocally(tabId);
        return;
      }
    }
    setTerminalTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, status } : tab)),
    );
    terminalTabsRef.current = terminalTabsRef.current.map((tab) =>
      tab.id === tabId ? { ...tab, status } : tab,
    );
  };

  const handleTerminalTabSessionResolved = (tabId: string, sessionId: string) => {
    const resolvingTab = terminalTabsRef.current.find((tab) => tab.id === tabId);
    if (!resolvingTab) return;
    if (
      closingTerminalTabIdsRef.current.has(tabId) ||
      closingTerminalSessionIdsRef.current.has(sessionId)
    ) {
      return;
    }
    const backendAlreadyListsSession =
      terminalTruthSessionsRef.current?.some((session) => session.terminal_session_id === sessionId) ??
      false;
    if (
      !backendAlreadyListsSession &&
      !terminalSessionIdsWithPreservedEmptyTruthRef.current.has(sessionId)
    ) {
      terminalSessionIdsAwaitingBackendTruthRef.current.add(sessionId);
    }
    setTerminalTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, sessionId } : tab)),
    );
    terminalTabsRef.current = terminalTabsRef.current.map((tab) =>
      tab.id === tabId ? { ...tab, sessionId } : tab,
    );
    void syncTerminalWorkspaceFromBackend().catch(() => {});
  };

  const requestTerminalTabPanelClose = (tabId: string) => {
    const nextTabs = terminalTabsRef.current.map((tab) =>
      tab.id === tabId
        ? { ...tab, closeRequestToken: tab.closeRequestToken + 1 }
        : tab,
    );
    terminalTabsRef.current = nextTabs;
    setTerminalTabs(nextTabs);
  };

  const closeTerminalTab = (tabId: string) => {
    const tab = terminalTabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;
    const sessionId =
      typeof tab.sessionId === "string" && tab.sessionId.length > 0
        ? tab.sessionId
        : null;
    if (!sessionId) {
      requestTerminalTabPanelClose(tabId);
      return;
    }
    if (closingTerminalTabIdsRef.current.has(tabId)) {
      return;
    }
    const shouldRefocusAfterClose = activeTerminalTabIdRef.current === tabId;
    closingTerminalTabIdsRef.current.add(tabId);
    closingTerminalSessionIdsRef.current.add(sessionId);
    terminalSessionIdsAwaitingBackendTruthRef.current.delete(sessionId);
    terminalSessionIdsWithPreservedEmptyTruthRef.current.delete(sessionId);
    void (async () => {
      try {
        await taskAPI.closeTerminalSession(
          workspaceId,
          projectId,
          taskId,
          sessionId,
        );
        const reconcileResult = await reconcileTerminalWorkspaceAfterSessionClose(
          sessionId,
          "TaskPage.closeTerminalTab.hydrate",
        );
        if (shouldRefocusAfterClose && reconcileResult !== "unavailable") {
          requestTerminalTabFocus(activeTerminalTabIdRef.current);
        }
      } catch (error) {
        handleError(error, {
          logContext: "TaskPage.closeTerminalTab",
        });
      } finally {
        closingTerminalTabIdsRef.current.delete(tabId);
        closingTerminalSessionIdsRef.current.delete(sessionId);
      }
    })();
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
    const tab = terminalTabsRef.current.find((item) => item.id === tabId);
    const sessionId =
      typeof tab?.sessionId === "string" && tab.sessionId.length > 0
        ? tab.sessionId
        : null;
    if (sessionId) {
      void reconcileTerminalWorkspaceAfterSessionClose(
        sessionId,
        "TaskPage.panelInternalTerminalClose.hydrate",
      );
      return;
    }
    removeTerminalTabLocally(tabId);
  };

  const terminalWorkspace = hasTerminalSessions ? (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-subtle bg-background/95 shadow-ambient"
      data-testid="agent-tasks__task-terminal-shell"
    >
      <div className="flex items-start justify-between gap-3 border-b border-subtle px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {tTask("terminal_workspace")}
          </div>
          <div className="mt-1 text-xs text-secondary">
            {tTask("terminal_scope_hint")}
          </div>
        </div>
        <Badge
          variant={terminalHasRecovery ? "destructive" : "secondary"}
          className="shrink-0 text-[11px]"
          data-testid="agent-tasks__task-terminal-shell-summary"
        >
          {terminalSessionSummaryLabel}
        </Badge>
      </div>
      <div
        className="flex min-h-0 w-full flex-1 flex-col"
        data-testid="agent-tasks__task-terminal-workspace"
        data-active-terminal-tab-id={activeTerminalTabId ?? undefined}
      >
        <div className="flex items-center justify-between gap-3 border-b border-subtle bg-background/80 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2">
            {terminalTabs.map((tab) => {
              const isActive = tab.id === activeTerminalTabId;
              const statusVariant =
                tab.status === "failed" || tab.status === "recovering"
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
                  data-testid={`agent-tasks__task-terminal-tab-${tab.id}`}
                >
                  <button
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-sm px-2 py-1 text-[12px] transition-colors ${
                      isActive
                        ? "text-foreground"
                        : "text-secondary hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTerminalTabId(tab.id);
                      activeTerminalTabIdRef.current = tab.id;
                      commitViewMode("terminal");
                      requestTerminalTabFocus(tab.id);
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
                    data-testid={`agent-tasks__task-terminal-close-${tab.id}`}
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
              data-testid="agent-tasks__task-terminal-create"
            >
              {tTask("terminal_new_session")}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-error/30 px-3 text-[12px] text-error hover:bg-error/5 hover:text-error"
              onClick={handleRequestCloseAllTerminalTabs}
              disabled={endAllTerminalPending}
              data-testid="agent-tasks__task-terminal-end-all"
            >
              {tTask("terminal_end_all")}
            </Button>
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2.5">
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className={
                effectiveViewMode === "terminal" && tab.id === activeTerminalTabId
                  ? "flex min-h-0 w-full flex-1 overflow-hidden"
                  : "pointer-events-none absolute h-0 w-0 overflow-hidden"
              }
            >
              <TaskTerminalPanel
                open
                visible={effectiveViewMode === "terminal" && tab.id === activeTerminalTabId}
                tabId={tab.id}
                sessionStorageScope={tab.id}
                workspaceId={workspaceId}
                projectId={projectId}
                taskId={taskId}
                taskTitle={task.title}
                taskApi={taskAPI}
                closeRequestToken={tab.closeRequestToken}
                focusRequestToken={tab.focusRequestToken ?? 0}
                onSessionResolved={(sessionId) =>
                  handleTerminalTabSessionResolved(tab.id, sessionId)
                }
                onStatusChange={(status) =>
                  handleTerminalTabStatusChange(tab.id, status)
                }
                onSessionCreateRejected={handleTerminalTabCreateRejected}
                onSessionCloseReconcile={(sessionId) =>
                  reconcileTerminalWorkspaceAfterSessionClose(
                    sessionId ?? tab.sessionId ?? null,
                    "TaskPage.panelInternalTerminalClose.hydrate",
                  )
                }
                onOpenChange={(open) => handleTerminalTabOpenChange(tab.id, open)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  const conversationBlockedState =
    effectiveViewMode === "conversation" && terminalTruthUnavailable
      ? {
          title: tTask("terminal_truth_unavailable_title"),
          description: tTask("terminal_truth_unavailable_description"),
          actionLabel: tTask("terminal_truth_unavailable_action"),
          actionTestId: "agent-tasks__conversation-blocked-action",
          onAction: handleRetryTerminalWorkspaceHydration,
          tone: "critical" as const,
        }
      : effectiveViewMode === "conversation" && hasTerminalSessions
        ? {
            title: terminalSessionSummaryLabel,
            description: terminalHiddenStateDescription,
            actionLabel: terminalWorkspaceActionLabel,
            actionTestId: "agent-tasks__conversation-blocked-action",
            onAction: () => handleOpenTerminalWorkspace(terminalHasRecovery),
            tone: terminalHasRecovery ? ("critical" as const) : ("default" as const),
          }
        : effectiveViewMode === "conversation" && developerBoundRunnerIssue
          ? {
              title: tTask("runner_binding_issue_title"),
              description: tTask("runner_binding_issue_description"),
              actionLabel: boundRunnerRecoveryActionLabel ?? undefined,
              actionTestId: "agent-tasks__conversation-blocked-action",
              onAction: handleCreateBoundRunnerRecoveryTask,
              tone: "critical" as const,
            }
          : null;
  const showConversationBlockedEmptyState =
    effectiveViewMode === "conversation" &&
    conversationBlockedState !== null &&
    messagesForDisplay.length === 0 &&
    !streamingMessageId &&
    !(streamingContent ?? "").trim() &&
    !showSandboxStarting &&
    !agentIsBusy;
  const showCompactTerminalStatusStrip = showConversationBlockedEmptyState;

  const terminalStatusStrip =
    terminalTruthUnavailable ||
    (effectiveViewMode === "conversation" && hasTerminalSessions) ? (
      terminalTruthUnavailable ? (
        <div
          className="mt-3 flex items-start justify-between gap-3 rounded-md border border-error/30 bg-error/5 px-4 py-3 shadow-ambient"
          data-testid="agent-tasks__task-terminal-truth-unavailable"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {tTask("terminal_truth_unavailable_title")}
            </div>
            {!showCompactTerminalStatusStrip ? (
              <div className="mt-1 text-xs text-secondary">
                {tTask("terminal_truth_unavailable_description")}
              </div>
            ) : null}
          </div>
          {!showConversationBlockedEmptyState ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                onClick={handleRetryTerminalWorkspaceHydration}
                disabled={terminalBootstrapPending}
                data-testid="agent-tasks__task-terminal-truth-unavailable-retry"
              >
                {tTask("terminal_truth_unavailable_action")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="mt-3 flex items-start justify-between gap-3 rounded-md border border-subtle bg-surface/72 px-4 py-3 shadow-ambient"
          data-testid="agent-tasks__task-terminal-status-strip"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {terminalSessionSummaryLabel}
            </div>
            {!showCompactTerminalStatusStrip ? (
              <div className="mt-1 text-xs text-secondary">
                {terminalHiddenStateDescription}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!showConversationBlockedEmptyState ? (
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
                onClick={() => handleOpenTerminalWorkspace(terminalHasRecovery)}
                data-testid="agent-tasks__task-terminal-status-action"
              >
                {terminalWorkspaceActionLabel}
              </button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-error/30 px-3 text-[12px] text-error hover:bg-error/5 hover:text-error"
              onClick={handleRequestCloseAllTerminalTabs}
              disabled={endAllTerminalPending}
              data-testid="agent-tasks__task-terminal-status-end-all"
            >
              {tTask("terminal_end_all")}
            </Button>
          </div>
        </div>
      )
    ) : null;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-subtle bg-background/72"
      data-testid="agent-tasks__task-detail-shell"
    >
      <TaskHeader
        task={task}
        workspaceId={workspaceId}
        projectId={projectId}
        headerAccessory={
          showArtifactsToggle ? (
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/24 bg-transparent px-3 text-[12px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
              onClick={() =>
                setPreferredArtifactsDrawerOpen((current) => !current)
              }
              data-testid="agent-tasks__task-artifacts-toggle"
            >
              {artifactsDrawerOpen ? tTask("artifacts_hide") : tTask("artifacts_show")}
            </button>
          ) : null
        }
        canDeleteTask={canDeleteTask}
        deleteBlockedReason={deleteBlockedReason}
        viewMode={effectiveViewMode}
        canCreateTerminalSession={canCreateTerminalSession}
        terminalSessionCount={terminalSessionCount}
        terminalTruthState={terminalWorkspaceHydrationState}
        terminalHasRecovery={terminalHasRecovery}
        terminalRecoveryCount={terminalRecoveryCount}
        terminalDisabledReason={terminalDisabledReason}
        boundRunnerRecoveryActionLabel={boundRunnerRecoveryActionLabel}
        onCreateBoundRunnerRecoveryTask={
          developerBoundRunnerIssue ? handleCreateBoundRunnerRecoveryTask : undefined
        }
        boundRunnerRecoveryPending={developerBoundRunnerIssue && createTask.isPending}
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
        activeRunView={activeRunView}
        artifacts={artifactsList}
        artifactsRefreshing={artifactsRefreshing}
        canUpdateTask={canUpdateTask}
        connectionErrorCode={effectiveRealtimeFailureCode}
        connectionErrorMessage={effectiveRealtimeFailureMessage}
        connectionStatus={connectionStatus}
        diagnosticsLinks={agentTaskDiagnosticsLinks}
        disabled={isConversationInputDisabled}
        fetchTracesForMessage={fetchTracesForMessage}
        focusTraceMessageId={traceFocusMessageId}
        focusTraceName={traceFocusName}
        focusTraceToken={traceFocusToken}
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
          const targetMessageId = activeRunView?.messageId ?? activeRunMessageId;
          if (!action.traceName || !targetMessageId) return;
          setTraceFocusMessageId(targetMessageId);
          setTraceFocusName(action.traceName);
          setTraceFocusToken((prev) => prev + 1);
        }}
        pendingMessages={pendingMessages}
        projectId={projectId}
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
        inputPlaceholder={
          hasTerminalSessions
            ? tTask("terminal_input_blocked_placeholder")
            : runStateInputPlaceholder ?? undefined
        }
        conversationBlockedState={conversationBlockedState}
        taskId={taskId}
        traceErrorByMessageId={traceErrorByMessageId}
        traceEventsByMessageId={traceEventsByMessageId}
        traceHasMoreByMessageId={traceHasMoreByMessageId}
        traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
        traceLoadingByMessageId={traceLoadingByMessageId}
        workspaceId={workspaceId}
      />
      <AlertDialog
        open={cancelEscalationDialogOpen}
        onOpenChange={(open) => {
          if (cancelActiveRun.isPending) return;
          setCancelEscalationDialogOpen(open);
        }}
      >
        <AlertDialogContent data-testid="agent-tasks__cancel-escalation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tConversation("run_escalation_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tConversation("run_escalation_description")}
              {cancelEscalationReason ? (
                <span className="mt-2 block">
                  {tConversation("run_escalation_reason", {
                    reason: cancelEscalationReason,
                  })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={cancelActiveRun.isPending}
              data-testid="agent-tasks__cancel-escalation-cancel"
            >
              {tConversation("run_escalation_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="agent-tasks__cancel-escalation-confirm"
              onClick={(event) => {
                event.preventDefault();
                handleConfirmCancelEscalation();
              }}
              disabled={cancelActiveRun.isPending}
              variant="destructive"
            >
              {tConversation("run_escalation_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={endAllTerminalDialogOpen} onOpenChange={setEndAllTerminalDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tTask("terminal_end_all_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tTask("terminal_end_all_confirm_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={endAllTerminalPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmCloseAllTerminalTabs();
              }}
              disabled={endAllTerminalPending}
              variant="destructive"
            >
              {tTask("terminal_end_all_confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
