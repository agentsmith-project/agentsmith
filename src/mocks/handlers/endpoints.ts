import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const endpointHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints', () => HttpResponse.json({ items: p0.endpoints })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id/acl', () => HttpResponse.json({ items: p0.endpoint_acl })),
];
