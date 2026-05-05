import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { PeopleTab } from '../PeopleTab';

const mockSearchParams = new URLSearchParams();
const setSelectedMember = vi.fn();
const setDrawerOpen = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    if (key === 'filters.page_info') return `${values?.page}/${values?.totalPages}`;
    return key;
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useMemberPageCapabilities: () => ({ canRead: true, canManage: false }),
}));

const members = Array.from({ length: 25 }).map((_, index) => ({
  id: `member_${index + 1}`,
  name: `Member ${index + 1}`,
  email: `member${index + 1}@example.com`,
  groups:
    index === 0
      ? [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }]
      : [{ id: 'grp_project_members', name: 'Project Members', permission_template_id: 'tpl_project_member', built_in: true, system_key: 'members' }],
  permissions:
    index === 0
      ? ['project:membership:update']
      : index === 1
        ? ['project:agent_task:use']
        : [],
  status: 'active' as const,
  joined_at: '2026-02-01T00:00:00Z',
}));

vi.mock('../MembersContext', () => ({
  useMembersContext: () => ({
    members,
    isLoading: false,
    selectedMemberIds: [],
    setSelectedMemberIds: vi.fn(),
    handleEditPermissions: vi.fn(),
    handleRemove: vi.fn(),
    handleViewHistory: vi.fn(),
    setBatchPermDialogOpen: vi.fn(),
    clearSelection: vi.fn(),
    selectedMember: null,
    drawerOpen: false,
    setDrawerOpen,
    permissions: [],
    project: null,
    permissionTemplates: [],
    handleSavePermissions: vi.fn(),
    setHistoryDrawerOpen: vi.fn(),
    setSelectedMember,
  }),
}));

vi.mock('../MembersTable', () => ({
  MembersTable: ({ data }: { data: Array<{ name: string }> }) => (
    <div data-testid="members-table-data">{data.map((member) => member.name).join(', ')}</div>
  ),
}));

vi.mock('../BatchApplyBar', () => ({
  BatchApplyBar: () => null,
}));

vi.mock('../MemberDetailDrawer', () => ({
  MemberDetailDrawer: () => null,
}));

describe('PeopleTab', () => {
  beforeEach(() => {
    setSelectedMember.mockClear();
    setDrawerOpen.mockClear();
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
  });

  it('opens member drawer from deep link context', () => {
    mockSearchParams.set('member_id', 'member_3');
    mockSearchParams.set('authorize_resource_type', 'endpoint');
    mockSearchParams.set('authorize_resource_id', 'ep_1');
    mockSearchParams.set('authorize_action', 'invoke');

    render(<PeopleTab workspaceId="ws_1" projectId="proj_1" />);

    expect(setSelectedMember).toHaveBeenCalledWith(expect.objectContaining({ id: 'member_3' }));
    expect(setDrawerOpen).toHaveBeenCalledWith(true);
  });

  it('paginates member list and supports next page', async () => {
    const user = userEvent.setup();
    render(<PeopleTab workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.queryByText('people_workbench_label')).not.toBeInTheDocument();
    expect(screen.getByTestId('members__page-info')).toHaveTextContent('1/2');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 1');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 20');
    expect(screen.getByTestId('members-table-data')).not.toHaveTextContent('Member 21');

    await user.click(screen.getByTestId('members__page-next'));

    expect(screen.getByTestId('members__page-info')).toHaveTextContent('2/2');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 21');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 25');
  });

  it('filters access profile from permissions instead of role labels', async () => {
    const user = userEvent.setup();
    render(<PeopleTab workspaceId="ws_1" projectId="proj_1" />);

    await user.selectOptions(screen.getByTestId('members__role-filter'), 'governance');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 1');
    expect(screen.getByTestId('members-table-data')).not.toHaveTextContent('Member 2');

    await user.selectOptions(screen.getByTestId('members__role-filter'), 'resource_manage');
    expect(screen.getByTestId('members-table-data')).toHaveTextContent('Member 2');
    expect(screen.getByTestId('members-table-data')).not.toHaveTextContent('Member 1');
  });
});
