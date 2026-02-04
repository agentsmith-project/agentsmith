import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', () => HttpResponse.json({ items: p0.usage })),
];
