import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { endpointHandlers, resetMockAgentTaskModelSettings } from '@/mocks/handlers/endpoints';

const server = setupServer(...endpointHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetMockAgentTaskModelSettings();
});
afterAll(() => server.close());

function url(path: string) {
  return `http://localhost/api/v1${path}`;
}

describe('agent task model setting mock handlers', () => {
  it('keeps the visual default workspace project ready for happy Agent task creation', async () => {
    const res = await fetch(url('/workspaces/ws_default/projects/proj_001/agent-task-model-setting'));

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        endpoint_id: 'ep_1',
        endpoint_display_name: 'OpenAI Main',
        default_model: 'gpt-4o',
      },
    });

    const endpoints = await fetch(url('/workspaces/ws_default/projects/proj_001/endpoints'))
      .then((response) => response.json() as Promise<{ items: Array<Record<string, unknown>> }>);
    expect(endpoints.items.find((item) => item.id === 'ep_1')).toMatchObject({
      agent_task_model_selected: true,
    });
  });

  it('returns display-safe readiness without setting details for task-only viewers', async () => {
    const res = await fetch(url('/workspaces/ws_1/projects/proj_001/agent-task-model-setting'), {
      headers: {
        'x-mock-agent-task-model-permission': 'task-only',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
    });
    expect(body).not.toHaveProperty('setting');
    expect(body).not.toHaveProperty('actions');
  });

  it('shapes endpoint row affordances and rejects stale setting revisions', async () => {
    const listBefore = await fetch(url('/workspaces/ws_1/projects/proj_001/endpoints'));
    expect(listBefore.status).toBe(200);
    const beforeBody = await listBefore.json() as { items: Array<Record<string, unknown>> };
    expect(beforeBody.items[0]).toMatchObject({
      id: 'ep_1',
      agent_task_model_selected: true,
      actions: {
        use_for_agent_tasks: {
          operation: 'use_for_agent_tasks',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });

    const stale = await fetch(url('/workspaces/ws_1/projects/proj_001/agent-task-model-setting'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint_id: 'ep_2',
        expected_setting_revision: 'set_stale',
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error_code: 'agent_task_model_setting_conflict',
      field: 'expected_setting_revision',
    });

    const current = await fetch(url('/workspaces/ws_1/projects/proj_001/agent-task-model-setting'))
      .then((response) => response.json() as Promise<{ setting: { setting_revision: string } }>);
    const updated = await fetch(url('/workspaces/ws_1/projects/proj_001/agent-task-model-setting'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint_id: 'ep_2',
        expected_setting_revision: current.setting.setting_revision,
      }),
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      setting: {
        endpoint_id: 'ep_2',
        endpoint_display_name: 'Claude Sonnet',
      },
    });

    const listAfter = await fetch(url('/workspaces/ws_1/projects/proj_001/endpoints'))
      .then((response) => response.json() as Promise<{ items: Array<Record<string, unknown>> }>);
    expect(listAfter.items.find((item) => item.id === 'ep_1')).toMatchObject({
      agent_task_model_selected: false,
    });
    expect(listAfter.items.find((item) => item.id === 'ep_2')).toMatchObject({
      agent_task_model_selected: true,
    });
  });
});
