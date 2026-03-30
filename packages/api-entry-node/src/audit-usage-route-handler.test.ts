import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type http from 'node:http';

import type { NodeApiDeps } from './node-api-deps.js';
import type { ProjectsRoute } from './projects-route-match.js';
import type { AuthenticatedUser } from './auth.js';
import { handleAuditUsageRoute } from './audit-usage-route-handler.js';
import { recordUsageFact } from './audit-usage-store.js';

describe('audit-usage-route-handler', () => {
  it('serves aggregated usage records for GET /usage', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_usage';
    const projectId = 'proj_usage';
    const now = new Date().toISOString();

    await recordUsageFact(docStore, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      end_user_id: 'user_real',
      requests: 1,
      tokens_total: 42,
      result: 'ok',
      request_id: 'req_usage_1',
      metadata_json: {
        provider: 'glm',
        resolved_model: 'placeholder-model',
      },
    });

    let observedStatus = 0;
    let observedPayload: unknown = null;
    const json = (_res: http.ServerResponse, status: number, payload: unknown) => {
      observedStatus = status;
      observedPayload = payload;
    };

    const handled = await handleAuditUsageRoute({
      route: { kind: 'usage', workspaceId, projectId } as ProjectsRoute,
      method: 'GET',
      requestUrl: new URL(
        `http://localhost/api/v1/workspaces/${workspaceId}/projects/${projectId}/usage?start_time=${encodeURIComponent(
          new Date(Date.now() - 60_000).toISOString(),
        )}&end_time=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&group_by=hour&page=1&page_size=25`,
      ),
      res: {} as http.ServerResponse,
      json,
      deps: { docStore } as unknown as NodeApiDeps,
      user: { id: 'user_real', email: 'user_real@example.com', name: 'User Real' } as AuthenticatedUser,
    });

    expect(handled).toBe(true);
    expect(observedStatus).toBe(200);
    expect(observedPayload).toMatchObject({
      total: 1,
      page: 1,
      page_size: 25,
      items: [
        expect.objectContaining({
          workspace_id: workspaceId,
          project_id: projectId,
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          end_user_id: 'user_real',
          requests: 1,
        }),
      ],
    });
  });
});
