import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const chatHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions', () => HttpResponse.json({ items: p0.chat_sessions })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/chat/sessions/:id/messages', () => HttpResponse.json({ items: p0.chat_messages })),
];
