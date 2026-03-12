import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseParams = vi.fn(() => ({ workspace: 'ws_alpha', locale: 'en-US' }));
const mockUseHasWorkspacePermission = vi.fn((permission: string) => permission === 'workspace:read' || permission === 'workspace:project:create');

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: (permission: string) => mockUseHasWorkspacePermission(permission),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => ({
    data: { id: 'ws_alpha', name: 'Alpha Workspace' },
  }),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

import WorkspaceHomePage from '../page';

describe('WorkspaceHomePage', () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_alpha', locale: 'en-US' });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:project:create',
    );
  });

  it('renders workspace business entry actions', async () => {
    render(<WorkspaceHomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-home__page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-home__heading')).toHaveTextContent('Alpha Workspace');
    expect(screen.getByTestId('workspace-home__workspace-id')).toHaveTextContent('ws_alpha');
    expect(screen.getByTestId('workspace-home__open-projects')).toHaveAttribute('href', '/en-US/workspaces/ws_alpha/projects');
    expect(screen.getByTestId('workspace-home__open-settings')).toHaveAttribute('href', '/en-US/workspaces/ws_alpha/settings');
  });

  it('hides workspace settings action for non-admin workspace users', async () => {
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');
    render(<WorkspaceHomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-home__page')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('workspace-home__open-settings')).not.toBeInTheDocument();
  });

  it('shows permission denied when workspace read is missing', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    render(<WorkspaceHomePage />);

    await waitFor(() => {
      expect(screen.getByText('workspace_home_denied_title')).toBeInTheDocument();
    });
  });
});
