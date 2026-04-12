// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { contextHandlers } from '@/mocks/handlers/context';

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
  it('allows active project members to store and read project_member context', async () => {
    const putRes = await fetch('http://localhost/api/v1/context', {
      method: 'PUT',
      headers: authHeaders('mock_token_user_001_scope'),
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        content: 'uec_project_1',
        content_type: 'text',
      }),
    });

    expect(putRes.status).toBe(200);
    await expect(putRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      user_id: 'user_001',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
    });

    const getRes = await fetch('http://localhost/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_001', {
      headers: authHeaders('mock_token_user_001_scope'),
    });
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      user_id: 'user_001',
    });
  });

  it('returns 404 for non-members when reading project_member context', async () => {
    const res = await fetch('http://localhost/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_001', {
      headers: authHeaders('mock_token_user_009_scope'),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });
  });

  it('returns 404 for inactive members when reading or writing project_member context', async () => {
    const readRes = await fetch('http://localhost/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=proj_001', {
      headers: authHeaders('mock_token_user_005_scope'),
    });
    expect(readRes.status).toBe(404);
    await expect(readRes.json()).resolves.toEqual({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });

    const writeRes = await fetch('http://localhost/api/v1/context', {
      method: 'PUT',
      headers: authHeaders('mock_token_user_005_scope'),
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
        content: 'uec_project_2',
        content_type: 'text',
      }),
    });

    expect(writeRes.status).toBe(404);
    await expect(writeRes.json()).resolves.toEqual({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });
  });
});
