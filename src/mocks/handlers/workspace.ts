import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const workspaceHandlers = [
  http.get('/api/v1/workspaces', () => HttpResponse.json({ items: p0.workspaces })),
  http.get('/api/v1/workspaces/:ws/members', () => HttpResponse.json({ items: p0.workspace_members })),
];
