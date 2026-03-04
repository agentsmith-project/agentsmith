import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UseGuidePage from '../page';

const mockHasPermission = vi.fn((_permission?: string) => true);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockHasPermission(permission),
}));

describe('UseGuidePage route', () => {
  it('renders guide cards and quick links', async () => {
    render(
      <UseGuidePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('use-guide__page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('use-guide__codex-sample')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__claude-sample')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__link-api-keys')).toHaveAttribute('href', '/en/user/api-keys');
  });

  it('shows permission denied when token is missing', async () => {
    mockHasPermission.mockReturnValue(false);

    render(
      <UseGuidePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    mockHasPermission.mockReturnValue(true);
  });
});
