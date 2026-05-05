import { describe, expect, it } from 'vitest';
import { apiFetchWithToken, startServerWithDeps } from './test-support.js';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from '../project-member-governance-persistence.js';

describe('api-entry-node agent permissions integration', () => {
  it('lets read-scoped members list Agent Runners but blocks management routes', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: `Agent Runner Read ${Math.random().toString(16).slice(2)}`,
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
      project_id: project.id,
      user_id: 'user_test',
      user_email: 'test@example.com',
      user_name: 'Test User',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(
      deps.docStore,
      'ws_default',
      project.id,
      'user_test',
      {
        mode: 'custom',
        template: null,
        permissions: ['project:agent_runner:read'],
      },
    );
    const agentRunnerPath = `/api/v1/workspaces/ws_default/projects/${project.id}/agent-runners`;
    const created = await deps.agentResourceService.createAgent('ws_default', project.id, {
      name: 'Managed Agent Runner',
      runner_provider: 'managed',
      status: 'enabled',
      runner_status: 'ready',
      owner_id: 'user_owner',
      visibility: 'public',
      default_endpoint_id: 'ep_default',
      capabilities: {
        task_execution: true,
        terminal: true,
      },
    });

    const listRes = await apiFetchWithToken(
      baseUrl,
      agentRunnerPath,
      'test-token',
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.some((item) => item.id === created.id)).toBe(true);

    const patchRes = await apiFetchWithToken(
      baseUrl,
      `${agentRunnerPath}/${created.id}`,
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
      `${agentRunnerPath}/${created.id}/keys`,
      'test-token',
      { method: 'POST' },
    );
    expect(keyRes.status).toBe(403);

    const deleteRes = await apiFetchWithToken(
      baseUrl,
      `${agentRunnerPath}/${created.id}`,
      'test-token',
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(403);
  });
});
