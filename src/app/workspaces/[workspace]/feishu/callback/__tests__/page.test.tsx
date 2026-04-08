import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const mockFetch = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

describe('WorkspaceFeishuCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    window.sessionStorage.clear();
  });

  it('completes admin verify on the server and redirects to settings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        intent: 'admin_verify',
        redirect_path: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
      }),
    });

    const Page = (await import('../page')).default;

    await expect(
      Page({
        params: Promise.resolve({ workspace: 'ws_default' }),
        searchParams: Promise.resolve({ code: 'test_code', state: 'test_state' }),
      }),
    ).rejects.toThrow('REDIRECT:/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/public/workspaces/ws_default/feishu/oauth/complete',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
      }),
    );
  });

  it('completes user connect on the server and redirects to connections', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        intent: 'user_connect',
        redirect_path: '/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1',
      }),
    });

    const Page = (await import('../page')).default;

    await expect(
      Page({
        params: Promise.resolve({ workspace: 'ws_default' }),
        searchParams: Promise.resolve({ code: 'test_code', state: 'test_state' }),
      }),
    ).rejects.toThrow('REDIRECT:/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1');
  });

  it('shows admin fallback navigation when callback completion fails', async () => {
    window.sessionStorage.setItem(
      'agentsmith:feishu-oauth-flow:ws_default',
      JSON.stringify({
        intent: 'admin_verify',
        redirectPath: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
        storedAt: Date.now(),
      }),
    );
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'feishu_callback_state_invalid' }),
    });

    const Page = (await import('../page')).default;
    const view = await Page({
      params: Promise.resolve({ workspace: 'ws_default' }),
      searchParams: Promise.resolve({ code: 'test_code', state: 'test_state' }),
    });
    render(view);

    expect(await screen.findByText('Feishu verification failed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Return to Feishu setup' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/settings/feishu?step=enable',
    );
  });

  it('shows user fallback navigation when callback completion fails', async () => {
    window.sessionStorage.setItem(
      'agentsmith:feishu-oauth-flow:ws_default',
      JSON.stringify({
        intent: 'user_connect',
        redirectPath: '/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1',
        storedAt: Date.now(),
      }),
    );
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'feishu_callback_state_invalid' }),
    });

    const Page = (await import('../page')).default;
    const view = await Page({
      params: Promise.resolve({ workspace: 'ws_default' }),
      searchParams: Promise.resolve({ code: 'test_code', state: 'test_state' }),
    });
    render(view);

    expect(await screen.findByText('Feishu authorization failed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open workspace connections' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/connections?provider=feishu',
    );
  });

  it('shows an admin timeout fallback when server-side completion times out', async () => {
    window.sessionStorage.setItem(
      'agentsmith:feishu-oauth-flow:ws_default',
      JSON.stringify({
        intent: 'admin_verify',
        redirectPath: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
        storedAt: Date.now(),
      }),
    );
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const Page = (await import('../page')).default;
    const view = await Page({
      params: Promise.resolve({ workspace: 'ws_default' }),
      searchParams: Promise.resolve({ code: 'test_code', state: 'test_state' }),
    });
    render(view);

    expect(await screen.findByText('Feishu verification is taking longer than expected')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Return to Feishu setup' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/settings/feishu?step=enable',
    );
  });
});
