import { http, HttpResponse } from 'msw';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';
import type {
  CreateTaskTerminalSessionRequest,
  TaskTerminalSessionCreateResponse,
  TaskTerminalSessionStatus,
} from '@/lib/types/task';
import {
  taskFixtures,
  taskMessageFixtures,
  artifactFixtures,
  taskTraceFixtures,
} from '../fixtures/notebook';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import {
  docTaskFixtures,
  docTaskMessageFixtures,
  docArtifactFixtures,
  docTaskTraceFixtures,
} from '../doc-fixtures/notebook';

const tasks = DOC_FIXTURES_ENABLED ? [...docTaskFixtures] : [...taskFixtures];
const taskMessages = DOC_FIXTURES_ENABLED ? [...docTaskMessageFixtures] : [...taskMessageFixtures];
const artifacts = DOC_FIXTURES_ENABLED ? [...docArtifactFixtures] : [...artifactFixtures];
const taskTraces = DOC_FIXTURES_ENABLED ? [...docTaskTraceFixtures] : [...taskTraceFixtures];
const API_V1_PATTERN = '*/api/v1';
const MOCK_SSE_TICKET_PREFIX = 'mock_sse_';
const terminalSessionsByScope = new Map<string, TaskTerminalSessionStatus[]>();
const issuedMockSseTickets = new Map<string, { bearerToken: string; expiresAt: string; maxConnections: number }>();
let nextTerminalSessionOrdinal = 1;
let nextMockSseTicketOrdinal = 1;

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
    id: sessionId,
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
    session_id: session.id,
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
    return HttpResponse.json({
      items,
      total: tasks.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < tasks.length,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id`, ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    return HttpResponse.json(task);
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks`, async ({ request, params }) => {
    const body: any = await request.json().catch(() => ({}));
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
    const now = new Date().toISOString();
    const generatedWorkspaceName = typeof body?.workspace_name === 'string' && body.workspace_name.trim().length > 0
      ? body.workspace_name.trim()
      : `${body?.title ?? 'New Task'} Workspace`;
    const newTask = {
      id: `task_${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: params.ws as string,
      project_id: params.prj as string,
      owner_user_id: 'user_001',
      title: body?.title ?? 'New Task',
      agent_id: body?.agent_id ?? 'ag_2',
      agent_name: body?.agent_name ?? 'Research Agent',
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
      agent_presence: body?.agent_presence ?? 'managed',
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
    const body: any = await request.json().catch(() => ({}));
    Object.assign(task, body, { updated_at: new Date().toISOString() });
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
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/cancel`, ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    task.run_state = 'idle';
    task.updated_at = now;
    task.last_activity_at = now;

    return HttpResponse.json({
      status: 'cancelling',
      task_id: taskId,
      run_id: `mock_run_${taskId}`,
      request_id: `mock_cancel_${taskId}`,
    });
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
      .find((item) => item.id === String(params.terminalSessionId ?? ''));
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
      session.id === String(params.terminalSessionId ?? '')
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
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/messages`, ({ params }) => {
    const taskId = params.id as string;
    const items = taskMessages.filter((m) => m.task_id === taskId);
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
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/tasks/:id/messages`, async ({ request, params }) => {
    const taskId = params.id as string;
    const body: any = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const message = {
      id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      role: body?.role ?? 'user',
      content: body?.content ?? '',
      created_at: now,
    };
    taskMessages.push(message);
    return HttpResponse.json(message);
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
