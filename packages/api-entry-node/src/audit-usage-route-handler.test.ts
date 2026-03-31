import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type http from 'node:http';

import type { NodeApiDeps } from './node-api-deps.js';
import type { ProjectsRoute } from './projects-route-match.js';
import type { AuthenticatedUser } from './auth.js';
import { handleAuditUsageRoute } from './audit-usage-route-handler.js';
import { recordUsageFact } from './audit-usage-store.js';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';

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

  it('forces limits and record summaries to the current user', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_usage_scope';
    const projectId = 'proj_usage_scope';
    const now = new Date().toISOString();

    await recordUsageFact(docStore, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_scope',
      end_user_id: 'user_real',
      requests: 2,
      result: 'ok',
      request_id: 'req_scope_1',
      metadata_json: { provider: 'openai', resolved_model: 'model-a', estimated_cost: 0.02 },
    });
    await recordUsageFact(docStore, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_scope',
      end_user_id: 'user_other',
      requests: 7,
      result: 'ok',
      request_id: 'req_scope_2',
      metadata_json: { provider: 'openai', resolved_model: 'model-b', estimated_cost: 0.07 },
    });
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_scope',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_5_hours', value: 6000 }],
      },
    });

    let observedStatus = 0;
    let observedPayload: unknown = null;
    const json = (_res: http.ServerResponse, status: number, payload: unknown) => {
      observedStatus = status;
      observedPayload = payload;
    };
    const deps = {
      docStore,
      endpointResourceService: {
        listEndpoints: async () => [{ id: 'ep_scope', name: 'Scoped Endpoint' }],
      },
    } as unknown as NodeApiDeps;

    await expect(handleAuditUsageRoute({
      route: { kind: 'limitsSummary', workspaceId, projectId } as ProjectsRoute,
      method: 'GET',
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${workspaceId}/projects/${projectId}/limits/summary`),
      res: {} as http.ServerResponse,
      json,
      deps,
      user: { id: 'user_real', email: 'user_real@example.com', name: 'User Real' } as AuthenticatedUser,
    })).resolves.toBe(true);
    expect(observedStatus).toBe(200);
    expect(observedPayload).toMatchObject({
      endpoints: [
        expect.objectContaining({
          endpoint_id: 'ep_scope',
          limits: expect.arrayContaining([
            expect.objectContaining({
              kind: 'rate_limit',
              window: '5h',
              used: 2,
            }),
          ]),
        }),
      ],
    });

    await expect(handleAuditUsageRoute({
      route: { kind: 'usageRecordsSummary', workspaceId, projectId } as ProjectsRoute,
      method: 'GET',
      requestUrl: new URL(
        `http://localhost/api/v1/workspaces/${workspaceId}/projects/${projectId}/usage/records-summary?start_time=${encodeURIComponent(
          new Date(Date.now() - 60_000).toISOString(),
        )}&end_time=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      ),
      res: {} as http.ServerResponse,
      json,
      deps,
      user: { id: 'user_real', email: 'user_real@example.com', name: 'User Real' } as AuthenticatedUser,
    })).resolves.toBe(true);
    expect(observedStatus).toBe(200);
    expect(observedPayload).toMatchObject({
      total_requests: 2,
      provider_breakdown: [expect.objectContaining({ provider: 'openai', requests: 2 })],
    });
  });
});
