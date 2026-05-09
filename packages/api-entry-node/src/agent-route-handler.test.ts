import { describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from './index.js';
import { handleAgentRoute, resolveAgentPresenceForApi } from './agent-route-handler.js';
import { handleTaskRoute } from './task-route-handler.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import { getNotebookTaskRunState } from './notebook-task/task-run-coordination.js';
import { notebookTaskMessagesCollection, notebookTasksCollection } from './notebook-task/task-store.js';
import { listAuditEvents } from './audit-usage-store.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('resolveAgentPresenceForApi', () => {
  it('returns online for developer runner sockets', () => {
    expect(
      resolveAgentPresenceForApi({
        managed: false,
        storedPresence: 'online',
        socketOnline: true,
      }),
    ).toBe('online');
  });

  it('keeps shared developer presence online even when the current API process has no local socket', () => {
    expect(
      resolveAgentPresenceForApi({
        managed: false,
        storedPresence: 'online',
        socketOnline: false,
      }),
    ).toBe('online');
  });

  it('uses a local socket as online evidence while shared presence is catching up', () => {
    expect(
      resolveAgentPresenceForApi({
        managed: false,
        storedPresence: 'offline',
        socketOnline: true,
      }),
    ).toBe('online');
  });

  it('keeps managed Agent Runners managed regardless of socket state', () => {
    expect(
      resolveAgentPresenceForApi({
        managed: true,
        storedPresence: 'managed',
        socketOnline: false,
      }),
    ).toBe('managed');
  });
});

describe('handleAgentRoute Agent Runner target contract', () => {
  async function createProjectWithMemberPermissions(
    permissions: string[],
  ): Promise<{
    deps: ReturnType<typeof createDefaultNodeApiDeps>;
    projectId: string;
  }> {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: `Runner authz ${Math.random().toString(36).slice(2)}`,
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
      project_id: project.id,
      user_id: 'user_test',
      user_email: 'test@example.com',
      user_name: 'Test User',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', project.id, 'user_test', {
      mode: 'custom',
      template: null,
      permissions,
    });
    return { deps, projectId: project.id };
  }

  async function createRunnerEndpoint(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId: string,
    name = 'runner-test endpoint',
  ) {
    const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
      name: `${name}-key`,
      value: 'sk-runner-test',
    });
    return deps.endpointResourceService.createEndpoint('ws_default', projectId, {
      name,
      model: 'gpt-5-codex',
      type: 'custom',
      base_url: 'https://example.com/v1',
      credential_ref: credential.id,
      status: 'active',
      upstream_protocol: 'openai_responses',
      model_profile: {
        max_context_tokens: 128000,
        max_output_tokens: 8192,
        supports_file: false,
        supports_tool_call: true,
        supports_reasoning: false,
        price_input_per_1m: 0,
        price_output_per_1m: 0,
        cache_read_discount_ratio: 0,
        cache_write_discount_ratio: 0,
      },
    });
  }

  async function seedAgentTaskModelSetting(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId: string,
    endpointId: string,
  ): Promise<void> {
    await new AgentTaskModelSettingService(deps).patchSetting({
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      expectedSettingRevision: null,
      actorUserId: 'user_test',
    });
  }

  async function createConnectedDeveloperRunner(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId: string,
    input?: {
      name?: string;
      capabilities?: Record<string, unknown>;
      runnerStatus?: 'draft' | 'connected' | 'ready' | 'degraded' | 'offline';
    },
  ) {
    const endpoint = await createRunnerEndpoint(deps, projectId);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: input?.name ?? 'Connected runner test task runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: input?.runnerStatus ?? 'ready',
      default_endpoint_id: endpoint.id,
      capabilities: input?.capabilities ?? { task_execution: true, artifacts: true },
    });
    const keyPair = await deps.agentResourceService.createAgentKey('ws_default', projectId, runner.id);
    await deps.agentResourceService.registerAgentConnection({
      agentId: runner.id,
      workspaceId: 'ws_default',
      projectId,
      connectionId: `conn_${runner.id}`,
      socketKey: runner.id,
      apiInstanceId: 'api_test',
      protocolVersion: '1.0',
      lastPongAt: '2026-05-05T00:00:00.000Z',
      authenticatedKey: {
        kind: 'service_key',
        keyId: keyPair.record.id,
        expiresAt: keyPair.record.expires_at,
      },
    });
    return { endpoint, runner };
  }

  it('rejects legacy runner selector fields with unsupported_field', async () => {
    const deps = createDefaultNodeApiDeps();
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        name: 'Legacy runner payload',
        mode: 'external',
        interaction_kind: 'notebook',
        runner_runtime: 'dev_direct',
        type: 'external',
        execution_preferences: { notebook: { endpoint_id: 'ep_old' } },
        execution_preferences_json: { agent_task: { endpoint_id: 'ep_internal' } },
      })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      400,
      {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [
          'mode',
          'runner_runtime',
          'interaction_kind',
          'type',
          'execution_preferences',
          'execution_preferences_json',
        ],
      },
    );
  });

  it('creates Developer runners with public kind, source, read_only, and backend actions', async () => {
    const deps = createDefaultNodeApiDeps();
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        name: 'Developer task runner',
        description: 'Local developer loop',
        kind: 'developer',
      })),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(body).toMatchObject({
      name: 'Developer task runner',
      description: 'Local developer loop',
      kind: 'developer',
      source: 'developer',
      read_only: false,
      is_default: false,
      status: 'draft',
      diagnostics: expect.any(Object),
      actions: expect.objectContaining({
        edit: expect.objectContaining({ operation: 'edit', visible: true }),
        delete: expect.objectContaining({ operation: 'delete', visible: true }),
        issue_connection_key: expect.objectContaining({ operation: 'issue_connection_key', visible: true }),
        view_diagnostics: expect.objectContaining({ operation: 'view_diagnostics', visible: true }),
      }),
    });
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('runner_runtime');
    expect(body).not.toHaveProperty('interaction_kind');
    expect(body).not.toHaveProperty('default_endpoint_id');
  });

  it('rejects public Agent Runner create payloads outside the Developer runner contract', async () => {
    const deps = createDefaultNodeApiDeps();
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        name: 'Invalid public runner',
        kind: 'system_managed',
        is_default: true,
        default_endpoint_id: 'ep_default',
        status: 'ready',
        diagnostics: { presence: 'managed' },
        capabilities: { terminal: true },
        presence: 'managed',
      })),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as { fields?: string[] };
    expect(json.mock.calls[0]?.[1]).toBe(400);
    expect(body).toMatchObject({
      error_code: 'unsupported_field',
      message: 'unsupported_field',
    });
    expect(body.fields).toEqual([
      'kind',
      'is_default',
      'default_endpoint_id',
      'status',
      'diagnostics',
      'capabilities',
      'presence',
    ]);
  });

  it('keeps System managed private runtime config internal while public reads expose read-only affordances', async () => {
    const previousInternalAgentImage = process.env.INTERNAL_AGENT_IMAGE;
    const previousIntegrationInternalAgentImage = process.env.INTEGRATION_INTERNAL_AGENT_IMAGE;
    process.env.INTERNAL_AGENT_IMAGE = 'agentsmith-agent-task-runner:test';
    delete process.env.INTEGRATION_INTERNAL_AGENT_IMAGE;

    try {
      const { deps, projectId } = await createProjectWithMemberPermissions([
        'project:agent_runner:read',
        'project:agent_runner:manage',
      ]);
      const json = vi.fn();

      const created = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Managed private runtime runner',
        default_endpoint_id: 'ep_default',
        runner_status: 'ready',
        status: 'enabled',
        presence: 'managed',
        is_default: true,
      });

      const stored = await deps.agentResourceService.getAgent(
        'ws_default',
        projectId,
        created.id,
      );
      expect(stored?.config).toEqual(expect.objectContaining({
        image: 'agentsmith-agent-task-runner:test',
        _internal_key_id: expect.stringMatching(/^agk_/),
        _internal_raw_key: expect.stringMatching(/^ask_/),
      }));
      const internalRawKey = stored?.config?._internal_raw_key;
      expect(typeof internalRawKey).toBe('string');
      const verifiedInternalKey = await deps.agentResourceService.verifyAgentKey(
        created.id,
        internalRawKey ?? '',
      );
      expect(verifiedInternalKey).toMatchObject({
        workspace_id: 'ws_default',
        project_id: projectId,
        agent_id: created.id,
        status: 'active',
      });

      await expect(handleAgentRoute({
        route: { kind: 'agents', workspaceId: 'ws_default', projectId },
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const listBody = json.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>> };
      const listed = listBody.items?.find((item) => item.id === created.id);
      expect(listed).toMatchObject({
        id: created.id,
        kind: 'system_managed',
        source: 'system',
        read_only: true,
        actions: expect.objectContaining({
          edit: expect.objectContaining({ allowed: false, reason_code: 'system_managed_read_only' }),
          delete: expect.objectContaining({ allowed: false, reason_code: 'system_managed_read_only' }),
          issue_connection_key: expect.objectContaining({ allowed: false, reason_code: 'system_managed_read_only' }),
          view_diagnostics: expect.objectContaining({ allowed: true }),
        }),
      });
      expect(listed).not.toHaveProperty('config');

      json.mockClear();
      await expect(handleAgentRoute({
        route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: created.id },
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const itemBody = json.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(itemBody).toMatchObject({
        id: created.id,
        kind: 'system_managed',
        read_only: true,
      });
      expect(itemBody).not.toHaveProperty('config');
    } finally {
      if (previousInternalAgentImage === undefined) {
        delete process.env.INTERNAL_AGENT_IMAGE;
      } else {
        process.env.INTERNAL_AGENT_IMAGE = previousInternalAgentImage;
      }
      if (previousIntegrationInternalAgentImage === undefined) {
        delete process.env.INTEGRATION_INTERNAL_AGENT_IMAGE;
      } else {
        process.env.INTEGRATION_INTERNAL_AGENT_IMAGE = previousIntegrationInternalAgentImage;
      }
    }
  });

  it('rejects private managed runtime config fields in public Agent Runner create payloads', async () => {
    const deps = createDefaultNodeApiDeps();
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        name: 'Invalid private config',
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_should_not_land',
        },
      })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      400,
      {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: ['config'],
      },
    );
  });

  it('allows Agent Runner read permission to list private project runners without legacy public/use tokens', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:read']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Private managed runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
    });

    await expect(handleAgentRoute({
      route: { kind: 'agents', workspaceId: 'ws_default', projectId },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as { items?: Array<{ id: string }> };
    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(body.items?.map((item) => item.id)).toContain(runner.id);
  });

  it('returns backend-owned collection create affordance on list without leaking System managed config', async () => {
    async function listForPermissions(permissions: string[]) {
      const { deps, projectId } = await createProjectWithMemberPermissions(permissions);
      const json = vi.fn();
      const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Managed config should stay private',
        owner_id: 'user_owner',
        admin_id: 'user_owner',
        visibility: 'private',
        presence: 'managed',
        status: 'enabled',
        runner_status: 'ready',
        config: {
          image: 'agentsmith-private-runner:test',
          _internal_key_id: 'agk_private_should_not_leak',
          _internal_raw_key: 'ask_private_should_not_leak',
        },
      });

      await expect(handleAgentRoute({
        route: { kind: 'agents', workspaceId: 'ws_default', projectId },
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(),
      })).resolves.toBe(true);

      return { body: json.mock.calls[0]?.[2] as Record<string, unknown>, runner };
    }

    const allowed = await listForPermissions(['project:agent_runner:manage']);
    expect(allowed.body).toMatchObject({
      actions: {
        create_developer_runner: {
          operation: 'create_developer_runner',
          visible: true,
          allowed: true,
          required_permissions: ['project:agent_runner:manage'],
          danger_level: 'none',
        },
      },
    });
    expect(JSON.stringify(allowed.body)).not.toContain('agentsmith-private-runner:test');
    expect(JSON.stringify(allowed.body)).not.toContain('agk_private_should_not_leak');
    expect(JSON.stringify(allowed.body)).not.toContain('ask_private_should_not_leak');
    expect((allowed.body.items as Array<Record<string, unknown>> | undefined)
      ?.find((item) => item.id === allowed.runner.id))
      .not.toHaveProperty('config');

    const denied = await listForPermissions(['project:agent_runner:read']);
    expect(denied.body).toMatchObject({
      actions: {
        create_developer_runner: {
          operation: 'create_developer_runner',
          visible: true,
          allowed: false,
          reason_code: 'permission_denied',
          required_permissions: ['project:agent_runner:manage'],
          danger_level: 'none',
        },
      },
    });
  });

  it('does not let legacy agent manage token update Agent Runners', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Private managed runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
    });

    await expect(handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({ name: 'Should not land' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      403,
      { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' },
    );
  });

  it('allows Agent Runner manage permission to update Developer runners', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Private developer runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'draft',
    });

    await expect(handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({ name: 'Updated runner' })),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(json.mock.calls[0]?.[2]).toMatchObject({
      id: runner.id,
      name: 'Updated runner',
      kind: 'developer',
      read_only: false,
    });
  });

  it('rejects public updates and deletes for System managed runners even with manage permission', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'System managed runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
    });

    const updateJson = vi.fn();
    await expect(handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json: updateJson,
      readBody: vi.fn(async () => ({ name: 'Should not land' })),
    })).resolves.toBe(true);
    expect(updateJson).toHaveBeenCalledWith(
      expect.anything(),
      403,
      { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' },
    );

    const deleteJson = vi.fn();
    await expect(handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json: deleteJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(deleteJson).toHaveBeenCalledWith(
      expect.anything(),
      403,
      { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' },
    );
  });

  it('deletes Developer runners with 204 and no response body', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Delete no content runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'draft',
    });
    const json = vi.fn();
    const res = { statusCode: 0, end: vi.fn() };

    await expect(handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: res as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledWith();
    await expect(deps.agentResourceService.getAgent('ws_default', projectId, runner.id)).resolves.toBeNull();
  });

  it('returns execution config with canonical agent_runner_id instead of legacy agent_id', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Config runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
      execution_preferences_json: {
        agent_task: {
          endpoint_id: 'ep_default',
          wire_api: 'openai_responses',
        },
      },
    });

    await expect(handleAgentRoute({
      route: { kind: 'agentExecutionConfig', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(body).toMatchObject({
      project_id: projectId,
      agent_runner_id: runner.id,
      execution_preferences: {
        agent_task: {
          endpoint_id: 'ep_default',
          wire_api: 'openai_responses',
        },
      },
      schema_version: 1,
    });
    expect(body).not.toHaveProperty('agent_id');
  });

  it('returns key payloads with canonical agent_runner_id instead of legacy agent_id', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Key runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'draft',
    });

    await expect(handleAgentRoute({
      route: { kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const createdBody = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(createdBody).toMatchObject({
      agent_runner_id: runner.id,
      key: expect.stringMatching(/^ask_/),
      key_prefix: expect.any(String),
    });
    expect(createdBody).not.toHaveProperty('agent_id');

    json.mockClear();
    await expect(handleAgentRoute({
      route: { kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const listBody = json.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>> };
    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(listBody.items?.[0]).toMatchObject({
      agent_runner_id: runner.id,
      key_prefix: expect.any(String),
    });
    expect(listBody.items?.[0]).not.toHaveProperty('agent_id');
  });

  it('rejects System managed connection-info and key lifecycle routes even with manage permission', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'System managed key runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
    });

    for (const [route, method] of [
      [{ kind: 'agentConnectionInfo', workspaceId: 'ws_default', projectId, agentId: runner.id }, 'GET'],
      [{ kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id }, 'GET'],
      [{ kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id }, 'POST'],
      [{ kind: 'agentKeyItem', workspaceId: 'ws_default', projectId, agentId: runner.id, keyId: 'agk_legacy' }, 'DELETE'],
    ] as const) {
      const json = vi.fn();
      await expect(handleAgentRoute({
        route: route as never,
        method,
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        403,
        { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' },
      );
    }
  });

  it('returns metadata-only key lists after key rotation without exposing raw keys', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Rotating developer key runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'draft',
    });
    const disconnectSpy = vi.spyOn(deps.agentExecutionService, 'disconnectAgentRunner');

    const issueFirst = vi.fn();
    await handleAgentRoute({
      route: { kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json: issueFirst,
      readBody: vi.fn(),
    });
    const firstBody = issueFirst.mock.calls[0]?.[2] as { id: string; key: string };

    await handleAgentRoute({
      route: { kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    });
    const secondBody = json.mock.calls[0]?.[2] as { id: string; key: string; expires_at?: string };
    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(disconnectSpy).toHaveBeenCalledWith(runner.id, 'agent_key_rotated');
    expect(secondBody).toMatchObject({
      agent_runner_id: runner.id,
      key: expect.stringMatching(/^ask_/),
      expires_at: expect.any(String),
    });

    json.mockClear();
    await handleAgentRoute({
      route: { kind: 'agentKeys', workspaceId: 'ws_default', projectId, agentId: runner.id },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    });

    const listBody = json.mock.calls[0]?.[2] as { items: Array<Record<string, unknown>> };
    expect(listBody.items.filter((item) => item.status === 'active')).toHaveLength(1);
    expect(listBody.items).toContainEqual(expect.objectContaining({
      id: firstBody.id,
      status: 'revoked',
    }));
    expect(listBody.items).toContainEqual(expect.objectContaining({
      id: secondBody.id,
      status: 'active',
      expires_at: secondBody.expires_at,
    }));
    expect(JSON.stringify(listBody)).not.toContain(firstBody.key);
    expect(JSON.stringify(listBody)).not.toContain(secondBody.key);
    expect(listBody.items[0]).not.toHaveProperty('key_hash');

    const auditEvents = await listAuditEvents(deps.docStore, {
      workspaceId: 'ws_default',
      projectId,
      action: 'agent_runner.key.issue',
      startTime: '1970-01-01T00:00:00.000Z',
      endTime: '2999-12-31T23:59:59.999Z',
      page: 1,
      pageSize: 10,
      sortOrder: 'asc',
    });
    const auditPayload = JSON.stringify(auditEvents.items);
    expect(auditPayload).toContain('key_prefix');
    expect(auditPayload).not.toContain(firstBody.key);
    expect(auditPayload).not.toContain(secondBody.key);
    expect(auditPayload).not.toContain('key_hash');
  });

  it('revokes Developer runner keys with 204 and no response body', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'No content key revoke runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'draft',
    });
    const keyPair = await deps.agentResourceService.createAgentKey('ws_default', projectId, runner.id);
    const json = vi.fn();
    const res = { statusCode: 0, end: vi.fn() };

    await expect(handleAgentRoute({
      route: {
        kind: 'agentKeyItem',
        workspaceId: 'ws_default',
        projectId,
        agentId: runner.id,
        keyId: keyPair.record.id,
      } as never,
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: res as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledWith();
    await expect(deps.agentResourceService.listAgentKeys('ws_default', projectId, runner.id))
      .resolves.toContainEqual(expect.objectContaining({
        id: keyPair.record.id,
        status: 'revoked',
      }));
  });

  it('reports Developer runner test-connection as disconnected without key or task side effects', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Offline test connection runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    const keysBefore = await deps.agentResourceService.listAgentKeys('ws_default', projectId, runner.id);
    const tasksBefore = await deps.docStore.list(notebookTasksCollection('ws_default'), { project_id: projectId });

    await expect(handleAgentRoute({
      route: { kind: 'agentTestConnection', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({
        timeout_ms: 750,
      })),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(json.mock.calls[0]?.[2]).toMatchObject({
      agent_runner_id: runner.id,
      status: 'disconnected',
      freshness: {
        state: 'missing',
      },
      errors: [
        expect.objectContaining({
          code: 'agent_runner_disconnected',
        }),
      ],
    });
    await expect(deps.agentResourceService.listAgentKeys('ws_default', projectId, runner.id))
      .resolves.toEqual(keysBefore);
    await expect(deps.docStore.list(notebookTasksCollection('ws_default'), { project_id: projectId }))
      .resolves.toEqual(tasksBefore);

    const auditEvents = await listAuditEvents(deps.docStore, {
      workspaceId: 'ws_default',
      projectId,
      action: 'agent_runner.test_connection.checked',
      startTime: '1970-01-01T00:00:00.000Z',
      endTime: '2999-12-31T23:59:59.999Z',
      page: 1,
      pageSize: 10,
      sortOrder: 'asc',
    });
    expect(auditEvents.items).toHaveLength(1);
    expect(auditEvents.items[0]).toMatchObject({
      actor_type: 'user',
      actor_id: 'user_test',
      action: 'agent_runner.test_connection.checked',
      resource_type: 'agent_runner',
      resource_id: runner.id,
      result: 'ok',
      metadata_json: {
        timeout_ms: 750,
        status: 'disconnected',
        freshness_state: 'missing',
        active_connection_count: 0,
        error_codes: ['agent_runner_disconnected'],
      },
    });
    expect(Object.keys(auditEvents.items[0]?.metadata_json ?? {}).sort()).toEqual([
      'active_connection_count',
      'error_codes',
      'freshness_state',
      'status',
      'timeout_ms',
    ]);
    const auditPayload = JSON.stringify(auditEvents.items);
    expect(auditPayload).not.toContain('ask_secret');
    expect(auditPayload).not.toContain('ws_url');
    expect(auditPayload).not.toContain('Authorization');
    expect(auditPayload).not.toContain('diagnostics');
  });

  it.each([
    ['ws_url', 'wss://example.invalid/agent?key=ask_secret'],
    ['key', 'ask_secret'],
    ['Authorization', 'Bearer ask_secret'],
    ['diagnostics', { raw: 'ask_secret diagnostics must not leak' }],
  ])('rejects unsupported test-connection field %s before connection checks', async (field, value) => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Strict test connection runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    const testConnectionSpy = vi.spyOn(deps.agentResourceService, 'testAgentConnection');

    await expect(handleAgentRoute({
      route: { kind: 'agentTestConnection', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({
        timeout_ms: 750,
        [field]: value,
      })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      400,
      {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [field],
      },
    );
    expect(testConnectionSpy).not.toHaveBeenCalled();
    const responsePayload = JSON.stringify(json.mock.calls[0]?.[2]);
    expect(responsePayload).not.toContain('ask_secret');
    expect(responsePayload).not.toContain('example.invalid');
  });

  it('disconnects the local runner socket through the execution service when test-connection finds an expired key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
      const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Expired test connection runner',
        runner_provider: 'developer',
        owner_id: 'user_owner',
        admin_id: 'user_owner',
        visibility: 'private',
        presence: 'offline',
        status: 'enabled',
        runner_status: 'ready',
        capabilities: { task_execution: true },
      });
      const keyPair = await deps.agentResourceService.createAgentKey('ws_default', projectId, runner.id);
      const expiredKeyRecord = {
        ...keyPair.record,
        expires_at: '2026-05-05T00:00:00.000Z',
      };
      await deps.docStore.upsert(
        resolveWorkspaceScopedCollection('agent_service_keys', 'ws_default'),
        keyPair.record.id,
        expiredKeyRecord,
      );
      await deps.agentResourceService.registerAgentConnection({
        agentId: runner.id,
        workspaceId: 'ws_default',
        projectId,
        connectionId: 'conn_test_connection_expired',
        socketKey: runner.id,
        apiInstanceId: 'api_test',
        protocolVersion: '1.0',
        lastPongAt: '2026-05-05T00:00:00.000Z',
        authenticatedKey: {
          kind: 'service_key',
          keyId: keyPair.record.id,
          expiresAt: expiredKeyRecord.expires_at,
        },
      });
      vi.setSystemTime(new Date('2026-05-05T00:00:01.000Z'));
      const onlineSpy = vi.spyOn(deps.agentExecutionService, 'getAgentOnlineState').mockReturnValue(true);
      const disconnectSpy = vi.spyOn(deps.agentExecutionService, 'disconnectAgentRunner').mockReturnValue(1);
      const json = vi.fn();

      await expect(handleAgentRoute({
        route: { kind: 'agentTestConnection', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(async () => ({ timeout_ms: 750 })),
      })).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(200);
      expect(json.mock.calls[0]?.[2]).toMatchObject({
        agent_runner_id: runner.id,
        status: 'stale',
        freshness: {
          state: 'stale',
          active_connection_count: 0,
        },
      });
      expect(onlineSpy).toHaveBeenCalledWith(runner.id);
      expect(disconnectSpy).toHaveBeenCalledWith(runner.id, 'agent_key_expired');
      await expect(deps.agentResourceService.getConnectionInfo(runner.id)).resolves.toBeNull();
      const body = json.mock.calls[0]?.[2] as {
        cleanup?: {
          key_expiry?: Record<string, unknown>;
        };
      };
      expect(body.cleanup?.key_expiry).toMatchObject({
        workspace_id: 'ws_default',
        project_id: projectId,
        agent_runner_id: runner.id,
        key_id: keyPair.record.id,
        key_prefix: keyPair.record.key_prefix,
        expires_at: '2026-05-05T00:00:00.000Z',
        cleanup_result: 'marked_expired',
        disconnected: true,
      });
      const auditEvents = await listAuditEvents(deps.docStore, {
        workspaceId: 'ws_default',
        projectId,
        action: 'agent_runner.connection_key.expired',
        startTime: '1970-01-01T00:00:00.000Z',
        endTime: '2999-12-31T23:59:59.999Z',
        page: 1,
        pageSize: 10,
        sortOrder: 'asc',
      });
      expect(auditEvents.items).toHaveLength(1);
      expect(auditEvents.items[0]).toMatchObject({
        actor_type: 'agent',
        actor_id: runner.id,
        action: 'agent_runner.connection_key.expired',
        resource_type: 'agent_runner',
        resource_id: runner.id,
        result: 'ok',
        metadata_json: {
          workspace_id: 'ws_default',
          project_id: projectId,
          agent_runner_id: runner.id,
          key_id: keyPair.record.id,
          key_prefix: keyPair.record.key_prefix,
          expires_at: '2026-05-05T00:00:00.000Z',
          cleanup_result: 'marked_expired',
          disconnected: true,
        },
      });
      const auditPayload = JSON.stringify(auditEvents.items);
      expect(auditPayload).not.toContain(keyPair.key);
      expect(auditPayload).not.toContain('key_hash');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects System managed runners on Developer runner test-connection', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
    const json = vi.fn();
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'System managed test connection runner',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
    });

    await expect(handleAgentRoute({
      route: { kind: 'agentTestConnection', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({})),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      403,
      { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' },
    );
  });

  it('keeps Developer Test connection available while gating test-task dispatch by fresh connection', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    const offlineRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Offline ready developer runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    const liveRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Live ready developer runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    await deps.agentResourceService.registerAgentConnection({
      agentId: liveRunner.id,
      workspaceId: 'ws_default',
      projectId,
      connectionId: 'conn_live_runner',
      socketKey: liveRunner.id,
      apiInstanceId: 'api_test',
      protocolVersion: '1.0',
      lastPongAt: '2026-05-05T00:00:00.000Z',
    });

    const offlineJson = vi.fn();
    await handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: offlineRunner.id },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json: offlineJson,
      readBody: vi.fn(),
    });
    expect(offlineJson.mock.calls[0]?.[2]).toMatchObject({
      actions: {
        test_connection: expect.objectContaining({
          allowed: true,
        }),
        run_test_task: expect.objectContaining({
          allowed: false,
          reason_code: 'agent_runner_disconnected',
        }),
      },
    });

    const liveJson = vi.fn();
    await handleAgentRoute({
      route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: liveRunner.id },
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json: liveJson,
      readBody: vi.fn(),
    });
    expect(liveJson.mock.calls[0]?.[2]).toMatchObject({
      actions: {
        test_connection: expect.objectContaining({ allowed: true }),
        run_test_task: expect.objectContaining({
          allowed: true,
        }),
      },
    });
  });

  it('creates standard runner_test task/run evidence and dispatches the route runner', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    try {
      const defaultEndpoint = await createRunnerEndpoint(deps, projectId, 'ordinary default endpoint');
      const defaultRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Ordinary default should not receive test dispatch',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: defaultEndpoint.id,
        capabilities: { task_execution: true, artifacts: true },
      });
      await seedAgentTaskModelSetting(deps, projectId, defaultEndpoint.id);
      const { runner } = await createConnectedDeveloperRunner(deps, projectId);
      const streamGate = createDeferred<void>();
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_runner_test_dispatch',
        cancel: vi.fn(),
        stream: (async function* () {
          await streamGate.promise;
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;
      const json = vi.fn();

      await expect(handleAgentRoute({
        route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
        method: 'POST',
        req: { headers: { 'x-request-id': 'req_runner_test_http' }, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' } as never,
        json,
        readBody: vi.fn(async () => ({ intent: 'Run a safe self-check with token sk-should-not-leak' })),
      })).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(202);
      const body = json.mock.calls[0]?.[2] as { task_id: string; run_id: string; resolved_runner_id: string };
      expect(body).toMatchObject({
        runner_test: true,
        status: 'accepted',
        task_id: expect.stringMatching(/^task_/),
        run_id: expect.stringMatching(/^run_/),
        resolved_runner_id: runner.id,
      });
      expect(body).not.toHaveProperty('selection');
      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: runner.id,
            sessionId: body.task_id,
            executionContext: expect.objectContaining({
              task_id: body.task_id,
              run_id: body.run_id,
              runner_id: runner.id,
            }),
          }),
        );
      });
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalledWith(
        expect.objectContaining({ agentId: defaultRunner.id }),
      );

      const task = await deps.docStore.get<Record<string, unknown>>(notebookTasksCollection('ws_default'), body.task_id);
      expect(task).toMatchObject({
        id: body.task_id,
        project_id: projectId,
        owner_user_id: 'user_test',
        source: 'runner_test',
        runner_test: true,
        bound_runner_id: runner.id,
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
        bound_at: expect.any(String),
        bound_by_user_id: 'user_test',
      });
      expect(task).not.toHaveProperty('runner_selection');
      expect(task).not.toHaveProperty('runner_id');

      const runState = await getNotebookTaskRunState(deps.cache, body.task_id);
      expect(runState).toMatchObject({
        task_id: body.task_id,
        run_id: body.run_id,
        runner_id: runner.id,
        resolved_runner_id: runner.id,
        runner_test: true,
      });
      expect(runState).not.toHaveProperty('selection');

      const taskRouteUser = { id: 'user_test', email: 'user_test@example.com', name: 'Test User' } as never;
      const listJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId } as never,
        method: 'GET',
        req: { headers: {}, url: 'http://localhost/api/v1/workspaces/ws_default/projects/test/tasks?page=1&page_size=10' } as never,
        res: {} as never,
        deps,
        user: taskRouteUser,
        json: listJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const listBody = listJson.mock.calls[0]?.[2] as { items: Array<Record<string, unknown>> };
      expect(listBody.items.find((item) => item.id === body.task_id)).toMatchObject({
        id: body.task_id,
        source: 'runner_test',
        runner_test: true,
        bound_runner_id: runner.id,
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
        active_run: expect.objectContaining({
          id: body.run_id,
          runner_id: runner.id,
          source: 'runner_test',
          runner_test: true,
        }),
      });

      const getJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'taskItem', workspaceId: 'ws_default', projectId, taskId: body.task_id } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: taskRouteUser,
        json: getJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      expect(getJson.mock.calls[0]?.[2]).toMatchObject({
        id: body.task_id,
        source: 'runner_test',
        runner_test: true,
        bound_runner_id: runner.id,
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
        active_run: expect.objectContaining({
          id: body.run_id,
          source: 'runner_test',
          runner_test: true,
        }),
      });

      const activityJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'taskActivity', workspaceId: 'ws_default', projectId, taskId: body.task_id } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: taskRouteUser,
        json: activityJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const activityBody = activityJson.mock.calls[0]?.[2] as Array<Record<string, unknown>>;
      expect(activityBody).toEqual(expect.arrayContaining([
        expect.objectContaining({
          task_id: body.task_id,
          source: 'runner_test',
          runner_test: true,
        }),
        expect.objectContaining({
          task_id: body.task_id,
          run_id: body.run_id,
          source: 'runner_test',
          runner_test: true,
        }),
      ]));
      const messages = await deps.docStore.list<Record<string, unknown>>(
        notebookTaskMessagesCollection('ws_default'),
        { task_id: body.task_id },
      );
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('AGENTSMITH_RUNNER_TEST_OK') }),
        expect.objectContaining({ role: 'agent', turn_id: body.run_id }),
      ]));
      expect(JSON.stringify(messages)).not.toContain('sk-should-not-leak');

      streamGate.resolve();
      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, body.task_id)).toBeNull();
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it.each([
    ['task_id'],
    ['runner_selection'],
    ['agent_id'],
    ['runner_id'],
    ['input_refs'],
    ['workspace_file_library_id'],
  ])('rejects ordinary launcher field %s on Developer runner test-task-runs', async (field) => {
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    const { runner } = await createConnectedDeveloperRunner(deps, projectId);
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test', email: 'user_test@example.com' } as never,
      json,
      readBody: vi.fn(async () => ({
        intent: 'Run test',
        [field]: field === 'runner_selection'
          ? { mode: 'explicit', agent_runner_id: runner.id }
          : 'ordinary-launcher-field',
      })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      400,
      {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [field],
      },
    );
    await expect(deps.docStore.list(notebookTasksCollection('ws_default'), { project_id: projectId }))
      .resolves.toEqual([]);
  });

  it.each([
    [['project:agent_task:use'], ['project:agent_runner:manage']],
    [[], ['project:agent_runner:manage']],
  ])('requires runner manage in addition to member task use for Developer runner test-task-runs', async (permissions, missing) => {
    const { deps, projectId } = await createProjectWithMemberPermissions(permissions);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Permission gated test task runner',
      runner_provider: 'developer',
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'offline',
      status: 'enabled',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test' } as never,
      json,
      readBody: vi.fn(async () => ({})),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      403,
      {
        error_code: 'FORBIDDEN',
        message: 'agent_test_task_forbidden',
        missing_permissions: missing,
      },
    );
  });

  it('rejects System managed runners on Developer runner test-task-runs', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'System managed test task runner',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      capabilities: { task_execution: true },
    });
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test', email: 'user_test@example.com' } as never,
      json,
      readBody: vi.fn(async () => ({ intent: 'Run test' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      403,
      { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' },
    );
  });

  it.each([
    [
      'capability mismatch',
      async (deps: ReturnType<typeof createDefaultNodeApiDeps>, projectId: string) =>
        createConnectedDeveloperRunner(deps, projectId, {
          name: 'No task execution runner',
          capabilities: { task_execution: false },
        }),
      'agent_runner_capability_mismatch',
    ],
    [
      'disconnected',
      async (deps: ReturnType<typeof createDefaultNodeApiDeps>, projectId: string) => ({
        runner: await deps.agentResourceService.createAgent('ws_default', projectId, {
          name: 'Disconnected runner',
          runner_provider: 'developer',
          owner_id: 'user_owner',
          admin_id: 'user_owner',
          visibility: 'private',
          presence: 'offline',
          status: 'enabled',
          runner_status: 'ready',
          capabilities: { task_execution: true },
        }),
      }),
      'agent_runner_disconnected',
    ],
    [
      'stale',
      async (deps: ReturnType<typeof createDefaultNodeApiDeps>, projectId: string) => {
        const runner = await deps.agentResourceService.createAgent('ws_default', projectId, {
          name: 'Stale runner',
          runner_provider: 'developer',
          owner_id: 'user_owner',
          admin_id: 'user_owner',
          visibility: 'private',
          presence: 'offline',
          status: 'enabled',
          runner_status: 'ready',
          capabilities: { task_execution: true },
        });
        await deps.agentResourceService.updateAgent('ws_default', projectId, runner.id, {
          last_seen_at: '2026-05-04T00:00:00.000Z',
        });
        return {
          runner: (await deps.agentResourceService.getAgent('ws_default', projectId, runner.id)) ?? runner,
        };
      },
      'agent_runner_stale',
    ],
    [
      'not ready',
      async (deps: ReturnType<typeof createDefaultNodeApiDeps>, projectId: string) =>
        createConnectedDeveloperRunner(deps, projectId, {
          name: 'Draft runner',
          runnerStatus: 'draft',
        }),
      'agent_runner_test_task_unavailable',
    ],
  ])('fails closed with no task for %s Developer runner test-task-runs', async (_name, setupRunner, errorCode) => {
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_should_not_dispatch_runner_test',
      cancel: vi.fn(),
      stream: (async function* () {})(),
    })) as never;
    const { runner } = await setupRunner(deps, projectId);
    const tasksBefore = await deps.docStore.list(notebookTasksCollection('ws_default'), { project_id: projectId });
    const json = vi.fn();

    await expect(handleAgentRoute({
      route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_test', email: 'user_test@example.com' } as never,
      json,
      readBody: vi.fn(async () => ({ intent: 'Run a safe self-check' })),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(409);
    const responseBody = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(responseBody).toMatchObject({
      error_code: errorCode,
      runner_test: true,
      status: 'not_started',
      resolved_runner_id: runner.id,
    });
    expect(responseBody).not.toHaveProperty('selection');
    expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
    await expect(deps.docStore.list(notebookTasksCollection('ws_default'), { project_id: projectId }))
      .resolves.toEqual(tasksBefore);
  });

  it('audits runner test task request and accepted events with redacted metadata and no preference side effects', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { deps, projectId } = await createProjectWithMemberPermissions([
      'project:agent_runner:manage',
      'project:agent_task:use',
    ]);
    try {
      const { endpoint, runner } = await createConnectedDeveloperRunner(deps, projectId);
      await seedAgentTaskModelSetting(deps, projectId, endpoint.id);
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_runner_test_redacted',
        cancel: vi.fn(),
        stream: (async function* () {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;
      const json = vi.fn();

      await expect(handleAgentRoute({
        route: { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId, agentId: runner.id } as never,
        method: 'POST',
        req: { headers: { 'x-request-id': 'req_runner_test_redacted_http' }, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test', email: 'user_test@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ intent: 'secret token sk-live-secret should not leak' })),
      })).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(202);
      const body = json.mock.calls[0]?.[2] as { task_id: string; run_id: string };
      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, body.task_id)).toBeNull();
      });

      const auditEvents = await listAuditEvents(deps.docStore, {
        workspaceId: 'ws_default',
        projectId,
        startTime: '1970-01-01T00:00:00.000Z',
        endTime: '2999-12-31T23:59:59.999Z',
        page: 1,
        pageSize: 50,
        sortOrder: 'asc',
      });
      const runnerTestEvents = auditEvents.items.filter((item) => item.action.startsWith('agent_runner.test_task.'));
      expect(runnerTestEvents.map((item) => item.action)).toEqual(expect.arrayContaining([
        'agent_runner.test_task.requested',
        'agent_runner.test_task.accepted',
      ]));
      expect(JSON.stringify(runnerTestEvents)).not.toContain('sk-live-secret');
      expect(JSON.stringify(runnerTestEvents)).not.toContain('secret token');
      expect(runnerTestEvents).toContainEqual(expect.objectContaining({
        action: 'agent_runner.test_task.accepted',
        metadata_json: expect.objectContaining({
          runner_test: true,
          task_id: body.task_id,
          run_id: body.run_id,
          resolved_runner_id: runner.id,
          bound_runner_id: runner.id,
          bound_runner_kind: 'developer',
          runner_binding_source: 'explicit',
          intent_present: true,
        }),
      }));
      const acceptedEvent = runnerTestEvents.find((item) => item.action === 'agent_runner.test_task.accepted');
      expect(acceptedEvent?.metadata_json).not.toHaveProperty('selection');
      const storedRunner = await deps.agentResourceService.getAgent('ws_default', projectId, runner.id);
      expect(storedRunner).toMatchObject({
        is_default: false,
      });
      expect(storedRunner?.execution_preferences_json).toBeUndefined();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });
});
