import { http, HttpResponse } from 'msw';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';
import type {
  CreateTaskTerminalSessionRequest,
  TaskRunnerBindingKind,
  Task,
  TaskActivityItem,
  TaskRunnerBindingSource,
  TaskRunnerBindingOption,
  TaskRunnerBindingReasonCode,
  TaskRunState,
  TaskTerminalSessionCreateResponse,
  TaskTerminalSessionStatus,
} from '@/lib/types/task';
import {
  taskFixtures,
  taskActivityFixtures,
  artifactFixtures,
  taskTraceFixtures,
} from '../fixtures/agent-tasks';
import { agentRunnerFixtures } from '../fixtures/agent-runners';
import { memberProjectMembershipFixtures } from '../fixtures/members';
import { readMockAuthActorFromRequest } from '../utils/mock-auth-token';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import {
  docTaskFixtures,
  docTaskActivityFixtures,
  docArtifactFixtures,
  docTaskTraceFixtures,
} from '../doc-fixtures/agent-tasks';

const tasks: Task[] = (DOC_FIXTURES_ENABLED ? docTaskFixtures : taskFixtures)
  .map((task) => ({ ...task })) as Task[];
const taskActivities = DOC_FIXTURES_ENABLED ? [...docTaskActivityFixtures] : [...taskActivityFixtures];
const artifacts = DOC_FIXTURES_ENABLED ? [...docArtifactFixtures] : [...artifactFixtures];
const taskTraces = DOC_FIXTURES_ENABLED ? [...docTaskTraceFixtures] : [...taskTraceFixtures];
const API_V1_PATTERN = '*/api/v1';
const LEGACY_RUN_SELECTION_FIELD = ['runner', 'selection'].join('_');
const MOCK_SSE_TICKET_PREFIX = 'mock_sse_';
const MOCK_TASK_STOP_RUNTIME_STORAGE_KEY = 'agentsmith:mock-task-stop-runtime';
const terminalSessionsByScope = new Map<string, TaskTerminalSessionStatus[]>();
const issuedMockSseTickets = new Map<string, { bearerToken: string; expiresAt: string; maxConnections: number }>();
let nextTerminalSessionOrdinal = 1;
let nextMockSseTicketOrdinal = 1;
type TaskAgentPresence = Exclude<Task['agent_presence'], undefined>;
const TASK_AGENT_PRESENCE_VALUES = ['online', 'offline', 'managed', 'unknown'] as const satisfies readonly TaskAgentPresence[];

function isTaskAgentPresence(value: string): value is TaskAgentPresence {
  return (TASK_AGENT_PRESENCE_VALUES as readonly string[]).includes(value);
}

function normalizeTaskAgentPresence(input: unknown): TaskAgentPresence {
  if (typeof input === 'string') {
    const value = input.trim();
    if (isTaskAgentPresence(value)) {
      return value;
    }
  }
  return 'managed';
}

export function createMockRunnerTestTaskRunEvidence(input: {
  workspaceId: string;
  projectId: string;
  runnerId: string;
  taskId: string;
  runId: string;
  intent?: string;
}): Task {
  const existing = tasks.find((task) => task.id === input.taskId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const task: Task = {
    id: input.taskId,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    owner_user_id: 'user_001',
    title: 'Developer runner test task',
    source: 'runner_test',
    runner_test: true,
    workspace_file_library_id: `lib_${input.taskId}`,
    workspace_file_library_name: 'Developer Runner Test Workspace',
    bound_runner_id: input.runnerId,
    bound_runner_kind: 'developer',
    runner_binding_source: 'explicit',
    bound_at: now,
    bound_by_user_id: 'user_001',
    status: 'active',
    attached_inputs: [],
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    agent_presence: 'online',
    run_state: 'running',
    active_run: {
      id: input.runId,
      status: 'running',
      runner_id: input.runnerId,
      source: 'runner_test',
      runner_test: true,
      started_at: now,
    },
    active_run_started_at: now,
    stats: {
      user_turn_count: 1,
      message_count: 2,
      artifact_count: 0,
      attached_input_count: 0,
    },
  };
  tasks.unshift(task);
  taskActivities.push(
    {
      id: `msg_${input.taskId}_user`,
      task_id: input.taskId,
      kind: 'user_intent',
      actor: 'user',
      content: input.intent?.trim() || 'developer_runner_connection_check',
      created_at: now,
      source: 'runner_test',
      runner_test: true,
    },
    {
      id: `msg_${input.taskId}_runner`,
      task_id: input.taskId,
      kind: 'runner_output',
      actor: 'runner',
      content: '',
      created_at: now,
      run_id: input.runId,
      source: 'runner_test',
      runner_test: true,
    },
  );
  return task;
}

type MockTaskStopMode = 'cancel' | 'terminate';
type MockTaskStopEscalationMode = 'supported' | 'unsupported';
type MockTaskStopEscalationReason = 'already_terminating' | 'unmanaged_runner' | 'unsupported_runner';
type MockTaskStopRuntimeTruth = {
  runState: TaskRunState;
  canEscalate: boolean;
  escalationReason: MockTaskStopEscalationReason | null;
  stopMode: MockTaskStopMode;
  now: string;
};
type MockTaskStopRuntimeFields = {
  run_state?: TaskRunState;
  can_escalate?: boolean;
  escalation_reason?: MockTaskStopEscalationReason | null;
  stop_mode?: MockTaskStopMode;
  updated_at?: string;
  last_activity_at?: string;
};
type MockTaskStopRuntimeSnapshot = {
  run_state: TaskRunState;
  can_escalate: boolean;
  escalation_reason: MockTaskStopEscalationReason | null;
  stop_mode: MockTaskStopMode;
  updated_at: string;
  last_activity_at: string;
};

function isTaskRunState(value: unknown): value is TaskRunState {
  return (
    value === 'running' ||
    value === 'cancelling' ||
    value === 'terminating' ||
    value === 'finalizing' ||
    value === 'idle'
  );
}

function isMockTaskStopMode(value: unknown): value is MockTaskStopMode {
  return value === 'cancel' || value === 'terminate';
}

function isMockTaskStopEscalationReason(value: unknown): value is MockTaskStopEscalationReason {
  return (
    value === 'already_terminating' ||
    value === 'unmanaged_runner' ||
    value === 'unsupported_runner'
  );
}

function getMockTaskStopRuntimeStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMockTaskStopRuntimeStore(): Record<string, unknown> {
  const storage = getMockTaskStopRuntimeStorage();
  if (!storage) return {};
  const raw = storage.getItem(MOCK_TASK_STOP_RUNTIME_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {};
}

function readPersistedMockTaskStopRuntimeTruth(
  taskId: string,
): MockTaskStopRuntimeSnapshot | null {
  const entry = readMockTaskStopRuntimeStore()[taskId];
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (
    !isTaskRunState(record.run_state) ||
    !isMockTaskStopMode(record.stop_mode) ||
    typeof record.can_escalate !== 'boolean' ||
    typeof record.updated_at !== 'string' ||
    typeof record.last_activity_at !== 'string'
  ) {
    return null;
  }
  const escalationReason = isMockTaskStopEscalationReason(record.escalation_reason)
    ? record.escalation_reason
    : null;
  return {
    run_state: record.run_state,
    can_escalate: record.can_escalate,
    escalation_reason: escalationReason,
    stop_mode: record.stop_mode,
    updated_at: record.updated_at,
    last_activity_at: record.last_activity_at,
  };
}

function persistMockTaskStopRuntimeTruth(
  taskId: string,
  truth: MockTaskStopRuntimeSnapshot,
) {
  const storage = getMockTaskStopRuntimeStorage();
  if (!storage) return;
  const next = readMockTaskStopRuntimeStore();
  next[taskId] = truth;
  try {
    storage.setItem(MOCK_TASK_STOP_RUNTIME_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in restricted browser contexts; in-memory mock truth still applies.
  }
}

function applyMockTaskStopRuntimeTruth(
  task: MockTaskStopRuntimeFields,
  truth: MockTaskStopRuntimeTruth,
) {
  task.run_state = truth.runState;
  task.can_escalate = truth.canEscalate;
  task.escalation_reason = truth.escalationReason;
  task.stop_mode = truth.stopMode;
  task.updated_at = truth.now;
  task.last_activity_at = truth.now;
}

function applyMockTaskStopRuntimeSnapshot(
  task: MockTaskStopRuntimeFields,
  snapshot: MockTaskStopRuntimeSnapshot,
) {
  task.run_state = snapshot.run_state;
  task.can_escalate = snapshot.can_escalate;
  task.escalation_reason = snapshot.escalation_reason;
  task.stop_mode = snapshot.stop_mode;
  task.updated_at = snapshot.updated_at;
  task.last_activity_at = snapshot.last_activity_at;
}

function hydrateMockTaskStopRuntimeTruth(
  taskId: string,
  task: MockTaskStopRuntimeFields,
) {
  const snapshot = readPersistedMockTaskStopRuntimeTruth(taskId);
  if (!snapshot) return;
  applyMockTaskStopRuntimeSnapshot(task, snapshot);
}

function readMockTaskRealtimeMode(request: Request) {
  const headerMode = request.headers.get('x-mock-task-realtime')?.trim();
  if (headerMode) return headerMode;

  const url = new URL(request.url);
  const queryMode = url.searchParams.get('mock_task_realtime')?.trim();
  if (queryMode) return queryMode;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieMode = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ags_mock_task_realtime='))
    ?.split('=')[1]
    ?.trim();
  return cookieMode && cookieMode.length > 0 ? decodeURIComponent(cookieMode) : null;
}

function readMockTaskCancelEscalationMode(request: Request): MockTaskStopEscalationMode | null {
  const headerMode = request.headers.get('x-mock-task-cancel-escalation')?.trim();
  if (headerMode === 'supported' || headerMode === 'unsupported') return headerMode;

  const url = new URL(request.url);
  const queryMode = url.searchParams.get('mock_task_cancel_escalation')?.trim();
  if (queryMode === 'supported' || queryMode === 'unsupported') return queryMode;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieMode = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ags_mock_task_cancel_escalation='))
    ?.split('=')[1]
    ?.trim();
  if (!cookieMode) return null;
  const decoded = decodeURIComponent(cookieMode);
  return decoded === 'supported' || decoded === 'unsupported' ? decoded : null;
}

function isTerminateMode(body: unknown) {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  return record.mode === 'terminate';
}

function resolveMockTaskStopEscalationReason(
  task: MockTaskStopRuntimeFields,
  fallback: MockTaskStopEscalationReason,
): MockTaskStopEscalationReason {
  return isMockTaskStopEscalationReason(task.escalation_reason)
    ? task.escalation_reason
    : fallback;
}

function mockTaskCancelUnavailableResponse(input: {
  taskId: string;
  task: MockTaskStopRuntimeFields;
  reason: Exclude<MockTaskStopEscalationReason, 'already_terminating'>;
}) {
  const stopMode = input.task.stop_mode ?? 'cancel';
  const status: Extract<TaskRunState, 'cancelling' | 'terminating'> =
    stopMode === 'terminate' || input.task.run_state === 'terminating'
      ? 'terminating'
      : 'cancelling';
  return {
    error_code: 'STOP_ESCALATION_UNAVAILABLE',
    message: 'stop_escalation_unavailable',
    task_id: input.taskId,
    run_id: `mock_run_${input.taskId}`,
    request_id: input.task.stop_mode ? `mock_${input.task.stop_mode}_${input.taskId}` : null,
    status,
    stop_mode: stopMode,
    can_escalate: false,
    escalation_reason: input.reason,
  };
}

function taskTerminalScopeKey(args: { workspaceId: string; projectId: string; taskId: string }) {
  return `${args.workspaceId}:${args.projectId}:${args.taskId}`;
}

function listLiveTerminalSessionsForScope(scopeKey: string): TaskTerminalSessionStatus[] {
  return (terminalSessionsByScope.get(scopeKey) ?? [])
    .filter((session) => session.status !== 'closed')
    .map((session) => ({ ...session }));
}

function terminalTruthUnavailable(request: Request) {
  return request.headers.get('x-mock-terminal-truth') === 'unavailable';
}

export function resetMockTaskTerminalSessions() {
  terminalSessionsByScope.clear();
  nextTerminalSessionOrdinal = 1;
}

export function resetMockTaskRealtimeRuntime() {
  issuedMockSseTickets.clear();
  nextMockSseTicketOrdinal = 1;
}

export function listMockTaskTerminalSessions(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
}): { total: number; items: TaskTerminalSessionStatus[] } {
  const items = listLiveTerminalSessionsForScope(taskTerminalScopeKey(args));
  return { total: items.length, items };
}

export function createMockTaskTerminalSession(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  cols?: number;
  rows?: number;
}): TaskTerminalSessionCreateResponse {
  const sessionId = `mock_terminal_${String(nextTerminalSessionOrdinal).padStart(3, '0')}`;
  nextTerminalSessionOrdinal += 1;
  const scopeKey = taskTerminalScopeKey(args);
  const now = VISUAL_TEST_REFERENCE_NOW_ISO;
  const session: TaskTerminalSessionStatus = {
    terminal_session_id: sessionId,
    status: 'active',
    cols: args.cols ?? 120,
    rows: args.rows ?? 30,
    created_at: now,
    last_activity_at: now,
    ended_at: null,
    close_reason: null,
    exit_code: null,
    ws_url: `ws://mock.agentsmith.local/terminal/${sessionId}`,
  };
  terminalSessionsByScope.set(scopeKey, [
    ...(terminalSessionsByScope.get(scopeKey) ?? []),
    session,
  ]);
  return {
    terminal_session_id: session.terminal_session_id,
    status: session.status,
    ws_url: session.ws_url ?? '',
  };
}

function issueMockTaskSseTicket(bearerToken: string) {
  const ticket = `${MOCK_SSE_TICKET_PREFIX}${String(nextMockSseTicketOrdinal).padStart(3, '0')}`;
  nextMockSseTicketOrdinal += 1;
  const expiresAt = new Date(Date.parse(VISUAL_TEST_REFERENCE_NOW_ISO) + 5 * 60 * 1000).toISOString();
  const issued = { bearerToken, expiresAt, maxConnections: 1 };
  issuedMockSseTickets.set(ticket, issued);
  return { ticket, ...issued };
}

function validateMockTaskSseTicket(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return false;
  return issuedMockSseTickets.has(ticket);
}

function createMockTaskEventsStream(taskId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const clearKeepalive = () => {
    closed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`: agentsmith mock task events connected task=${taskId}\n\n`));
      keepaliveTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: agentsmith mock task events keepalive task=${taskId}\n\n`));
        } catch {
          clearKeepalive();
        }
      }, 15000);
    },
    cancel() {
      clearKeepalive();
    },
  });
}

function mockBindingSummary(
  state: string,
  reason_code?: TaskRunnerBindingReasonCode,
) {
  return {
    state,
    summary: state,
    ...(reason_code ? { reason_code } : {}),
  };
}

function mockBindingAction(
  allowed: boolean,
  required_permissions: string[],
  reason_code?: TaskRunnerBindingReasonCode,
) {
  return {
    operation: 'bind_to_task' as const,
    visible: true,
    allowed,
    ...(reason_code ? { reason_code } : {}),
    required_permissions,
    danger_level: 'none' as const,
  };
}

function mockRunnerBindingReason(runner: typeof agentRunnerFixtures[number]): TaskRunnerBindingReasonCode | undefined {
  if (runner.status !== 'ready') return 'agent_runner_unavailable' as const;
  if (runner.capabilities?.task_execution === false) return 'agent_runner_capability_mismatch' as const;
  return undefined;
}

function buildMockDefaultRunnerBindingOption(
  projectId: string,
): TaskRunnerBindingOption {
  const defaultRunner = agentRunnerFixtures.find((item) => (
    item.project_id === projectId &&
    item.kind === 'system_managed' &&
    item.is_default === true
  ));
  const reason = defaultRunner ? mockRunnerBindingReason(defaultRunner) : 'agent_runner_unavailable';
  return {
    option_id: 'default_managed',
    label: 'Default managed runner',
    bound_runner_kind: 'managed',
    runner_binding_source: 'default_managed',
    readiness: mockBindingSummary(reason ? 'unavailable' : 'ready', reason),
    capability: mockBindingSummary(reason === 'agent_runner_capability_mismatch' ? 'incompatible' : 'compatible', reason === 'agent_runner_capability_mismatch' ? reason : undefined),
    ...(reason ? { disabled_reason_code: reason } : {}),
    actions: {
      bind_to_task: mockBindingAction(!reason, ['project:agent_task:use'], reason),
    },
  };
}

function buildMockDeveloperRunnerBindingOption(
  runner: typeof agentRunnerFixtures[number],
): TaskRunnerBindingOption {
  const requiredPermissions = ['project:agent_task:use', 'project:agent_runner:manage'];
  const reason = mockRunnerBindingReason(runner);
  return {
    option_id: runner.id,
    agent_runner_id: runner.id,
    label: runner.name,
    bound_runner_kind: 'developer',
    runner_binding_source: 'explicit',
    readiness: mockBindingSummary(reason ? 'unavailable' : 'ready', reason === 'agent_runner_unavailable' ? reason : undefined),
    capability: mockBindingSummary(reason === 'agent_runner_capability_mismatch' ? 'incompatible' : 'compatible', reason === 'agent_runner_capability_mismatch' ? reason : undefined),
    freshness: mockBindingSummary(runner.status === 'ready' ? 'fresh' : 'missing', runner.status === 'ready' ? undefined : 'agent_runner_disconnected'),
    ...(reason ? { disabled_reason_code: reason } : {}),
    actions: {
      bind_to_task: mockBindingAction(!reason, requiredPermissions, reason),
    },
  };
}

function hasMockRunnerBindingManageAuthority(request: Request, projectId: string) {
  const actor = readMockAuthActorFromRequest(request);
  const membership = memberProjectMembershipFixtures.find((item) => (
    item.project_id === projectId &&
    item.user_id === actor.userId &&
    item.status === 'active'
  ));
  return membership?.permissions.some((permission) => (
    permission === 'project:agent_runner:manage'
  )) ?? false;
}

function readMockExplicitBoundRunnerId(body: Record<string, unknown>): string {
  return typeof body.bound_runner_id === 'string'
    ? body.bound_runner_id.trim()
    : '';
}

function findMockExplicitBoundRunnerTarget(
  projectId: string,
  runnerId: string,
): typeof agentRunnerFixtures[number] | undefined {
  return agentRunnerFixtures.find((item) => (
    item.id === runnerId &&
    item.project_id === projectId
  ));
}

function resolveMockTaskBoundRunner(
  projectId: string,
  body: Record<string, unknown>,
): typeof agentRunnerFixtures[number] | null {
  const explicitRunnerId = readMockExplicitBoundRunnerId(body);
  if (explicitRunnerId) {
    const runner = agentRunnerFixtures.find((item) => (
      item.id === explicitRunnerId &&
      item.project_id === projectId &&
      item.kind === 'developer' &&
      item.status === 'ready' &&
      item.capabilities?.task_execution !== false
    ));
    return runner ?? null;
  }
  return agentRunnerFixtures.find((item) => (
    item.project_id === projectId &&
    item.kind === 'system_managed' &&
    item.is_default === true &&
    item.status === 'ready' &&
    item.capabilities?.task_execution !== false
  )) ?? null;
}

export const taskHandlers = [
  http.post(`${API_V1_PATTERN}/sse-ticket`, ({ request }) => {
    if (readMockTaskRealtimeMode(request) === 'sse_ticket_upstream') {
      return HttpResponse.json({
        error_code: 'MOCK_SSE_TICKET_UPSTREAM',
        message: 'mock_sse_ticket_upstream_failure',
      }, { status: 503 });
    }

    const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!bearerToken) {
      return HttpResponse.json({
        error_code: 'MOCK_SSE_TICKET_UNAUTHORIZED',
        message: 'mock_sse_ticket_requires_authorization',
      }, { status: 401 });
    }
    const issued = issueMockTaskSseTicket(bearerToken);
    const url = new URL(request.url);
    return HttpResponse.json({
      ticket: issued.ticket,
      expires_at: issued.expiresAt,
      max_connections: issued.maxConnections,
      sso_url: `${url.origin}/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/events`, ({ request, params }) => {
    if (!validateMockTaskSseTicket(request)) {
      return HttpResponse.json({
        error_code: 'MOCK_SSE_TICKET_REQUIRED',
        message: 'mock_sse_ticket_required',
      }, { status: 401 });
    }
    return new HttpResponse(createMockTaskEventsStream(String(params.id ?? '')), {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('page_size') ?? 20);
    const start = (page - 1) * pageSize;
    const items = tasks.slice(start, start + pageSize);
    for (const item of items) {
      hydrateMockTaskStopRuntimeTruth(item.id, item as MockTaskStopRuntimeFields);
    }
    return HttpResponse.json({
      items,
      total: tasks.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < tasks.length,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/runner-binding-options`, ({ request, params }) => {
    const projectId = params.prj as string;
    if (!hasMockRunnerBindingManageAuthority(request, projectId)) {
      return HttpResponse.json({
        options: [
          buildMockDefaultRunnerBindingOption(projectId),
        ],
        generated_at: VISUAL_TEST_REFERENCE_NOW_ISO,
      });
    }
    const options = [
      buildMockDefaultRunnerBindingOption(projectId),
      ...agentRunnerFixtures
        .filter((runner) => runner.project_id === projectId && runner.kind === 'developer')
        .map((runner) => buildMockDeveloperRunnerBindingOption(runner)),
    ];
    return HttpResponse.json({
      options,
      generated_at: VISUAL_TEST_REFERENCE_NOW_ISO,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id`, ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    hydrateMockTaskStopRuntimeTruth(taskId, task as MockTaskStopRuntimeFields);
    return HttpResponse.json(task);
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks`, async ({ request, params }) => {
    const body: any = await request.json().catch(() => ({}));
    const unsupportedFields = [
      'agent_id',
      'agent_name',
      'runner_id',
      LEGACY_RUN_SELECTION_FIELD,
      'is_default',
      'default_endpoint_id',
      'config',
      'capabilities',
      'runner_provider',
    ].filter((field) => (
      Object.prototype.hasOwnProperty.call(body ?? {}, field)
    ));
    if (unsupportedFields.length > 0) {
      return HttpResponse.json(
        { error_code: 'unsupported_field', message: 'unsupported_field', fields: unsupportedFields },
        { status: 400 },
      );
    }
    const workspaceMode = typeof body?.workspace_mode === 'string' ? body.workspace_mode.trim() : '';
    const workspaceFileLibraryId = typeof body?.workspace_file_library_id === 'string'
      ? body.workspace_file_library_id.trim()
      : '';
    if (workspaceMode !== 'create_new' && workspaceFileLibraryId.length === 0) {
      return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'workspace_file_library_id_required' }, { status: 422 });
    }
    if (workspaceFileLibraryId.length > 0) {
      const occupied = tasks.find((task) => task.status === 'active' && task.workspace_file_library_id === workspaceFileLibraryId);
      if (occupied) {
        return HttpResponse.json({ error_code: 'RESOURCE_CONFLICT', message: 'workspace_file_library_in_use' }, { status: 409 });
      }
    }
    const projectId = String(params.prj ?? '');
    const explicitRunnerId = readMockExplicitBoundRunnerId(body ?? {});
    const explicitRunnerTarget = explicitRunnerId
      ? findMockExplicitBoundRunnerTarget(projectId, explicitRunnerId)
      : undefined;
    if (explicitRunnerTarget?.kind === 'system_managed') {
      return HttpResponse.json({
        error_code: 'invalid_binding_target',
        message: 'invalid_binding_target',
        field: 'bound_runner_id',
        details: {
          bound_runner_id: explicitRunnerId,
          expected_bound_runner_kind: 'developer',
          actual_bound_runner_kind: 'managed',
        },
      }, { status: 422 });
    }
    const boundRunner = resolveMockTaskBoundRunner(projectId, body ?? {});
    if (!boundRunner) {
      return HttpResponse.json({
        error_code: 'agent_runner_unavailable',
        message: 'agent_runner_unavailable',
      }, { status: 409 });
    }
    const now = new Date().toISOString();
    const generatedWorkspaceName = typeof body?.workspace_name === 'string' && body.workspace_name.trim().length > 0
      ? body.workspace_name.trim()
      : `${body?.title ?? 'New Task'} Workspace`;
    const boundRunnerKind: TaskRunnerBindingKind = boundRunner.kind === 'developer' ? 'developer' : 'managed';
    const newTask = {
      id: `task_${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: params.ws as string,
      project_id: params.prj as string,
      owner_user_id: 'user_001',
      title: body?.title ?? 'New Task',
      bound_runner_id: boundRunner.id,
      bound_runner_kind: boundRunnerKind,
    runner_binding_source: (body?.bound_runner_id ? 'explicit' : 'default_managed') as TaskRunnerBindingSource,
      bound_at: now,
      bound_by_user_id: readMockAuthActorFromRequest(request).userId,
      workspace_file_library_id: workspaceMode === 'create_new'
        ? `flib_${Math.random().toString(36).slice(2, 10)}`
        : workspaceFileLibraryId,
      workspace_file_library_name: workspaceMode === 'create_new'
        ? generatedWorkspaceName
        : body?.workspace_file_library_name ?? 'Project Uploads',
      status: body?.status ?? 'active',
      attached_inputs: Array.isArray(body?.inputs) ? body.inputs.map((item: any, idx: number) => ({
        id: item?.id ?? `in_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        ...item,
      })) : [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
      agent_presence: normalizeTaskAgentPresence(body?.agent_presence),
      run_state: body?.run_state ?? 'idle',
    };
    tasks.unshift(newTask);
    return HttpResponse.json(newTask);
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id`, async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const body = asRecord(await request.json().catch(() => ({})));
    const unsupportedFields = [
      'agent_id',
      'agent_name',
      'runner_id',
      LEGACY_RUN_SELECTION_FIELD,
      'bound_runner_id',
      'agent_runner_id',
      'is_default',
      'default_endpoint_id',
      'config',
      'capabilities',
      'runner_provider',
    ].filter((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (unsupportedFields.length > 0) {
      return HttpResponse.json({
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      }, { status: 400 });
    }
    if (typeof body.title === 'string' && body.title.trim().length > 0) {
      task.title = body.title.trim();
    }
    if (body.status === 'active' || body.status === 'archived') {
      task.status = body.status;
    }
    task.updated_at = new Date().toISOString();
    return HttpResponse.json(task);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id`, ({ params }) => {
    const taskId = params.id as string;
    const index = tasks.findIndex((r) => r.id === taskId);
    if (index >= 0) {
      tasks.splice(index, 1);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/cancel`, async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const terminateRequested = isTerminateMode(body);
    const cancelEscalationMode = readMockTaskCancelEscalationMode(request);
    const mutableTask = task as MockTaskStopRuntimeFields;
    const alreadyTerminating =
      mutableTask.stop_mode === 'terminate' ||
      mutableTask.run_state === 'terminating';
    const terminateSupported =
      cancelEscalationMode === 'supported' ||
      (cancelEscalationMode !== 'unsupported' && mutableTask.can_escalate === true) ||
      alreadyTerminating;
    if (terminateRequested && !terminateSupported) {
      return HttpResponse.json(mockTaskCancelUnavailableResponse({
        taskId,
        task: mutableTask,
        reason: 'unsupported_runner',
      }), { status: 409 });
    }
    const shouldTerminate =
      alreadyTerminating || (terminateRequested && terminateSupported);
    const stopMode: MockTaskStopMode = shouldTerminate ? 'terminate' : 'cancel';
    const canEscalate =
      !terminateRequested &&
      stopMode === 'cancel' &&
      (
        cancelEscalationMode === 'supported' ||
        (cancelEscalationMode !== 'unsupported' && mutableTask.can_escalate === true)
      );
    const nextRunState: TaskRunState =
      stopMode === 'terminate' ? 'terminating' : 'cancelling';
    const escalationReason =
      stopMode === 'terminate'
        ? 'already_terminating'
        : canEscalate
          ? null
          : resolveMockTaskStopEscalationReason(mutableTask, 'unsupported_runner');
    const requestIdPrefix =
      stopMode === 'terminate' ? 'mock_terminate' : 'mock_cancel';
    const now = new Date().toISOString();
    applyMockTaskStopRuntimeTruth(mutableTask, {
      runState: nextRunState,
      canEscalate,
      escalationReason,
      stopMode,
      now,
    });
    persistMockTaskStopRuntimeTruth(taskId, {
      run_state: nextRunState,
      can_escalate: canEscalate,
      escalation_reason: escalationReason,
      stop_mode: stopMode,
      updated_at: now,
      last_activity_at: now,
    });

    return HttpResponse.json({
      status: nextRunState,
      task_id: taskId,
      run_id: `mock_run_${taskId}`,
      request_id: `${requestIdPrefix}_${taskId}`,
      can_escalate: canEscalate,
      ...(escalationReason ? { escalation_reason: escalationReason } : {}),
      stop_mode: stopMode,
    }, { status: 202 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/inputs`, async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const body: any = await request.json().catch(() => ({}));
    const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
    const existing = new Set((task.attached_inputs ?? []).map((item: any) =>
      item?.kind === 'library_object'
        ? `library_object:${item.library_id}:${item.key}`
        : item?.kind === 'artifact'
          ? `artifact:${item.task_id}:${item.artifact_id}`
          : `url:${item.url}`));
    for (const rawInput of inputs) {
      const item = rawInput ?? {};
      const dedupeKey = item.kind === 'library_object'
        ? `library_object:${item.library_id}:${item.key}`
        : item.kind === 'artifact'
          ? `artifact:${item.task_id}:${item.artifact_id}`
          : `url:${item.url}`;
      if (existing.has(dedupeKey)) continue;
      existing.add(dedupeKey);
      (task.attached_inputs ??= []).push({
        id: item.id ?? `in_${Math.random().toString(36).slice(2, 8)}`,
        ...item,
      });
    }
    task.updated_at = new Date().toISOString();
    return HttpResponse.json(task);
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/inputs`, ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const items = (task.attached_inputs ?? []).map((input: any) => {
      if (input.kind === 'library_object') {
        return {
          id: input.id,
          kind: 'library_object',
          library_id: input.library_id,
          key: input.key,
          filename: input.name ?? (typeof input.key === 'string' ? input.key.split('/').pop() : 'object.bin'),
          file_type: input.content_type ?? 'application/octet-stream',
          file_size: input.size_bytes ?? 0,
        };
      }
      if (input.kind === 'artifact') {
        return {
          id: input.id,
          kind: 'artifact',
          task_id: input.task_id,
          artifact_id: input.artifact_id,
          filename: input.name ?? input.task_relative_path ?? 'artifact',
          file_type: input.content_type ?? 'application/octet-stream',
          file_size: input.size_bytes ?? 0,
          ...(input.task_relative_path ? { task_relative_path: input.task_relative_path } : {}),
        };
      }
      if (input.kind === 'url') {
        return {
          id: input.id,
          kind: 'url',
          url: input.url,
          filename: input.name ?? input.url ?? 'url_input.url.txt',
          file_type: input.content_type ?? 'text/plain',
          file_size: input.size_bytes ?? 0,
          ...(input.imported_library_id ? { imported_library_id: input.imported_library_id } : {}),
          ...(input.imported_key ? { imported_key: input.imported_key } : {}),
        };
      }
      return null;
    }).filter(Boolean);
    return HttpResponse.json(items);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/inputs/:inputId`, ({ params }) => {
    const taskId = params.id as string;
    const inputId = params.inputId as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    task.attached_inputs = (task.attached_inputs ?? []).filter((item: any) => item.id !== inputId);
    task.updated_at = new Date().toISOString();
    return HttpResponse.json(task);
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/terminal/sessions`, ({ request, params }) => {
    if (terminalTruthUnavailable(request)) {
      return HttpResponse.json({ error_code: 'terminal_truth_unavailable', message: 'terminal_truth_unavailable' }, { status: 503 });
    }
    return HttpResponse.json(listMockTaskTerminalSessions({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      taskId: String(params.id ?? ''),
    }));
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/terminal/sessions`, async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as CreateTaskTerminalSessionRequest;
    return HttpResponse.json(createMockTaskTerminalSession({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      taskId: String(params.id ?? ''),
      cols: body.cols,
      rows: body.rows,
    }), { status: 201 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/terminal/sessions/:terminalSessionId`, ({ request, params }) => {
    if (terminalTruthUnavailable(request)) {
      return HttpResponse.json({ error_code: 'terminal_truth_unavailable', message: 'terminal_truth_unavailable' }, { status: 503 });
    }
    const scopeKey = taskTerminalScopeKey({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      taskId: String(params.id ?? ''),
    });
    const session = listLiveTerminalSessionsForScope(scopeKey)
      .find((item) => item.terminal_session_id === String(params.terminalSessionId ?? ''));
    if (!session) {
      return HttpResponse.json({ error_code: 'task_terminal_session_missing', message: 'task_terminal_session_missing' }, { status: 404 });
    }
    return HttpResponse.json(session);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/terminal/sessions/:terminalSessionId`, ({ params }) => {
    const scopeKey = taskTerminalScopeKey({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      taskId: String(params.id ?? ''),
    });
    const sessions = terminalSessionsByScope.get(scopeKey) ?? [];
    terminalSessionsByScope.set(scopeKey, sessions.map((session) =>
      session.terminal_session_id === String(params.terminalSessionId ?? '')
        ? {
            ...session,
            status: 'closed',
            ended_at: VISUAL_TEST_REFERENCE_NOW_ISO,
            close_reason: 'user_closed',
          }
        : session,
    ));
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/activity`, ({ params }) => {
    const taskId = params.id as string;
    const items = taskActivities.filter((m) => m.task_id === taskId);
    return HttpResponse.json(items);
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/traces`, ({ request, params }) => {
    const taskId = params.id as string;
    const url = new URL(request.url);
    const messageId = url.searchParams.get('message_id');
    const runId = url.searchParams.get('run_id');
    const afterId = url.searchParams.get('after_id');
    const beforeId = url.searchParams.get('before_id');
    const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('page_size') ?? 100)));

    let items = taskTraces
      .filter((t) => t.task_id === taskId)
      .sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
    if (messageId) items = items.filter((t) => t.message_id === messageId);
    if (runId) items = items.filter((t) => t.run_id === runId);

    if (afterId) {
      const idx = items.findIndex((t) => t.id === afterId);
      if (idx >= 0) items = items.slice(idx + 1);
      const sliced = items.slice(0, pageSize);
      return HttpResponse.json({
        items: sliced,
        total: sliced.length,
        has_more: items.length > sliced.length,
        next_after_id: null,
      });
    }

    if (beforeId) {
      const idx = items.findIndex((t) => t.id === beforeId);
      const older = idx >= 0 ? items.slice(0, idx) : items;
      const start = Math.max(0, older.length - pageSize);
      const sliced = older.slice(start);
      return HttpResponse.json({
        items: sliced,
        total: sliced.length,
        has_more: start > 0,
        next_after_id: start > 0 ? sliced[0]?.id ?? null : null,
      });
    }

    // Default behavior: return latest page to exercise UI "load earlier logs".
    const start = Math.max(0, items.length - Math.min(pageSize, 3));
    const sliced = items.slice(start);
    return HttpResponse.json({
      items: sliced,
      total: sliced.length,
      has_more: start > 0,
      next_after_id: start > 0 ? sliced[0]?.id ?? null : null,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/runs`, async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((item) => item.id === taskId);
    if (task && task.run_state && task.run_state !== 'idle') {
      return HttpResponse.json({
        error_code: 'TASK_RUN_IN_PROGRESS',
        message: 'task_run_in_progress',
      }, { status: 409 });
    }
    const body = asRecord(await request.json().catch(() => ({})));
    const unsupportedFields = [
      'role',
      'content',
      'agent_id',
      'agent_name',
      'runner_id',
      LEGACY_RUN_SELECTION_FIELD,
      'bound_runner_id',
      'agent_runner_id',
      'is_default',
      'default_endpoint_id',
      'config',
    ]
      .filter((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (unsupportedFields.length > 0) {
      return HttpResponse.json({
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      }, { status: 400 });
    }
    const intent = typeof body.intent === 'string' ? body.intent : '';
    if (!intent.trim()) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'task_run_intent_required',
        field: 'intent',
      }, { status: 422 });
    }
    const now = new Date().toISOString();
    const userActivity: TaskActivityItem = {
      id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      kind: 'user_intent',
      actor: 'user',
      content: intent,
      created_at: now,
    };
    const runnerActivity: TaskActivityItem = {
      id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      kind: 'runner_output',
      actor: 'runner',
      content: '',
      created_at: now,
      run_id: `run_${Math.random().toString(36).slice(2, 8)}`,
    };
    taskActivities.push(userActivity, runnerActivity);
    return HttpResponse.json(runnerActivity);
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/artifacts`, ({ params }) => {
    const taskId = params.id as string;
    const items = artifacts.filter((a) => a.task_id === taskId);
    return HttpResponse.json(items);
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/artifacts/:artifactId/download`, () => {
    return new HttpResponse('Mock artifact content', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),
];
