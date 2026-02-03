/**
 * Unit tests for use-sync-auth-from-url hook
 *
 * Tests for URL-based authentication state synchronization including:
 * - Invalid workspace_id redirects to workspace list
 * - Invalid project_id redirects to project list
 * - Browser back button navigation
 * - Direct access to deep links
 * - Hydration state handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSyncAuthFromUrl } from '../use-sync-auth-from-url';
import { useWorkspaces } from '../use-workspaces';
import { useProjects } from '../use-projects-queries';
import { useAuthStoreHydration } from '@/lib/stores/authStore';
import * as React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams,
  usePathname: () => '/',
}));

const mockRouter = {
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  pathname: '/',
  query: {},
};

const mockParams = {
  workspace: undefined as string | undefined,
  project: undefined as string | undefined,
};

// Mock hooks
vi.mock('../use-workspaces', () => ({
  useWorkspaces: vi.fn(),
}));

vi.mock('../use-projects-queries', () => ({
  useProjects: vi.fn(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: vi.fn(),
}));

// Test data
const mockWorkspaces = [
  {
    id: 'ws_default',
    name: 'Default Workspace',
    description: 'Default workspace',
    owner_id: 'user_1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ws_another',
    name: 'Another Workspace',
    description: 'Another workspace',
    owner_id: 'user_1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const mockProjects = [
  {
    id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'Project One',
    owner_id: 'user_1',
    status: 'active' as const,
    visibility: 'public' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'proj_002',
    workspace_id: 'ws_default',
    name: 'Project Two',
    owner_id: 'user_1',
    status: 'active' as const,
    visibility: 'public' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

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

describe('useSyncAuthFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.replace.mockReset();
    mockParams.workspace = undefined;
    mockParams.project = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Workspace validation', () => {
    it('should not redirect when workspace exists in user workspaces', async () => {
      mockParams.workspace = 'ws_default';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });

    it('should redirect to workspace list when workspace_id is invalid', async () => {
      mockParams.workspace = 'ws_nonexistent';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/workspaces');
      });
    });

    it('should not redirect when workspaces are still loading', async () => {
      mockParams.workspace = 'ws_unknown';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      // Should not redirect while loading
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('should not redirect when not hydrated yet', async () => {
      mockParams.workspace = 'ws_unknown';
      vi.mocked(useAuthStoreHydration).mockReturnValue(false);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      // Should not redirect while not hydrated
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('should not redirect when workspace_id is empty (on workspace list page)', async () => {
      mockParams.workspace = undefined;
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });

    it('should handle empty workspaces array', async () => {
      mockParams.workspace = 'ws_any';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/workspaces');
      });
    });
  });

  describe('Project validation', () => {
    it('should not redirect when project exists in workspace projects', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });

    it('should redirect to project list when project_id is invalid', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_nonexistent';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/workspaces/ws_default/projects'
        );
      });
    });

    it('should redirect to project list when project does not belong to workspace', async () => {
      mockParams.workspace = 'ws_another';
      mockParams.project = 'proj_001'; // proj_001 belongs to ws_default
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      // Projects for ws_another would be empty
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/workspaces/ws_another/projects'
        );
      });
    });

    it('should not redirect when projects are still loading', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_unknown';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      // Should not redirect while loading
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('should not redirect when project_id is empty (on project list page)', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = undefined;
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });
  });

  describe('Deep link navigation', () => {
    it('should handle direct access to deep link with valid workspace and project', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaceId).toBe('ws_default');
        expect(result.current.projectId).toBe('proj_001');
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });

    it('should handle direct access to deep link with invalid workspace', async () => {
      mockParams.workspace = 'ws_invalid';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/workspaces');
      });
    });

    it('should handle direct access to deep link with valid workspace but invalid project', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_invalid';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/workspaces/ws_default/projects'
        );
      });
    });
  });

  describe('Browser back button navigation', () => {
    it('should re-validate URL params on back navigation', async () => {
      // Simulate navigating from a valid page to an invalid one via back button
      mockParams.workspace = 'ws_invalid';
      mockParams.project = undefined;
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/workspaces');
      });
    });

    it('should handle back navigation to workspace list page', async () => {
      mockParams.workspace = undefined;
      mockParams.project = undefined;
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaceId).toBeUndefined();
        expect(result.current.projectId).toBeUndefined();
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });
    });
  });

  describe('Loading state', () => {
    it('should report loading when workspaces are loading', () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should report loading when projects are loading', () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should report not loading when both are loaded', () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Return values', () => {
    it('should return correct workspaceId and projectId from URL params', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaceId).toBe('ws_default');
        expect(result.current.projectId).toBe('proj_001');
      });
    });

    it('should return undefined for workspaceId and projectId when not in URL', async () => {
      mockParams.workspace = undefined;
      mockParams.project = undefined;
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaceId).toBeUndefined();
        expect(result.current.projectId).toBeUndefined();
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle workspace_id and project_id changing between renders', async () => {
      // Start with valid workspace/project
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      const { result, rerender } = renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaceId).toBe('ws_default');
        expect(result.current.projectId).toBe('proj_001');
        expect(mockRouter.replace).not.toHaveBeenCalled();
      });

      // Change to invalid project
      mockParams.project = 'proj_invalid';
      vi.mocked(useProjects).mockReturnValue({
        data: mockProjects,
        isLoading: false,
      } as any);

      rerender();

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/workspaces/ws_default/projects'
        );
      });
    });

    it('should handle null workspaces data gracefully', async () => {
      mockParams.workspace = 'ws_default';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: null,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/workspaces');
      });
    });

    it('should handle null projects data gracefully', async () => {
      mockParams.workspace = 'ws_default';
      mockParams.project = 'proj_001';
      vi.mocked(useAuthStoreHydration).mockReturnValue(true);
      vi.mocked(useWorkspaces).mockReturnValue({
        data: mockWorkspaces,
        isLoading: false,
      } as any);
      vi.mocked(useProjects).mockReturnValue({
        data: null,
        isLoading: false,
      } as any);

      renderHook(() => useSyncAuthFromUrl(), {
        wrapper: createTestWrapper(),
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/workspaces/ws_default/projects'
        );
      });
    });
  });
});
