import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

const agents = [...(p0.agents ?? [])];

export const agentHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents', () =>
    HttpResponse.json({ items: agents }),
  ),
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents/:id', ({ params }) => {
    const agent = agents.find((a) => a.id === params.id);
    if (!agent) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(agent);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/agents', async ({ request }) => {
    const body: Record<string, unknown> = await request.json().catch(() => ({}));
    const created = {
      id: `agent_${Date.now()}`,
      project_id: 'proj_001',
      name: (body.name as string) ?? 'New Agent',
      description: (body.description as string) ?? '',
      mode: (body.mode as string) ?? 'external',
      interaction_mode: (body.interaction_mode as string) ?? 'both',
      status: 'active',
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agents.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/agents/:id', async ({ params, request }) => {
    const body: Record<string, unknown> = await request.json().catch(() => ({}));
    const idx = agents.findIndex((a) => a.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    agents[idx] = { ...agents[idx], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(agents[idx]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/agents/:id', ({ params }) => {
    const idx = agents.findIndex((a) => a.id === params.id);
    if (idx >= 0) agents.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents/:id/diagnostics', () =>
    HttpResponse.json(p0.agent_diagnostics),
  ),
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents/:id/keys', () =>
    HttpResponse.json({ items: [] }),
  ),
  http.post('/api/v1/workspaces/:ws/projects/:prj/agents/:id/keys', () =>
    HttpResponse.json({
      id: `ask_${Date.now()}`,
      key: `mbos_agent_${Math.random().toString(36).slice(2, 18)}`,
      created_at: new Date().toISOString(),
    }, { status: 201 }),
  ),
];
