import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { EndpointResourceService } from './endpoint-resource-service.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import { handleAgentTaskModelSettingRoute } from './agent-task-model-setting-route-handler.js';

type MockResponse = EventEmitter & http.ServerResponse & {
  statusCode: number;
  body?: unknown;
  headers: Map<string, string>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function response(): MockResponse {
  const res = new EventEmitter() as MockResponse;
  res.statusCode = 200;
  res.headers = new Map();
  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers.set(name.toLowerCase(), value);
    return res;
  });
  res.end = vi.fn();
  return res;
}

function request(): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage;
  req.headers = {};
  return req;
}

function json(res: http.ServerResponse, statusCode: number, body: unknown): void {
  (res as MockResponse).statusCode = statusCode;
  (res as MockResponse).body = body;
}

async function buildDeps(permissions: string[]): Promise<NodeApiDeps> {
  const docStore = new InMemoryJsonDocStore();
  const deps = {
    cache: new InMemoryCache(),
    docStore,
    endpointResourceService: new EndpointResourceService(docStore),
    getProjectUseCase: {
      execute: vi.fn(async () => ({
        id: 'proj_1',
        workspace_id: 'ws_default',
        owner_id: 'owner_1',
        governance_json: null,
      })),
    },
  } as unknown as NodeApiDeps;
  await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
    project_id: 'proj_1',
    user_id: 'user_1',
    user_email: 'user1@example.com',
    user_name: 'User 1',
    status: 'active',
    joined_at: '2026-05-07T00:00:00.000Z',
  });
  await upsertProjectMemberPermissionState(docStore, 'ws_default', 'proj_1', 'user_1', {
    mode: 'custom',
    template: null,
    permissions,
  });
  return deps;
}

async function createEndpoint(deps: NodeApiDeps) {
  const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
    name: 'agent-task-key',
    value: 'sk-agent-task',
  });
  return deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
    name: 'Production endpoint',
    model: 'gpt-5.5',
    type: 'custom',
    base_url: 'https://provider.example/v1',
    credential_ref: credential.id,
    status: 'active',
    upstream_protocol: 'openai_chat_completions',
    defaults: { chat_model_id: 'gpt-5.5' },
    capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
    models: [{ capability: 'chat_completion', model_id: 'gpt-5.5' }],
  });
}

const user: AuthenticatedUser = {
  id: 'user_1',
  email: 'user1@example.com',
  name: 'User 1',
};

describe('handleAgentTaskModelSettingRoute', () => {
  it('returns display-safe readiness only for project:agent_task:use viewers', async () => {
    const deps = await buildDeps(['project:agent_task:use', 'project:governance:update']);
    const endpoint = await createEndpoint(deps);
    await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'PATCH',
      req: request(),
      res: response(),
      deps,
      user,
      json,
      readBody: vi.fn(async () => ({ endpoint_id: endpoint.id, expected_setting_revision: null })),
    });
    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', 'proj_1', 'user_1', {
      mode: 'custom',
      template: null,
      permissions: ['project:agent_task:use'],
    });

    const res = response();
    const handled = await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'GET',
      req: request(),
      res,
      deps,
      user,
      json,
      readBody: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
    });
  });

  it('exposes setting details and update action to project:governance:update viewers', async () => {
    const deps = await buildDeps(['project:agent_task:use', 'project:governance:update']);
    const endpoint = await createEndpoint(deps);
    const patchRes = response();
    await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'PATCH',
      req: request(),
      res: patchRes,
      deps,
      user,
      json,
      readBody: vi.fn(async () => ({ endpoint_id: endpoint.id, expected_setting_revision: null })),
    });

    const res = response();
    await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'GET',
      req: request(),
      res,
      deps,
      user,
      json,
      readBody: vi.fn(),
    });

    expect(res.body).toMatchObject({
      readiness: { state: 'ready' },
      setting: {
        endpoint_id: endpoint.id,
        endpoint_display_name: 'Production endpoint',
        default_model: 'gpt-5.5',
      },
      actions: {
        update: {
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });
  });

  it('requires expected_setting_revision and rejects stale PATCH updates', async () => {
    const deps = await buildDeps(['project:agent_task:use', 'project:governance:update']);
    const endpoint = await createEndpoint(deps);
    const missingRevision = response();
    await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'PATCH',
      req: request(),
      res: missingRevision,
      deps,
      user,
      json,
      readBody: vi.fn(async () => ({ endpoint_id: endpoint.id })),
    });
    expect(missingRevision.statusCode).toBe(422);
    expect(missingRevision.body).toMatchObject({ message: 'expected_setting_revision_required' });

    const stale = response();
    await handleAgentTaskModelSettingRoute({
      route: { kind: 'agentTaskModelSetting', workspaceId: 'ws_default', projectId: 'proj_1' },
      method: 'PATCH',
      req: request(),
      res: stale,
      deps,
      user,
      json,
      readBody: vi.fn(async () => ({ endpoint_id: endpoint.id, expected_setting_revision: 'set_stale' })),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toMatchObject({ error_code: 'agent_task_model_setting_conflict' });
  });
});
