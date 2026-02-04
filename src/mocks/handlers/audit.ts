import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const auditHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/audit', () => HttpResponse.json({ items: p0.audit })),
];
