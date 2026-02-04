import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const workbenchHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/workbench/recipes', () => HttpResponse.json({ items: p0.recipes })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/workbench/recipes/:id/artifacts', () => HttpResponse.json({ items: p0.artifacts })),
];
