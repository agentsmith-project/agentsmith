import { describe, expect, it, vi } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleContextRoute } from './context-route-handler.js';
import type { ResolvedInternalTicket } from './internal-ticket-store.js';
import {
  getContextEntry,
  putContextEntry,
  type ContextScope,
  type ContextTarget,
} from './context-store.js';
import { upsertProjectMembershipRecord } from './project-member-governance-persistence.js';

type TestResponse = {
  statusCode: number;
  ended: boolean;
  handled: boolean;
  body?: unknown;
};

function expectJsonObject(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

async function executeContextRoute(params: {
  deps: NodeApiDeps;
  method: string;
  reqUrl: string;
  internalTicket?: ResolvedInternalTicket | null;
  body?: unknown;
  user?: { id: string; email: string; name: string };
}): Promise<TestResponse> {
  const response: TestResponse = { statusCode: 200, ended: false, handled: false };
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

  response.handled = await handleContextRoute({
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

const FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY = 'managed_credentials.legacy_projection';
const LEGACY_CREDENTIAL_PROJECTION_CONTENT = '{"fields":{"access_token":"legacy_sample_token"}}';

type NonMemberContextScope = Exclude<ContextScope, 'member'>;
type ForbiddenContextScopeCase = {
  label: string;
  scope: NonMemberContextScope;
  identifiers: Record<string, string>;
  target: ContextTarget;
};

const forbiddenNonMemberScopeCases: ForbiddenContextScopeCase[] = [
  {
    label: 'project_member',
    scope: 'project_member',
    identifiers: {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    },
    target: {
      scope: 'project_member',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    },
  },
  {
    label: 'project',
    scope: 'project',
    identifiers: {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    },
    target: {
      scope: 'project',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    },
  },
  {
    label: 'task',
    scope: 'task',
    identifiers: {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
    },
    target: {
      scope: 'task',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
    },
  },
  {
    label: 'workspace',
    scope: 'workspace',
    identifiers: {
      workspace_id: 'ws_default',
    },
    target: {
      scope: 'workspace',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      workspace_id: 'ws_default',
    },
  },
];

function createNotebookAgentTicket(): ResolvedInternalTicket {
  return {
    ticket: 'int_context_forbidden_key',
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
  };
}

function contextUrl(scopeCase: ForbiddenContextScopeCase): string {
  const params = new URLSearchParams({
    scope: scopeCase.scope,
    key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
    ...scopeCase.identifiers,
  });
  return `/api/v1/context?${params.toString()}`;
}

function contextListUrl(scopeCase: ForbiddenContextScopeCase): string {
  const params = new URLSearchParams({
    scope: scopeCase.scope,
    ...scopeCase.identifiers,
  });
  return `/api/v1/context/list?${params.toString()}`;
}

describe('context-route-handler', () => {
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
        key: 'bindings.sample.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        content: 'uec_project_1',
        content_type: 'text',
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'bindings.sample.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    }));

    const readResponse = await executeContextRoute({
      deps: { docStore, getProjectUseCase } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.sample.connection_id&workspace_id=ws_default&project_id=proj_1',
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.body).toEqual(expect.objectContaining({
      scope: 'project_member',
      key: 'bindings.sample.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      content: 'uec_project_1',
    }));

    const otherUserReadResponse = await executeContextRoute({
      deps: { docStore, getProjectUseCase } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.sample.connection_id&workspace_id=ws_default&project_id=proj_1',
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
      key: 'bindings.sample.connection_id',
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
      reqUrl: '/api/v1/context?scope=project_member&key=bindings.sample.connection_id&workspace_id=ws_default&project_id=proj_1',
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
      key: 'bindings.sample.connection_id',
      content: 'uec_project_1',
      user_id: 'user_1',
    }));

    const writeResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'project_member',
        key: 'bindings.sample.connection_id',
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

  it('rejects writes to retired managed credential projection keys', async () => {
    const docStore = new InMemoryJsonDocStore();

    const response = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'PUT',
      reqUrl: '/api/v1/context',
      body: {
        scope: 'member',
        key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
        workspace_id: 'ws_default',
        content: '{"fields":{"access_token":"legacy"}}',
        content_type: 'json',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_managed_credentials_read_only',
    });
  });

  it('does not expose retired managed credential projections or legacy stored projection entries', async () => {
    const docStore = new InMemoryJsonDocStore();
    await putContextEntry(docStore, {
      scope: 'member',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      content: '{"fields":{"access_token":"legacy_sample_token"}}',
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      updated_by: 'user_1',
    });

    const getResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: `/api/v1/context?scope=member&key=${FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY}&workspace_id=ws_default`,
    });

    expect(getResponse.statusCode).toBe(404);
    expect(getResponse.body).toEqual({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });

    const listResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'GET',
      reqUrl: '/api/v1/context/list?scope=member&workspace_id=ws_default',
    });

    expect(listResponse.statusCode).toBe(200);
    const body = expectJsonObject(listResponse.body);
    expect(body.items).toEqual([]);
    expect(JSON.stringify(listResponse.body)).not.toContain('legacy_sample_token');

    const deleteResponse = await executeContextRoute({
      deps: { docStore } as unknown as NodeApiDeps,
      method: 'DELETE',
      reqUrl: `/api/v1/context?scope=member&key=${FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY}&workspace_id=ws_default`,
    });

    expect(deleteResponse.statusCode).toBe(403);
    expect(deleteResponse.body).toEqual({
      error_code: 'FORBIDDEN',
      message: 'context_managed_credentials_read_only',
    });
    await expect(getContextEntry(docStore, {
      scope: 'member',
      key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
      user_id: 'user_1',
      workspace_id: 'ws_default',
    })).resolves.toEqual(expect.objectContaining({
      content: '{"fields":{"access_token":"legacy_sample_token"}}',
    }));
  });

  it.each(forbiddenNonMemberScopeCases)(
    'does not expose forbidden managed credential keys in $label scope reads or listings',
    async (scopeCase) => {
      const docStore = new InMemoryJsonDocStore();
      await putContextEntry(docStore, {
        ...scopeCase.target,
        content: LEGACY_CREDENTIAL_PROJECTION_CONTENT,
        content_type: 'json',
        updated_by: 'user_1',
      });

      const getResponse = await executeContextRoute({
        deps: { docStore } as unknown as NodeApiDeps,
        method: 'GET',
        reqUrl: contextUrl(scopeCase),
        internalTicket: createNotebookAgentTicket(),
      });

      expect(getResponse.statusCode).toBe(404);
      expect(getResponse.body).toEqual({
        error_code: 'NOT_FOUND',
        message: 'context_not_found',
      });
      expect(JSON.stringify(getResponse.body)).not.toContain('legacy_sample_token');

      const listResponse = await executeContextRoute({
        deps: { docStore } as unknown as NodeApiDeps,
        method: 'GET',
        reqUrl: contextListUrl(scopeCase),
        internalTicket: createNotebookAgentTicket(),
      });

      expect(listResponse.statusCode).toBe(200);
      const body = expectJsonObject(listResponse.body);
      expect(body.items).toEqual([]);
      expect(JSON.stringify(listResponse.body)).not.toContain('legacy_sample_token');
    },
  );

  it.each(forbiddenNonMemberScopeCases)(
    'rejects writes and deletes for forbidden managed credential keys in $label scope',
    async (scopeCase) => {
      const docStore = new InMemoryJsonDocStore();

      const putResponse = await executeContextRoute({
        deps: { docStore } as unknown as NodeApiDeps,
        method: 'PUT',
        reqUrl: '/api/v1/context',
        body: {
          scope: scopeCase.scope,
          key: FORBIDDEN_MANAGED_CREDENTIAL_CONTEXT_KEY,
          ...scopeCase.identifiers,
          content: LEGACY_CREDENTIAL_PROJECTION_CONTENT,
          content_type: 'json',
        },
        internalTicket: createNotebookAgentTicket(),
      });

      expect(putResponse.statusCode).toBe(403);
      expect(putResponse.body).toEqual({
        error_code: 'FORBIDDEN',
        message: 'context_managed_credentials_read_only',
      });
      expect(JSON.stringify(putResponse.body)).not.toContain('legacy_sample_token');
      await expect(getContextEntry(docStore, scopeCase.target)).resolves.toBeNull();

      await putContextEntry(docStore, {
        ...scopeCase.target,
        content: LEGACY_CREDENTIAL_PROJECTION_CONTENT,
        content_type: 'json',
        updated_by: 'user_1',
      });

      const deleteResponse = await executeContextRoute({
        deps: { docStore } as unknown as NodeApiDeps,
        method: 'DELETE',
        reqUrl: contextUrl(scopeCase),
        internalTicket: createNotebookAgentTicket(),
      });

      expect(deleteResponse.statusCode).toBe(403);
      expect(deleteResponse.body).toEqual({
        error_code: 'FORBIDDEN',
        message: 'context_managed_credentials_read_only',
      });
      expect(JSON.stringify(deleteResponse.body)).not.toContain('legacy_sample_token');
      await expect(getContextEntry(docStore, scopeCase.target)).resolves.toEqual(expect.objectContaining({
        content: LEGACY_CREDENTIAL_PROJECTION_CONTENT,
      }));
    },
  );

  it('does not handle retired managed credential refresh routes', async () => {
    const response = await executeContextRoute({
      deps: { docStore: new InMemoryJsonDocStore() } as unknown as NodeApiDeps,
      method: 'POST',
      reqUrl: '/api/v1/context/managed-credentials/legacy_projection/refresh?workspace_id=ws_default&project_id=proj_1',
    });

    expect(response.handled).toBe(false);
    expect(response.body).toBeUndefined();
  });
});
