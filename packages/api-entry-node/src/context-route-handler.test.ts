import { beforeEach, describe, expect, it, vi } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
  MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
} from '@mbos/agent-runner-contract';
import type { NodeApiDeps } from './node-api-deps.js';
import { createUserExternalConnection } from './user-external-connections-store.js';
import { handleContextRoute } from './context-route-handler.js';
import type { ResolvedInternalTicket } from './internal-ticket-store.js';
import { putContextEntry } from './context-store.js';
import { upsertProjectMembershipRecord } from './project-member-governance-persistence.js';

const { refreshFeishuOAuthMock } = vi.hoisted(() => ({
  refreshFeishuOAuthMock: vi.fn(),
}));

vi.mock('./feishu-oauth.js', () => ({
  refreshFeishuOAuth: refreshFeishuOAuthMock,
}));

type TestResponse = {
  statusCode: number;
  ended: boolean;
  body?: unknown;
};

function expectJsonObject(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function expectRequiredKeys(value: Record<string, unknown>, required: readonly string[]): void {
  for (const key of required) {
    expect(value).toHaveProperty(key);
  }
}

function expectNoRejectedSupportProjectionSemantics(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const rejected of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
    expect(serialized).not.toContain(rejected);
  }
}

function parseProjectedJsonContent(responseBody: Record<string, unknown>): Record<string, unknown> {
  expect(typeof responseBody.content).toBe('string');
  const parsed = JSON.parse(responseBody.content as string) as unknown;
  return expectJsonObject(parsed);
}

async function executeContextRoute(params: {
  deps: NodeApiDeps;
  method: string;
  reqUrl: string;
  internalTicket?: ResolvedInternalTicket | null;
  body?: unknown;
  user?: { id: string; email: string; name: string };
}): Promise<TestResponse> {
  const response: TestResponse = { statusCode: 200, ended: false };
  const deps = 'getProjectUseCase' in params.deps
    ? params.deps
    : {
        ...params.deps,
        getProjectUseCase: {
          execute: vi.fn(async () => ({
            owner_id: 'user_1',
            governance_json: {},
          })),
        },
      };
  const res = {
    statusCode: 200,
    end: (payload?: string | Buffer) => {
      response.ended = true;
      response.statusCode = res.statusCode;
      if (typeof payload === 'string') {
        try {
          response.body = JSON.parse(payload) as unknown;
        } catch {
          response.body = payload;
        }
      } else if (payload) {
        response.body = payload.toString('utf8');
      }
    },
  } as unknown as http.ServerResponse;

  await handleContextRoute({
    req: { headers: {}, url: params.reqUrl } as http.IncomingMessage,
    res,
    method: params.method,
    requestUrl: new URL(`http://localhost${params.reqUrl}`),
    deps: deps as NodeApiDeps,
    user: params.user ?? { id: 'user_1', email: 'u@example.com', name: 'User One' },
    internalTicket: params.internalTicket,
    readBody: async () => params.body ?? null,
    json: (_res, status, payload) => {
      response.statusCode = status;
      response.body = payload;
    },
  });

  return response;
}

describe('context-route-handler', () => {
  beforeEach(() => {
    refreshFeishuOAuthMock.mockReset();
  });

  it('rejects deprecated user scope for reads', async () => {
    const response = await executeContextRoute({
      deps: {
        docStore: new InMemoryJsonDocStore(),
      } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=user&key=prefs.editor&workspace_id=ws_default',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error_code: 'INVALID_REQUEST',
      message: 'context_scope_and_key_required',
    });
  });

  it('rejects deprecated user scope for writes', async () => {
    const response = await executeContextRoute({
      deps: {
        docStore: new InMemoryJsonDocStore(),
      } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'user',
        key: 'prefs.editor',
        workspace_id: 'ws_default',
        content: 'vim',
        content_type: 'text',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error_code: 'INVALID_REQUEST',
      message: 'context_scope_and_key_required',
    });
  });

  it('rejects deprecated user scope for listings', async () => {
    const response = await executeContextRoute({
      deps: {
        docStore: new InMemoryJsonDocStore(),
      } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context/list?scope=user&workspace_id=ws_default',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error_code: 'INVALID_REQUEST',
      message: 'context_scope_required',
    });
  });

  it('rejects project context deletion for agent execution tickets', async () => {
    const response = await executeContextRoute({
      deps: {
        docStore: new InMemoryJsonDocStore(),
      } as unknown as NodeApiDeps,
      method: 'DELETE',
      reqUrl: '/api/v1/context?scope=project&key=shared.prompt&workspace_id=ws_default&project_id=proj_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'chat',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_scope_read_only_for_agent',
    });
  });

  it('rejects task scope for chat agent execution tickets', async () => {
    const response = await executeContextRoute({
      deps: {
        docStore: new InMemoryJsonDocStore(),
      } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=task&key=notes.current&workspace_id=ws_default&project_id=proj_1&task_id=task_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          mode: 'chat',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_task_scope_not_available',
    });
  });

  it('allows deleting owned task context for notebook agent execution tickets', async () => {
    const docStore = new InMemoryJsonDocStore();
    await putContextEntry(docStore, {
      scope: 'task' as const,
      key: 'notes.current',
      content: 'hello',
      content_type: 'text',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
      updated_by: 'user_1',
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'DELETE',
      reqUrl: '/api/v1/context?scope=task&key=notes.current&workspace_id=ws_default&project_id=proj_1&task_id=task_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'notebook',
        },
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
  });

  it('lets notebook agent tickets read task context written through authenticated ownership', async () => {
    const docStore = new InMemoryJsonDocStore();
    await putContextEntry(docStore, {
      scope: 'task',
      key: 'notes.current',
      content: 'hello from user path',
      content_type: 'text',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
      updated_by: 'user_1',
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=task&key=notes.current&workspace_id=ws_default&project_id=proj_1&task_id=task_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'notebook',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scope: 'task',
      key: 'notes.current',
      content: 'hello from user path',
      user_id: 'user_1',
    }));
  });

  it('stores and isolates project_member context for authenticated project members', async () => {
    const docStore = new InMemoryJsonDocStore();
    const getProjectUseCase = {
      execute: vi.fn(async () => ({
        owner_id: 'user_1',
        governance_json: {},
      })),
    };
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const saveResponse = await executeContextRoute({
      deps: { docStore, getProjectUseCase } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        content: 'uec_project_1',
        content_type: 'text',
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    }));

    const readResponse = await executeContextRoute({
      deps: { docStore, getProjectUseCase } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_1',
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      content: 'uec_project_1',
    }));

    const otherUserReadResponse = await executeContextRoute({
      deps: { docStore, getProjectUseCase } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_1',
      user: { id: 'user_2', email: 'other@example.com', name: 'User Two' },
    });
    expect(otherUserReadResponse.statusCode).toBe(404);
    expect(otherUserReadResponse.body).toEqual({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });
  });

  it('lets notebook agent tickets read project_member context but not write it', async () => {
    const docStore = new InMemoryJsonDocStore();
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      content_type: 'text',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });

    const readResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'notebook',
        },
      },
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      user_id: 'user_1',
    }));

    const writeResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        content: 'uec_project_2',
        content_type: 'text',
      },
      internalTicket: {
        ticket: 'int_test_write',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'notebook',
        },
      },
    });
    expect(writeResponse.statusCode).toBe(403);
    expect(writeResponse.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_scope_read_only_for_agent',
    });
  });

  it('stores project-member Feishu bindings through the context API', async () => {
    const docStore = new InMemoryJsonDocStore();

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'project_member',
        key: 'managed_credential_bindings.feishu',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        content: JSON.stringify({
          provider: 'feishu',
          connection_id: 'uec_project_member',
        }),
        content_type: 'json',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    }));
  });

  it('prefers workspace-scoped managed credentials even when reauth is required', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace feishu',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'workspace_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: null,
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'global feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'global_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=member&key=managed_credentials.feishu&workspace_id=ws_default',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scope: 'member',
      key: 'managed_credentials.feishu',
    }));
    const responseBody = expectJsonObject(response.body);
    expectRequiredKeys(responseBody, CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA.required);

    const content = parseProjectedJsonContent(responseBody);
    expectRequiredKeys(content, MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA.required);
    expect(Object.keys(content).sort()).toEqual(
      [...MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA.required].sort(),
    );
    const fields = expectJsonObject(content.fields);
    const provenance = expectJsonObject(content.provenance);
    expect(content.display_name).toBe('workspace feishu');
    expect(content.status).toBe('reauth_required');
    expect(fields.access_token).toBe('workspace_token');
    expect(provenance.source).toBe('workspace_active_connection');
    expectNoRejectedSupportProjectionSemantics({ response: response.body, content });
  });

  it('falls back to the global active managed credential projection when the workspace has no match', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_other',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'other workspace feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'other_workspace_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: null,
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'global feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'global_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=member&key=managed_credentials.feishu&workspace_id=ws_default',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scope: 'member',
      key: 'managed_credentials.feishu',
    }));
    const content = JSON.parse((response.body as { content: string }).content) as {
      display_name: string;
      workspace_id: string | null;
      provenance?: { source?: string };
      fields: { access_token: string };
    };
    expect(content.display_name).toBe('global feishu');
    expect(content.workspace_id).toBeNull();
    expect(content.provenance?.source).toBe('workspace_active_connection');
    expect(content.fields.access_token).toBe('global_token');
  });

  it('prefers project-member managed credential bindings over member defaults', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project binding',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'project_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await putContextEntry(docStore, {
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: memberConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      updated_by: 'user_1',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=member&key=managed_credentials.feishu&workspace_id=ws_default&project_id=proj_1',
    });

    expect(response.statusCode).toBe(200);
    const content = JSON.parse((response.body as { content: string }).content) as {
      display_name: string;
      provenance?: { source?: string };
      fields: { access_token: string };
    };
    expect(content.display_name).toBe('project binding');
    expect(content.provenance?.source).toBe('project_member_binding');
    expect(content.fields.access_token).toBe('project_token');
  });

  it('ignores project-member managed credential bindings on reads when membership is not active', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project binding',
      status: 'active',
      fields: [{ key: 'access_token', value: 'project_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'pending',
      joined_at: new Date().toISOString(),
    });
    await putContextEntry(docStore, {
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: memberConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      updated_by: 'user_1',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=member&key=managed_credentials.feishu&workspace_id=ws_default&project_id=proj_1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      scope: 'member',
      key: 'managed_credentials.feishu',
    }));
    const content = JSON.parse((response.body as { content: string }).content) as {
      display_name: string;
      provenance?: { source?: string };
    };
    expect(content.display_name).toBe('member default');
    expect(content.provenance?.source).toBe('member_binding');
  });

  it('refreshes the workspace-scoped managed credential instead of a fallback active one', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace feishu',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'workspace_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: null,
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'global feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'global_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    refreshFeishuOAuthMock.mockResolvedValueOnce({
      ...workspaceConnection,
      status: 'active',
      updated_at: '2026-04-08T00:00:00.000Z',
      fields: [{ key: 'access_token', value: 'workspace_refreshed', secret: true }],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default',
    });

    expect(refreshFeishuOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      connectionId: workspaceConnection.id,
    }));
    expect(response.statusCode).toBe(200);
  });

  it('refreshes project-member managed credentials using the project binding first', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project binding',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'project_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await putContextEntry(docStore, {
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: memberConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      updated_by: 'user_1',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });
    refreshFeishuOAuthMock.mockResolvedValueOnce({
      ...projectConnection,
      status: 'active',
      updated_at: '2026-04-08T00:00:00.000Z',
      fields: [{ key: 'access_token', value: 'project_refreshed', secret: true }],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default&project_id=proj_1',
    });

    expect(refreshFeishuOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      connectionId: projectConnection.id,
    }));
    expect(response.statusCode).toBe(200);
    const content = JSON.parse((response.body as { content: string }).content) as {
      display_name: string;
      provenance?: { source?: string };
    };
    expect(content.display_name).toBe('project binding');
    expect(content.provenance?.source).toBe('project_member_binding');
  });

  it('ignores project-member bindings on refresh when membership is not active', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project binding',
      status: 'active',
      fields: [{ key: 'access_token', value: 'project_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'suspended',
      joined_at: new Date().toISOString(),
    });
    await putContextEntry(docStore, {
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: memberConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      updated_by: 'user_1',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });
    refreshFeishuOAuthMock.mockResolvedValueOnce({
      ...memberConnection,
      updated_at: '2026-04-08T00:00:00.000Z',
      fields: [{ key: 'access_token', value: 'member_refreshed', secret: true }],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default&project_id=proj_1',
    });

    expect(refreshFeishuOAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      connectionId: memberConnection.id,
    }));
    expect(response.statusCode).toBe(200);
    const content = JSON.parse((response.body as { content: string }).content) as {
      display_name: string;
      provenance?: { source?: string };
    };
    expect(content.display_name).toBe('member default');
    expect(content.provenance?.source).toBe('member_binding');
  });

  it('rejects project-scoped managed credential refresh when an agent ticket project id mismatches', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'workspace_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default&project_id=proj_1',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_other',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'chat',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_project_scope_mismatch',
    });
    expect(refreshFeishuOAuthMock).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace managed credential refresh for agent tickets', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_other',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'other workspace feishu',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'other_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_other',
      internalTicket: {
        ticket: 'int_test',
        purpose: 'agent_execution',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        expires_at: '2099-01-01T00:00:00.000Z',
        max_uses: 1,
        remaining_uses: 1,
        payload: {
          endpoint_id: 'ep_1',
          task_id: 'task_1',
          mode: 'chat',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_workspace_scope_mismatch',
    });
    expect(refreshFeishuOAuthMock).not.toHaveBeenCalled();
  });
});
