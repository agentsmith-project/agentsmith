import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createUsageReportSchedule, recordUsageFact } from './audit-usage-store.js';
import { createUsageReportRunner } from './usage-report-runner.js';

describe('usage-report-runner', () => {
  it('runs due schedules and updates runner status', async () => {
    const docStore = new InMemoryJsonDocStore();
    await recordUsageFact(docStore, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      requests: 1,
      result: 'ok',
      metadata_json: {
        provider: 'secondaryok',
        resolved_model: 'model-b',
        estimated_cost: 0.0012,
      },
    });
    const created = await createUsageReportSchedule(docStore, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      name: 'Runner Schedule',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      release_evidence_required: false,
      empty_result_policy: 'deliver',
    });
    await docStore.upsert('project_usage_report_schedules', created.id, {
      ...created,
      next_run_at: '2026-03-01T00:00:00.000Z',
    });

    const runner = createUsageReportRunner(docStore, {
      enabled: false,
      intervalMs: 5_000,
      now: () => '2026-03-02T00:00:00.000Z',
    });

    const result = await runner.runOnce('manual');
    const status = runner.getStatus();

    expect(result.processed_schedules).toBe(1);
    expect(result.successful_deliveries).toBe(1);
    expect(status.last_status).toBe('success');
    expect(status.run_count).toBe(1);
    expect(status.last_result?.processed_schedules).toBe(1);
    runner.stop();
  });
});
