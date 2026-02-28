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
});
