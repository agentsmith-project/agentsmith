import { beforeEach, describe, expect, it, vi } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { createUserExternalConnection } from './user-external-connections-store.js';
import { handleContextRoute } from './context-route-handler.js';
import type { ResolvedInternalTicket } from './internal-ticket-store.js';
import { putContextEntry } from './context-store.js';

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

async function executeContextRoute(params: {
  deps: NodeApiDeps;
  method: string;
  reqUrl: string;
  internalTicket?: ResolvedInternalTicket | null;
  body?: unknown;
}): Promise<TestResponse> {
  const response: TestResponse = { statusCode: 200, ended: false };
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
    deps: params.deps,
    user: { id: 'user_1', email: 'u@example.com', name: 'User One' },
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
    const content = JSON.parse((response.body as { content: string }).content);
    expect(content.display_name).toBe('workspace feishu');
    expect(content.status).toBe('reauth_required');
    expect(content.fields.access_token).toBe('workspace_token');
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
