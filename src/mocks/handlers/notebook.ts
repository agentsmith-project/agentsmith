import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const notebookHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/notebook/tasks', () => HttpResponse.json({ items: p0.tasks })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/notebook/tasks/:id/artifacts', () => HttpResponse.json({ items: p0.artifacts })),
];
