import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsagePage } from '../UsagePage';

const invalidateQueries = vi.fn();
const exportReportMock = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<object>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  };
});

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => permission === 'project:endpoint:use' || permission === 'project:manage',
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<object>('@/lib/api');
  return {
    ...actual,
    getApiClient: () => ({ getToken: () => null }),
    UsageAPI: class {
      exportReport = exportReportMock;
    },
  };
});

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useUsageKPI: () => ({ data: { requests_today: 10, errors_today: 1, tokens_today: 100 }, isLoading: false }),
  useUsageRecords: () => ({
    data: {
      items: [
        {
          id: 'usage_1',
          time_bucket: '2026-02-28 15:00',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          end_user_id: 'user_001',
          requests: 2,
          duration_p95_ms: 1000,
          bytes_in: 10,
          bytes_out: 20,
          tokens: 300,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_more: false,
    },
    isLoading: false,
    error: null,
  }),
  useUsageFacts: () => ({
    data: {
      items: [
        {
          id: 'usgf_1',
          timestamp: '2026-02-28T15:10:00.000Z',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          request_id: 'req_1',
          requests: 1,
          result: 'ok',
          runtime: {
            provider: 'zhipu',
            resolved_model: 'glm-5',
            fallback_hops: 0,
          },
          metadata_json: {},
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UsagePage', () => {
  it('renders simplified my-usage view and opens detail drawer', async () => {
    const user = userEvent.setup();
    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    expect(screen.getByTestId('usage__my-scope-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('usage__open-runtime-observability')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__open-release-ops')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage__report-schedules')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('usage__table__row'));

    expect(screen.getByText('detail.title')).toBeInTheDocument();
    expect(screen.getByTestId('usage__detail-fact-usgf_1')).toBeInTheDocument();
  });

  it('exports usage report', async () => {
    const user = userEvent.setup();
    const createObjectURLMock = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:usage');
    const revokeObjectURLMock = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    exportReportMock.mockResolvedValue({
      blob: new Blob(['ok'], { type: 'text/csv' }),
      filename: 'usage.csv',
    });

    render(<UsagePage workspaceId="ws_1" projectId="proj_1" currentUserId="user_001" />);

    await user.click(screen.getByTestId('usage__export-trigger'));
    await user.click(screen.getByTestId('usage__export-option-csv'));

    expect(exportReportMock).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      expect.objectContaining({ end_user_id: 'user_001', format: 'csv' }),
    );

    createObjectURLMock.mockRestore();
    revokeObjectURLMock.mockRestore();
  });
});
