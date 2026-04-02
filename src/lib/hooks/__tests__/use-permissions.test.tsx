import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import {
  useHasPermission,
  useCurrentPermissions,
  useIsAuthenticated,
  useHasAnyPermission,
  useHasAllPermissions,
  useCanAccessChat,
  useCanAccessNotebook,
  useCanUseNotebookTerminal,
  useCanReadAudit,
  useAgentPageCapabilities,
  useAlertPageCapabilities,
  useEndpointPageCapabilities,
  useFilesPageCapabilities,
  useMemberPageCapabilities,
  useProjectOverviewCapabilities,
  useProjectSettingsCapabilities,
  useUsagePageCapabilities,
} from '../use-permissions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
vi.mock('../use-projects-queries', () => ({
  useProject: vi.fn(),
}));

// Mock authStore with selector support
let mockAuthState = { isAuthenticated: true };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: { isAuthenticated: boolean }) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockAuthState);
    }
    return mockAuthState;
  }),
}));

import { useProject } from '../use-projects-queries';

const mockUseProject = useProject as unknown as ReturnType<typeof vi.fn>;

// Helper to update auth state
const setMockAuthState = (state: { isAuthenticated: boolean }) => {
  mockAuthState = state;
};

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

describe('use-permissions hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockAuthState({ isAuthenticated: true });
  });

  describe('useCurrentPermissions', () => {
    it('should return permissions from validated project', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'owner' as const,
        permissions: ['project:endpoint:use', 'project:governance:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual(['project:endpoint:use', 'project:governance:update']);
    });

    it('should return empty permissions for project without membership', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual([]);
    });

    it('should return empty permissions when project is undefined', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual([]);
    });

    it('should return empty permissions when explicit permissions are empty', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'developer' as const,
        permissions: [],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual([]);
    });
  });

  describe('useHasPermission', () => {
    it('should return true when user has exact permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use', 'project:governance:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:endpoint:use'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false when user does not have permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:governance:update'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should reject removed endpoint invoke permission name', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:endpoint:use'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('chat/notebook access hooks', () => {
    it('useCanAccessChat should require project:endpoint:use', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanAccessChat(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('useCanAccessNotebook should require project:endpoint:use', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanAccessNotebook(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('useCanUseNotebookTerminal should require project:terminal:use', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use', 'project:terminal:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanUseNotebookTerminal(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('useCanAccessChat should reject removed project:endpoint:invoke permission name', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanAccessChat(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('useCanUseNotebookTerminal should return false without project:terminal:use', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use', 'project:agent:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanUseNotebookTerminal(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

  });

  describe('useIsAuthenticated', () => {
    it('should return true when user is authenticated', () => {
      setMockAuthState({ isAuthenticated: true });

      const { result } = renderHook(() => useIsAuthenticated(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false when user is not authenticated', () => {
      setMockAuthState({ isAuthenticated: false });

      const { result } = renderHook(() => useIsAuthenticated(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('useHasAnyPermission', () => {
    it('should return true when user has at least one of the requested permissions', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:endpoint:use', 'project:write', 'project:governance:update']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(true);
    });

    it('should return false when user has none of the requested permissions', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:write', 'project:governance:update']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });

    it('should return false when requested permissions array is empty', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasAnyPermission([]), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should return false when user has no permissions', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:endpoint:use']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });
  });

  describe('useHasAllPermissions', () => {
    it('should return true when user has all requested permissions', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use', 'project:write', 'project:governance:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:endpoint:use', 'project:write']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(true);
    });

    it('should return false when user is missing some permissions', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:endpoint:use', 'project:write']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });

    it('should return true when requested permissions array is empty (vacuous truth)', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasAllPermissions([]), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false when user has no permissions', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:endpoint:use']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });
  });

  describe('useHasPermission edge cases', () => {
    it('should return false when user has empty permissions array', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: [],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:endpoint:use'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should require exact token match without wildcard expansion', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:endpoint:use'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result: readResult } = renderHook(
        () => useHasPermission('project:endpoint:use'),
        { wrapper: createWrapper() }
      );
      expect(readResult.current).toBe(true);

      const { result: writeResult } = renderHook(
        () => useHasPermission('project:audit:write'),
        { wrapper: createWrapper() }
      );
      expect(writeResult.current).toBe(false);
    });
  });

  describe('split project permission helpers', () => {
    it('should allow audit page only with project:audit:read', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:audit:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanReadAudit(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });
  });

  describe('page capability hooks', () => {
    it('useAgentPageCapabilities should separate agent use from manage', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:agent:use', 'project:agent:manage', 'project:agent:public'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useAgentPageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canRead).toBe(true);
      expect(result.current.canUse).toBe(true);
      expect(result.current.canCreate).toBe(true);
      expect(result.current.canIssueKeys).toBe(true);
      expect(result.current.canPublic).toBe(true);
    });

    it('useEndpointPageCapabilities should allow read when use or manage exists', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:governance:update'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useEndpointPageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canUse).toBe(false);
      expect(result.current.canManage).toBe(true);
      expect(result.current.canRead).toBe(true);
    });

    it('useProjectOverviewCapabilities should aggregate project governance flags', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: [
            'project:endpoint:use',
            'project:membership:update',
            'project:audit:read',
            'project:admins:update',
          ],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useProjectOverviewCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canUseProject).toBe(true);
      expect(result.current.canUseAgents).toBe(false);
      expect(result.current.canManageMembership).toBe(true);
      expect(result.current.canReadAudit).toBe(true);
      expect(result.current.canReadProjectSettings).toBe(true);
      expect(result.current.canManageAgents).toBe(false);
    });

    it('useAlertPageCapabilities should separate read and manage', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:audit:read'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useAlertPageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canRead).toBe(true);
      expect(result.current.canManage).toBe(false);
    });

    it('useUsagePageCapabilities should expose usage read flag', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:endpoint:use'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useUsagePageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canRead).toBe(true);
    });

    it('useFilesPageCapabilities should allow every project user to manage their own libraries', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:endpoint:use'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useFilesPageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canRead).toBe(true);
      expect(result.current.canManage).toBe(true);
      expect(result.current.canExchangeCredentials).toBe(true);
    });

    it('useMemberPageCapabilities should expose member read and manage flags', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: ['project:membership:update'],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMemberPageCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canRead).toBe(true);
      expect(result.current.canManage).toBe(true);
    });

    it('useProjectSettingsCapabilities should aggregate settings flags', () => {
      mockUseProject.mockReturnValue({
        data: {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'Test Project',
          owner_id: 'user_001',
          status: 'active' as const,
          visibility: 'public' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          permissions: [
            'project:governance:update',
            'project:membership:update',
            'project:lifecycle:update',
          ],
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useProjectSettingsCapabilities(), {
        wrapper: createWrapper(),
      });

      expect(result.current.canReadSettings).toBe(true);
      expect(result.current.canManageProjectLifecycle).toBe(true);
      expect(result.current.canManageGovernance).toBe(true);
      expect(result.current.canManageMembership).toBe(true);
      expect(result.current.canReadAudit).toBe(false);
    });
  });
});
