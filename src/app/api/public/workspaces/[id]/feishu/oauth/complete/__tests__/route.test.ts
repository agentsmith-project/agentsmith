import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

describe('/api/public/workspaces/[id]/feishu/oauth/complete', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('proxies callback completion to the configured backend public route', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        intent: 'admin_verify',
        redirect_path: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost:3101/api/public/workspaces/ws_default/feishu/oauth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test_code', state: 'test_state' }),
      }),
      { params: Promise.resolve({ id: 'ws_default' }) },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/public/workspaces/ws_default/feishu/oauth/complete',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      intent: 'admin_verify',
      redirect_path: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
    });
  });
});
