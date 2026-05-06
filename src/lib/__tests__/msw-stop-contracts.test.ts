import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { chatHandlers } from '@/mocks/handlers/chat';
import { taskHandlers } from '@/mocks/handlers/tasks';
import { createMockAuthToken } from '@/mocks/utils/mock-auth-token';

const server = setupServer(...chatHandlers, ...taskHandlers);

type JsonObject = Record<string, unknown>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function postJson(path: string, body: JsonObject) {
  return fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createRunningTask(title: string) {
  const response = await postJson('/api/v1/workspaces/ws_001/projects/proj_001/tasks', {
    title,
    workspace_mode: 'create_new',
    run_state: 'running',
  });
  expect(response.status).toBe(200);
  const payload = await response.json() as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

async function createIdleTask(title: string) {
  const response = await postJson('/api/v1/workspaces/ws_001/projects/proj_001/tasks', {
    title,
    workspace_mode: 'create_new',
  });
  expect(response.status).toBe(200);
  const payload = await response.json() as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

function authHeaders(userId: string, userEmail: string) {
  return {
    authorization: `Bearer ${createMockAuthToken({ userId, userEmail })}`,
  };
}

describe('msw stop/cancel contracts', () => {
  it('rejects external_agent_id on chat session create and update', async () => {
    const create = await postJson(
      '/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions',
      {
        endpoint_id: 'ep_openai_001',
        model: 'gpt-4o-mini',
        external_agent_id: 'agent_legacy',
      },
    );

    expect(create.status).toBe(400);
    await expect(create.json()).resolves.toMatchObject({
      error_code: 'unsupported_field',
      message: 'external_agent_id',
    });

    const update = await fetch(
      'http://localhost/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions/chat_001',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ external_agent_id: 'agent_legacy' }),
      },
    );

    expect(update.status).toBe(400);
    await expect(update.json()).resolves.toMatchObject({
      error_code: 'unsupported_field',
      message: 'external_agent_id',
    });
  });

  it('returns required chat not_found_or_finished fields with production 202', async () => {
    const response = await postJson(
      '/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions/session_unit_not_running/stop',
      { mode: 'cancel' },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      session_id: 'session_unit_not_running',
      state: 'not_found_or_finished',
      status: 'not_found_or_finished',
      stop_mode: 'cancel',
      can_escalate: false,
    });
  });

  it('rejects runner_selection on task create', async () => {
    const response = await postJson(
      '/api/v1/workspaces/ws_001/projects/proj_001/tasks',
      {
        title: 'MSW create rejects run scoped selection',
        workspace_mode: 'create_new',
        runner_selection: {
          mode: 'explicit',
          agent_runner_id: 'agent_002',
        },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: ['runner_selection'],
    });
  });

  it('rejects explicit managed bound_runner_id with a typed validation code', async () => {
    const response = await postJson(
      '/api/v1/workspaces/ws_001/projects/proj_001/tasks',
      {
        title: 'MSW create rejects managed explicit task binding',
        workspace_mode: 'create_new',
        bound_runner_id: 'agent_001',
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'invalid_binding_target',
      message: 'invalid_binding_target',
      field: 'bound_runner_id',
    });
  });

  it('keeps task runner binding immutable on PATCH like the backend contract', async () => {
    const taskId = await createIdleTask(`MSW patch immutable binding ${Date.now()}`);
    const initial = await fetch(
      `http://localhost/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}`,
    ).then((response) => response.json() as Promise<Record<string, unknown>>);

    const rejected = await fetch(
      `http://localhost/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Should not patch binding',
          bound_runner_id: 'ag_2',
        }),
      },
    );

    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: ['bound_runner_id'],
    });

    const ignored = await fetch(
      `http://localhost/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Allowed patch title',
          bound_runner_kind: 'developer',
          runner_binding_source: 'explicit',
          bound_at: '2026-05-06T00:00:00.000Z',
          bound_by_user_id: 'user_attacker',
        }),
      },
    );
    const ignoredBody = await ignored.json() as Record<string, unknown>;

    expect(ignored.status).toBe(200);
    expect(ignoredBody).toMatchObject({
      title: 'Allowed patch title',
      bound_runner_id: initial.bound_runner_id,
      bound_runner_kind: initial.bound_runner_kind,
      runner_binding_source: initial.runner_binding_source,
      bound_at: initial.bound_at,
      bound_by_user_id: initial.bound_by_user_id,
    });
  });

  it.each(['role', 'content', 'agent_id', 'agent_name', 'runner_id', 'runner_selection', 'bound_runner_id', 'is_default', 'default_endpoint_id'])(
    'rejects unsupported runner/message field %s on task run payload',
    async (field) => {
      const taskId = await createIdleTask(`MSW run rejects ${field} ${Date.now()}`);
      const response = await postJson(
        `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/runs`,
        {
          intent: 'Run with unsupported selector field',
          [field]: 'legacy-selector',
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [field],
      });
    },
  );

  it('rejects run-scoped runner_selection instead of resolving it at run start', async () => {
    const taskId = await createIdleTask(`MSW stale selection ${Date.now()}`);
    const response = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/runs`,
      {
        intent: 'Run with stale selection',
        runner_selection: {
          mode: 'explicit',
          agent_runner_id: 'agent_runner_stale',
        },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: ['runner_selection'],
    });
  });

  it('serves task runner binding options without returning full Agent Runner fixture rows', async () => {
    const response = await fetch(
      'http://localhost/api/v1/workspaces/ws_001/projects/proj_001/tasks/runner-binding-options',
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      options?: Array<Record<string, unknown>>;
    };
    expect(payload.options?.find((item) => item.option_id === 'default_managed')).toMatchObject({
      option_id: 'default_managed',
      label: 'Default managed runner',
      bound_runner_kind: 'managed',
      runner_binding_source: 'default_managed',
      actions: {
        bind_to_task: {
          required_permissions: ['project:agent_task:use'],
        },
      },
    });
    expect(payload.options?.find((item) => item.option_id === 'agent_003')).toMatchObject({
      option_id: 'agent_003',
      label: 'CodeRunner',
      bound_runner_kind: 'developer',
      disabled_reason_code: 'agent_runner_unavailable',
      actions: {
        bind_to_task: {
          allowed: false,
        },
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('default_endpoint_id');
    expect(serialized).not.toContain('diagnostics');
    expect(serialized).not.toContain('config');
    expect(serialized).not.toContain('read_only');
    expect(serialized).not.toContain('select_for_task');
    expect(payload.options?.every((item) => !Object.prototype.hasOwnProperty.call(item, 'source'))).toBe(true);
  });

  it('serves no-authority runner-binding options as default-only while expert users see Developer rows', async () => {
    const snapshotUrl =
      'http://localhost/api/v1/workspaces/ws_001/projects/proj_001/tasks/runner-binding-options';

    const viewerResponse = await fetch(snapshotUrl, {
      headers: authHeaders('user_004', 'viewer@example.com'),
    });
    expect(viewerResponse.status).toBe(200);
    const viewerPayload = await viewerResponse.json() as {
      selected_option_id?: string;
      options?: Array<Record<string, unknown>>;
    };
    const viewerVisibleOptions = viewerPayload.options?.filter((option) => {
      const actions = option.actions as { bind_to_task?: { visible?: unknown } } | undefined;
      return actions?.bind_to_task?.visible === true;
    }) ?? [];
    expect(viewerPayload.options).toHaveLength(1);
    expect(viewerVisibleOptions).toHaveLength(1);
    expect(viewerVisibleOptions[0]).toMatchObject({
      option_id: 'default_managed',
      label: 'Default managed runner',
      runner_binding_source: 'default_managed',
      actions: {
        bind_to_task: {
          visible: true,
          allowed: true,
          required_permissions: ['project:agent_task:use'],
        },
      },
    });
    expect(JSON.stringify(viewerPayload)).not.toContain('CodeRunner');
    expect(JSON.stringify(viewerPayload)).not.toContain('ResearchRunner');

    const expertResponse = await fetch(snapshotUrl, {
      headers: authHeaders('user_001', 'test@example.com'),
    });
    expect(expertResponse.status).toBe(200);
    const expertPayload = await expertResponse.json() as {
      selected_option_id?: string;
      options?: Array<Record<string, unknown>>;
    };
    expect(expertPayload.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option_id: 'agent_003',
          label: 'CodeRunner',
          bound_runner_kind: 'developer',
          runner_binding_source: 'explicit',
        }),
      ]),
    );
  });

  it('uses chat mode as the authoritative terminate field and returns schema reasons', async () => {
    const sessionId = `session_unit_stop_${Date.now()}`;
    const stopModeOnly = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions/${sessionId}/stop?mock_chat_stop_escalation=unsupported`,
      { stop_mode: 'terminate' },
    );

    expect(stopModeOnly.status).toBe(202);
    await expect(stopModeOnly.json()).resolves.toMatchObject({
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const terminate = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions/${sessionId}/stop?mock_chat_stop_escalation=unsupported`,
      { mode: 'terminate' },
    );

    expect(terminate.status).toBe(202);
    await expect(terminate.json()).resolves.toMatchObject({
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });
  });

  it('returns task cancel accepted truth with production 202', async () => {
    const taskId = await createRunningTask(`MSW cancel accepted ${Date.now()}`);
    const response = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/cancel?mock_task_cancel_escalation=supported`,
      { mode: 'cancel' },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'cancelling',
      task_id: taskId,
      run_id: `mock_run_${taskId}`,
      request_id: `mock_cancel_${taskId}`,
      stop_mode: 'cancel',
      can_escalate: true,
    });
  });

  it('returns task unsupported cancel and terminate authoritative contracts', async () => {
    const taskId = await createRunningTask(`MSW unsupported cancel ${Date.now()}`);
    const cancel = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/cancel?mock_task_cancel_escalation=unsupported`,
      { mode: 'cancel' },
    );

    expect(cancel.status).toBe(202);
    await expect(cancel.json()).resolves.toMatchObject({
      status: 'cancelling',
      task_id: taskId,
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'unsupported_runner',
    });

    const terminate = await postJson(
      `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/cancel?mock_task_cancel_escalation=unsupported`,
      { mode: 'terminate' },
    );

    expect(terminate.status).toBe(409);
    await expect(terminate.json()).resolves.toMatchObject({
      error_code: 'STOP_ESCALATION_UNAVAILABLE',
      message: 'stop_escalation_unavailable',
      task_id: taskId,
      run_id: `mock_run_${taskId}`,
      request_id: `mock_cancel_${taskId}`,
      status: 'cancelling',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'unsupported_runner',
    });
  });
});
