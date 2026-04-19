import { describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bindNotebookExecutionSocketToTask,
  collectTrackedTaskWorkspaceMounts,
  createExternalConnectionViaApi,
  createExternalRunnerAgentBundle,
  resolveNotebookRunnerSocketUrl,
} from '../e2e/integration-real-helpers';

describe('integration-real-helpers', () => {
  const okResponse = <T,>(body: T) => ({
    ok: () => true,
    status: () => 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it('creates an external connection through the API without mutating page state', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: () => true,
      status: 201,
      json: async () => ({ id: 'uec_seed_1' }),
    });
    const request = { post } as unknown as APIRequestContext;

    const id = await createExternalConnectionViaApi({
      request,
      token: 'mock_token_user_001_12345',
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Seeded Connection',
      note: 'seeded via api',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
      ],
    });

    expect(id).toBe('uec_seed_1');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/me/external-connections'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock_token_user_001_12345',
        }),
      }),
    );
  });

  it('fails when the explicit token is missing', async () => {
    const request = { post: vi.fn() } as unknown as APIRequestContext;

    await expect(createExternalConnectionViaApi({
      request,
      token: '   ',
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Seeded Connection',
      fields: [],
    })).rejects.toThrow('auth_token_not_found_for_external_connection_seed');
  });

  it('collects tracked host-external task mounts from the runner registry', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'integration-helper-runner-'));
    await writeFile(
      path.join(workspaceRoot, 'task-workspace-mount-sessions.json'),
      JSON.stringify({
        sessions: [
          { mount_path: '/home/alice/ags-workspace/task_1' },
          { mount_path: '/home/alice/ags-workspace/task_2' },
          { mount_path: '/home/alice/ags-workspace/task_1' },
          { mount_path: '' },
        ],
      }),
      'utf8',
    );

    await expect(collectTrackedTaskWorkspaceMounts(workspaceRoot)).resolves.toEqual([
      '/home/alice/ags-workspace/task_1',
      '/home/alice/ags-workspace/task_2',
    ]);
  });

  it('binds notebook execution sockets to the task session while preserving other query params', () => {
    expect(
      bindNotebookExecutionSocketToTask({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1&foo=bar',
        taskId: 'task_123',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1&foo=bar&session_id=task_123');
  });

  it('replaces stale notebook execution session ids with the current task id', () => {
    expect(
      bindNotebookExecutionSocketToTask({
        wsUrl: 'wss://runner.example.com/api/v1/agent-execution/ws?agent_id=ag_1&session_id=task_old',
        taskId: 'task_new',
      }),
    ).toBe('wss://runner.example.com/api/v1/agent-execution/ws?agent_id=ag_1&session_id=task_new');
  });

  it('keeps notebook presence runner sockets agent-scoped before task creation', () => {
    expect(
      resolveNotebookRunnerSocketUrl({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1',
        scope: 'agent_presence',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1');
  });

  it('requires a task id when resolving a task-bound notebook runner socket', () => {
    expect(() =>
      resolveNotebookRunnerSocketUrl({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1',
        scope: 'task_execution',
      }),
    ).toThrow('task_id_required_for_task_bound_notebook_runner');
  });

  it('creates anthropic chat runner bundles with the anthropic_messages wire selected from endpoint upstream_protocol', async () => {
    const post = vi.fn().mockImplementation(async (url: string, options?: { data?: Record<string, unknown> }) => {
      if (url.includes('/agents/') && url.endsWith('/keys')) {
        return okResponse({ key: 'agent_key_1' });
      }
      if (url.endsWith('/chat/sessions')) {
        return okResponse({ id: 'sess_1' });
      }
      if (url.endsWith('/agents')) {
        return okResponse({ id: 'ag_1' });
      }
      throw new Error(`unexpected_post:${url}:${JSON.stringify(options?.data ?? null)}`);
    });
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/endpoints/ep_anthropic')) {
        return okResponse({
          id: 'ep_anthropic',
          provider_family: 'custom',
          upstream_protocol: 'anthropic_messages',
        });
      }
      if (url.includes('/agents/ag_1/connection-info')) {
        return okResponse({ ws_url: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1' });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: {
        get,
        post,
      },
    } as unknown as Parameters<typeof createExternalRunnerAgentBundle>[0];

    await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_anthropic',
      title: 'anthropic-chat',
      interactionKind: 'chat',
    });

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/agents'),
      expect.objectContaining({
        data: expect.objectContaining({
          interaction_kind: 'chat',
          execution_preferences: {
            chat: expect.objectContaining({
              endpoint_id: 'ep_anthropic',
              wire_api: 'anthropic_messages',
            }),
          },
        }),
      }),
    );
  });
});
