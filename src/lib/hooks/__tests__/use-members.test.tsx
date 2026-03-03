/**
 * Unit tests for use-members hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuotaOverride } from '@/lib/api/types';

// Mock the MemberAPI class and all its methods inline
vi.mock('@/lib/api/endpoints/members', () => {
  const mockList = vi.fn().mockResolvedValue([]);
  const mockCreateInvite = vi.fn().mockResolvedValue({
    invite_id: 'invite_123',
    invite_url: 'https://example.com/invite',
    expires_at: '2026-01-08T00:00:00Z',
  });
  const mockRemove = vi.fn().mockResolvedValue(undefined);
  const mockGetPermissions = vi.fn().mockResolvedValue({
    role: 'developer',
    permissions: ['project:endpoint:use'],
  });
  const mockUpdatePermissions = vi.fn().mockResolvedValue(undefined);
  const mockGetQuotaOverrides = vi.fn().mockResolvedValue({});
  const mockUpdateQuotaOverrides = vi.fn().mockResolvedValue({});
  const mockGetResourcePolicy = vi.fn().mockResolvedValue({ owner_id: 'user_1', permissions: [] });
  const mockUpdateResourcePolicy = vi.fn().mockResolvedValue(undefined);
  const mockListPermissionTemplates = vi.fn().mockResolvedValue([]);
  const mockCreatePermissionTemplate = vi.fn().mockResolvedValue({});
  const mockUpdatePermissionTemplate = vi.fn().mockResolvedValue({});
  const mockDeletePermissionTemplate = vi.fn().mockResolvedValue(undefined);
  const mockListQuotaTemplates = vi.fn().mockResolvedValue([]);
  const mockCreateQuotaTemplate = vi.fn().mockResolvedValue({});
  const mockUpdateQuotaTemplate = vi.fn().mockResolvedValue({});
  const mockDeleteQuotaTemplate = vi.fn().mockResolvedValue(undefined);
  const mockApplyQuotaTemplate = vi.fn().mockResolvedValue({ applied_count: 1 });
  const mockGetChangeHistory = vi.fn().mockResolvedValue([]);

  class MockMemberAPI {
    list = mockList;
    createInvite = mockCreateInvite;
    remove = mockRemove;
    getPermissions = mockGetPermissions;
    updatePermissions = mockUpdatePermissions;
    getQuotaOverrides = mockGetQuotaOverrides;
    updateQuotaOverrides = mockUpdateQuotaOverrides;
    getResourcePolicy = mockGetResourcePolicy;
    updateResourcePolicy = mockUpdateResourcePolicy;
    listPermissionTemplates = mockListPermissionTemplates;
    createPermissionTemplate = mockCreatePermissionTemplate;
    updatePermissionTemplate = mockUpdatePermissionTemplate;
    deletePermissionTemplate = mockDeletePermissionTemplate;
    listQuotaTemplates = mockListQuotaTemplates;
    createQuotaTemplate = mockCreateQuotaTemplate;
    updateQuotaTemplate = mockUpdateQuotaTemplate;
    deleteQuotaTemplate = mockDeleteQuotaTemplate;
    applyQuotaTemplate = mockApplyQuotaTemplate;
    getChangeHistory = mockGetChangeHistory;
  }

  return {
    MemberAPI: MockMemberAPI,
  };
});

// Mock the getApiClient function
vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({})),
}));

// Mock the @/lib/api module to export MemberAPI
vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  MemberAPI: vi.fn().mockImplementation(function() {
    return {
      list: vi.fn().mockResolvedValue([]),
      createInvite: vi.fn().mockResolvedValue({
        invite_id: 'invite_123',
        invite_url: 'https://example.com/invite',
        expires_at: '2026-01-08T00:00:00Z',
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      getPermissions: vi.fn().mockResolvedValue({
        role: 'developer',
        permissions: ['project:endpoint:use'],
      }),
      updatePermissions: vi.fn().mockResolvedValue(undefined),
      getQuotaOverrides: vi.fn().mockResolvedValue({}),
      updateQuotaOverrides: vi.fn().mockResolvedValue({}),
      getResourcePolicy: vi.fn().mockResolvedValue({ owner_id: 'user_1', permissions: [] }),
      updateResourcePolicy: vi.fn().mockResolvedValue(undefined),
      listPermissionTemplates: vi.fn().mockResolvedValue([]),
      createPermissionTemplate: vi.fn().mockResolvedValue({}),
      updatePermissionTemplate: vi.fn().mockResolvedValue({}),
      deletePermissionTemplate: vi.fn().mockResolvedValue(undefined),
      listQuotaTemplates: vi.fn().mockResolvedValue([]),
      createQuotaTemplate: vi.fn().mockResolvedValue({}),
      updateQuotaTemplate: vi.fn().mockResolvedValue({}),
      deleteQuotaTemplate: vi.fn().mockResolvedValue(undefined),
      applyQuotaTemplate: vi.fn().mockResolvedValue({ applied_count: 1 }),
      getChangeHistory: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn((error) => {
    console.error(error);
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock query-keys to provide the expected structure
vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    members: {
      list: vi.fn((ws: string, proj: string) => ['members', ws, proj]),
      permissions: vi.fn((ws: string, proj: string, member: string) => ['member-permissions', ws, proj, member]),
      quotaOverrides: vi.fn((ws: string, proj: string, member: string) => ['member-quota-overrides', ws, proj, member]),
      quotaOverridesHistory: vi.fn((ws: string, proj: string, member: string, page: number, pageSize: number) => ['member-quota-overrides-history', ws, proj, member, page, pageSize]),
      changeHistory: vi.fn((ws: string, proj: string, member: string) => ['member-change-history', ws, proj, member]),
    },
    joinRequests: {
      list: vi.fn((ws: string, proj: string) => ['join-requests', ws, proj]),
    },
    permissionTemplates: {
      list: vi.fn((ws: string, proj: string) => ['permission-templates', ws, proj]),
    },
    quotaTemplates: {
      list: vi.fn((ws: string, proj: string) => ['quota-templates', ws, proj]),
      detail: vi.fn((ws: string, proj: string, id: string) => ['quota-templates', ws, proj, id]),
    },
    resourcePolicy: {
      detail: vi.fn((ws: string, proj: string, type: string, id: string) => ['resource-policy', ws, proj, type, id]),
    },
  },
}));

// Mock console.error to avoid cluttering test output
global.console.error = vi.fn();

// Import hooks after mocking
import {
  useCreateInvite,
  useMembers,
  useRemoveMember,
  useMemberPermissions,
  useUpdateMemberPermissions,
  useApplyTemplateToMember,
  useBatchApplyPermissionTemplate,
  useMemberQuotaOverrides,
  useUpdateMemberQuotaOverrides,
  useResourcePolicy,
  useUpdateResourcePolicy,
  usePermissionTemplates,
  useCreatePermissionTemplate,
  useUpdatePermissionTemplate,
  useDeletePermissionTemplate,
  useQuotaTemplates,
  useCreateQuotaTemplate,
  useUpdateQuotaTemplate,
  useDeleteQuotaTemplate,
  useBatchApplyQuotaTemplate,
  useMemberChangeHistory,
} from '../use-members';

// Test constants
const workspaceId = 'ws_test';
const projectId = 'proj_test';
const memberId = 'member_test';
const templateId = 'template_test';
const resourceId = 'endpoint_test';

// Test data
const mockQuotaOverrides: QuotaOverride = {
  endpoint: {
    daily_token_limit: 100_000,
  },
  source_library: {
    max_total_files: 1_000,
    max_file_size_bytes: 10 * 1024 * 1024,
  },
  agent: {
    max_concurrency: 4,
  },
};

function createTestWrapper() {
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

describe('useCreateInvite', () => {
  it('should create invite successfully', async () => {
    const { result } = renderHook(() => useCreateInvite(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        email: 'newuser@example.com',
        group_template: 'developer',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      invite_id: 'invite_123',
      invite_url: 'https://example.com/invite',
      expires_at: '2026-01-08T00:00:00Z',
    });
  });

  it('should be idle initially', () => {
    const { result } = renderHook(() => useCreateInvite(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isIdle).toBe(true);
  });
});

describe('useMembers', () => {
  it('should fetch members successfully', async () => {
    const { result } = renderHook(() => useMembers(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('should be disabled when workspaceId is empty', () => {
    const { result } = renderHook(() => useMembers('', projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should be disabled when projectId is empty', () => {
    const { result } = renderHook(() => useMembers(workspaceId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRemoveMember', () => {
  it('should remove member successfully', async () => {
    const { result } = renderHook(() => useRemoveMember(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(memberId);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useMemberPermissions', () => {
  it('should fetch member permissions successfully', async () => {
    const { result } = renderHook(
      () => useMemberPermissions(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      role: 'developer',
      permissions: ['project:endpoint:use'],
    });
  });

  it('should be disabled when memberId is empty', () => {
    const { result } = renderHook(() => useMemberPermissions(workspaceId, projectId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateMemberPermissions', () => {
  it('should update permissions with template successfully', async () => {
    const { result } = renderHook(
      () => useUpdateMemberPermissions(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await act(async () => {
      await result.current.mutateAsync({
        template: 'admin',
        mode: 'template',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should update permissions with custom mode successfully', async () => {
    const { result } = renderHook(
      () => useUpdateMemberPermissions(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    const customPermissions = ['project:endpoint:use', 'project:settings:manage'];

    await act(async () => {
      await result.current.mutateAsync({
        permissions: customPermissions,
        mode: 'custom',
        template: null,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useApplyTemplateToMember', () => {
  it('should apply template to member successfully', async () => {
    const { result } = renderHook(() => useApplyTemplateToMember(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberId,
        permissions: ['project:endpoint:use', 'project:settings:manage'],
        template: 'developer',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should apply custom permissions to member successfully', async () => {
    const { result } = renderHook(() => useApplyTemplateToMember(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberId,
        permissions: ['project:endpoint:use'],
        template: null,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useBatchApplyPermissionTemplate', () => {
  it('should apply template to multiple members successfully', async () => {
    const { result } = renderHook(() => useBatchApplyPermissionTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    const memberIds = ['member_1', 'member_2'];

    await act(async () => {
      await result.current.mutateAsync({
        memberIds,
        permissions: ['project:endpoint:use'],
        template: 'user',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should handle single member correctly', async () => {
    const { result } = renderHook(() => useBatchApplyPermissionTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberIds: [memberId],
        permissions: ['project:endpoint:use'],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useMemberQuotaOverrides', () => {
  it('should fetch quota overrides successfully', async () => {
    const { result } = renderHook(
      () => useMemberQuotaOverrides(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({});
  });
});

describe('useUpdateMemberQuotaOverrides', () => {
  it('should update quota overrides successfully', async () => {
    const updatedOverrides = { ...mockQuotaOverrides, max_endpoints: 20 };

    const { result } = renderHook(
      () => useUpdateMemberQuotaOverrides(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await act(async () => {
      await result.current.mutateAsync(updatedOverrides);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useResourcePolicy', () => {
  it('should fetch resource policy successfully', async () => {
    const { result } = renderHook(
      () => useResourcePolicy(workspaceId, projectId, 'endpoint', resourceId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ owner_id: 'user_1', permissions: [] });
  });
});

describe('useUpdateResourcePolicy', () => {
  it('should update resource policy successfully', async () => {
    const { result } = renderHook(
      () => useUpdateResourcePolicy(workspaceId, projectId, 'endpoint', resourceId),
      {
        wrapper: createTestWrapper(),
      }
    );

    const payload = {
      access_mode: 'allow_list' as const,
      allowed_subjects: [
        {
          subject_type: 'user' as const,
          subject_id: 'user_123',
          quota_limits: {
            rules: [{ key: 'endpoint.daily_token_limit' as const, value: 100000, window: 'day' as const }],
          },
        },
      ],
      quota_limits: {
        rules: [{ key: 'endpoint.daily_token_limit' as const, value: 500000, window: 'day' as const }],
      },
    };

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('usePermissionTemplates', () => {
  it('should fetch permission templates successfully', async () => {
    const { result } = renderHook(() => usePermissionTemplates(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('useCreatePermissionTemplate', () => {
  it('should create permission template successfully', async () => {
    const { result } = renderHook(() => useCreatePermissionTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'New Template',
        description: 'A new template',
        permissions: ['project:endpoint:use'],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useUpdatePermissionTemplate', () => {
  it('should update permission template successfully', async () => {
    const { result } = renderHook(
      () => useUpdatePermissionTemplate(workspaceId, projectId, templateId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Updated Template',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useDeletePermissionTemplate', () => {
  it('should delete permission template successfully', async () => {
    const { result } = renderHook(() => useDeletePermissionTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(templateId);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useQuotaTemplates', () => {
  it('should fetch quota templates successfully', async () => {
    const { result } = renderHook(() => useQuotaTemplates(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateQuotaTemplate', () => {
  it('should create quota template successfully', async () => {
    const { result } = renderHook(() => useCreateQuotaTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'New Quota',
        overrides_json: mockQuotaOverrides,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useUpdateQuotaTemplate', () => {
  it('should update quota template successfully', async () => {
    const { result } = renderHook(
      () => useUpdateQuotaTemplate(workspaceId, projectId, templateId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Updated Quota',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useDeleteQuotaTemplate', () => {
  it('should delete quota template successfully', async () => {
    const { result } = renderHook(() => useDeleteQuotaTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(templateId);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useBatchApplyQuotaTemplate', () => {
  it('should apply quota template to members successfully', async () => {
    const { result } = renderHook(() => useBatchApplyQuotaTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    const memberIds = ['member_1', 'member_2'];

    await act(async () => {
      await result.current.mutateAsync({
        templateId,
        memberIds,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ memberIds, appliedCount: 1, failedCount: 1 });
  });
});

describe('useMemberChangeHistory', () => {
  it('should fetch member change history successfully', async () => {
    const { result } = renderHook(
      () => useMemberChangeHistory(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});
