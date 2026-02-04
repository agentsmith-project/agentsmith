import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const sourceHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/sources', () => HttpResponse.json({ items: p0.sources })),
];
