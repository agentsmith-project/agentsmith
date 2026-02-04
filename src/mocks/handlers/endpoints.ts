import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const endpointHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints', () => HttpResponse.json({ items: p0.endpoints })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id/acl', () => HttpResponse.json({ items: p0.endpoint_acl })),
  http.put('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return HttpResponse.json({ ...body });
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id', () => HttpResponse.json({ ok: true })),
];
