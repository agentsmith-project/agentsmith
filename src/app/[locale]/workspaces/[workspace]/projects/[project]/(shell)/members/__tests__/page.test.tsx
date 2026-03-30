import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMemberPageCapabilities } from '@/lib/hooks/use-permissions';

vi.mock('@/components/members/MembersPage', () => ({
  MembersPage: ({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) => (
    <div data-testid="members__route-page">{workspaceId}:{projectId}:{locale ?? 'missing'}</div>
  ),
}));
vi.mock('@/lib/hooks/use-permissions', () => ({
  useMemberPageCapabilities: vi.fn(() => ({ canRead: true, canManage: true })),
}));

import MembersRoute from '../page';

const mockUseMemberPageCapabilities = vi.mocked(useMemberPageCapabilities);

describe('MembersRoute', () => {
  it('renders members page with validated params', async () => {
    mockUseMemberPageCapabilities.mockReturnValue({ canRead: true, canManage: true });
    render(<MembersRoute params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('members__route-page')).toBeInTheDocument();
    });
  });

  it('shows invalid parameter error for unsafe params', async () => {
    render(<MembersRoute params={Promise.resolve({ workspace: '<script>', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks members permission', async () => {
    mockUseMemberPageCapabilities.mockReturnValue({ canRead: false, canManage: false });
    render(<MembersRoute params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });
});
