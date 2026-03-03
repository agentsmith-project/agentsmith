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
  useCanAccessNotebook,
  useCanCreateTask,
  useCanUpdateTask,
  useCanDeleteTask,
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
        permissions: ['project:endpoint:invoke', 'project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual(['project:endpoint:invoke', 'project:manage']);
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
        permissions: ['project:endpoint:invoke', 'project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:endpoint:invoke'), {
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
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:manage'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('chat/notebook access hooks', () => {
    it('useCanAccessChat should require project:endpoint:invoke', () => {
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

      expect(result.current).toBe(true);
    });

    it('useCanAccessNotebook should require project:endpoint:invoke', () => {
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

      const { result } = renderHook(() => useCanAccessNotebook(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('notebook task capability hooks should all follow notebook access', () => {
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

      const { result: createResult } = renderHook(() => useCanCreateTask(), {
        wrapper: createWrapper(),
      });
      const { result: updateResult } = renderHook(() => useCanUpdateTask(), {
        wrapper: createWrapper(),
      });
      const { result: deleteResult } = renderHook(() => useCanDeleteTask(), {
        wrapper: createWrapper(),
      });

      expect(createResult.current).toBe(true);
      expect(updateResult.current).toBe(true);
      expect(deleteResult.current).toBe(true);
    });
  });

  describe('useIsOwnerOrAdmin', () => {
    it('should return true for project-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true for project-manage token (admin equivalent)', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false without project-manage token', () => {
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
    it('should return true for project-manage token', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false without project-manage token', () => {
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
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:endpoint:invoke', 'project:write', 'project:manage']),
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
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAnyPermission(['project:write', 'project:manage']),
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
        permissions: ['project:endpoint:invoke'],
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
        () => useHasAnyPermission(['project:endpoint:invoke']),
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
        permissions: ['project:endpoint:invoke', 'project:write', 'project:manage'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:endpoint:invoke', 'project:write']),
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
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(
        () => useHasAllPermissions(['project:endpoint:invoke', 'project:write']),
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
        permissions: ['project:endpoint:invoke'],
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
        () => useHasAllPermissions(['project:endpoint:invoke']),
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

      const { result } = renderHook(() => useHasPermission('project:endpoint:invoke'), {
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
        permissions: ['project:endpoint:invoke'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result: readResult } = renderHook(
        () => useHasPermission('project:endpoint:invoke'),
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
});
