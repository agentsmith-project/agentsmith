import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ProjectGroupsSection } from '../ProjectGroupsSection';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';

const mockCreateMutateAsync = vi.fn().mockResolvedValue({});
const mockUpdateMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
const mockRefetchMembers = vi.fn().mockResolvedValue(undefined);
const mockApplyMutateAsync = vi.fn().mockResolvedValue({
  applied_count: 1,
  results: [
    { member_id: 'm_1', status: 'applied' },
    { member_id: 'm_2', status: 'failed', message: 'forbidden' },
  ],
});

vi.mock('@/lib/hooks/use-members', () => ({
  useProjectGroups: vi.fn(() => ({
    data: [
      {
        id: 'grp_1',
        project_id: 'proj_1',
        name: 'ops-team',
        permission_template_id: 'developer',
        member_ids: ['m_1'],
        created_at: '2026-02-07T00:00:00Z',
        updated_at: '2026-02-07T00:00:00Z',
      },
    ],
  })),
  useMembers: vi.fn(() => ({
    data: [
      {
        id: 'm_1',
        name: 'Alice',
        email: 'alice@example.com',
        permissions: ['project:endpoint:use'],
      },
      {
        id: 'm_2',
        name: 'Bob',
        email: 'bob@example.com',
        permissions: ['project:manage'],
      },
    ],
    refetch: mockRefetchMembers,
  })),
  usePermissionTemplates: vi.fn(() => ({
    data: [
      {
        id: 'developer',
        name: 'Developer',
        permissions: ['project:endpoint:use'],
      },
    ],
  })),
  useCreateProjectGroup: vi.fn(() => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  })),
  useUpdateProjectGroup: vi.fn(() => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  })),
  useDeleteProjectGroup: vi.fn(() => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  })),
  useApplyProjectGroupTemplate: vi.fn(() => ({
    mutateAsync: mockApplyMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanManageMemberGovernance: vi.fn(() => true),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    if ('count' in values) return `${key}:${values.count}`;
    if ('applied' in values || 'failed' in values) {
      return `${key}:${values.applied ?? ''}:${values.failed ?? ''}`;
    }
    if ('name' in values) return `${key}:${values.name}`;
    return key;
  },
}));

describe('ProjectGroupsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetchMembers.mockResolvedValue(undefined);
  });

  it('creates a group with template and selected members', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.type(screen.getByTestId('members__group-name-input'), 'qa-team');
    await user.selectOptions(screen.getByTestId('members__group-template-select'), 'developer');
    await user.click(screen.getByTestId('members__group-member-checkbox--m_2'));
    await user.click(screen.getByTestId('members__group-save-btn'));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        name: 'qa-team',
        permission_template_id: 'developer',
        member_ids: ['m_2'],
      });
    });
  });

  it('applies group template to group members', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-apply-btn--grp_1'));
    await waitFor(() => {
      expect(mockApplyMutateAsync).toHaveBeenCalledWith({ groupId: 'grp_1' });
    });
    expect(screen.getByTestId('members__group-apply-result--grp_1')).toBeInTheDocument();
    expect(screen.getByTestId('members__group-apply-failed-list--grp_1')).toBeInTheDocument();
    expect(screen.getByTestId('members__group-copy-failed-btn--grp_1')).toBeInTheDocument();
    expect(screen.getByTestId('members__group-export-failed-btn--grp_1')).toBeInTheDocument();
    expect(mockRefetchMembers).toHaveBeenCalled();
  });

  it('retries failed members for group apply', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-apply-btn--grp_1'));
    await waitFor(() => {
      expect(screen.getByTestId('members__group-retry-failed-btn--grp_1')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('members__group-retry-failed-btn--grp_1'));

    await waitFor(() => {
      expect(mockApplyMutateAsync).toHaveBeenLastCalledWith({
        groupId: 'grp_1',
        memberIds: ['m_2'],
      });
    });
  });

  it('shows preview diff rows for group members', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-preview-btn--grp_1'));
    expect(screen.getByTestId('members__group-preview-row--grp_1--m_1')).toBeInTheDocument();
  });

  it('shows delete confirm and deletes group on confirm', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-delete-btn--grp_1'));
    await user.click(screen.getByTestId('members__group-delete-confirm-btn'));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('grp_1');
    });
  });

  it('renders group management controls as read-only for project admins', () => {
    vi.mocked(useCanManageMemberGovernance).mockReturnValue(false);

    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByTestId('members__group-name-input')).toBeDisabled();
    expect(screen.getByTestId('members__group-save-btn')).toBeDisabled();
    expect(screen.getByTestId('members__group-apply-btn--grp_1')).toBeDisabled();
    expect(screen.getByTestId('members__group-edit-btn--grp_1')).toBeDisabled();
    expect(screen.getByTestId('members__group-delete-btn--grp_1')).toBeDisabled();
  });
});
