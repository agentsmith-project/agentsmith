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

    const result = await api.listReports();

    expect(getMock).toHaveBeenCalledWith('/internal/release-reports');
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

    const result = await api.getReport('sample-release');

    expect(getMock).toHaveBeenCalledWith('/internal/release-reports/sample-release');
    expect(result.markdown).toContain('Sample Release');
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
});
