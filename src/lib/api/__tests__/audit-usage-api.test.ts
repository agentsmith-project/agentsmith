import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageAPI } from '@/lib/api/endpoints/audit-usage';

describe('UsageAPI exportReport', () => {
  const client = {
    getToken: () => 'token_123',
  } as unknown as ConstructorParameters<typeof UsageAPI>[0];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads usage export and extracts filename', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('timestamp,request_id\n2026-02-28T00:00:00.000Z,req_1', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="usage-report-proj_1.csv"',
        },
      }),
    );

    const api = new UsageAPI(client);
    const result = await api.exportReport('ws_1', 'proj_1', {
      start_time: '2026-02-27T00:00:00.000Z',
      end_time: '2026-02-28T00:00:00.000Z',
      format: 'csv',
      provider: 'openai',
      result: 'ok',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/workspaces/ws_1/projects/proj_1/usage/export?');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('format=csv');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('provider=openai');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('result=ok');
    expect(result.filename).toBe('usage-report-proj_1.csv');
    expect(result.contentType).toContain('text/csv');
    expect(result.blob).toBeDefined();
  });

  it('creates usage report schedule via project route', async () => {
    const postMock = vi.fn().mockResolvedValue({
        id: 'usage_schedule_1',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        name: 'Daily Ops',
        cadence: 'daily',
        status: 'active',
        format: 'json',
        time_window: 'last_7d',
        delivery_channel: 'in_app',
        created_at: '2026-02-28T00:00:00.000Z',
        updated_at: '2026-02-28T00:00:00.000Z',
        next_run_at: '2026-03-01T00:00:00.000Z',
      });

    const api = new UsageAPI({
      ...client,
      post: postMock,
    } as unknown as ConstructorParameters<typeof UsageAPI>[0]);
    const result = await api.createReportSchedule('ws_1', 'proj_1', {
      name: 'Daily Ops',
      cadence: 'daily',
      status: 'active',
      format: 'json',
      time_window: 'last_7d',
      delivery_channel: 'in_app',
      filters: { provider: 'openai' },
    });

    expect(postMock).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/usage/report-schedules',
      expect.objectContaining({ name: 'Daily Ops' }),
    );
    expect(result.name).toBe('Daily Ops');
  });
});
