import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const studioHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/studio/recipes', () => HttpResponse.json({ items: p0.recipes })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/studio/recipes/:id/artifacts', () => HttpResponse.json({ items: p0.artifacts })),
];
