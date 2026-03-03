import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const hoisted = vi.hoisted(() => ({
  updatePermissions: vi.fn(),
  applyQuotaTemplate: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  createInvite: vi.fn().mockResolvedValue({}),
  remove: vi.fn().mockResolvedValue(undefined),
  getPermissions: vi.fn().mockResolvedValue({ role: 'developer', permissions: [] }),
  getQuotaOverrides: vi.fn().mockResolvedValue({}),
  updateQuotaOverrides: vi.fn().mockResolvedValue({}),
  getResourcePolicy: vi.fn().mockResolvedValue({ owner_id: 'u_1', permissions: [] }),
  updateResourcePolicy: vi.fn().mockResolvedValue({}),
  listPermissionTemplates: vi.fn().mockResolvedValue([]),
  createPermissionTemplate: vi.fn().mockResolvedValue({}),
  updatePermissionTemplate: vi.fn().mockResolvedValue({}),
  deletePermissionTemplate: vi.fn().mockResolvedValue({}),
  listQuotaTemplates: vi.fn().mockResolvedValue([]),
  createQuotaTemplate: vi.fn().mockResolvedValue({}),
  updateQuotaTemplate: vi.fn().mockResolvedValue({}),
  deleteQuotaTemplate: vi.fn().mockResolvedValue({}),
  getChangeHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  MemberAPI: vi.fn().mockImplementation(function MockMemberAPI() {
    return {
      list: hoisted.list,
      createInvite: hoisted.createInvite,
      remove: hoisted.remove,
      getPermissions: hoisted.getPermissions,
      updatePermissions: hoisted.updatePermissions,
      getQuotaOverrides: hoisted.getQuotaOverrides,
      updateQuotaOverrides: hoisted.updateQuotaOverrides,
      getResourcePolicy: hoisted.getResourcePolicy,
      updateResourcePolicy: hoisted.updateResourcePolicy,
      listPermissionTemplates: hoisted.listPermissionTemplates,
      createPermissionTemplate: hoisted.createPermissionTemplate,
      updatePermissionTemplate: hoisted.updatePermissionTemplate,
      deletePermissionTemplate: hoisted.deletePermissionTemplate,
      listQuotaTemplates: hoisted.listQuotaTemplates,
      createQuotaTemplate: hoisted.createQuotaTemplate,
      updateQuotaTemplate: hoisted.updateQuotaTemplate,
      deleteQuotaTemplate: hoisted.deleteQuotaTemplate,
      applyQuotaTemplate: hoisted.applyQuotaTemplate,
      getChangeHistory: hoisted.getChangeHistory,
    };
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    members: {
      list: (ws: string, proj: string) => ['members', ws, proj],
      permissions: (ws: string, proj: string, member: string) => ['member-permissions', ws, proj, member],
      quotaOverrides: (ws: string, proj: string, member: string) => ['member-quota-overrides', ws, proj, member],
    },
    quotaTemplates: {
      list: (ws: string, proj: string) => ['quota-templates', ws, proj],
      detail: (ws: string, proj: string, id: string) => ['quota-templates', ws, proj, id],
    },
    permissionTemplates: {
      list: (ws: string, proj: string) => ['permission-templates', ws, proj],
    },
  },
}));

import { toast } from '@/components/ui/toast';
import {
  useBatchApplyPermissionTemplate,
  useBatchApplyQuotaTemplate,
} from '../use-members';

const workspaceId = 'ws_1';
const projectId = 'proj_1';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('batch apply hooks partial success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updatePermissions.mockResolvedValue(undefined);
    hoisted.applyQuotaTemplate.mockResolvedValue({ applied_count: 1 });
  });

  it('shows warning when permission template apply is partially successful', async () => {
    hoisted.updatePermissions
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(
      () => useBatchApplyPermissionTemplate(workspaceId, projectId),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.mutateAsync({
        memberIds: ['m_1', 'm_2', 'm_3'],
        permissions: ['project:endpoint:use'],
        template: 'developer',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toast.warning).toHaveBeenCalledWith('apply_partial_success');
  });

  it('shows warning when quota template apply is partially successful', async () => {
    hoisted.applyQuotaTemplate.mockResolvedValueOnce({ applied_count: 1 });

    const { result } = renderHook(
      () => useBatchApplyQuotaTemplate(workspaceId, projectId),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.mutateAsync({
        templateId: 'quota_tpl_1',
        memberIds: ['m_1', 'm_2'],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toast.warning).toHaveBeenCalledWith('quota_apply_partial_success');
  });
});

