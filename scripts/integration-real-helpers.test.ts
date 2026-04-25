import { describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bindNotebookExecutionSocketToTask,
  collectTrackedTaskWorkspaceMounts,
  createExternalConnectionViaApi,
  createExternalRunnerAgentBundle,
  findPreparedTaskWorkspaceRootInRunnerLog,
  parseWorkloadPodSnapshot,
  resolveIntegrationKeycloakBaseUrl,
  resolveNotebookRunnerSocketUrl,
} from '../e2e/integration-real-helpers';

describe('integration-real-helpers', () => {
  const okResponse = <T,>(body: T) => ({
    ok: () => true,
    status: () => 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it('keeps workspace landing path builders sourced from the shared helper instead of the app boundary', async () => {
    const source = await readFile(path.resolve('e2e/integration-real-helpers.ts'), 'utf8');

    expect(source).toContain("from '@mbos/contracts/src/auth-handoff-paths'");
    expect(source).not.toContain("from '../src/lib/auth/invite-handoff'");
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

  it('extracts the prepared task workspace cwd from notebook runner debug logs', () => {
    const logText = [
      '[notebook-codex-runner][debug] received start {"task_id":"task_123"}',
      '[notebook-codex-runner][debug] prepared task workspace {"cwd":"/home/alice/ags-workspace/task_123","codex_config":"/home/alice/ags-workspace/task_123/.codex/config.toml"}',
    ].join('\n');

    expect(findPreparedTaskWorkspaceRootInRunnerLog(logText)).toBe('/home/alice/ags-workspace/task_123');
  });

  it('prefers the latest prepared task workspace entry when a runner reconnects across tasks', () => {
    const logText = [
      '[notebook-codex-runner][debug] prepared task workspace {"cwd":"/home/alice/ags-workspace/task_old"}',
      '[notebook-codex-runner][debug] prepared task workspace {"cwd":"/home/alice/ags-workspace/task_new"}',
    ].join('\n');

    expect(findPreparedTaskWorkspaceRootInRunnerLog(logText)).toBe('/home/alice/ags-workspace/task_new');
  });

  it('returns null when the runner log has not yet declared a prepared task workspace', () => {
    expect(findPreparedTaskWorkspaceRootInRunnerLog('[notebook-codex-runner] connected')).toBeNull();
  });

  it('parses workload pod readiness truth from kubernetes pod list payloads', () => {
    const payload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-1', uid: 'pod-uid-1' },
          status: {
            phase: 'Running',
            conditions: [
              { type: 'Ready', status: 'True' },
            ],
            containerStatuses: [
              { ready: true, state: { running: {} } },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(payload)).toMatchObject({
      name: 'workload-pod-1',
      uid: 'pod-uid-1',
      phase: 'Running',
      ready: true,
      containerReadyCount: 1,
      containerCount: 1,
    });
  });

  it('retains waiting reasons when a workload pod exists but is not ready yet', () => {
    const payload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-2', uid: 'pod-uid-2' },
          status: {
            phase: 'Pending',
            conditions: [
              { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
            ],
            containerStatuses: [
              {
                ready: false,
                state: { waiting: { reason: 'ContainerCreating' } },
              },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(payload)).toMatchObject({
      name: 'workload-pod-2',
      uid: 'pod-uid-2',
      phase: 'Pending',
      ready: false,
      readyReason: 'ContainersNotReady',
      reason: 'ContainerCreating',
      containerReadyCount: 0,
      containerCount: 1,
    });
  });

  it('keeps terminate recovery spec on ready-aware pod and execution outcome helpers', async () => {
    const source = await readFile(path.resolve('e2e/integration-internal-notebook-workspace.spec.ts'), 'utf8');

    expect(source).toContain('waitForNotebookExecutionOutcome');
    expect(source).toContain('waitForWorkloadPodReady');
    expect(source).not.toMatch(
      /waitForAssistantToken\(\{\s*page,\s*workspaceId: "ws_default",\s*projectId,\s*taskId,\s*token: terminateRecoveryToken,/,
    );
  });

  it('binds the terminate recovery assistant message id into the scoped outcome wait', async () => {
    const source = await readFile(path.resolve('e2e/integration-internal-notebook-workspace.spec.ts'), 'utf8');

    expect(source).toMatch(
      /const \{ assistantMessageId: terminateRecoveryAssistantMessageId \}\s*=\s*await sendTaskMessage\(/,
    );
    expect(source).toMatch(
      /waitForNotebookExecutionOutcome\(\{\s*page,\s*workspaceId: "ws_default",\s*projectId,\s*taskId,\s*token: terminateRecoveryToken,\s*assistantMessageId: terminateRecoveryAssistantMessageId,/,
    );
  });

  it('scopes notebook execution outcome polling to the current assistant message boundary', async () => {
    const source = await readFile(path.resolve('e2e/integration-real-helpers.ts'), 'utf8');

    expect(source).toContain('assistantMessageId');
    expect(source).toContain('message_id=');
  });

  it('prefers KEYCLOAK_BASE_URL over every other integration keycloak env source', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      KEYCLOAK_BASE_URL: 'http://auth.example.test:39090/',
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://auth.example.test:39090');
  });

  it('prefers RUNTIME_HOST_KEYCLOAK_BASE_URL before browser and public/internal fallbacks', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091/',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://runtime-host.example.test:39091');
  });

  it('prefers RUNTIME_BROWSER_KEYCLOAK_BASE_URL before public/internal fallbacks', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092/',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://runtime-browser.example.test:39092');
  });

  it('uses browser runtime truth for browser-facing flows when host and browser urls diverge', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092/',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
    }, { target: 'browser' })).toBe('http://runtime-browser.example.test:39092');
  });

  it('prefers PUBLIC_KEYCLOAK_BASE_URL before INTERNAL_KEYCLOAK_BASE_URL', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093/',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://public.example.test:39093');
  });

  it('falls back to INTERNAL_KEYCLOAK_BASE_URL before constructing loopback from a port', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094/',
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://internal.example.test:39094');
  });

  it('constructs a loopback base url from KEYCLOAK_PORT when no base url env is declared', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://127.0.0.1:39095');
  });

  it('falls back to INTEGRATION_KEYCLOAK_PORT when KEYCLOAK_PORT is absent', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://127.0.0.1:39096');
  });

  it('fails fast when the integration runtime does not declare any keycloak base url truth', () => {
    expect(() => resolveIntegrationKeycloakBaseUrl({})).toThrow('integration_keycloak_base_url_missing');
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
