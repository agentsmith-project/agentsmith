import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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

describe('WorkspaceSettingsPage', () => {
  it('renders members section', () => {
    render(<WorkspaceSettingsPage />);
    expect(screen.getByText('workspace_members')).toBeInTheDocument();
    expect(screen.getByText('dev1@example.com')).toBeInTheDocument();
  });
});
