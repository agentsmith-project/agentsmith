import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const STABLE_WORKSPACE = { id: 'ws_1', name: 'Corp Workspace' };
const STABLE_MEMBERS = [
  {
    id: 'wm_1',
    user_id: 'u_1',
    name: 'Dev One',
    email: 'dev1@example.com',
    role: 'developer',
    status: 'active',
    joined_at: '2026-02-01T00:00:00Z',
  },
];

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1', locale: 'en' }));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: vi.fn((permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update'),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => ({
    data: STABLE_WORKSPACE,
  }),
  useWorkspaceMembers: () => ({
    data: STABLE_MEMBERS,
  }),
  useUpdateWorkspaceMemberGovernanceGroup: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

import WorkspaceSettingsPage from '../page';

const mockUseHasWorkspacePermission = vi.mocked(useHasWorkspacePermission);

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update');
  });

  it('renders members section', async () => {
    render(<WorkspaceSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('workspace_members')).toBeInTheDocument();
    });
    expect(screen.getByText('dev1@example.com')).toBeInTheDocument();
  });

  it('shows validation_error for invalid workspace param', async () => {
    mockUseParams.mockReturnValue({ workspace: '<script>', locale: 'en' });
    render(<WorkspaceSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('validation_error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks workspace:read', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    render(<WorkspaceSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });
});
