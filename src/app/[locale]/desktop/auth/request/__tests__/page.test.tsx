import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockUseSearchParams = vi.fn();
const mockUseAuthStoreHydration = vi.fn();
const mockUseAuthStore = vi.fn();
const mockBuildPublicApiUrl = vi.fn((path: string) => `https://api.example.com${path}`);

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

vi.mock('@/lib/public-runtime-config', () => ({
  buildPublicApiUrl: (path: string) => mockBuildPublicApiUrl(path),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => mockUseAuthStoreHydration(),
  useAuthStore: (selector: (state: { token: string | null; isAuthenticated: boolean }) => unknown) =>
    selector(mockUseAuthStore()),
}));

import DesktopAuthRequestPage from '../page';

describe('DesktopAuthRequestPage', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('desktop_auth_request_id=req_123'));
    mockUseAuthStoreHydration.mockReturnValue(true);
    mockUseAuthStore.mockReturnValue({ token: null, isAuthenticated: false });
    mockBuildPublicApiUrl.mockClear();
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated users to workspace login with the desktop request id', async () => {
    render(<DesktopAuthRequestPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/en-US/login/workspace?desktop_auth_request_id=req_123');
    });
  });

  it('shows the missing request recovery state when the request id is absent', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));

    render(<DesktopAuthRequestPage />);

    expect(await screen.findByTestId('desktop-auth-request__title')).toHaveTextContent('desktop_auth_request_missing_title');
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-auth-request__workspace-login-link')).toHaveAttribute('href', '/en-US/login/workspace');
  });

  it('keeps the progress hint singular instead of repeating it in the main column', async () => {
    mockUseAuthStore.mockReturnValue({ token: 'token_123', isAuthenticated: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<DesktopAuthRequestPage />);

    await waitFor(() => {
      expect(screen.getAllByText('desktop_auth_request_progress_hint')).toHaveLength(1);
    });
  });

  it('completes the desktop handoff and redirects to the completion page', async () => {
    mockUseAuthStore.mockReturnValue({ token: 'token_123', isAuthenticated: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<DesktopAuthRequestPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/me/desktop/auth/requests/req_123/complete',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockReplace).toHaveBeenCalledWith('/en-US/desktop/auth/complete?desktop_auth_request_id=req_123');
    });
  });

  it('shows completion failure state and retries the desktop handoff', async () => {
    mockUseAuthStore.mockReturnValue({ token: 'token_123', isAuthenticated: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<DesktopAuthRequestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('desktop-auth-request__title')).toHaveTextContent('desktop_auth_request_error_title');
      expect(screen.getByRole('button', { name: 'desktop_auth_request_retry' })).toBeInTheDocument();
      expect(screen.getByTestId('desktop-auth-request__workspace-login-link')).toHaveAttribute(
        'href',
        '/en-US/login/workspace?desktop_auth_request_id=req_123',
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/me/desktop/auth/requests/req_123/complete',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    mockReplace.mockClear();
    const callsBeforeRetry = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'desktop_auth_request_retry' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://api.example.com/me/desktop/auth/requests/req_123/complete',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockReplace).toHaveBeenCalledWith('/en-US/desktop/auth/complete?desktop_auth_request_id=req_123');
    });
  });
});
