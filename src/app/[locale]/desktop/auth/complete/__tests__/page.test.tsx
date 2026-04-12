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

    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-auth-complete__title')).toHaveTextContent('desktop_auth_complete_title');
    expect(screen.getByRole('link', { name: 'desktop_auth_complete_open_workspace_entry' })).toHaveAttribute('href', '/en-US/login/workspace');
  });

  it('shows the desktop request id when one is present', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('desktop_auth_request_id=req_123'));

    render(<DesktopAuthCompletePage />);

    expect(screen.getByTestId('desktop-auth-complete__request-id')).toHaveTextContent('req_123');
  });
});
