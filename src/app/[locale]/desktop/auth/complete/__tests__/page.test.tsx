import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseSearchParams = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

import DesktopAuthCompletePage from '../page';

describe('DesktopAuthCompletePage', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
  });

  it('shows a recovery link back to workspace entry', () => {
    render(<DesktopAuthCompletePage />);

    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('desktop-auth-complete__title')).toHaveTextContent('desktop_auth_complete_title');
    expect(screen.getByRole('link', { name: 'desktop_auth_complete_open_workspace_entry' })).toHaveAttribute('href', '/en-US/login/workspace');
    expect(screen.queryByTestId('desktop-auth-complete__request-meta')).not.toBeInTheDocument();
    expect(screen.queryByText('desktop_auth_complete_next_steps_title')).not.toBeInTheDocument();
    expect(screen.queryByText('desktop_auth_complete_retry_hint')).not.toBeInTheDocument();
    expect(screen.queryByText('desktop_auth_request_checklist_followup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desktop-auth-complete__aside')).not.toBeInTheDocument();
  });

  it('shows the desktop request id when one is present', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('desktop_auth_request_id=req_123'));

    render(<DesktopAuthCompletePage />);

    expect(screen.getByTestId('desktop-auth-complete__request-meta')).toHaveTextContent('req_123');
  });
});
