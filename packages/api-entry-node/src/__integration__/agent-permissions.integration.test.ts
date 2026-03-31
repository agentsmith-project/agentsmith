import { describe, expect, it } from 'vitest';
import { apiFetchWithToken, startServer } from './test-support.js';

describe('api-entry-node agent permissions integration', () => {
  it('lets members use agents but blocks agent management routes', async () => {
    const { baseUrl, deps } = startServer();
    const created = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'Managed Agent',
      mode: 'external',
      interaction_mode: 'both',
      status: 'enabled',
      owner_id: 'user_owner',
      visibility: 'public',
      execution_preferences_json: {
        chat: {
          endpoint_id: 'ep_default',
          wire_api: 'responses',
          model: 'placeholder-model',
        },
      },
      config: {
        _external_key_source: 'generated',
      } as never,
    });

    const listRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      'test-token',
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.some((item) => item.id === created.id)).toBe(true);

    const patchRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      'test-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'should fail' }),
      },
    );
    expect(patchRes.status).toBe(403);

    const keyRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}/keys`,
      'test-token',
      { method: 'POST' },
    );
    expect(keyRes.status).toBe(403);

    const deleteRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      'test-token',
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(403);
  });
});
