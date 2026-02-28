import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  acknowledgeUsageReportDelivery,
  createUsageReportSchedule,
  exportUsageData,
  getRuntimeObservability,
  getUsageReportEvidence,
  getUsageOperationsSummary,
  listUsageFactRecords,
  listUsageReportSchedules,
  recordUsageFact,
  retryUsageReportDelivery,
  runDueUsageReportSchedules,
  runDueUsageReportSchedulesAcrossProjects,
  testUsageReportScheduleDelivery,
  USAGE_REPORT_SCHEDULES_COLLECTION,
} from './audit-usage-store.js';

describe('audit-usage-store runtime observability', () => {
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
    const summary = await getRuntimeObservability(store, {
      workspaceId,
      projectId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });

    expect(summary.total_requests).toBe(3);
    expect(summary.total_errors).toBe(2);
    expect(summary.error_rate).toBeCloseTo(0.6667, 4);
    expect(summary.fallback_hops_histogram['0']).toBe(1);
    expect(summary.fallback_hops_histogram['1']).toBe(1);
    expect(summary.fallback_hops_histogram['2']).toBe(1);
    expect(summary.error_class_counts.provider_retryable).toBe(1);
    expect(summary.error_class_counts.provider_non_retryable).toBe(1);
    expect(summary.avg_estimated_cost).toBeGreaterThan(0);
    expect(summary.p95_estimated_cost).toBeGreaterThan(0);
    expect(summary.health_summary.recovered_requests).toBe(2);
    expect(summary.health_summary.missing_price_facts).toBe(1);
    expect(summary.request_trend.length).toBeGreaterThan(0);
    expect(summary.cost_distribution_usd.p95).toBeGreaterThan(0);
    expect(summary.degradation_signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'missing_price' })]),
    );
    expect(summary.provider_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', requests: 2, errors: 1, fallback_rate: 0.5 }),
      expect.objectContaining({ provider: 'anthropic', requests: 1, errors: 1, missing_price_facts: 1 }),
    ]);
    expect(summary.model_breakdown).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o', requests: 2 }),
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-5', requests: 1 }),
    ]);
  });

  it('lists request-level usage facts with runtime metadata', async () => {
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
        pricing_version: 'runtime-pricing-v1',
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
    expect(rows.items[0]?.runtime?.provider).toBe('secondaryok');
    expect(rows.items[0]?.runtime?.resolved_model).toBe('model-b');
    expect(rows.items[0]?.runtime?.error_class).toBeUndefined();
    expect(rows.items[0]?.runtime?.fallback_hops).toBe(1);
    expect(rows.items[0]?.runtime?.pricing_version).toBe('runtime-pricing-v1');
    expect(rows.items[0]?.runtime?.estimated_cost).toBe(0.0068);
    expect(rows.items[0]?.runtime?.attempts).toHaveLength(2);
  });

  it('filters usage facts by runtime provider, model, and error class', async () => {
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
    expect(rows.items[0]?.runtime?.error_class).toBe('provider_retryable');
  });

  it('builds usage operations summary from filtered runtime facts', async () => {
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
  });

  it('exports usage data as csv and json snapshots', async () => {
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
      end_user_id: 'user_export',
      requests: 1,
      result: 'ok',
      request_id: 'req_export',
      duration_ms: 321,
      tokens_in: 100,
      tokens_out: 50,
      tokens_total: 150,
      metadata_json: {
        provider: 'openai',
        resolved_model: 'gpt-4o',
        fallback_hops: 0,
        pricing_version: 'runtime-pricing-v1',
        estimated_cost: 0.0042,
      },
    });

    const csv = await exportUsageData(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      format: 'csv',
    });
    expect(csv.filename).toMatch(/\.csv$/);
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.body).toContain('request_id');
    expect(csv.body).toContain('req_export');
    expect(csv.body).toContain('openai');

    const json = await exportUsageData(store, {
      workspaceId,
      projectId,
      startTime: new Date(Date.now() - 60_000).toISOString(),
      endTime: new Date(Date.now() + 60_000).toISOString(),
      format: 'json',
    });
    expect(json.filename).toMatch(/\.json$/);
    expect(json.contentType).toBe('application/json; charset=utf-8');
    const payload = JSON.parse(json.body) as {
      kpi: { requests_today?: number };
      facts: Array<{ request_id?: string }>;
      runtime_observability: { total_requests: number };
      operations_summary: { top_providers: Array<{ provider: string }> };
    };
    expect(payload.facts).toEqual(expect.arrayContaining([expect.objectContaining({ request_id: 'req_export' })]));
    expect(payload.runtime_observability.total_requests).toBe(1);
    expect(payload.operations_summary.top_providers).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'openai' })]));
  });

  it('creates and tests scheduled usage reports', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

    await recordUsageFact(store, {
      timestamp: now,
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_sched',
      requests: 1,
      result: 'ok',
      request_id: 'req_sched',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        estimated_cost: 0.0033,
      },
    });

    const created = await createUsageReportSchedule(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Weekly Runtime Digest',
      cadence: 'weekly',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: true,
      empty_result_policy: 'deliver',
      filters: {
        provider: 'secondaryok',
      },
    });

    const listed = await listUsageReportSchedules(store, { workspaceId, projectId });
    expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, name: 'Weekly Runtime Digest' })]));

    const delivery = await testUsageReportScheduleDelivery(store, {
      workspaceId,
      projectId,
      scheduleId: created.id,
    });
    expect(delivery).toEqual(expect.objectContaining({
      schedule_id: created.id,
      status: 'success',
      summary: expect.objectContaining({
        requests: 1,
        top_provider: 'secondaryok',
      }),
    }));
  });

  it('fails empty-result schedules, supports retry, and builds evidence', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    const created = await createUsageReportSchedule(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Required Empty Guard',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_24h',
      delivery_channel: 'in_app',
      release_evidence_required: true,
      empty_result_policy: 'fail',
      filters: {
        provider: 'secondaryok',
      },
    });

    const failedDelivery = await testUsageReportScheduleDelivery(store, {
      workspaceId,
      projectId,
      scheduleId: created.id,
    });

    expect(failedDelivery).toEqual(expect.objectContaining({
      schedule_id: created.id,
      status: 'failed',
      error: 'usage_report_empty_result',
    }));

    let evidence = await getUsageReportEvidence(store, { workspaceId, projectId });
    expect(evidence.release_readiness).toBe('blocked');
    expect(evidence.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('usage_report_schedule_latest_delivery_failed:Required Empty Guard'),
        expect.stringContaining('usage_report_schedule_unacknowledged:Required Empty Guard'),
      ]),
    );

    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_sched_retry',
      requests: 1,
      result: 'ok',
      request_id: 'req_sched_retry',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        estimated_cost: 0.0042,
      },
    });

    const retried = await retryUsageReportDelivery(store, {
      workspaceId,
      projectId,
      scheduleId: created.id,
      deliveryId: failedDelivery?.delivery_id ?? '',
    });

    expect(retried).toEqual(expect.objectContaining({
      schedule_id: created.id,
      status: 'success',
      summary: expect.objectContaining({
        requests: 1,
      }),
    }));

    evidence = await getUsageReportEvidence(store, { workspaceId, projectId });
    expect(evidence.release_readiness).toBe('blocked');
    expect(evidence.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining('usage_report_schedule_unacknowledged:Required Empty Guard')]),
    );
    expect(evidence.successful_deliveries_last_7d).toBe(1);
    expect(evidence.failed_deliveries_last_7d).toBe(0);

    const listed = await listUsageReportSchedules(store, { workspaceId, projectId });
    const latest = listed.items[0]?.recent_deliveries?.[0];
    expect(latest?.status).toBe('success');

    const acknowledged = await acknowledgeUsageReportDelivery(store, {
      workspaceId,
      projectId,
      scheduleId: created.id,
      deliveryId: latest?.id ?? '',
      acknowledgedBy: 'user_admin',
    });
    expect(acknowledged?.acknowledged_by).toBe('user_admin');

    evidence = await getUsageReportEvidence(store, { workspaceId, projectId });
    expect(evidence.release_readiness).toBe('ready');
    expect(evidence.blockers).toEqual([]);
    expect(evidence.unacknowledged_required_deliveries).toBe(0);
  });

  it('runs due schedules and only processes active schedules with elapsed next_run_at', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: 'rpc_sched_due',
      requests: 1,
      result: 'ok',
      request_id: 'req_sched_due',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        estimated_cost: 0.0051,
      },
    });

    const due = await createUsageReportSchedule(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Due Schedule',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });
    await createUsageReportSchedule(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Future Schedule',
      cadence: 'daily',
      status: 'paused',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });

    const pastNow = '2026-03-02T00:00:00.000Z';
    await store.upsert(USAGE_REPORT_SCHEDULES_COLLECTION, due.id, {
      ...due,
      next_run_at: '2026-03-01T00:00:00.000Z',
    });

    const result = await runDueUsageReportSchedules(store, {
      workspaceId,
      projectId,
      now: pastNow,
    });

    expect(result.processed).toBe(1);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.schedule_id).toBe(due.id);
  });

  it('runs due schedules across projects', async () => {
    const store = new InMemoryJsonDocStore();

    await recordUsageFact(store, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      requests: 1,
      result: 'ok',
      metadata_json: { provider: 'secondaryok', resolved_model: 'model-b', estimated_cost: 0.0031 },
    });
    await recordUsageFact(store, {
      workspace_id: 'ws_2',
      project_id: 'proj_2',
      resource_type: 'endpoint',
      requests: 1,
      result: 'ok',
      metadata_json: { provider: 'secondaryok', resolved_model: 'model-b', estimated_cost: 0.0027 },
    });

    const first = await createUsageReportSchedule(store, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      name: 'Runner One',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });
    const second = await createUsageReportSchedule(store, {
      workspace_id: 'ws_2',
      project_id: 'proj_2',
      name: 'Runner Two',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });

    await store.upsert(USAGE_REPORT_SCHEDULES_COLLECTION, first.id, {
      ...first,
      next_run_at: '2026-03-01T00:00:00.000Z',
    });
    await store.upsert(USAGE_REPORT_SCHEDULES_COLLECTION, second.id, {
      ...second,
      next_run_at: '2026-03-01T00:00:00.000Z',
    });

    const sweep = await runDueUsageReportSchedulesAcrossProjects(store, {
      now: '2026-03-02T00:00:00.000Z',
    });

    expect(sweep.scanned_projects).toBe(2);
    expect(sweep.processed_schedules).toBe(2);
    expect(sweep.successful_deliveries).toBe(2);
    expect(sweep.failed_deliveries).toBe(0);
    expect(sweep.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspace_id: 'ws_1', project_id: 'proj_1', processed: 1 }),
        expect.objectContaining({ workspace_id: 'ws_2', project_id: 'proj_2', processed: 1 }),
      ]),
    );
  });

  it('records delivery metadata from dispatcher side effects', async () => {
    const store = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await recordUsageFact(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      requests: 1,
      result: 'ok',
      metadata_json: { provider: 'secondaryok', resolved_model: 'model-b', estimated_cost: 0.0031 },
    });

    const schedule = await createUsageReportSchedule(store, {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Metadata Schedule',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });

    const result = await testUsageReportScheduleDelivery(store, {
      workspaceId,
      projectId,
      scheduleId: schedule.id,
      recipientUserId: 'user_admin',
      deliveryDispatch: async () => ({
        ok: true,
        delivery_metadata: {
          dispatch_mode: 'user_notification',
          notification_id: 'notif_1',
        },
      }),
    });

    expect(result?.status).toBe('success');
    expect(result?.delivery_metadata).toEqual({
      dispatch_mode: 'user_notification',
      notification_id: 'notif_1',
    });
  });

  it('adds runner health warnings to usage report evidence', async () => {
    const store = new InMemoryJsonDocStore();
    const evidence = await getUsageReportEvidence(store, {
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      runnerHealth: {
        enabled: true,
        interval_ms: 60000,
        running: false,
        run_count: 2,
        last_status: 'failed',
        last_error: 'usage_report_runner_busy',
      },
    });

    expect(evidence.runner_health?.last_status).toBe('failed');
    expect(evidence.warnings).toContain('usage_report_no_active_schedules');
    expect(evidence.warnings).toContain('usage_report_runner_last_run_failed');
  });

  it('blocks usage report evidence when required schedules rely on a disabled runner', async () => {
    const store = new InMemoryJsonDocStore();
    await createUsageReportSchedule(store, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      name: 'Release Snapshot',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'webhook',
      delivery_config: {
        webhook_url: 'https://example.internal/report-hook',
        credential_ref: 'cred_webhook',
        secret_header_name: 'x-webhook-secret',
      },
      release_evidence_required: true,
      empty_result_policy: 'deliver',
    });

    const evidence = await getUsageReportEvidence(store, {
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      runnerHealth: {
        enabled: false,
        interval_ms: 60000,
        running: false,
        run_count: 0,
        last_status: 'idle',
      },
    });

    expect(evidence.release_readiness).toBe('blocked');
    expect(evidence.blockers).toContain('usage_report_schedule_missing_delivery:Release Snapshot');
    expect(evidence.blockers).toContain('usage_report_runner_disabled');
    expect(evidence.warnings).toContain('usage_report_schedule_webhook_signature_missing:Release Snapshot');
  });
});
