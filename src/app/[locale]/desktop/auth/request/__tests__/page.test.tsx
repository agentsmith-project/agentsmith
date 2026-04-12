import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replaceMock = vi.fn();
const mockFetch = vi.fn();
const mockUseSearchParams = vi.fn();
const mockAuthState = {
  token: 'desktop-token',
  isAuthenticated: true,
};

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => true,
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock('@/lib/public-runtime-config', () => ({
  buildPublicApiUrl: (path: string) => `/api/v1${path}`,
}));

import DesktopAuthRequestPage from '../page';

describe('DesktopAuthRequestPage', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    mockFetch.mockReset();
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('shows a recovery CTA when the desktop auth request id is missing', async () => {
    render(<DesktopAuthRequestPage />);

    expect(await screen.findByText('desktop_auth_request_missing_title')).toBeInTheDocument();
    expect(screen.getByText('desktop_auth_request_missing_description')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'desktop_auth_request_back_to_workspace_login' })).toHaveAttribute('href', '/en-US/login/workspace');
    expect(screen.queryByRole('button', { name: 'desktop_auth_request_retry' })).not.toBeInTheDocument();
  });

  it('offers retry when completing the desktop auth request fails', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('desktop_auth_request_id=req_123'));

    render(<DesktopAuthRequestPage />);

    await waitFor(() => {
      expect(screen.getByText('desktop_auth_request_error_title')).toBeInTheDocument();
    });

    expect(screen.getByText('desktop_auth_request_error_description')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'desktop_auth_request_back_to_workspace_login' })).toHaveAttribute(
      'href',
      '/en-US/login/workspace?desktop_auth_request_id=req_123',
    );
    expect(screen.getByRole('button', { name: 'desktop_auth_request_retry' })).toBeInTheDocument();

    const initialCalls = mockFetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'desktop_auth_request_retry' }));

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
