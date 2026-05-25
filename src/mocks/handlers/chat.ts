import { http, HttpResponse } from 'msw';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';
import p0 from '../fixtures/p0.json';
import { chatSessionFixtures, chatMessageFixtures } from '../fixtures/chat';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docChatSessions, docChatMessages } from '../doc-fixtures/chat';
import type { Attachment } from '@/lib/api/types';

type ChatSessionLike = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  starred?: boolean;
  pinned?: boolean;
  model?: string;
  endpoint_id?: string;
  execution_status?: 'running' | 'stopping' | 'terminating' | 'completed' | 'stopped' | 'failed';
  can_escalate?: boolean;
  escalation_reason?: string | null;
  stop_mode?: 'cancel' | 'terminate';
  status?: 'running' | 'stopping' | 'terminating';
  termination_state?: 'terminating' | null;
};

type ChatMessageLike = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  parent_id?: string | null;
};

const sessions: ChatSessionLike[] = DOC_FIXTURES_ENABLED
  ? (docChatSessions as unknown as ChatSessionLike[])
  : p0.chat_sessions.length
  ? (p0.chat_sessions as unknown as ChatSessionLike[])
  : (chatSessionFixtures as unknown as ChatSessionLike[]);
const messages: ChatMessageLike[] = DOC_FIXTURES_ENABLED
  ? (docChatMessages as unknown as ChatMessageLike[])
  : p0.chat_messages.length
  ? (p0.chat_messages as unknown as ChatMessageLike[])
  : (chatMessageFixtures as unknown as ChatMessageLike[]);

const attachmentsBySession: Record<string, Attachment[]> = {};
const API_V1_PATTERN = '*/api/v1';
const MOCK_CHAT_STOP_ESCALATION_SESSION_ID = 'session_001';
type MockChatStopEscalationMode = 'supported' | 'unsupported';
type MockChatStopMode = 'cancel' | 'terminate';
type MockChatStopActiveStatus = 'running' | 'stopping' | 'terminating';
type MockChatStopResponseStatus = 'stopping' | 'terminating' | 'not_found_or_finished';
type MockChatStopEscalationReason = 'STOP_ESCALATION_UNAVAILABLE';
const mockChatStopRuntimeBySession = new Map<string, {
  capabilityMode: MockChatStopEscalationMode;
  streamId: string;
  executionStatus: MockChatStopActiveStatus;
  canEscalate: boolean;
  escalationReason: MockChatStopEscalationReason | null;
  stopMode: MockChatStopMode;
  status: MockChatStopActiveStatus;
  terminationState: 'terminating' | null;
}>();

function getSessionAttachments(sessionId: string): Attachment[] {
  if (!attachmentsBySession[sessionId]) {
    attachmentsBySession[sessionId] = [];
  }
  return attachmentsBySession[sessionId];
}

function readMockChatStopEscalationMode(request: Request): MockChatStopEscalationMode | null {
  const headerMode = request.headers.get('x-mock-chat-stop-escalation')?.trim();
  if (headerMode === 'supported' || headerMode === 'unsupported') return headerMode;

  const url = new URL(request.url);
  const queryMode = url.searchParams.get('mock_chat_stop_escalation')?.trim();
  if (queryMode === 'supported' || queryMode === 'unsupported') return queryMode;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieMode = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ags_mock_chat_stop_escalation='))
    ?.split('=')[1]
    ?.trim();
  if (!cookieMode) return null;
  const decoded = decodeURIComponent(cookieMode);
  return decoded === 'supported' || decoded === 'unsupported' ? decoded : null;
}

function isTerminateStopMode(body: unknown) {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  return record.mode === 'terminate';
}

function hasLegacyStopModeField(body: unknown): boolean {
  return Boolean(
    body
    && typeof body === 'object'
    && Object.prototype.hasOwnProperty.call(body, 'stop_mode'),
  );
}

function legacyStopModeFieldResponse() {
  return HttpResponse.json({
    error_code: 'unsupported_field',
    message: 'unsupported_field',
    fields: ['stop_mode'],
  }, { status: 400 });
}

function hasUnsupportedExternalAgentField(body: unknown): boolean {
  return (
    typeof body === 'object'
    && body !== null
    && Object.prototype.hasOwnProperty.call(body, 'external_agent_id')
  );
}

function ensureMockChatStopRuntime(sessionId: string, mode: MockChatStopEscalationMode) {
  const existing = mockChatStopRuntimeBySession.get(sessionId);
  if (existing && existing.capabilityMode === mode) return existing;

  const runtime = {
    capabilityMode: mode,
    streamId: `mock_chat_stream_${sessionId}`,
    executionStatus: 'running' as const,
    canEscalate: mode === 'supported',
    escalationReason: null,
    stopMode: 'cancel' as const,
    status: 'running' as const,
    terminationState: null,
  };
  mockChatStopRuntimeBySession.set(sessionId, runtime);
  return runtime;
}

function buildMockChatStopResponse(
  ids: { sessionId?: string; streamId?: string },
  input: {
    state: MockChatStopResponseStatus;
    stopMode: MockChatStopMode;
    canEscalate: boolean;
    escalationReason?: MockChatStopEscalationReason | null;
  },
) {
  return {
    success: true,
    ...(ids.sessionId ? { session_id: ids.sessionId } : {}),
    ...(ids.streamId ? { stream_id: ids.streamId } : {}),
    state: input.state,
    status: input.state,
    mode: input.stopMode,
    can_escalate: input.canEscalate,
    ...(input.escalationReason ? { escalation_reason: input.escalationReason } : {}),
  };
}

function applyMockChatStopRequest(
  runtime: NonNullable<ReturnType<typeof ensureMockChatStopRuntime>>,
  terminateRequested: boolean,
): Exclude<MockChatStopResponseStatus, 'not_found_or_finished'> {
  const terminateMode = terminateRequested && runtime.capabilityMode === 'supported';
  const responseStatus = terminateMode ? 'terminating' : 'stopping';
  runtime.executionStatus = responseStatus;
  runtime.stopMode = terminateMode ? 'terminate' : 'cancel';
  runtime.status = responseStatus;
  runtime.terminationState = terminateMode ? 'terminating' : null;
  runtime.canEscalate = !terminateMode && runtime.capabilityMode === 'supported';
  runtime.escalationReason =
    runtime.canEscalate || terminateMode ? null : 'STOP_ESCALATION_UNAVAILABLE';
  return responseStatus;
}

function getMockChatStopRuntimeForRequest(request: Request, sessionId: string) {
  const existing = mockChatStopRuntimeBySession.get(sessionId);
  if (existing) return existing;

  const mode = readMockChatStopEscalationMode(request);
  if (!mode || sessionId !== MOCK_CHAT_STOP_ESCALATION_SESSION_ID) return null;
  return ensureMockChatStopRuntime(sessionId, mode);
}

function decorateSessionForMockStop(request: Request, session: ChatSessionLike): ChatSessionLike {
  const runtime = getMockChatStopRuntimeForRequest(request, session.id);
  if (!runtime) return session;

  return {
    ...session,
    model: session.model ?? 'gpt-4o',
    endpoint_id: session.endpoint_id ?? 'ep_1',
    execution_status: runtime.executionStatus,
    can_escalate: runtime.canEscalate,
    escalation_reason: runtime.escalationReason,
    stop_mode: runtime.stopMode,
    status: runtime.status,
    termination_state: runtime.terminationState,
  };
}

function createMockChatEventsStream(sessionId: string, streamId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const clearKeepalive = () => {
    closed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
        stream_id: streamId,
        session_id: sessionId,
        model: 'gpt-4o',
        endpoint_id: 'ep_1',
      })}\n\n`));
      keepaliveTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: agentsmith mock chat stream keepalive session=${sessionId}\n\n`));
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

export const chatHandlers = [
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions`, ({ request }) =>
    HttpResponse.json({
      items: sessions.map((session) => decorateSessionForMockStop(request, session)),
      total: sessions.length,
      page: 1,
      page_size: 25,
      has_more: false,
    }),
  ),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id`, ({ request, params }) => {
    const session = sessions.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(decorateSessionForMockStop(request, session));
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ChatSessionLike> & Record<string, unknown>;
    if (hasUnsupportedExternalAgentField(body)) {
      return HttpResponse.json(
        { error_code: 'unsupported_field', message: 'external_agent_id' },
        { status: 400 },
      );
    }
    const newSession = {
      id: `session_${Date.now()}`,
      project_id: 'proj_001',
      user_id: 'user_001',
      title: body.title ?? 'New Chat',
      model: body.model ?? 'gpt-4o-mini',
      endpoint_id: body.endpoint_id ?? 'ep_openai_001',
      starred: false,
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    sessions.unshift(newSession);
    return HttpResponse.json(newSession, { status: 201 });
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ChatSessionLike> & Record<string, unknown>;
    if (hasUnsupportedExternalAgentField(body)) {
      return HttpResponse.json(
        { error_code: 'unsupported_field', message: 'external_agent_id' },
        { status: 400 },
      );
    }
    const idx = sessions.findIndex((s) => s.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const next: ChatSessionLike = {
      ...sessions[idx],
      ...body,
      updated_at: new Date().toISOString(),
    };
    sessions[idx] = next;
    return HttpResponse.json(next);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id`, ({ params }) => {
    const idx = sessions.findIndex((s) => s.id === params.id);
    if (idx >= 0) {
      sessions.splice(idx, 1);
    }
    return HttpResponse.json({ success: true });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/streams`, ({ request, params }) => {
    const sessionId = String(params.id ?? '');
    const runtime = getMockChatStopRuntimeForRequest(request, sessionId);
    if (!runtime) {
      return HttpResponse.json({ items: [], total: 0 });
    }
    return HttpResponse.json({
      items: [{
        stream_id: runtime.streamId,
        status: runtime.executionStatus,
        started_at: VISUAL_TEST_REFERENCE_NOW_ISO,
      }],
      total: 1,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/messages/streams/:streamId`, ({ request, params }) => {
    const sessionId = String(params.id ?? '');
    const streamId = String(params.streamId ?? '');
    const runtime = getMockChatStopRuntimeForRequest(request, sessionId);
    if (!runtime || runtime.streamId !== streamId) {
      return HttpResponse.json({
        error_code: 'RESOURCE_NOT_FOUND',
        message: 'mock_chat_stream_not_found',
      }, { status: 404 });
    }
    return new HttpResponse(createMockChatEventsStream(sessionId, streamId), {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/stop`, async ({ request, params }) => {
    const sessionId = String(params.id ?? '');
    const mode = readMockChatStopEscalationMode(request);
    const runtime = mode ? ensureMockChatStopRuntime(sessionId, mode) : mockChatStopRuntimeBySession.get(sessionId);
    const body = await request.json().catch(() => ({}));
    if (hasLegacyStopModeField(body)) return legacyStopModeFieldResponse();
    const terminateRequested = isTerminateStopMode(body);
    if (!runtime) {
      return HttpResponse.json(buildMockChatStopResponse({ sessionId }, {
        state: 'not_found_or_finished',
        stopMode: terminateRequested ? 'terminate' : 'cancel',
        canEscalate: false,
      }), { status: 202 });
    }

    const responseStatus = applyMockChatStopRequest(runtime, terminateRequested);
    return HttpResponse.json({
      ...buildMockChatStopResponse({ sessionId }, {
        state: responseStatus,
        stopMode: runtime.stopMode,
        canEscalate: runtime.canEscalate,
        escalationReason: runtime.escalationReason,
      }),
      termination_state: runtime.terminationState,
    }, { status: 202 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/messages/streams/:streamId/stop`, async ({ request, params }) => {
    const sessionId = String(params.id ?? '');
    const streamId = String(params.streamId ?? '');
    const mode = readMockChatStopEscalationMode(request);
    const runtime = mode ? ensureMockChatStopRuntime(sessionId, mode) : mockChatStopRuntimeBySession.get(sessionId);
    const body = await request.json().catch(() => ({}));
    if (hasLegacyStopModeField(body)) return legacyStopModeFieldResponse();
    const terminateRequested = isTerminateStopMode(body);
    if (!runtime || runtime.streamId !== streamId) {
      return HttpResponse.json(buildMockChatStopResponse({ streamId }, {
        state: 'not_found_or_finished',
        stopMode: terminateRequested ? 'terminate' : 'cancel',
        canEscalate: false,
      }), { status: 202 });
    }

    const responseStatus = applyMockChatStopRequest(runtime, terminateRequested);
    return HttpResponse.json({
      ...buildMockChatStopResponse({ streamId }, {
        state: responseStatus,
        stopMode: runtime.stopMode,
        canEscalate: runtime.canEscalate,
        escalationReason: runtime.escalationReason,
      }),
      termination_state: runtime.terminationState,
    }, { status: 202 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/messages`, ({ params }) => {
    const sessionMessages = messages.filter((m) => m.session_id === params.id);
    return HttpResponse.json({
      items: sessionMessages,
      total: sessionMessages.length,
      page: 1,
      page_size: 50,
      has_more: false,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/messages`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ChatMessageLike> & { content?: string };
    const newMessage: ChatMessageLike = {
      id: `msg_${Date.now()}`,
      session_id: String(params.id ?? body.session_id ?? 'session_001'),
      role: 'user' as const,
      content: body.content ?? '',
      created_at: new Date().toISOString(),
      parent_id: body.parent_id ?? null,
    };
    messages.push(newMessage);
    return HttpResponse.json(newMessage, { status: 201 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments`, ({ params }) => {
    const sessionId = String(params.id ?? '');
    const items = getSessionAttachments(sessionId);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/init`, async ({ params, request }) => {
    const sessionId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as {
      file_name?: string;
      file_type?: string;
      file_size?: number;
    };
    const attachment: Attachment = {
      id: `att_${Date.now()}`,
      session_id: sessionId,
      file_name: body.file_name ?? 'attachment.bin',
      file_type: body.file_type ?? 'application/octet-stream',
      file_size: typeof body.file_size === 'number' ? body.file_size : 0,
      upload_status: 'ready',
      created_at: new Date().toISOString(),
    };
    const items = getSessionAttachments(sessionId);
    items.unshift(attachment);
    return HttpResponse.json({ attachment }, { status: 201 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId/complete`, ({ params }) => {
    const sessionId = String(params.id ?? '');
    const attachmentId = String(params.attachmentId ?? '');
    const items = getSessionAttachments(sessionId);
    const attachment = items.find((item) => item.id === attachmentId);
    if (!attachment) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    attachment.upload_status = 'ready';
    return HttpResponse.json(attachment);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId`, ({ params }) => {
    const sessionId = String(params.id ?? '');
    const attachmentId = String(params.attachmentId ?? '');
    const items = getSessionAttachments(sessionId);
    const idx = items.findIndex((item) => item.id === attachmentId);
    if (idx >= 0) items.splice(idx, 1);
    return HttpResponse.json({ success: true });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId/retry`, ({ params }) => {
    const sessionId = String(params.id ?? '');
    const attachmentId = String(params.attachmentId ?? '');
    const items = getSessionAttachments(sessionId);
    const attachment = items.find((item) => item.id === attachmentId);
    if (!attachment) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    attachment.upload_status = 'ready';
    attachment.error_message = undefined;
    return HttpResponse.json(attachment);
  }),
];
