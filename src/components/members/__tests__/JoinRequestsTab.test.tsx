import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { JoinRequestsTab } from '../JoinRequestsTab';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanManageMemberGovernance: vi.fn(),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: vi.fn(() => ({
    data: {
      id: 'proj_1',
      governance_json: { project_admins: ['owner_1'] },
    },
  })),
}));

const mockProjectUpdate = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  ProjectAPI: vi.fn().mockImplementation(function () {
    return {
      update: mockProjectUpdate,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/errors')>('@/lib/api/errors');
  return {
    ...actual,
    handleErrorForToast: vi.fn(),
  };
});

vi.mock('@/lib/hooks/use-join-requests', () => ({
  useApproveJoinRequest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
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
    mockProjectUpdate.mockResolvedValue(undefined);
  });

  function renderTab() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <JoinRequestsTab workspaceId="ws_1" projectId="proj_1" requests={mockRequests} />
      </QueryClientProvider>,
    );
  }

  it('shows approve and reject actions for project owners', () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(true);

    renderTab();

    expect(screen.getByRole('button', { name: 'approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'approve_and_grant' })).toBeInTheDocument();
  });

  it('hides approve and reject actions for project admins without owner controls', () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(false);

    renderTab();

    expect(screen.queryByRole('button', { name: 'approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reject' })).not.toBeInTheDocument();
  });

  it('opens reject dialog when owner clicks reject', async () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(true);
    const user = userEvent.setup();

    renderTab();

    await user.click(screen.getByRole('button', { name: 'reject' }));

    expect(screen.getByText('reject_title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'confirm_reject' })).toBeDisabled();
  });

  it('can approve and grant project admin in one action', async () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(true);
    const user = userEvent.setup();

    renderTab();

    await user.click(screen.getByRole('button', { name: 'approve_and_grant' }));

    expect(mockProjectUpdate).toHaveBeenCalledWith('ws_1', 'proj_1', {
      governance_json: {
        project_admins: ['owner_1', 'user_alt'],
      },
    });
  });
});
