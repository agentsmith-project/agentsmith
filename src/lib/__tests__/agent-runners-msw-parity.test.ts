import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { agentRunnerHandlers } from '@/mocks/handlers/agent-runners';
import { taskHandlers } from '@/mocks/handlers/tasks';

const server = setupServer(...agentRunnerHandlers, ...taskHandlers);
const baseUrl = 'http://localhost/api/v1/workspaces/ws_default/projects/proj_001/agent-runners';
const project2BaseUrl = 'http://localhost/api/v1/workspaces/ws_default/projects/proj_002/agent-runners';
const taskBaseUrl = 'http://localhost/api/v1/workspaces/ws_default/projects/proj_001/tasks';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('agent runner MSW public contract parity', () => {
  it('lists public runners with kind, source, read_only, and action affordances', async () => {
    const response = await fetch(baseUrl);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions.create_developer_runner).toMatchObject({
      operation: 'create_developer_runner',
      visible: true,
      allowed: true,
      required_permissions: ['project:agent_runner:manage'],
      danger_level: 'none',
    });
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.kind === 'system_managed' || item.kind === 'developer').toBe(true);
      expect(item.source === 'system' || item.source === 'developer').toBe(true);
      expect(typeof item.read_only).toBe('boolean');
      expect(item.actions.view_diagnostics.operation).toBe('view_diagnostics');
      expect(typeof item.actions.issue_connection_key.allowed).toBe('boolean');
    }
  });

  it('returns denied collection create affordance from MSW list without relying on frontend capabilities', async () => {
    const response = await fetch(baseUrl, {
      headers: { 'x-mock-agent-runner-manage': 'denied' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions.create_developer_runner).toMatchObject({
      operation: 'create_developer_runner',
      visible: true,
      allowed: false,
      reason_code: 'permission_denied',
      required_permissions: ['project:agent_runner:manage'],
      danger_level: 'none',
    });
  });

  it('scopes list items and totals to the project route parameter', async () => {
    const created = await fetch(project2BaseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Project 2 Developer Runner ${Date.now()}` }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.project_id).toBe('proj_002');

    const project2Response = await fetch(project2BaseUrl);
    const project2Body = await project2Response.json();
    expect(project2Response.status).toBe(200);
    expect(project2Body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdBody.id, project_id: 'proj_002' }),
      ]),
    );
    expect(project2Body.items.every((item: { project_id?: string }) => item.project_id === 'proj_002')).toBe(true);
    expect(project2Body.total).toBe(project2Body.items.length);

    const project1Response = await fetch(baseUrl);
    const project1Body = await project1Response.json();
    expect(project1Response.status).toBe(200);
    expect(project1Body.items.some((item: { id: string }) => item.id === createdBody.id)).toBe(false);
    expect(project1Body.items.every((item: { project_id?: string }) => item.project_id === 'proj_001')).toBe(true);
    expect(project1Body.total).toBe(project1Body.items.length);
  });

  it('returns 404 for existing runners addressed through a different project', async () => {
    const created = await fetch(project2BaseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Cross Project Developer Runner ${Date.now()}` }),
    }).then((res) => res.json());
    const key = await fetch(`${project2BaseUrl}/${created.id}/keys`, { method: 'POST' }).then((res) => res.json());
    const wrongProjectRunnerUrl = `${baseUrl}/${created.id}`;

    await expect(fetch(wrongProjectRunnerUrl).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(wrongProjectRunnerUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wrong project update' }),
    }).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(`${wrongProjectRunnerUrl}/keys`).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(`${wrongProjectRunnerUrl}/keys`, { method: 'POST' }).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(`${wrongProjectRunnerUrl}/keys/${key.id}`, { method: 'DELETE' }).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(`${wrongProjectRunnerUrl}/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 5000 }),
    }).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(`${wrongProjectRunnerUrl}/test-task-runs`, {
      method: 'POST',
    }).then((res) => res.status)).resolves.toBe(404);
    await expect(fetch(wrongProjectRunnerUrl, { method: 'DELETE' }).then((res) => res.status)).resolves.toBe(404);
  });

  it('rejects System managed and configuration fields on public create/update', async () => {
    const createSystem = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Forged system runner', kind: 'system_managed' }),
    });
    expect(createSystem.status).toBe(400);

    const createWithConfig = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Configured runner', default_endpoint_id: 'ep_1', capabilities: { terminal: true } }),
    });
    expect(createWithConfig.status).toBe(400);

    const list = await fetch(baseUrl).then((res) => res.json());
    const systemRunner = list.items.find((item: { kind: string }) => item.kind === 'system_managed');
    expect(systemRunner).toBeTruthy();

    const updateSystem = await fetch(`${baseUrl}/${systemRunner.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mutated system runner' }),
    });
    expect(updateSystem.status).toBe(403);
  });

  it('creates and updates Developer runners with display metadata only', async () => {
    const created = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Local Developer Runner', description: 'Local checks' }),
    });
    const createdBody = await created.json();

    expect(created.status).toBe(201);
    expect(createdBody.kind).toBe('developer');
    expect(createdBody.source).toBe('developer');
    expect(createdBody.read_only).toBe(false);
    expect(createdBody.is_default).toBe(false);
    expect(createdBody.default_endpoint_id).toBeUndefined();

    const rejectedUpdate = await fetch(`${baseUrl}/${createdBody.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ready' }),
    });
    expect(rejectedUpdate.status).toBe(400);

    const updated = await fetch(`${baseUrl}/${createdBody.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Developer Runner', description: 'Updated' }),
    });
    const updatedBody = await updated.json();

    expect(updated.status).toBe(200);
    expect(updatedBody.name).toBe('Renamed Developer Runner');
    expect(updatedBody.description).toBe('Updated');
  });

  it('deletes Developer runners with 204 and no response body', async () => {
    const created = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Delete Contract Developer Runner' }),
    }).then((res) => res.json());

    const deleted = await fetch(`${baseUrl}/${created.id}`, { method: 'DELETE' });

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');
    expect(await fetch(`${baseUrl}/${created.id}`)).toMatchObject({
      status: 404,
    });
  });

  it('keeps Developer key lifecycle to one active key, seven-day expiry, and metadata-only lists', async () => {
    const created = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Key Rotation Developer Runner' }),
    }).then((res) => res.json());

    const firstCreate = await fetch(`${baseUrl}/${created.id}/keys`, { method: 'POST' });
    const firstBody = await firstCreate.json();

    expect(firstCreate.status).toBe(201);
    expect(firstBody.key).toMatch(/^ask_/);
    expect(Date.parse(firstBody.expires_at) - Date.parse(firstBody.created_at)).toBe(7 * 24 * 60 * 60 * 1000);

    const secondCreate = await fetch(`${baseUrl}/${created.id}/keys`, { method: 'POST' });
    const secondBody = await secondCreate.json();

    expect(secondCreate.status).toBe(201);
    expect(secondBody.key).toMatch(/^ask_/);
    expect(Date.parse(secondBody.expires_at) - Date.parse(secondBody.created_at)).toBe(7 * 24 * 60 * 60 * 1000);

    const keys = await fetch(`${baseUrl}/${created.id}/keys`).then((res) => res.json());
    expect(keys.total).toBe(2);
    expect(keys.items.filter((item: { status: string }) => item.status === 'active')).toHaveLength(1);
    expect(keys.items).toContainEqual(expect.objectContaining({
      id: firstBody.id,
      key_prefix: firstBody.key_prefix,
      status: 'revoked',
    }));
    expect(keys.items).toContainEqual(expect.objectContaining({
      id: secondBody.id,
      key_prefix: secondBody.key_prefix,
      status: 'active',
      expires_at: secondBody.expires_at,
    }));
    expect(JSON.stringify(keys)).not.toContain(firstBody.key);
    expect(JSON.stringify(keys)).not.toContain(secondBody.key);
    expect(keys.items[0].key).toBeUndefined();
    expect(keys.items[0].key_hash).toBeUndefined();
  });

  it('rejects System managed key operations', async () => {
    const list = await fetch(baseUrl).then((res) => res.json());
    const systemRunner = list.items.find((item: { kind: string }) => item.kind === 'system_managed');

    const systemKeyCreate = await fetch(`${baseUrl}/${systemRunner.id}/keys`, { method: 'POST' });
    expect(systemKeyCreate.status).toBe(403);
  });

  it('covers Test connection connected and offline Developer paths', async () => {
    const allowed = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 5000 }),
    });
    const allowedBody = await allowed.json();

    expect(allowed.status).toBe(200);
    expect(allowedBody.agent_runner_id).toBe('ag_2');
    expect(allowedBody.status).toBe('connected');
    expect(allowedBody.timeout_ms).toBe(5000);
    expect(allowedBody.freshness.state).toBe('fresh');

    const offlineRunner = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline Test Connection Runner' }),
    }).then((res) => res.json());
    expect(offlineRunner.actions.test_connection).toMatchObject({
      visible: true,
      allowed: true,
    });
    expect(offlineRunner.actions.run_test_task).toMatchObject({
      visible: true,
      allowed: false,
      reason_code: 'agent_runner_disconnected',
    });

    const offline = await fetch(`${baseUrl}/${offlineRunner.id}/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 5000 }),
    });
    const offlineBody = await offline.json();

    expect(offline.status).toBe(200);
    expect(offlineBody).toMatchObject({
      agent_runner_id: offlineRunner.id,
      status: 'disconnected',
      timeout_ms: 5000,
      freshness: {
        state: 'missing',
        active_connection_count: 0,
      },
      errors: [
        expect.objectContaining({ code: 'agent_runner_disconnected' }),
      ],
    });
  });

  it('matches backend Test connection timeout default, custom echo, and invalid range validation', async () => {
    const defaultTimeout = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const defaultBody = await defaultTimeout.json();

    expect(defaultTimeout.status).toBe(200);
    expect(defaultBody.timeout_ms).toBe(1000);

    const customTimeout = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 750 }),
    });
    const customBody = await customTimeout.json();

    expect(customTimeout.status).toBe(200);
    expect(customBody.timeout_ms).toBe(750);

    const tooLow = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 99 }),
    });

    expect(tooLow.status).toBe(422);
    await expect(tooLow.json()).resolves.toEqual({
      error_code: 'VALIDATION_ERROR',
      message: 'agent_test_timeout_invalid',
      field: 'timeout_ms',
    });

    const tooHigh = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 10001 }),
    });

    expect(tooHigh.status).toBe(422);
  });

  it.each([
    ['ws_url', 'wss://example.invalid/agent?key=ask_secret'],
    ['key', 'ask_secret'],
    ['Authorization', 'Bearer ask_secret'],
    ['diagnostics', { raw: 'ask_secret diagnostics must not leak' }],
  ])('rejects unsupported Test connection field %s like the backend', async (field, value) => {
    const response = await fetch(`${baseUrl}/ag_2/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        timeout_ms: 750,
        [field]: value,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: [field],
    });
    expect(JSON.stringify(body)).not.toContain('ask_secret');
    expect(JSON.stringify(body)).not.toContain('example.invalid');
  });

  it('keeps Test connection cleanup schema redacted when an active key has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const keyCreate = await fetch(`${baseUrl}/ag_2/keys`, { method: 'POST' });
      const keyBody = await keyCreate.json();
      vi.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));

      const response = await fetch(`${baseUrl}/ag_2/test-connection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeout_ms: 750 }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.cleanup?.key_expiry).toEqual({
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        agent_runner_id: 'ag_2',
        key_id: keyBody.id,
        key_prefix: keyBody.key_prefix,
        expires_at: '2026-05-12T00:00:00.000Z',
        cleanup_result: 'marked_expired',
        disconnected: false,
      });
      expect(JSON.stringify(body.cleanup)).not.toContain(keyBody.key);
      expect(JSON.stringify(body.cleanup)).not.toContain('key_hash');
    } finally {
      vi.useRealTimers();
    }
  });

  it('covers Developer test task accepted and unavailable paths', async () => {
    const accepted = await fetch(`${baseUrl}/ag_2/test-task-runs`, {
      method: 'POST',
    });
    const acceptedBody = await accepted.json();

    expect(accepted.status).toBe(202);
    expect(acceptedBody.status).toBe('accepted');
    expect(acceptedBody.runner_test).toBe(true);
    expect(acceptedBody.resolved_runner_id).toBe('ag_2');
    expect(acceptedBody).not.toHaveProperty('selection');
    expect(acceptedBody.task_id).toMatch(/^task_runner_test_/);
    expect(acceptedBody.run_id).toMatch(/^run_runner_test_/);

    const tasks = await fetch(taskBaseUrl).then((res) => res.json());
    expect(tasks.items.find((item: { id: string }) => item.id === acceptedBody.task_id)).toMatchObject({
      id: acceptedBody.task_id,
      source: 'runner_test',
      runner_test: true,
      bound_runner_id: 'ag_2',
      bound_runner_kind: 'developer',
      runner_binding_source: 'explicit',
      active_run: expect.objectContaining({
        id: acceptedBody.run_id,
        runner_id: 'ag_2',
        source: 'runner_test',
        runner_test: true,
      }),
    });

    const task = await fetch(`${taskBaseUrl}/${acceptedBody.task_id}`).then((res) => res.json());
    expect(task).toMatchObject({
      id: acceptedBody.task_id,
      source: 'runner_test',
      runner_test: true,
      active_run: expect.objectContaining({
        id: acceptedBody.run_id,
        source: 'runner_test',
        runner_test: true,
      }),
    });

    const activity = await fetch(`${taskBaseUrl}/${acceptedBody.task_id}/activity`).then((res) => res.json());
    expect(activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task_id: acceptedBody.task_id,
        source: 'runner_test',
        runner_test: true,
      }),
      expect.objectContaining({
        task_id: acceptedBody.task_id,
        run_id: acceptedBody.run_id,
        source: 'runner_test',
        runner_test: true,
      }),
    ]));

    const unavailableRunner = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unavailable Test Task Runner' }),
    }).then((res) => res.json());

    const unavailable = await fetch(`${baseUrl}/${unavailableRunner.id}/test-task-runs`, {
      method: 'POST',
    });
    const unavailableBody = await unavailable.json();

    expect(unavailable.status).toBe(409);
    expect(unavailableBody.status).toBe('not_started');
    expect(unavailableBody.runner_test).toBe(true);
    expect(unavailableBody.error_code).toBe('agent_runner_test_task_unavailable');
    expect(unavailableBody.resolved_runner_id).toBe(unavailableRunner.id);
    expect(unavailableBody).not.toHaveProperty('selection');
  });

  it.each([
    ['task_id'],
    ['runner_selection'],
    ['agent_id'],
    ['runner_id'],
    ['input_refs'],
    ['workspace_file_library_id'],
  ])('rejects ordinary launcher field %s on Developer test task MSW route', async (field) => {
    const response = await fetch(`${baseUrl}/ag_2/test-task-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        [field]: field === 'runner_selection'
          ? { mode: 'explicit', agent_runner_id: 'ag_2' }
          : 'ordinary-launcher-field',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
      fields: [field],
    });
  });

  it('rejects System managed Test connection and Developer test task actions', async () => {
    const list = await fetch(baseUrl).then((res) => res.json());
    const systemRunner = list.items.find((item: { kind: string }) => item.kind === 'system_managed');
    expect(systemRunner).toBeTruthy();

    const testConnection = await fetch(`${baseUrl}/${systemRunner.id}/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 5000 }),
    });
    expect(testConnection.status).toBe(403);

    const testTask = await fetch(`${baseUrl}/${systemRunner.id}/test-task-runs`, {
      method: 'POST',
    });
    expect(testTask.status).toBe(403);
  });
});
