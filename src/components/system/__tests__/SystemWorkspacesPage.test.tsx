import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'updated_at' && values?.value) {
      return `updated_at:${values.value}`;
    }
    return key;
  },
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

vi.mock('../SystemLogoutButton', () => ({
  SystemLogoutButton: () => <button type="button" data-testid="system__logout">logout</button>,
}));

import { SystemWorkspacesPage } from '../SystemWorkspacesPage';

describe('SystemWorkspacesPage', () => {
  const refetch = vi.fn();

  beforeEach(() => {
    refetch.mockClear();
    mockUseWorkspaces.mockReturnValue({
      data: [
        {
          id: 'ws_alpha',
          name: 'Alpha Workspace',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-10T00:00:00.000Z',
        },
        {
          id: 'ws_beta',
          name: 'Beta Workspace',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      refetch,
    });
  });

  it('renders system workspace cards and preview panel', () => {
    render(<SystemWorkspacesPage />);

    expect(screen.getByTestId('system-workspaces__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__open-projects--ws_alpha').closest('a')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_alpha/projects',
    );
    expect(screen.getByTestId('system-workspaces__preview')).toBeInTheDocument();
  });

  it('filters workspaces and generates preview values', () => {
    render(<SystemWorkspacesPage />);

    fireEvent.change(screen.getByTestId('system-workspaces__search'), { target: { value: 'beta' } });
    expect(screen.queryByTestId('system-workspaces__card--ws_alpha')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_beta')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('system-workspaces__draft-name'), { target: { value: 'Platform Ops' } });
    expect(screen.getByTestId('system-workspaces__preview')).toHaveTextContent('platform_ops');
  });

  it('shows retry state when loading fails', () => {
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<SystemWorkspacesPage />);

    fireEvent.click(screen.getByTestId('system-workspaces__retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
