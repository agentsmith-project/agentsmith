// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import p0 from '../src/mocks/fixtures/p0.json';
import { taskFixtures } from '../src/mocks/fixtures/agent-tasks';
import { agentRunnerHandlers } from '../src/mocks/handlers/agent-runners';
import { taskHandlers } from '../src/mocks/handlers/tasks';

type MockAgentRunnerTruth = {
  id: string;
  name: string;
  status?: string;
  is_default?: boolean;
  capabilities?: Record<string, unknown>;
};

const server = setupServer(...agentRunnerHandlers, ...taskHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fixtureAgentRunnerTruth(): MockAgentRunnerTruth[] {
  return (p0.agent_runners ?? []) as MockAgentRunnerTruth[];
}

describe('Agent Task mock runtime truth', () => {
  it('keeps every happy Agent Task fixture bound to managed runner state', () => {
    const runnersById = new Map(fixtureAgentRunnerTruth().map((runner) => [runner.id, runner]));

    const contractViolations = taskFixtures.flatMap((task) => {
      const violations: string[] = [];
      if (!task.run_state) {
        violations.push(`${task.id}: happy fixture is missing explicit run_state`);
      }
      if (task.agent_presence !== 'managed') {
        violations.push(`${task.id}: happy fixture must use managed Agent Task presence`);
      }
      const runnerId = task.active_run?.runner_id;
      if (runnerId) {
        const runner = runnersById.get(runnerId);
        if (!runner) {
          violations.push(`${task.id}: active_run.runner_id=${runnerId} does not exist in p0 Agent Runner truth`);
        } else if (runner.status !== 'ready') {
          violations.push(`${task.id}: active_run.runner_id=${runnerId} is not ready`);
        } else if (runner.capabilities?.task_execution !== true) {
          violations.push(`${task.id}: active_run.runner_id=${runnerId} is not task-execution capable`);
        }
      }
      return violations;
    });

    expect(contractViolations).toEqual([]);
  });

  it('serves an Agent Task detail whose runner reference resolves through the same mock API truth', async () => {
    const taskResponse = await fetch('http://localhost/api/v1/workspaces/ws_default/projects/proj_001/tasks/task_002');
    expect(taskResponse.status).toBe(200);
    const task = await taskResponse.json() as {
      agent_presence?: string;
      run_state?: string;
      active_run?: { runner_id?: string };
    };

    expect(task.active_run?.runner_id).toBeTruthy();
    const runnerResponse = await fetch(`http://localhost/api/v1/workspaces/ws_default/projects/proj_001/agent-runners/${task.active_run?.runner_id}`);
    expect(runnerResponse.status).toBe(200);
    const runner = await runnerResponse.json() as MockAgentRunnerTruth;

    expect(runner).toMatchObject({
      id: task.active_run?.runner_id,
      status: 'ready',
    });
    expect(runner.capabilities?.task_execution).toBe(true);
    expect(task.agent_presence).toBe('managed');
    expect(task.run_state).toMatch(/^(idle|running)$/);
  });

  it('provides deterministic SSE ticket and quiet task event stream handlers for Agent Task happy paths', async () => {
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
