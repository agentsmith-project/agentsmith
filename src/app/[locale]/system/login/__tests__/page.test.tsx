import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssign = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

import SystemLoginPage from '../page';

describe('SystemLoginPage', () => {
  beforeEach(() => {
    mockAssign.mockClear();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        assign: mockAssign,
      },
    });
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
      expect(mockAssign).toHaveBeenCalledWith('/en-US/system/workspaces');
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
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('uses the single-column auth recipe with a quiet workspace recovery action', () => {
    render(<SystemLoginPage />);

    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.queryByTestId('public-auth__aside')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-login__support')).toHaveTextContent('login_scope_value');
    expect(screen.getByTestId('system-login__support')).toHaveTextContent('login_scope_hint');
    expect(screen.getAllByRole('button', { name: 'open_workspace_login' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'open_system_info' })).not.toBeInTheDocument();
  });
});
