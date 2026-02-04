import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const agentHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents', () => HttpResponse.json({ items: p0.agents })),
];
