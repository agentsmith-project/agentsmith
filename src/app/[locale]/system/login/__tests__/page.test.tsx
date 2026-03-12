import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import SystemLoginPage from '../page';

describe('SystemLoginPage', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    vi.restoreAllMocks();
  });

  it('submits credentials and redirects to system workspaces on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SystemLoginPage />);

    fireEvent.click(screen.getByTestId('system-login__submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/system/session', expect.objectContaining({ method: 'POST' }));
      expect(mockReplace).toHaveBeenCalledWith('/en-US/system/workspaces');
    });
  });

  it('shows error when credentials are rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error_message: 'invalid_system_admin_credentials' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SystemLoginPage />);

    fireEvent.click(screen.getByTestId('system-login__submit'));

    expect(await screen.findByTestId('system-login__error')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
