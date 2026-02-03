/**
 * Unit tests for use-members hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuotaOverride } from '@/lib/api/types';

// Create mock class inline in the vi.mock call
const mockList = vi.fn().mockResolvedValue([]);
const mockCreateInvite = vi.fn().mockResolvedValue({
  invite_id: 'invite_123',
  invite_url: 'https://example.com/invite',
  expires_at: '2026-01-08T00:00:00Z',
});
const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockGetPermissions = vi.fn().mockResolvedValue({
  role: 'developer',
  permissions: ['project:read'],
});
const mockUpdatePermissions = vi.fn().mockResolvedValue(undefined);
const mockGetQuotaOverrides = vi.fn().mockResolvedValue({});
const mockUpdateQuotaOverrides = vi.fn().mockResolvedValue({});
const mockGetResourceACL = vi.fn().mockResolvedValue({ owner_id: 'user_1', permissions: [] });
const mockUpdateResourceACL = vi.fn().mockResolvedValue(undefined);
const _mockListPermissionTemplates = vi.fn().mockResolvedValue([]);
const _mockCreatePermissionTemplate = vi.fn().mockResolvedValue({});
const _mockUpdatePermissionTemplate = vi.fn().mockResolvedValue({});
const _mockDeletePermissionTemplate = vi.fn().mockResolvedValue(undefined);
const _mockListQuotaTemplates = vi.fn().mockResolvedValue([]);
const _mockCreateQuotaTemplate = vi.fn().mockResolvedValue({});
const _mockUpdateQuotaTemplate = vi.fn().mockResolvedValue({});
const _mockDeleteQuotaTemplate = vi.fn().mockResolvedValue(undefined);
const _mockApplyQuotaTemplate = vi.fn().mockResolvedValue({ applied_count: 1 });
const _mockGetChangeHistory = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/api/endpoints/members', () => {
  class MockMemberAPI {
    list = mockList;
    createInvite = mockCreateInvite;
    remove = mockRemove;
    getPermissions = mockGetPermissions;
    updatePermissions = mockUpdatePermissions;
    getQuotaOverrides = mockGetQuotaOverrides;
    updateQuotaOverrides = mockUpdateQuotaOverrides;
    getResourceACL = mockGetResourceACL;
    updateResourceACL = mockUpdateResourceACL;
    listPermissionTemplates = _mockListPermissionTemplates;
    createPermissionTemplate = _mockCreatePermissionTemplate;
    updatePermissionTemplate = _mockUpdatePermissionTemplate;
    deletePermissionTemplate = _mockDeletePermissionTemplate;
    listQuotaTemplates = _mockListQuotaTemplates;
    createQuotaTemplate = _mockCreateQuotaTemplate;
    updateQuotaTemplate = _mockUpdateQuotaTemplate;
    deleteQuotaTemplate = _mockDeleteQuotaTemplate;
    applyQuotaTemplate = _mockApplyQuotaTemplate;
    getChangeHistory = _mockGetChangeHistory;
  }
  return {
    MemberAPI: MockMemberAPI,
  };
});

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
  useResourceACL,
  useUpdateResourceACL,
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
  max_endpoints: 10,
  max_agents: 5,
  max_recipes: 20,
  max_sources: 15,
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
        role_template: 'developer',
      });
    });

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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
      permissions: ['project:read'],
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

    expect(result.current.isSuccess).toBe(true);
  });

  it('should update permissions with custom mode successfully', async () => {
    const { result } = renderHook(
      () => useUpdateMemberPermissions(workspaceId, projectId, memberId),
      {
        wrapper: createTestWrapper(),
      }
    );

    const customPermissions = ['project:read', 'project:update'];

    await act(async () => {
      await result.current.mutateAsync({
        permissions: customPermissions,
        mode: 'custom',
        template: null,
      });
    });

    expect(result.current.isSuccess).toBe(true);
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
        permissions: ['project:read', 'project:update'],
        template: 'developer',
      });
    });

    expect(result.current.isSuccess).toBe(true);
  });

  it('should apply custom permissions to member successfully', async () => {
    const { result } = renderHook(() => useApplyTemplateToMember(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberId,
        permissions: ['project:read'],
        template: null,
      });
    });

    expect(result.current.isSuccess).toBe(true);
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
        permissions: ['project:read'],
        template: 'user',
      });
    });

    expect(result.current.isSuccess).toBe(true);
  });

  it('should handle single member correctly', async () => {
    const { result } = renderHook(() => useBatchApplyPermissionTemplate(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberIds: [memberId],
        permissions: ['project:read'],
      });
    });

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
  });
});

describe('useResourceACL', () => {
  it('should fetch resource ACL successfully', async () => {
    const { result } = renderHook(
      () => useResourceACL(workspaceId, projectId, 'endpoint', resourceId),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ owner_id: 'user_1', permissions: [] });
  });
});

describe('useUpdateResourceACL', () => {
  it('should update resource ACL successfully', async () => {
    const { result } = renderHook(
      () => useUpdateResourceACL(workspaceId, projectId, 'endpoint', resourceId),
      {
        wrapper: createTestWrapper(),
      }
    );

    const ops = [
      {
        op: 'allow' as const,
        subject_type: 'user' as const,
        subject_id: 'user_123',
        permissions: ['endpoint:read', 'endpoint:invoke'],
        reason: 'Grant access',
      },
    ];

    await act(async () => {
      await result.current.mutateAsync({ ops });
    });

    expect(result.current.isSuccess).toBe(true);
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
        permissions: ['project:read'],
      });
    });

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
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

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual({ memberIds, appliedCount: 1 });
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
