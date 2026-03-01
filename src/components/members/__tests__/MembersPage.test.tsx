import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(),
  useCanManageMemberGovernance: vi.fn(),
}));

vi.mock('@/lib/hooks/use-join-requests', () => ({
  useJoinRequests: vi.fn(),
}));

vi.mock('@/lib/hooks/use-members-list', () => ({
  useMembersList: vi.fn(),
}));

vi.mock('../MembersTable', () => ({
  MembersTable: () => <div data-testid="members-table" />,
}));

vi.mock('../MemberDetailDrawer', () => ({
  MemberDetailDrawer: () => <div data-testid="member-detail-drawer" />,
}));

vi.mock('../ChangeHistoryDrawer', () => ({
  ChangeHistoryDrawer: () => <div data-testid="change-history-drawer" />,
}));

vi.mock('../InviteMemberDialog', () => ({
  InviteMemberDialog: () => <div data-testid="invite-member-dialog" />,
}));

vi.mock('../QuotaOverrideHistoryDrawer', () => ({
  QuotaOverrideHistoryDrawer: () => <div data-testid="quota-override-history-drawer" />,
}));

vi.mock('../JoinRequestsTab', () => ({
  JoinRequestsTab: () => <div data-testid="join-requests-tab" />,
}));

vi.mock('../PeopleTab', () => ({
  PeopleTab: () => <div data-testid="people-tab" />,
}));

vi.mock('../TemplatesTab', () => ({
  TemplatesTab: () => <div data-testid="templates-tab" />,
}));

vi.mock('../GroupsTab', () => ({
  GroupsTab: () => <div data-testid="groups-tab" />,
}));

vi.mock('../BatchApplyBar', () => ({
  BatchApplyBar: () => <div data-testid="batch-apply-bar" />,
}));

vi.mock('../BatchApplyPermissionDialog', () => ({
  BatchApplyPermissionDialog: () => <div data-testid="batch-apply-permission-dialog" />,
}));

vi.mock('../BatchApplyQuotaDialog', () => ({
  BatchApplyQuotaDialog: () => <div data-testid="batch-apply-quota-dialog" />,
}));

import { MembersPage } from '../MembersPage';
import { useMembersList } from '@/lib/hooks/use-members-list';
import { useCanManageMemberGovernance, useHasPermission } from '@/lib/hooks/use-permissions';
import { useJoinRequests } from '@/lib/hooks/use-join-requests';

const mockUseMembersList = vi.mocked(useMembersList);
const mockUseHasPermission = vi.mocked(useHasPermission);
const mockUseCanManageMemberGovernance = vi.mocked(useCanManageMemberGovernance);
const mockUseJoinRequests = vi.mocked(useJoinRequests);
const STABLE_EMPTY_JOIN_REQUESTS = { data: [], isLoading: false } as any;

describe('MembersPage', () => {
  beforeEach(() => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseCanManageMemberGovernance.mockReturnValue(true);
    mockUseJoinRequests.mockReturnValue(STABLE_EMPTY_JOIN_REQUESTS);
    mockUseMembersList.mockReturnValue({
      project: null,
      members: [],
      permissionTemplates: [],
      quotaTemplates: [],
      isLoading: false,
      selectedMember: null,
      permissions: [],
      quotaOverrides: [],
      effectiveAccessSnapshot: null,
      changeHistory: [],
      quotaHistoryData: null,
      quotaHistoryLoading: false,
      quotaHistoryPage: 1,
      setQuotaHistoryPage: vi.fn(),
      selectedMemberIds: [],
      allSelected: false,
      someSelected: false,
      setSelectedMemberIds: vi.fn(),
      drawerOpen: false,
      historyDrawerOpen: false,
      quotaHistoryDrawerOpen: false,
      inviteDialogOpen: false,
      batchPermDialogOpen: false,
      batchQuotaDialogOpen: false,
      memberToRemove: null,
      isUpdatingPermissions: false,
      isUpdatingQuota: false,
      isRemovingMember: false,
      isCheckingAuthorization: false,
      authorizationCheckResult: null,
      setSelectedMember: vi.fn(),
      setDrawerOpen: vi.fn(),
      setHistoryDrawerOpen: vi.fn(),
      setQuotaHistoryDrawerOpen: vi.fn(),
      setInviteDialogOpen: vi.fn(),
      setBatchPermDialogOpen: vi.fn(),
      setBatchQuotaDialogOpen: vi.fn(),
      setMemberToRemove: vi.fn(),
      handleEditPermissions: vi.fn(),
      handleCloseDrawer: vi.fn(),
      handleViewHistory: vi.fn(),
      handleViewQuotaHistory: vi.fn(),
      handleSavePermissions: vi.fn(),
      handleSaveQuota: vi.fn(),
      handleRemove: vi.fn(),
      handleConfirmRemove: vi.fn(),
      handleToggleSelection: vi.fn(),
      handleToggleAll: vi.fn(),
      clearSelection: vi.fn(),
      handleBatchApplyPermission: vi.fn(),
      handleBatchApplyQuota: vi.fn(),
      handleAuthorizationCheck: vi.fn(),
    } as any);
  });

  it('uses shared layout header without local padding', () => {
    render(<MembersPage workspaceId="ws_1" projectId="proj_1" />);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { name: 'title' })).toBeInTheDocument();
    const body = screen.getByTestId('page-layout__body');
    expect(body.classList.contains('p-6')).toBe(false);
  });
});
