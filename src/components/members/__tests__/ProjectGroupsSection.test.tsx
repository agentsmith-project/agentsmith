import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ProjectGroupsSection } from '../ProjectGroupsSection';
import { useMemberPageCapabilities } from '@/lib/hooks/use-permissions';

const mockCreateMutateAsync = vi.fn().mockResolvedValue({});
const mockCreateTemplateMutateAsync = vi.fn().mockResolvedValue({
  id: 'tpl_custom',
  name: 'Custom Template',
  permissions: ['project:endpoint:use', 'project:membership:update'],
});
const mockUpdateTemplateMutateAsync = vi.fn().mockResolvedValue({
  id: 'tpl_custom',
  name: 'Custom Template',
  permissions: ['project:endpoint:use', 'project:membership:update'],
});
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
        permissions: ['project:membership:update'],
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
  useCreatePermissionTemplate: vi.fn(() => ({
    mutateAsync: mockCreateTemplateMutateAsync,
    isPending: false,
  })),
  useUpdatePermissionTemplate: vi.fn(() => ({
    mutateAsync: mockUpdateTemplateMutateAsync,
    isPending: false,
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
  useMemberPageCapabilities: vi.fn(() => ({ canRead: true, canManage: true })),
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
    mockCreateTemplateMutateAsync.mockResolvedValue({
      id: 'tpl_custom',
      name: 'Custom Template',
      permissions: ['project:endpoint:use', 'project:membership:update'],
    });
    mockUpdateTemplateMutateAsync.mockResolvedValue({
      id: 'tpl_custom',
      name: 'Custom Template',
      permissions: ['project:endpoint:use', 'project:membership:update'],
    });
  });

  it('creates a group with template and selected members', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByTestId('members__group-template-permissions')).toBeInTheDocument();
    expect(screen.getByText('project:endpoint:use')).toBeInTheDocument();

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

  it('surfaces a visible editing state when editing a group', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-edit-btn--grp_1'));

    expect(screen.getByTestId('members__group-editing-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('members__group-name-input')).toHaveValue('ops-team');
  });

  it('resets editing state after deleting the group being edited so the next save creates a new group', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-edit-btn--grp_1'));
    await user.click(screen.getByTestId('members__group-delete-btn--grp_1'));
    await user.click(screen.getByTestId('members__group-delete-confirm-btn'));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('grp_1');
    });

    await user.clear(screen.getByTestId('members__group-name-input'));
    await user.type(screen.getByTestId('members__group-name-input'), 'new-group');
    await user.selectOptions(screen.getByTestId('members__group-template-select'), 'developer');
    await user.click(screen.getByTestId('members__group-save-btn'));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        name: 'new-group',
        permission_template_id: 'developer',
        member_ids: [],
      });
    });
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });

  it('creates a permission template inline and selects it for the group form', async () => {
    const user = userEvent.setup();
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('members__group-create-template-btn'));
    await user.type(screen.getByLabelText('template_name'), 'Custom Template');
    await user.click(screen.getAllByRole('button', { name: 'create_template' }).at(-1)!);

    await waitFor(() => {
      expect(mockCreateTemplateMutateAsync).toHaveBeenCalledWith({
        name: 'Custom Template',
        description: undefined,
        permissions: [],
      });
    });

    expect(screen.getByTestId('members__group-template-select')).toHaveValue('tpl_custom');
  });

  it('shows a visible action to configure permissions for the selected template', () => {
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByTestId('members__group-create-template-btn')).toBeInTheDocument();
  });

  it('keeps the create group primary action in a sticky action bar for the default visual viewport', () => {
    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByTestId('members__group-action-bar')).toHaveClass('sticky', 'bottom-0');
    expect(screen.getByTestId('members__group-save-btn')).toBeInTheDocument();
  });

  it('renders group management controls as read-only for project admins', () => {
    vi.mocked(useMemberPageCapabilities).mockReturnValue({ canRead: true, canManage: false });

    render(<ProjectGroupsSection workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByTestId('members__group-name-input')).toBeDisabled();
    expect(screen.getByTestId('members__group-save-btn')).toBeDisabled();
    expect(screen.getByTestId('members__group-apply-btn--grp_1')).toBeDisabled();
    expect(screen.getByTestId('members__group-edit-btn--grp_1')).toBeDisabled();
    expect(screen.getByTestId('members__group-delete-btn--grp_1')).toBeDisabled();
  });
});
