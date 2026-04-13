import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';

const mockUpdatePermissions = vi.hoisted(() => vi.fn());
const mockRemoveMember = vi.hoisted(() => vi.fn());
const mockUpdateProjectGroup = vi.hoisted(() => vi.fn());
const mockApplyGroupTemplate = vi.hoisted(() => vi.fn());
const mockCreateGroup = vi.hoisted(() => vi.fn());
const mockDeleteGroup = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  MemberAPI: class MockMemberAPI {
    list = vi.fn();
    remove = mockRemoveMember;
    listJoinRequests = vi.fn();
    createJoinRequest = vi.fn();
    approveJoinRequest = vi.fn();
    rejectJoinRequest = vi.fn();
    getPermissions = vi.fn();
    updatePermissions = mockUpdatePermissions;
    getResourcePolicy = vi.fn();
    updateResourcePolicy = vi.fn();
    listPermissionTemplates = vi.fn();
    createPermissionTemplate = vi.fn();
    updatePermissionTemplate = vi.fn();
    deletePermissionTemplate = vi.fn();
    getChangeHistory = vi.fn();
    listGroups = vi.fn();
    createGroup = mockCreateGroup;
    updateGroup = mockUpdateProjectGroup;
    deleteGroup = mockDeleteGroup;
    applyGroupTemplate = mockApplyGroupTemplate;
  },
}));

import {
  useApplyProjectGroupTemplate,
  useBatchApplyPermissionTemplate,
  useRemoveMember,
  useUpdateMemberPermissions,
  useUpdateProjectGroup,
} from '../use-members';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('use-members cache invalidation', () => {
  const workspaceId = 'ws_1';
  const projectId = 'proj_1';
  const memberId = 'user_1';
  const projectGroupId = 'grp_project_admins';
  const effectiveAccessKey = queryKeys.governanceExplainability.effectiveAccess(workspaceId, projectId, memberId);
  const memberPermissionsKey = queryKeys.members.permissions(workspaceId, projectId, memberId);
  const membersListKey = queryKeys.members.list(workspaceId, projectId);
  const changeHistoryKey = queryKeys.members.changeHistory(workspaceId, projectId, memberId);
  const projectGroupsKey = queryKeys.projectGroups.list(workspaceId, projectId);
  const projectDetailKey = queryKeys.projects.detail(workspaceId, projectId);

  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(effectiveAccessKey, {
      membership_status: 'active',
      effective_permissions: ['project:endpoint:use'],
    });
    queryClient.setQueryData(memberPermissionsKey, {
      platform_permissions: ['project:endpoint:use'],
    });
    queryClient.setQueryData(membersListKey, [{ id: memberId }]);
    queryClient.setQueryData(changeHistoryKey, [{ id: 'ch_1' }]);
    queryClient.setQueryData(projectGroupsKey, [{ id: projectGroupId }]);
    queryClient.setQueryData(projectDetailKey, {
      id: projectId,
      workspace_id: workspaceId,
      name: 'Project',
      owner_id: 'user_owner',
      status: 'active',
      visibility: 'public',
      permissions: ['project:endpoint:use'],
      membership_status: 'active',
    });

    mockUpdatePermissions.mockResolvedValue(undefined);
    mockRemoveMember.mockResolvedValue(undefined);
    mockUpdateProjectGroup.mockResolvedValue(undefined);
    mockApplyGroupTemplate.mockResolvedValue({ applied_count: 1, results: [] });
    mockCreateGroup.mockResolvedValue({ id: 'grp_new' });
    mockDeleteGroup.mockResolvedValue(undefined);
  });

  it('invalidates effective access snapshots when a member permission changes', async () => {
    const { result } = renderHook(() => useUpdateMemberPermissions(workspaceId, projectId, memberId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        mode: 'custom',
        permissions: ['project:agent:manage'],
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: effectiveAccessKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: memberPermissionsKey })?.isStale()).toBe(true);
  });

  it('invalidates effective access snapshots when a member is removed', async () => {
    const { result } = renderHook(() => useRemoveMember(workspaceId, projectId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(memberId);
    });

    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: membersListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: effectiveAccessKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: changeHistoryKey })?.isStale()).toBe(true);
  });

  it('invalidates effective access snapshots when project admins change', async () => {
    const { result } = renderHook(() => useUpdateProjectGroup(workspaceId, projectId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        groupId: projectGroupId,
        data: { member_ids: [memberId] },
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: projectGroupsKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: membersListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: effectiveAccessKey })?.isStale()).toBe(true);
  });

  it('invalidates effective access snapshots when project group template is applied', async () => {
    const { result } = renderHook(() => useApplyProjectGroupTemplate(workspaceId, projectId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        groupId: projectGroupId,
        memberIds: [memberId],
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: membersListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: effectiveAccessKey })?.isStale()).toBe(true);
  });

  it('invalidates effective access snapshots when a batch permission template is applied', async () => {
    const { result } = renderHook(() => useBatchApplyPermissionTemplate(workspaceId, projectId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberIds: [memberId],
        permissions: ['project:agent:use'],
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: projectDetailKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: membersListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: memberPermissionsKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: effectiveAccessKey })?.isStale()).toBe(true);
  });
});
