import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('returns not_configured with the backend runtime reason code for governance viewers', async () => {
    const res = await fetch(url('/workspaces/ws_first_config/projects/proj_001/agent-task-model-setting'));

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'not_configured',
        display_summary: 'Agent task model is not configured.',
        reason_code: 'agent_task_model_setting_missing',
      },
      actions: {
        update: {
          operation: 'update',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });
    expect(body).not.toHaveProperty('setting');
  });

  it('returns display-safe readiness without setting details for task-only viewers', async () => {
    const res = await fetch(url('/workspaces/ws_first_config/projects/proj_001/agent-task-model-setting'), {
      headers: {
        'x-mock-agent-task-model-permission': 'task-only',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'not_configured',
        display_summary: 'Agent task model is not configured.',
      },
    });
    expect((body.readiness as Record<string, unknown>)).not.toHaveProperty('reason_code');
    expect(body).not.toHaveProperty('setting');
    expect(body).not.toHaveProperty('actions');
  });

  it('returns blocked readiness with concrete agent_task_model reason codes for unusable settings and rows', async () => {
    const res = await fetch(url('/workspaces/ws_1/projects/proj_agent_task_model_blocked/agent-task-model-setting'));

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'blocked',
        display_summary: 'Agent tasks are blocked by model setup.',
        reason_code: 'agent_task_model_endpoint_disabled',
      },
      setting: {
        workspace_id: 'ws_1',
        project_id: 'proj_agent_task_model_blocked',
        endpoint_id: 'ep_agent_task_model_disabled',
        endpoint_display_name: 'Disabled Agent task model',
        default_model: 'gpt-4o',
      },
    });

    const endpoints = await fetch(url('/workspaces/ws_1/projects/proj_agent_task_model_blocked/endpoints'))
      .then((response) => response.json() as Promise<{ items: Array<Record<string, unknown>> }>);
    expect(endpoints.items.find((item) => item.id === 'ep_agent_task_model_disabled')).toMatchObject({
      agent_task_model_selected: true,
      actions: {
        use_for_agent_tasks: {
          visible: true,
          allowed: false,
          reason_code: 'agent_task_model_endpoint_disabled',
        },
      },
    });
    expect(endpoints.items.find((item) => item.id === 'ep_agent_task_model_no_default')).toMatchObject({
      agent_task_model_selected: false,
      actions: {
        use_for_agent_tasks: {
          visible: true,
          allowed: false,
          reason_code: 'agent_task_model_default_missing',
        },
      },
    });
  });

  it('accepts null expected_setting_revision for first configuration and returns a complete response', async () => {
    const updated = await fetch(url('/workspaces/ws_first_config/projects/proj_001/agent-task-model-setting'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint_id: 'ep_1',
        expected_setting_revision: null,
      }),
    });

    expect(updated.status).toBe(200);
    const body = await updated.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_first_config',
        project_id: 'proj_001',
        endpoint_id: 'ep_1',
        endpoint_display_name: 'OpenAI Main',
        default_model: 'gpt-4o',
        updated_by_user_id: 'user_1',
      },
      actions: {
        update: {
          operation: 'update',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });
    expect((body.setting as Record<string, unknown>).setting_revision).toEqual(expect.stringMatching(/^set_mock_/));

    const endpoints = await fetch(url('/workspaces/ws_first_config/projects/proj_001/endpoints'))
      .then((response) => response.json() as Promise<{ items: Array<Record<string, unknown>> }>);
    expect(endpoints.items.find((item) => item.id === 'ep_1')).toMatchObject({
      agent_task_model_selected: true,
    });
  });

  it('rejects unsupported PATCH fields before applying the setting', async () => {
    const updated = await fetch(url('/workspaces/ws_first_config/projects/proj_001/agent-task-model-setting'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint_id: 'ep_1',
        expected_setting_revision: null,
        default_model: 'gpt-4o',
      }),
    });

    expect(updated.status).toBe(400);
    await expect(updated.json()).resolves.toEqual({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: ['default_model'],
    });

    const current = await fetch(url('/workspaces/ws_first_config/projects/proj_001/agent-task-model-setting'))
      .then((response) => response.json() as Promise<Record<string, unknown>>);
    expect(current).toMatchObject({
      readiness: {
        state: 'not_configured',
        reason_code: 'agent_task_model_setting_missing',
      },
    });
    expect(current).not.toHaveProperty('setting');
  });

  it('keeps doc fixture mode initial setting pointed at doc Endpoint ids', async () => {
    server.close();
    vi.resetModules();
    vi.doMock('@/lib/public-runtime-config', () => ({
      getPublicRuntimeConfig: () => ({ docFixtures: true }),
    }));
    const {
      endpointHandlers: docEndpointHandlers,
      resetMockAgentTaskModelSettings: resetDocAgentTaskModelSettings,
    } = await import('@/mocks/handlers/endpoints');
    const docServer = setupServer(...docEndpointHandlers);

    try {
      docServer.listen({ onUnhandledRequest: 'error' });
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
          endpoint_id: 'endpoint_001',
          endpoint_display_name: 'placeholder-model 主生产',
          default_model: 'placeholder-model',
        },
      });

      const endpoints = await fetch(url('/workspaces/ws_default/projects/proj_001/endpoints'))
        .then((response) => response.json() as Promise<{ items: Array<Record<string, unknown>> }>);
      expect(endpoints.items.find((item) => item.id === 'endpoint_001')).toMatchObject({
        agent_task_model_selected: true,
      });
    } finally {
      resetDocAgentTaskModelSettings();
      docServer.close();
      vi.doUnmock('@/lib/public-runtime-config');
      vi.resetModules();
      server.listen({ onUnhandledRequest: 'error' });
    }
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
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_1',
        project_id: 'proj_001',
        endpoint_id: 'ep_2',
        endpoint_display_name: 'Claude Sonnet',
      },
      actions: {
        update: {
          operation: 'update',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
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
