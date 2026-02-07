import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

const endpoints = [...(p0.endpoints ?? [])];

export const endpointHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints', () =>
    HttpResponse.json({ items: endpoints }),
  ),
  http.get('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id', ({ params }) => {
    const ep = endpoints.find((e) => e.id === params.id);
    if (!ep) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(ep);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/endpoints', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const created = {
      id: `ep_${Date.now()}`,
      project_id: 'proj_001',
      name: (body.name as string) ?? 'New Endpoint',
      description: (body.description as string) ?? '',
      type: (body.type as string) ?? 'openai',
      openai_model: (body.openai_model as string) ?? '',
      base_url: (body.base_url as string) ?? 'https://api.openai.com/v1',
      credential_ref: (body.credential_ref as string) ?? '',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    endpoints.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.put('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = endpoints.findIndex((e) => e.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    endpoints[idx] = { ...endpoints[idx], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(endpoints[idx]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/endpoints/:id', ({ params }) => {
    const idx = endpoints.findIndex((e) => e.id === params.id);
    if (idx >= 0) endpoints.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
];
