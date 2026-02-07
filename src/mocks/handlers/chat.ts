import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { chatSessionFixtures, chatMessageFixtures } from '../fixtures/chat';
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
};

type ChatMessageLike = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  parent_id?: string | null;
};

const sessions: ChatSessionLike[] = p0.chat_sessions.length
  ? (p0.chat_sessions as unknown as ChatSessionLike[])
  : (chatSessionFixtures as unknown as ChatSessionLike[]);
const messages: ChatMessageLike[] = p0.chat_messages.length
  ? (p0.chat_messages as unknown as ChatMessageLike[])
  : (chatMessageFixtures as unknown as ChatMessageLike[]);

const attachmentsBySession: Record<string, Attachment[]> = {};

function getSessionAttachments(sessionId: string): Attachment[] {
  if (!attachmentsBySession[sessionId]) {
    attachmentsBySession[sessionId] = [];
  }
  return attachmentsBySession[sessionId];
}

export const chatHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions', () =>
    HttpResponse.json({
      items: sessions,
      total: sessions.length,
      page: 1,
      page_size: 25,
      has_more: false,
    }),
  ),
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id', ({ params }) => {
    const session = sessions.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(session);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ChatSessionLike>;
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
  http.patch('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ChatSessionLike>;
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
  http.delete('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id', ({ params }) => {
    const idx = sessions.findIndex((s) => s.id === params.id);
    if (idx >= 0) {
      sessions.splice(idx, 1);
    }
    return HttpResponse.json({ success: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/messages', ({ params }) => {
    const sessionMessages = messages.filter((m) => m.session_id === params.id);
    return HttpResponse.json({
      items: sessionMessages,
      total: sessionMessages.length,
      page: 1,
      page_size: 50,
      has_more: false,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/messages', async ({ params, request }) => {
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
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments', ({ params }) => {
    const sessionId = String(params.id ?? '');
    const items = getSessionAttachments(sessionId);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/init', async ({ params, request }) => {
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
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId/complete', ({ params }) => {
    const sessionId = String(params.id ?? '');
    const attachmentId = String(params.attachmentId ?? '');
    const items = getSessionAttachments(sessionId);
    const attachment = items.find((item) => item.id === attachmentId);
    if (!attachment) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    attachment.upload_status = 'ready';
    return HttpResponse.json(attachment);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId', ({ params }) => {
    const sessionId = String(params.id ?? '');
    const attachmentId = String(params.attachmentId ?? '');
    const items = getSessionAttachments(sessionId);
    const idx = items.findIndex((item) => item.id === attachmentId);
    if (idx >= 0) items.splice(idx, 1);
    return HttpResponse.json({ success: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/attachments/:attachmentId/retry', ({ params }) => {
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
