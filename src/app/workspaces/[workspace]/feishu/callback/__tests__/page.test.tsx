import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReplace = vi.fn();
const mockFetch = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspace: 'ws_default' }),
  useSearchParams: () => new URLSearchParams('code=test_code&state=test_state'),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    API_BASE: 'http://localhost:20000/api/v1',
    handleErrorForToast: vi.fn(),
  };
});

Object.defineProperty(window, 'location', {
  value: { replace: mockReplace },
  writable: true,
});

describe('WorkspaceFeishuCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('completes admin verify via public callback route and redirects to settings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirect_path: '/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1' }),
    });

    const Page = (await import('../page')).default;
    render(<Page />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:20000/api/public/workspaces/ws_default/feishu/oauth/complete',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/zh-CN/workspaces/ws_default/settings/feishu?step=enable&verified=1');
    });
  });

  it('completes user connect via public callback route and redirects to connections', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirect_path: '/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1' }),
    });

    const Page = (await import('../page')).default;
    render(<Page />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/zh-CN/workspaces/ws_default/connections?provider=feishu&connected=1');
    });
  });

  it('shows fallback navigation on callback failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'feishu_callback_state_invalid' }),
    });

    const Page = (await import('../page')).default;
    render(<Page />);

    expect(await screen.findByText('Feishu authorization failed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open workspace connections' })).toBeInTheDocument();
  });
});
