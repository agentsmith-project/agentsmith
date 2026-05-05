import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docAgentRunnerFixtures } from '../doc-fixtures/workspace-projects';
import type { AgentRunner } from '@/lib/api/types';

const agentRunners: AgentRunner[] = DOC_FIXTURES_ENABLED
  ? [...docAgentRunnerFixtures]
  : [...((p0.agent_runners ?? []) as AgentRunner[])];
const API_V1_PATTERN = '*/api/v1';
type AgentRunnerStatus = AgentRunner['status'];
type AgentRunnerKeyRecord = {
  id: string;
  agent_runner_id: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  created_at: string;
  key?: string;
};
const agentRunnerKeys: AgentRunnerKeyRecord[] = [];

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readRunnerStatus(value: unknown): AgentRunnerStatus | undefined {
  return value === 'draft'
    || value === 'connected'
    || value === 'ready'
    || value === 'degraded'
    || value === 'offline'
    ? value
    : undefined;
}

export const agentRunnerHandlers = [
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners`, () =>
    HttpResponse.json({ items: agentRunners }),
  ),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, ({ params }) => {
    const agentRunner = agentRunners.find((runner) => runner.id === params.id);
    if (!agentRunner) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(agentRunner);
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const created: AgentRunner = {
      id: `agent_${Date.now()}`,
      project_id: String(body.project_id ?? 'proj_001'),
      name: (body.name as string) ?? 'New Agent Runner',
      description: (body.description as string) ?? '',
      is_default: body.is_default === true,
      ...(typeof body.default_endpoint_id === 'string' && body.default_endpoint_id.trim()
        ? { default_endpoint_id: body.default_endpoint_id.trim() }
        : {}),
      status: readRunnerStatus(body.status) ?? 'draft',
      capabilities: readObject(body.capabilities) ?? {},
      diagnostics: readObject(body.diagnostics) ?? { presence: 'managed' },
      created_at: now,
      updated_at: now,
    };
    agentRunners.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = agentRunners.findIndex((runner) => runner.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const current = agentRunners[idx];
    if (!current) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    agentRunners[idx] = {
      ...current,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.is_default === 'boolean' ? { is_default: body.is_default } : {}),
      ...(typeof body.default_endpoint_id === 'string' ? { default_endpoint_id: body.default_endpoint_id } : {}),
      ...(readRunnerStatus(body.status) ? { status: readRunnerStatus(body.status) } : {}),
      ...(readObject(body.capabilities) ? { capabilities: readObject(body.capabilities) } : {}),
      ...(readObject(body.diagnostics) ? { diagnostics: readObject(body.diagnostics) } : {}),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(agentRunners[idx]);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, ({ params }) => {
    const idx = agentRunners.findIndex((runner) => runner.id === params.id);
    if (idx >= 0) agentRunners.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/diagnostics`, () =>
    HttpResponse.json(p0.agent_runner_diagnostics),
  ),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/connection-info`, ({ params }) =>
    HttpResponse.json({
      ws_url: `ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=${encodeURIComponent(String(params.id ?? ''))}`,
      agent_runner_id: String(params.id ?? ''),
      protocol_version: '1.0',
      heartbeat_interval_sec: 15,
    }),
  ),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys`, ({ params }) => {
    const runnerId = String(params.id ?? '');
    return HttpResponse.json({
      items: agentRunnerKeys.filter((item) => item.agent_runner_id === runnerId && item.status === 'active'),
      total: agentRunnerKeys.filter((item) => item.agent_runner_id === runnerId && item.status === 'active').length,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys`, ({ params }) => {
    const runnerId = String(params.id ?? '');
    const fullKey = `mbos_runner_${Math.random().toString(36).slice(2, 18)}`;
    const keyPrefix = `${fullKey.slice(0, 10)}***`;
    const created: AgentRunnerKeyRecord = {
      id: `ask_${Date.now()}`,
      agent_runner_id: runnerId,
      key_prefix: keyPrefix,
      status: 'active',
      created_at: new Date().toISOString(),
      key: fullKey,
    };
    agentRunnerKeys.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys/:keyId`, ({ params }) => {
    const keyId = String(params.keyId ?? '');
    const item = agentRunnerKeys.find((key) => key.id === keyId);
    if (!item) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    item.status = 'revoked';
    return HttpResponse.json(null, { status: 204 });
  }),
];
