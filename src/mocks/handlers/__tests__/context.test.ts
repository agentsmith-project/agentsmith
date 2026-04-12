import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { contextHandlers } from '../context';

const server = setupServer(...contextHandlers);

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('context mock handlers', () => {
  it('stores and isolates project_member context for the authenticated project user', async () => {
    const putRes = await fetch('http://localhost/api/v1/context', {
      method: 'PUT',
      headers: authHeaders('mock_token_user_1_scope'),
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        content: 'uec_project_1',
        content_type: 'text',
      }),
    });

    expect(putRes.status).toBe(200);
    await expect(putRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });

    const getRes = await fetch('http://localhost/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_1', {
      headers: authHeaders('mock_token_user_1_scope'),
    });
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      user_id: 'user_1',
    });

    const otherUserGetRes = await fetch('http://localhost/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_1', {
      headers: authHeaders('mock_token_user_2_scope'),
    });
    expect(otherUserGetRes.status).toBe(404);
  });
});
