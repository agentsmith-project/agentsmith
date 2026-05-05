import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { chatHandlers } from '@/mocks/handlers/chat';
import { taskHandlers } from '@/mocks/handlers/tasks';

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
