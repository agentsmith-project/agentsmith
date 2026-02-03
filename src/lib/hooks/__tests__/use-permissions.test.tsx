import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useHasPermission, useCurrentPermissions, useIsOwnerOrAdmin, useIsOwner } from '../use-permissions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
vi.mock('../use-projects-queries', () => ({
  useProject: vi.fn(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

import { useProject } from '../use-projects-queries';
import { useAuthStore } from '@/lib/stores/authStore';

const mockUseProject = useProject as vi.MockedFunction<typeof useProject>;
const mockUseAuthStore = useAuthStore as unknown as { mockReturnValue: (value: unknown) => void };

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
    mockUseAuthStore.mockReturnValue({ isAuthenticated: true });
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

  describe('useIsOwnerOrAdmin', () => {
    it('should return true for owner role', () => {
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
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true for admin role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'admin' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false for developer role', () => {
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
    it('should return true only for owner role', () => {
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
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false for admin role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'admin' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });
});
