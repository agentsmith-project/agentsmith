import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import {
  getUsageRecordsSummary,
  getLimitsSummary,
  getUsageOperationsSummary,
  listAuditEvents,
  listUsageFactRecords,
  recordAuditEvent,
  recordUsageFact,
} from './audit-usage-store.js';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';

describe('audit-usage-store usage records summary', () => {
  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  it('aggregates fallback hops and error classes from usage facts', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4o', fallback_hops: 0, estimated_cost: 0.001 },
      request_id: 'req_1',
    });
    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4o', fallback_hops: 1, estimated_cost: 0.003 },
      request_id: 'req_2',
    });
    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_400',
      metadata_json: { provider: 'anthropic', resolved_model: 'claude-sonnet-4-5', fallback_hops: 2, estimated_cost: 0.005, missing_price: true },
      request_id: 'req_3',
    });

    const end = new Date();
    const start = new Date(end.getTime() - 60_000);
    const summary = await getUsageRecordsSummary(store, {
      workspaceId,
      projectId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });

    expect(summary.total_requests).toBe(3);
    expect(summary.total_errors).toBe(2);
    expect(summary.error_rate).toBeCloseTo(0.6667, 4);
    expect(summary.reroute_hops_histogram['0']).toBe(1);
    expect(summary.reroute_hops_histogram['1']).toBe(1);
    expect(summary.reroute_hops_histogram['2']).toBe(1);
    expect(summary.error_class_counts.provider_retryable).toBe(1);
    expect(summary.error_class_counts.provider_non_retryable).toBe(1);
    expect(summary.avg_estimated_cost).toBeGreaterThan(0);
    expect(summary.p95_estimated_cost).toBeGreaterThan(0);
    expect(summary.records_health.rerouted_requests).toBe(2);
    expect(summary.records_health.missing_price_records).toBe(1);
    expect(summary.request_trend.length).toBeGreaterThan(0);
    expect(summary.cost_distribution_usd.p95).toBeGreaterThan(0);
    expect(summary.issue_signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'missing_price' })]),
    );
    expect(summary.provider_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', requests: 2, errors: 1, reroute_rate: 0.5 }),
      expect.objectContaining({ provider: 'anthropic', requests: 1, errors: 1, missing_price_records: 1 }),
    ]);
    expect(summary.model_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o', requests: 2 }),
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-5', requests: 1 }),
    ]);
  });

  it('lists request-level usage facts with request details', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      request_id: 'req_1',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        fallback_hops: 1,
        pricing_source: 'project-pricing-v1',
        estimated_cost: 0.0068,
        attempt_trace: [
          { index: 0, provider: 'primaryfail', model: 'model-a', outcome: 'fallback_upstream_error' },
          { index: 1, provider: 'secondaryok', model: 'model-b', outcome: 'success' },
        ],
      },
    });

    const rows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      resourceType: 'endpoint',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(rows.total).toBe(1);
    expect(rows.items[0]?.request_id).toBe('req_1');
    expect(rows.items[0]?.request_details?.provider).toBe('secondaryok');
    expect(rows.items[0]?.request_details?.resolved_model).toBe('model-b');
    expect(rows.items[0]?.request_details?.error_class).toBeUndefined();
    expect(rows.items[0]?.request_details?.fallback_hops).toBe(1);
    expect(rows.items[0]?.request_details?.pricing_source).toBe('project-pricing-v1');
    expect(rows.items[0]?.request_details?.estimated_cost).toBe(0.0068);
    expect(rows.items[0]?.request_details?.attempts).toHaveLength(2);
  });

  it('surfaces decision_id in audit and usage list responses', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const decisionId = 'gdec_123';
    const now = new Date().toISOString();

    await recordAuditEvent(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      actor_type: 'user',
      actor_id: 'user_1',
      action: 'resource_policy.rate_limited',
      result: 'error',
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      request_id: 'req_audit',
      metadata_json: { decision_id: decisionId, scope: 'policy' },
      resource_type: 'endpoint',
      resource_id: 'ep_1',
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      requests: 1,
      result: 'error',
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      request_id: 'req_usage',
      metadata_json: { decision_id: decisionId, scope: 'policy' },
    });

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const auditRows = await listAuditEvents(store, {
      workspaceId,
      projectId,
      startTime: start,
      endTime: end,
      action: 'resource_policy.rate_limited',
      actorType: null,
      actorId: null,
      endUserId: null,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      result: 'error',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });
    const usageRows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: start,
      endTime: end,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(auditRows.items[0]?.decision_id).toBe(decisionId);
    expect(usageRows.items[0]?.decision_id).toBe(decisionId);
  });

  it('preserves unknown actor and resource shapes in audit event records', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordAuditEvent(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      actor_type: 'service_account',
      actor_id: 'svc_1',
      action: 'request_delivery_failed',
      result: 'error',
      error_code: 'UPSTREAM_429',
      request_id: 'req_unknown_shape',
      resource_type: 'governance_incident',
      resource_id: 'incident_1',
      metadata_json: {},
    });

    const rows = await listAuditEvents(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      action: null,
      actorType: null,
      actorId: null,
      endUserId: null,
      resourceType: null,
      resourceId: null,
      result: null,
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(rows.items[0]?.actor_type).toBe('service_account');
    expect(rows.items[0]?.resource_type).toBe('governance_incident');
    expect(rows.items[0]?.error_code).toBe('UPSTREAM_429');
    expect(rows.items[0]?.action).toBe('request_delivery_failed');
  });

  it('projects backend default endpoint limits into usage summary even without a saved policy', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_limits';
    const projectId = 'proj_limits';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_usage_only',
      requests: 3,
      result: 'ok',
      request_id: 'req_usage_only',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4.1', estimated_cost: 0.12 },
    });

    await upsertProjectResourcePolicy(store, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_with_policy',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_5_hours', value: 6000 }],
      },
      spending_limits: {
        rules: [{ key: 'endpoint.spending_usd_per_day', value: 400 }],
      },
    });

    const summary = await getLimitsSummary(store, { workspaceId, projectId });
    const usageOnly = summary.endpoints.find((item) => item.endpoint_id === 'ep_usage_only');
    const withPolicy = summary.endpoints.find((item) => item.endpoint_id === 'ep_with_policy');

    expect(usageOnly?.limits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rate_limit',
          window: '5h',
          policy_key: 'endpoint.requests_per_5_hours',
          max: 6000,
        }),
        expect.objectContaining({
          kind: 'rate_limit',
          window: 'day',
          policy_key: 'endpoint.requests_per_day',
          max: 20000,
        }),
        expect.objectContaining({
          kind: 'spending_limit',
          window: '5h',
          policy_key: 'endpoint.spending_usd_per_5_hours',
          max: 100,
        }),
        expect.objectContaining({
          kind: 'spending_limit',
          window: 'day',
          policy_key: 'endpoint.spending_usd_per_day',
          max: 400,
        }),
      ]),
    );
    expect(withPolicy?.limits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rate_limit',
          window: '5h',
          policy_key: 'endpoint.requests_per_5_hours',
          max: 6000,
        }),
        expect.objectContaining({
          kind: 'spending_limit',
          window: 'day',
          policy_key: 'endpoint.spending_usd_per_day',
          max: 400,
        }),
        expect.objectContaining({
          kind: 'rate_limit',
          window: 'day',
          policy_key: 'endpoint.requests_per_day',
          max: 20000,
        }),
        expect.objectContaining({
          kind: 'spending_limit',
          window: '5h',
          policy_key: 'endpoint.spending_usd_per_5_hours',
          max: 100,
        }),
      ]),
    );
  });

  it('includes project endpoints in limits summary even before they emit usage facts', async () => {
    const store = new InMemoryJsonDocStore();

    const summary = await getLimitsSummary(store, {
      workspaceId: 'ws_limits_empty',
      projectId: 'proj_limits_empty',
      endpoints: [{ id: 'ep_configured_only', name: 'Configured Only Endpoint' }],
    });

    expect(summary.endpoints).toEqual([
      expect.objectContaining({
        endpoint_id: 'ep_configured_only',
        endpoint_name: 'Configured Only Endpoint',
        limits: expect.arrayContaining([
          expect.objectContaining({
            kind: 'rate_limit',
            window: '5h',
            policy_key: 'endpoint.requests_per_5_hours',
            max: 6000,
            used: 0,
          }),
          expect.objectContaining({
            kind: 'spending_limit',
            window: 'day',
            policy_key: 'endpoint.spending_usd_per_day',
            max: 400,
            used: 0,
          }),
        ]),
      }),
    ]);
  });

  it('filters limits summary and usage records summary by end user id', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_limits_scope';
    const projectId = 'proj_limits_scope';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_scope',
      end_user_id: 'user_a',
      requests: 2,
      result: 'ok',
      request_id: 'req_scope_a',
      metadata_json: { provider: 'openai', resolved_model: 'model-a', estimated_cost: 0.02 },
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_scope',
      end_user_id: 'user_b',
      requests: 5,
      result: 'ok',
      request_id: 'req_scope_b',
      metadata_json: { provider: 'openai', resolved_model: 'model-b', estimated_cost: 0.05 },
    });

    const limitsSummary = await getLimitsSummary(store, {
      workspaceId,
      projectId,
      endUserId: 'user_a',
      endpoints: [{ id: 'ep_scope', name: 'Scoped Endpoint' }],
    });
    const scopedEndpoint = limitsSummary.endpoints.find((item) => item.endpoint_id === 'ep_scope');
    expect(scopedEndpoint?.limits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rate_limit',
          window: '5h',
          used: 2,
        }),
      ]),
    );

    const recordsSummary = await getUsageRecordsSummary(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      endUserId: 'user_a',
    });
    expect(recordsSummary.total_requests).toBe(2);
    expect(recordsSummary.provider_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', requests: 2 }),
    ]);
  });

  it('filters usage facts by request provider, model, and error class', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      requests: 1,
      result: 'ok',
      request_id: 'req_ok',
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
      },
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_2',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      request_id: 'req_error',
      metadata_json: {
        provider: 'anthropic',
        resolved_model: 'claude-sonnet-4-5',
      },
    });

    const rows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      errorClass: 'provider_retryable',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(rows.total).toBe(1);
    expect(rows.items[0]?.request_id).toBe('req_error');
    expect(rows.items[0]?.request_details?.error_class).toBe('provider_retryable');
  });

  it('builds usage operations summary from filtered request facts', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      end_user_id: 'user_a',
      requests: 2,
      result: 'ok',
      request_id: 'req_a',
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
        estimated_cost: 0.01,
      },
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_1',
      end_user_id: 'user_b',
      requests: 1,
      result: 'error',
      error_code: 'UPSTREAM_429',
      request_id: 'req_b',
      metadata_json: {
        provider: 'anthropic',
        resolved_model: 'claude-sonnet-4-5',
        estimated_cost: 0.02,
      },
    });

    const summary = await getUsageOperationsSummary(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      result: null,
    });

    expect(summary.top_providers[0]).toEqual(expect.objectContaining({ provider: 'anthropic', estimated_cost: 0.02 }));
    expect(summary.top_models).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'openai', model: 'gpt-4o', requests: 2 })]),
    );
    expect(summary.top_end_users).toEqual(
      expect.arrayContaining([expect.objectContaining({ end_user_id: 'user_a', requests: 2 })]),
    );
    expect(summary.recent_requests).toEqual(
      expect.arrayContaining([expect.objectContaining({ request_id: 'req_b', result: 'error', error_class: 'provider_retryable' })]),
    );
    expect(summary.webhook_destinations).toEqual([]);
  });

  it('uses tenant-prefixed collections for audit events and usage facts', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        substrate_label: 'primary',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_default';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordAuditEvent(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      actor_type: 'user',
      actor_id: 'user_1',
      action: 'endpoint.create',
      result: 'ok',
      request_id: 'req_audit_tenant',
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      metadata_json: {},
    });
    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      requests: 1,
      result: 'ok',
      request_id: 'req_usage_tenant',
      metadata_json: { provider: 'openai', resolved_model: 'gpt-4o' },
    });

    expect(await store.list('project_audit_events', {})).toHaveLength(0);
    expect(await store.list('project_usage_facts', {})).toHaveLength(0);
    expect(await store.list('ws_default_project_audit_events', {})).toHaveLength(1);
    expect(await store.list('ws_default_project_usage_facts', {})).toHaveLength(1);

    const auditRows = await listAuditEvents(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      action: null,
      actorType: null,
      actorId: null,
      endUserId: null,
      resourceType: null,
      resourceId: null,
      result: null,
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });
    const usageRows = await listUsageFactRecords(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      resourceType: 'endpoint',
      sortOrder: 'desc',
      page: 1,
      pageSize: 20,
    });

    expect(auditRows.total).toBe(1);
    expect(usageRows.total).toBe(1);
  });

});
