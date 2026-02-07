import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import {
  useHasPermission,
  useCurrentPermissions,
  useIsOwnerOrAdmin,
  useIsOwner,
  useIsAuthenticated,
  useHasAnyPermission,
  useHasAllPermissions,
  useCanAccessChat,
  useCanAccessStudio,
  useCanCreateRecipe,
  useCanUpdateRecipe,
  useCanDeleteRecipe,
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
        permissions: ['project:read', 'project:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual(['project:read', 'project:update']);
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
        permissions: ['project:read', 'project:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:read'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true when user has wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:any:thing'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true when user has prefix wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:read'), {
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
        permissions: ['project:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:delete'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('chat/studio access hooks', () => {
    it('useCanAccessChat should require project:chat:access', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:chat:access'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanAccessChat(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('useCanAccessStudio should require project:studio:access', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:studio:access'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCanAccessStudio(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('studio recipe capability hooks should all follow studio access', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:studio:access'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result: createResult } = renderHook(() => useCanCreateRecipe(), {
        wrapper: createWrapper(),
      });
      const { result: updateResult } = renderHook(() => useCanUpdateRecipe(), {
        wrapper: createWrapper(),
      });
      const { result: deleteResult } = renderHook(() => useCanDeleteRecipe(), {
        wrapper: createWrapper(),
      });

      expect(createResult.current).toBe(true);
      expect(updateResult.current).toBe(true);
      expect(deleteResult.current).toBe(true);
    });
  });

  describe('useIsOwnerOrAdmin', () => {
    it('should return true for member-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:member:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true for member-manage token (admin equivalent)', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:member:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false without member-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:member:view'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should return false when project is undefined', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('useIsOwner', () => {
    it('should return true for settings-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:settings:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false without settings-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:member:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
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
        permissions: ['project:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:read', 'project:write', 'project:delete']),
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
        permissions: ['project:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:write', 'project:delete']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });

    it('should return true when user has wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:write', 'project:delete']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(true);
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
        permissions: ['project:read'],
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
        () => useHasAnyPermission(['project:read']),
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
        permissions: ['project:read', 'project:write', 'project:delete'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:read', 'project:write']),
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
        permissions: ['project:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:read', 'project:write']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(false);
    });

    it('should return true when user has wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:read', 'project:write', 'project:delete']),
        { wrapper: createWrapper() }
      );

      expect(result.current).toBe(true);
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
        permissions: ['project:read'],
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
        () => useHasAllPermissions(['project:read']),
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

      const { result } = renderHook(() => useHasPermission('project:read'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should handle nested prefix wildcard correctly', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:audit:*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result: readResult } = renderHook(
        () => useHasPermission('project:audit:view'),
        { wrapper: createWrapper() }
      );
      expect(readResult.current).toBe(true);

      const { result: writeResult } = renderHook(
        () => useHasPermission('project:audit:write'),
        { wrapper: createWrapper() }
      );
      expect(writeResult.current).toBe(true);

      // Should not match different prefix
      const { result: otherResult } = renderHook(
        () => useHasPermission('project:members:read'),
        { wrapper: createWrapper() }
      );
      expect(otherResult.current).toBe(false);
    });
  });
});
