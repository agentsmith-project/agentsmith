import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { chatSessionFixtures, chatMessageFixtures } from '../fixtures/chat';

const sessions = p0.chat_sessions.length ? p0.chat_sessions : chatSessionFixtures;
const messages = p0.chat_messages.length ? p0.chat_messages : chatMessageFixtures;

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
    const session = sessions.find((s: any) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(session);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions', async ({ request }) => {
    const body: any = await request.json().catch(() => ({}));
    const newSession = {
      id: `session_${Date.now()}`,
      project_id: 'proj_001',
      user_id: 'user_001',
      title: body.title ?? 'New Chat',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(newSession, { status: 201 });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/messages', ({ params }) => {
    const sessionMessages = messages.filter((m: any) => m.session_id === params.id);
    return HttpResponse.json({
      items: sessionMessages,
      total: sessionMessages.length,
      page: 1,
      page_size: 50,
      has_more: false,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/messages', async ({ request }) => {
    const body: any = await request.json().catch(() => ({}));
    const newMessage = {
      id: `msg_${Date.now()}`,
      session_id: 'session_001',
      role: 'user',
      content: body.content ?? '',
      created_at: new Date().toISOString(),
    };
    return HttpResponse.json(newMessage, { status: 201 });
  }),
];
