import { describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from './index.js';
import { handleAgentRoute, resolveAgentPresenceForApi } from './agent-route-handler.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';

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

  it('returns Agent Runner readiness shape without exposing old mode/runtime/workload fields', async () => {
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
        name: 'Managed task runner',
        description: 'Default task runner',
        is_default: true,
        status: 'ready',
        default_endpoint_id: 'ep_default',
        capabilities: {
          terminal: true,
          artifacts: true,
        },
      })),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(body).toMatchObject({
      name: 'Managed task runner',
      is_default: true,
      status: 'ready',
      default_endpoint_id: 'ep_default',
      capabilities: {
        terminal: true,
        artifacts: true,
      },
      diagnostics: expect.any(Object),
    });
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('runner_runtime');
    expect(body).not.toHaveProperty('interaction_kind');
  });

  it('generates managed Agent Runner private runtime config without exposing it through public API', async () => {
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

      await expect(handleAgentRoute({
        route: { kind: 'agents', workspaceId: 'ws_default', projectId },
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(async () => ({
          name: 'Managed private runtime runner',
          status: 'ready',
          default_endpoint_id: 'ep_default',
        })),
      })).resolves.toBe(true);

      const createdBody = json.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(json.mock.calls[0]?.[1]).toBe(201);
      expect(createdBody).toMatchObject({
        name: 'Managed private runtime runner',
        status: 'ready',
        default_endpoint_id: 'ep_default',
      });
      expect(createdBody).not.toHaveProperty('config');
      expect(createdBody).not.toHaveProperty('mode');
      expect(createdBody).not.toHaveProperty('runner_runtime');
      expect(createdBody).not.toHaveProperty('interaction_kind');

      const stored = await deps.agentResourceService.getAgent(
        'ws_default',
        projectId,
        String(createdBody.id),
      );
      expect(stored?.config).toEqual(expect.objectContaining({
        image: 'agentsmith-agent-task-runner:test',
        _internal_key_id: expect.stringMatching(/^agk_/),
        _internal_raw_key: expect.stringMatching(/^ask_/),
      }));
      const internalRawKey = stored?.config?._internal_raw_key;
      expect(typeof internalRawKey).toBe('string');
      const verifiedInternalKey = await deps.agentResourceService.verifyAgentKey(
        String(createdBody.id),
        internalRawKey ?? '',
      );
      expect(verifiedInternalKey).toMatchObject({
        workspace_id: 'ws_default',
        project_id: projectId,
        agent_id: createdBody.id,
        status: 'active',
      });

      json.mockClear();
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
      const listed = listBody.items?.find((item) => item.id === createdBody.id);
      expect(listed).toBeTruthy();
      expect(listed).not.toHaveProperty('config');

      json.mockClear();
      await expect(handleAgentRoute({
        route: { kind: 'agentItem', workspaceId: 'ws_default', projectId, agentId: String(createdBody.id) },
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_test' } as never,
        json,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const itemBody = json.mock.calls[0]?.[2] as Record<string, unknown>;
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
        fields: ['config.image', 'config._internal_raw_key'],
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

  it('allows Agent Runner manage permission to update private project runners', async () => {
    const { deps, projectId } = await createProjectWithMemberPermissions(['project:agent_runner:manage']);
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
      readBody: vi.fn(async () => ({ name: 'Updated runner' })),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(200);
    expect(json.mock.calls[0]?.[2]).toMatchObject({ id: runner.id, name: 'Updated runner' });
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
      owner_id: 'user_owner',
      admin_id: 'user_owner',
      visibility: 'private',
      presence: 'managed',
      status: 'enabled',
      runner_status: 'ready',
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
});
