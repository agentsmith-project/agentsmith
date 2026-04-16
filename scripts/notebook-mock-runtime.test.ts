// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import p0 from '../src/mocks/fixtures/p0.json';
import { taskFixtures } from '../src/mocks/fixtures/notebook';
import { agentHandlers } from '../src/mocks/handlers/agents';
import { taskHandlers } from '../src/mocks/handlers/tasks';

type MockAgentTruth = {
  id: string;
  name: string;
  mode?: 'external' | 'internal';
  presence?: 'online' | 'offline' | 'managed';
  status?: string;
  interaction_kind?: string;
};

const server = setupServer(...agentHandlers, ...taskHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fixtureAgentTruth(): MockAgentTruth[] {
  return (p0.agents ?? []) as MockAgentTruth[];
}

describe('notebook mock runtime truth', () => {
  it('keeps every happy notebook task fixture bound to an enabled notebook-capable agent with runner state', () => {
    const agentsById = new Map(fixtureAgentTruth().map((agent) => [agent.id, agent]));

    const contractViolations = taskFixtures.flatMap((task) => {
      const agent = agentsById.get(task.agent_id);
      const violations: string[] = [];
      if (!agent) {
        violations.push(`${task.id}: agent_id=${task.agent_id} does not exist in p0 agent truth`);
        return violations;
      }
      if (agent.status !== 'enabled') {
        violations.push(`${task.id}: agent_id=${task.agent_id} is not enabled`);
      }
      if (agent.interaction_kind !== 'notebook') {
        violations.push(`${task.id}: agent_id=${task.agent_id} is ${agent.interaction_kind ?? 'unknown'}, not notebook`);
      }
      if (task.agent_name !== agent.name) {
        violations.push(`${task.id}: agent_name=${task.agent_name} drifts from agent truth name=${agent.name}`);
      }
      if (!task.agent_presence || task.agent_presence === 'unknown') {
        violations.push(`${task.id}: happy fixture is missing explicit agent_presence`);
      }
      if (task.agent_presence && agent.presence && task.agent_presence !== agent.presence) {
        violations.push(`${task.id}: agent_presence=${task.agent_presence} drifts from agent truth presence=${agent.presence}`);
      }
      if (!task.run_state) {
        violations.push(`${task.id}: happy fixture is missing explicit run_state`);
      }
      return violations;
    });

    expect(contractViolations).toEqual([]);
  });

  it('serves a notebook task detail whose agent reference resolves through the same mock API truth', async () => {
    const taskResponse = await fetch('http://localhost/api/v1/workspaces/ws_default/projects/proj_001/tasks/task_001');
    expect(taskResponse.status).toBe(200);
    const task = await taskResponse.json() as {
      agent_id: string;
      agent_name: string;
      agent_presence?: string;
      run_state?: string;
    };

    const agentResponse = await fetch(`http://localhost/api/v1/workspaces/ws_default/projects/proj_001/agents/${task.agent_id}`);
    expect(agentResponse.status).toBe(200);
    const agent = await agentResponse.json() as MockAgentTruth;

    expect(agent).toMatchObject({
      id: task.agent_id,
      name: task.agent_name,
      interaction_kind: 'notebook',
      status: 'enabled',
    });
    expect(task.agent_presence).toBe(agent.presence);
    expect(task.run_state).toMatch(/^(idle|running)$/);
  });

  it('provides deterministic SSE ticket and quiet task event stream handlers for notebook happy paths', async () => {
    const ticketResponse = await fetch('http://localhost/api/v1/sse-ticket', {
      method: 'POST',
      headers: { authorization: 'Bearer atk_mock' },
    });

    expect(ticketResponse.status).toBe(200);
    const ticketPayload = await ticketResponse.json() as {
      ticket: string;
      expires_at: string;
      max_connections: number;
      sso_url: string;
    };
    expect(ticketPayload.ticket).toMatch(/^mock_sse_/);
    expect(ticketPayload.ticket).not.toBe('atk_mock');
    expect(ticketPayload.max_connections).toBe(1);
    expect(Number.isNaN(Date.parse(ticketPayload.expires_at))).toBe(false);
    expect(ticketPayload.sso_url).toContain(`/api/v1/events?ticket=${encodeURIComponent(ticketPayload.ticket)}`);

    const controller = new AbortController();
    const eventsResponse = await fetch(
      `http://localhost/api/v1/workspaces/ws_default/projects/proj_001/tasks/task_001/events?ticket=${encodeURIComponent(ticketPayload.ticket)}`,
      { signal: controller.signal },
    );
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(eventsResponse.headers.get('cache-control')).toContain('no-cache');
    controller.abort();
    void eventsResponse.body?.cancel().catch(() => undefined);
  });

  it('fails closed when a mock task events stream is opened without an issued SSE ticket', async () => {
    const eventsResponse = await fetch(
      'http://localhost/api/v1/workspaces/ws_default/projects/proj_001/tasks/task_001/events',
    );

    expect(eventsResponse.status).toBe(401);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      error_code: 'MOCK_SSE_TICKET_REQUIRED',
    });
  });
});
