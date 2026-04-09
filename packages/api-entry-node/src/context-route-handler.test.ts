import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleContextRoute } from './context-route-handler.js';
import type { ResolvedInternalTicket } from './internal-ticket-store.js';
import { putContextEntry } from './context-store.js';

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
    readBody: async () => null,
    json: (_res, status, payload) => {
      response.statusCode = status;
      response.body = payload;
    },
  });

  return response;
}

describe('context-route-handler', () => {
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

  it('allows deleting owned task context for agent execution tickets', async () => {
    const docStore = new InMemoryJsonDocStore();
    await putContextEntry(docStore, {
      scope: 'task' as const,
      key: 'notes.current',
      content: 'hello',
      content_type: 'text',
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
          mode: 'chat',
        },
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
  });
});
