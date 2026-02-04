import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', () => HttpResponse.json({ items: p0.projects })),
  http.get('/api/v1/workspaces/:ws/projects/:prj', () => HttpResponse.json(p0.project_detail)),
  http.get('/api/v1/workspaces/:ws/projects/:prj/join-requests', () => HttpResponse.json({ items: p0.join_requests })),
];
