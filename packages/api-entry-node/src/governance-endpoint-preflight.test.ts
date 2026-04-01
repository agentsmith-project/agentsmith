import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import type { EndpointRecord } from './resource-models.js';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { __resetProjectResourcePolicyRateCountersForTests } from './project-resource-policy-enforcer.js';
import { recordUsageFact, listAuditEvents, listUsageFacts } from './audit-usage-store.js';
import { enforceEndpointGovernancePreflight } from './governance-endpoint-preflight.js';

function buildEndpoint(overrides?: Partial<EndpointRecord>): EndpointRecord {
  return {
    id: 'ep_1',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    name: 'endpoint-1',
    model: 'placeholder-model',
    type: 'catalog',
    upstream_protocol: 'openai_chat_completions',
    base_url: 'https://example.com',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildDeps(docStore: InMemoryJsonDocStore): NodeApiDeps {
  return { docStore } as unknown as NodeApiDeps;
}

describe('governance-endpoint-preflight', () => {
  it('allows request and computes estimated cost per token when endpoint profile exists', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const endpoint = buildEndpoint({
      model_profile: {
        max_context_tokens: 100000,
        max_output_tokens: 8000,
        supports_file: true,
        supports_tool_call: true,
        supports_reasoning: true,
        price_input_per_1m: 2,
        price_output_per_1m: 4,
        cache_read_discount_ratio: 0.5,
      },
    });
    const decision = await enforceEndpointGovernancePreflight({
      deps: buildDeps(docStore),
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      endpoint,
      userId: 'user_1',
      source: 'unit_test',
    });
    expect(decision).toMatchObject({
      allowed: true,
      estimatedCostPerTokenUsd: 0.000004,
    });
  });

  it('denies access and records audit/usage evidence for allow-list rejection', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const endpoint = buildEndpoint({ id: 'ep_access' });
    await upsertProjectResourcePolicy(docStore, endpoint.workspace_id, endpoint.project_id, {
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      access_mode: 'allow_list',
      allowed_subjects: [],
    });

    const decision = await enforceEndpointGovernancePreflight({
      deps: buildDeps(docStore),
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      endpoint,
      userId: 'user_denied',
      requestId: 'req_access_denied',
      source: 'unit_test',
      recordAccessDeniedEvidence: true,
    });
    expect(decision).toMatchObject({
      allowed: false,
      statusCode: 403,
      responseBody: {
        error_code: 'RESOURCE_POLICY_DENIED',
      },
    });
    expect(decision.decisionId.startsWith('gdec_')).toBe(true);

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const audit = await listAuditEvents(docStore, {
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      startTime: start,
      endTime: end,
      action: 'resource_policy.access_denied',
      actorType: null,
      actorId: null,
      endUserId: null,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      result: 'error',
      sortOrder: 'desc',
      page: 1,
      pageSize: 10,
    });
    expect(audit.items.length).toBeGreaterThan(0);
    const auditDecisionId = audit.items[0]?.metadata_json?.decision_id;
    expect(auditDecisionId).toBe(decision.decisionId);

    const usage = await listUsageFacts(docStore, {
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      startTime: start,
      endTime: end,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      endUserId: 'user_denied',
      provider: null,
      model: null,
      result: 'error',
      errorClass: null,
    });
    const deniedUsage = usage.find((item) => item.error_code === 'RESOURCE_POLICY_DENIED');
    expect(deniedUsage).toBeDefined();
    expect(deniedUsage?.metadata_json?.decision_id).toBe(decision.decisionId);
  });

  it('denies request when endpoint minute rate limit is hit', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const endpoint = buildEndpoint({ id: 'ep_rate' });
    await upsertProjectResourcePolicy(docStore, endpoint.workspace_id, endpoint.project_id, {
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_minute', value: 1 }],
      },
    });
    await recordUsageFact(docStore, {
      workspace_id: endpoint.workspace_id,
      project_id: endpoint.project_id,
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      end_user_id: 'user_rate',
      requests: 1,
      result: 'ok',
      timestamp: new Date(Date.now() - 1_000).toISOString(),
    });

    const decision = await enforceEndpointGovernancePreflight({
      deps: buildDeps(docStore),
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      endpoint,
      userId: 'user_rate',
      requestId: 'req_rate_limited',
      source: 'unit_test',
    });
    expect(decision).toMatchObject({
      allowed: false,
      statusCode: 429,
      responseBody: {
        error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      },
    });
    expect(decision.decisionId.startsWith('gdec_')).toBe(true);
  });

  it('denies request when endpoint spending daily limit is exceeded', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const endpoint = buildEndpoint({ id: 'ep_spending' });
    await upsertProjectResourcePolicy(docStore, endpoint.workspace_id, endpoint.project_id, {
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      spending_limits: {
        rules: [{ key: 'endpoint.spending_usd_per_day', value: 1 }],
      },
    });
    await recordUsageFact(docStore, {
      workspace_id: endpoint.workspace_id,
      project_id: endpoint.project_id,
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      end_user_id: 'user_spending',
      requests: 1,
      result: 'ok',
      metadata_json: { cost_usd: 1.2 },
      timestamp: new Date(Date.now() - 10_000).toISOString(),
    });

    const decision = await enforceEndpointGovernancePreflight({
      deps: buildDeps(docStore),
      workspaceId: endpoint.workspace_id,
      projectId: endpoint.project_id,
      endpoint,
      userId: 'user_spending',
      requestId: 'req_spending_limited',
      source: 'unit_test',
    });
    expect(decision).toMatchObject({
      allowed: false,
      statusCode: 429,
      responseBody: {
        error_code: 'RESOURCE_POLICY_SPENDING_LIMITED',
      },
    });
    expect(decision.decisionId.startsWith('gdec_')).toBe(true);
  });
});
