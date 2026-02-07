import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

const agents = [...(p0.agents ?? [])];
type AgentKeyRecord = {
  id: string;
  agent_id: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  created_at: string;
  key?: string;
};
const agentKeys: AgentKeyRecord[] = [];

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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const created = {
      id: `agent_${Date.now()}`,
      project_id: 'proj_001',
      workspace_id: 'ws_default',
      name: (body.name as string) ?? 'New Agent',
      description: (body.description as string) ?? '',
      mode: (body.mode as string) ?? 'external',
      interaction_mode: (body.interaction_mode as string) ?? 'both',
      presence: 'offline',
      status: 'enabled',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agents.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/agents/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
  http.get('/api/v1/workspaces/:ws/projects/:prj/agents/:id/keys', ({ params }) => {
    const agentId = String(params.id ?? '');
    return HttpResponse.json({
      items: agentKeys.filter((item) => item.agent_id === agentId && item.status === 'active'),
      total: agentKeys.filter((item) => item.agent_id === agentId && item.status === 'active').length,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/agents/:id/keys', ({ params }) => {
    const agentId = String(params.id ?? '');
    const fullKey = `mbos_agent_${Math.random().toString(36).slice(2, 18)}`;
    const keyPrefix = `${fullKey.slice(0, 10)}***`;
    const created: AgentKeyRecord = {
      id: `ask_${Date.now()}`,
      agent_id: agentId,
      key_prefix: keyPrefix,
      status: 'active',
      created_at: new Date().toISOString(),
      key: fullKey,
    };
    agentKeys.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/agents/:id/keys/:keyId', ({ params }) => {
    const keyId = String(params.keyId ?? '');
    const item = agentKeys.find((key) => key.id === keyId);
    if (!item) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    item.status = 'revoked';
    return HttpResponse.json(null, { status: 204 });
  }),
];
