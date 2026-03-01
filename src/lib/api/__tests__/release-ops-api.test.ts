import { describe, expect, it, vi } from 'vitest';
import { ReleaseOpsAPI } from '@/lib/api/endpoints/release-ops';

describe('ReleaseOpsAPI', () => {
  const client = {
    get: vi.fn(),
  } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0];

  it('lists release report artifacts', async () => {
    const getMock = vi.fn().mockResolvedValue({
      items: [
        {
          name: 'sample-release',
          generated_at: '2026-02-28T20:35:10.000Z',
          status: 'pass',
          markdown_available: true,
        },
      ],
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.listReports({ workspaceId: 'ws_default', projectId: 'proj_001' });

    expect(getMock).toHaveBeenCalledWith('/internal/release-reports?workspace_id=ws_default&project_id=proj_001');
    expect(result.items[0]?.name).toBe('sample-release');
  });

  it('loads a release report detail', async () => {
    const getMock = vi.fn().mockResolvedValue({
      name: 'sample-release',
      report: {
        summary: {
          status: 'pass',
        },
      },
      markdown: '# Sample Release',
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.getReport('sample-release', { workspaceId: 'ws_default', projectId: 'proj_001' });

    expect(getMock).toHaveBeenCalledWith('/internal/release-reports/sample-release?workspace_id=ws_default&project_id=proj_001');
    expect(result.markdown).toContain('Sample Release');
  });

  it('lists release gate runs', async () => {
    const getMock = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'sample-release',
          report_name: 'sample-release',
          artifact_name: 'sample-release',
          started_at: '2026-02-28T20:34:50.000Z',
          completed_at: '2026-02-28T20:35:10.000Z',
          duration_ms: 20000,
          trigger: 'manual',
          status: 'pass',
          total_checks: 6,
          passed_checks: 6,
          failed_checks: 0,
        },
      ],
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.listRuns({ workspaceId: 'ws_default', projectId: 'proj_001' });

    expect(getMock).toHaveBeenCalledWith('/internal/release-runs?workspace_id=ws_default&project_id=proj_001');
    expect(result.items[0]?.id).toBe('sample-release');
  });

  it('loads a release gate run detail', async () => {
    const getMock = vi.fn().mockResolvedValue({
      id: 'sample-release',
      report_name: 'sample-release',
      artifact_name: 'sample-release',
      started_at: '2026-02-28T20:34:50.000Z',
      completed_at: '2026-02-28T20:35:10.000Z',
      duration_ms: 20000,
      trigger: 'manual',
      status: 'pass',
      total_checks: 6,
      passed_checks: 6,
      failed_checks: 0,
      failed_step_names: [],
      failure_categories: [],
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.getRun('sample-release', { workspaceId: 'ws_default', projectId: 'proj_001' });

    expect(getMock).toHaveBeenCalledWith('/internal/release-runs/sample-release?workspace_id=ws_default&project_id=proj_001');
    expect(result.status).toBe('pass');
  });

  it('lists release escalations', async () => {
    const getMock = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'sample-release',
          report_name: 'sample-release',
          run_id: 'sample-release',
          created_at: '2026-02-28T20:35:10.000Z',
          event_type: 'gate_warning',
          severity: 'warning',
          status: 'open',
          title: 'Release gate completed with warning state',
        },
      ],
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.listEscalations();

    expect(getMock).toHaveBeenCalledWith('/internal/release-escalations');
    expect(result.items[0]?.event_type).toBe('gate_warning');
  });

  it('acknowledges a release escalation', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'sample-release', status: 'open' });
    const api = new ReleaseOpsAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    await api.acknowledgeEscalation('sample-release');

    expect(postMock).toHaveBeenCalledWith('/internal/release-escalations/sample-release/acknowledge');
  });

  it('updates release escalation resolution', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'sample-release', status: 'resolved' });
    const api = new ReleaseOpsAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    await api.resolveEscalation('sample-release', { status: 'resolved', reason: 'Mitigated' });

    expect(postMock).toHaveBeenCalledWith('/internal/release-escalations/sample-release/resolution', {
      status: 'resolved',
      reason: 'Mitigated',
    });
  });

  it('loads a release escalation detail', async () => {
    const getMock = vi.fn().mockResolvedValue({
      id: 'sample-release',
      report_name: 'sample-release',
      run_id: 'sample-release',
      created_at: '2026-02-28T20:35:10.000Z',
      event_type: 'gate_warning',
      severity: 'warning',
      status: 'open',
      title: 'Release gate completed with warning state',
    });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    const result = await api.getEscalation('sample-release');

    expect(getMock).toHaveBeenCalledWith('/internal/release-escalations/sample-release');
    expect(result.id).toBe('sample-release');
  });

  it('lists release policy overrides', async () => {
    const getMock = vi.fn().mockResolvedValue({ items: [] });
    const api = new ReleaseOpsAPI({
      ...client,
      get: getMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    await api.listOverrides({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      reportName: 'sample-release',
    });

    expect(getMock).toHaveBeenCalledWith('/internal/release-policy-overrides?workspace_id=ws_default&project_id=proj_001&report_name=sample-release');
  });

  it('creates a release policy override', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'rpo_1' });
    const api = new ReleaseOpsAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    await api.createOverride({
      workspace_id: 'ws_default',
      project_id: 'proj_001',
      report_name: 'sample-release',
      issue_id: 'usage_warning',
      issue_source: 'usage',
      issue_message: 'usage_report_webhook_signature_recommended',
      reason: 'Accepted for staged rollout',
    });

    expect(postMock).toHaveBeenCalledWith('/internal/release-policy-overrides', {
      workspace_id: 'ws_default',
      project_id: 'proj_001',
      report_name: 'sample-release',
      issue_id: 'usage_warning',
      issue_source: 'usage',
      issue_message: 'usage_report_webhook_signature_recommended',
      reason: 'Accepted for staged rollout',
    });
  });

  it('decides a release policy override', async () => {
    const postMock = vi.fn().mockResolvedValue({ id: 'rpo_1', status: 'approved' });
    const api = new ReleaseOpsAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof ReleaseOpsAPI>[0]);

    await api.decideOverride('rpo_1', { status: 'approved' });

    expect(postMock).toHaveBeenCalledWith('/internal/release-policy-overrides/rpo_1/decision', {
      status: 'approved',
    });
  });
});
