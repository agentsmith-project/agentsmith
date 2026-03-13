import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JoinRequestsTab } from '../JoinRequestsTab';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanManageMemberGovernance: vi.fn(),
}));

vi.mock('@/lib/hooks/use-join-requests', () => ({
  useApproveJoinRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectJoinRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockRequests = [
  {
    id: 'jr_1',
    project_id: 'proj_1',
    user_id: 'user_alt',
    user_name: 'Alt User',
    user_email: 'alt@example.com',
    status: 'pending' as const,
    reason: '',
    requested_at: '2026-03-01T00:00:00Z',
  },
];

describe('JoinRequestsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows approve and reject actions for project owners', () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(true);

    render(<JoinRequestsTab workspaceId="ws_1" projectId="proj_1" requests={mockRequests} />);

    expect(screen.getByRole('button', { name: 'approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reject' })).toBeInTheDocument();
  });

  it('hides approve and reject actions for project admins without owner controls', () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(false);

    render(<JoinRequestsTab workspaceId="ws_1" projectId="proj_1" requests={mockRequests} />);

    expect(screen.queryByRole('button', { name: 'approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reject' })).not.toBeInTheDocument();
  });

  it('opens reject dialog when owner clicks reject', async () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(true);
    const user = userEvent.setup();

    render(<JoinRequestsTab workspaceId="ws_1" projectId="proj_1" requests={mockRequests} />);

    await user.click(screen.getByRole('button', { name: 'reject' }));

    expect(screen.getByText('reject_title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'confirm_reject' })).toBeDisabled();
  });
});
