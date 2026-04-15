import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { JoinRequestsTab } from '../JoinRequestsTab';
import { useMemberPageCapabilities } from '@/lib/hooks/use-permissions';
import { PROJECT_BUILT_IN_GROUP_IDS } from '@/lib/governance/member-groups';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useMemberPageCapabilities: vi.fn(),
}));

const {
  useProjectGroups: mockUseProjectGroups,
  useUpdateProjectGroup: mockUseUpdateProjectGroup,
} = vi.hoisted(() => ({
  useProjectGroups: vi.fn(() => ({
    data: [
      {
        id: PROJECT_BUILT_IN_GROUP_IDS.admins,
        name: 'Project Admins',
        member_ids: ['owner_1'],
      },
    ],
  })),
  useUpdateProjectGroup: vi.fn(),
}));

const { projectKeys: mockProjectKeys } = vi.hoisted(() => ({
  projectKeys: {
    detail: (workspaceId: string, projectId: string) => ['workspaces', workspaceId, 'projects', projectId] as const,
    all: (workspaceId: string) => ['workspaces', workspaceId, 'projects'] as const,
  },
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  projectKeys: mockProjectKeys,
}));

const mockUpdateProjectGroup = vi.fn();

vi.mock('@/lib/hooks/use-members', () => ({
  useProjectGroups: mockUseProjectGroups,
  useUpdateProjectGroup: mockUseUpdateProjectGroup,
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
    id: 'join_001',
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
    mockUpdateProjectGroup.mockResolvedValue(undefined);
    mockUseUpdateProjectGroup.mockReturnValue({
      mutateAsync: mockUpdateProjectGroup,
      isPending: false,
    });
    mockUseProjectGroups.mockReturnValue({
      data: [
        {
          id: PROJECT_BUILT_IN_GROUP_IDS.admins,
          name: 'Project Admins',
          member_ids: ['owner_1'],
        },
      ],
    });
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
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });

    renderTab();

    expect(screen.getByRole('button', { name: 'approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'approve_and_grant' })).toBeInTheDocument();
    expect(screen.getByTestId('members__join-requests-list')).toBeInTheDocument();
    expect(screen.queryByText('pending_help')).not.toBeInTheDocument();
    expect(screen.queryByTestId('members__join-request-decision-paths')).not.toBeInTheDocument();
  });

  it('exposes pending join requests as stable governance rows with identity, status, and actions', () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });

    renderTab();

    const list = screen.getByTestId('members__join-requests-list');
    const requestRow = within(list).getByTestId('members__join-request-row--join_001');

    expect(requestRow).toHaveTextContent('Alt User');
    expect(requestRow).toHaveTextContent('alt@example.com');
    expect(requestRow).toHaveTextContent('status.pending');
    expect(within(requestRow).getByTestId('members__join-request-approve--join_001')).toBeInTheDocument();
    expect(within(requestRow).getByTestId('members__join-request-approve-admin--join_001')).toBeInTheDocument();
    expect(within(requestRow).getByTestId('members__join-request-reject--join_001')).toBeInTheDocument();
  });

  it('hides approve and reject actions for project admins without owner controls', () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: false });

    renderTab();

    expect(screen.queryByRole('button', { name: 'approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reject' })).not.toBeInTheDocument();
  });

  it('opens reject dialog when owner clicks reject', async () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });
    const user = userEvent.setup();

    renderTab();

    await user.click(screen.getByRole('button', { name: 'reject' }));

    expect(screen.getByText('reject_title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'confirm_reject' })).toBeDisabled();
  });

  it('can approve and grant project admin in one action', async () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });
    const user = userEvent.setup();

    renderTab();

    await user.click(screen.getByRole('button', { name: 'approve_and_grant' }));

    expect(mockUpdateProjectGroup).toHaveBeenCalledWith({
      groupId: PROJECT_BUILT_IN_GROUP_IDS.admins,
      data: {
        member_ids: ['owner_1', 'user_alt'],
      },
    });
  });

  it('shows loading state through i18n key', () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JoinRequestsTab workspaceId="ws_1" projectId="proj_1" requests={[]} loading />
      </QueryClientProvider>,
    );

    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('shows approved requests with project admin outcome when the user is already a project admin', () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: true });
    mockUseProjectGroups.mockReturnValue({
      data: [
        {
          id: PROJECT_BUILT_IN_GROUP_IDS.admins,
          name: 'Project Admins',
          member_ids: ['owner_1', 'user_alt'],
        },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JoinRequestsTab
          workspaceId="ws_1"
          projectId="proj_1"
          requests={[
            {
              ...mockRequests[0],
              status: 'approved',
              reviewed_at: '2026-03-02T00:00:00Z',
            },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('outcome.project_admin')).toBeInTheDocument();
    expect(screen.queryByText('reviewed_help')).not.toBeInTheDocument();
  });
});
