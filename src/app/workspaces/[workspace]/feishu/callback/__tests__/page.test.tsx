import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'ws_default' }),
  useSearchParams: () => new URLSearchParams('code=test_code&state=test_state'),
}));

Object.defineProperty(window, 'location', {
  value: { replace: mockReplace },
  writable: true,
});

describe('WorkspaceFeishuCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    global.fetch = mockFetch as unknown as typeof fetch;
    window.sessionStorage.clear();
  });

  it('completes admin verify via same-origin public callback route and redirects to settings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        intent: 'admin_verify',
        redirect_path: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
      }),
    });

    const Page = (await import('../page')).default;
    render(<Page />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/public/workspaces/ws_default/feishu/oauth/complete',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1');
    });
  });

  it('completes user connect via same-origin public callback route and redirects to connections', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        intent: 'user_connect',
        redirect_path: '/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1',
      }),
    });

    const Page = (await import('../page')).default;
    render(<Page />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1');
    });
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
    render(<Page />);

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
    render(<Page />);

    expect(await screen.findByText('Feishu authorization failed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open workspace connections' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/connections?provider=feishu',
    );
  });

  it('shows an admin timeout fallback when callback completion hangs', async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(
      'agentsmith:feishu-oauth-flow:ws_default',
      JSON.stringify({
        intent: 'admin_verify',
        redirectPath: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1',
        storedAt: Date.now(),
      }),
    );
    mockFetch.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    );

    const Page = (await import('../page')).default;
    render(<Page />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(screen.getByText('Feishu verification is taking longer than expected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Feishu setup' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/settings/feishu?step=enable',
    );
  });
});
