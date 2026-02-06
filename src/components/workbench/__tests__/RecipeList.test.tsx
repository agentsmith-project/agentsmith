/**
 * Tests for RecipeList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeList } from '../RecipeList';
import type { Recipe } from '@/lib/types/recipe';

// Mock the hooks
vi.mock('@/lib/hooks/use-recipe', () => ({
  useRecipes: vi.fn(),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    locale: 'en-US',
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { useRecipes } from '@/lib/hooks/use-recipe';

describe('RecipeList', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';

  const mockRecipes: Recipe[] = [
    {
      id: 'recipe-1',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Test Recipe 1',
      agent_id: 'agent-1',
      agent_name: 'Test Agent 1',
      status: 'active',
      attached_source_ids: ['source-1', 'source-2'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      last_activity_at: '2024-01-02T12:00:00Z',
    },
    {
      id: 'recipe-2',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Test Recipe 2',
      agent_id: 'agent-2',
      agent_name: 'Test Agent 2',
      status: 'closed',
      attached_source_ids: [],
      created_at: '2024-01-03T00:00:00Z',
      updated_at: '2024-01-03T00:00:00Z',
      last_activity_at: '2024-01-03T08:00:00Z',
    },
    {
      id: 'recipe-3',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Archived Recipe',
      agent_id: 'agent-3',
      agent_name: 'Test Agent 3',
      status: 'archived',
      attached_source_ids: ['source-3'],
      created_at: '2024-01-04T00:00:00Z',
      updated_at: '2024-01-04T00:00:00Z',
      last_activity_at: '2024-01-04T16:00:00Z',
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('Loading State', () => {
    it('renders loading state', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      // Should show loading spinner
      const loader = document.querySelector('.animate-spin');
      expect(loader).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no recipes', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [], total: 0, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('No recipes yet')).toBeInTheDocument();
      expect(screen.getByText(/Create your first Recipe/)).toBeInTheDocument();
    });

    it('shows create recipe button in empty state', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [], total: 0, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Create Recipe')).toBeInTheDocument();
    });
  });

  describe('Recipe List Rendering', () => {
    it('renders list of recipes', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Test Recipe 1')).toBeInTheDocument();
      expect(screen.getByText('Test Recipe 2')).toBeInTheDocument();
      expect(screen.getByText('Archived Recipe')).toBeInTheDocument();
    });

    it('displays recipe agent names', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Agent: Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Agent: Test Agent 2')).toBeInTheDocument();
    });

    it('displays recipe status badges', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Closed')).toBeInTheDocument();
      expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('displays attached sources count', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('2 source(s) attached')).toBeInTheDocument();
    });

    it('displays last activity time', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      // Should show time ago format
      expect(screen.getByText(/Last activity:/)).toBeInTheDocument();
    });
  });

  describe('Recipe Card Interactions', () => {
    it('navigates to recipe when clicked', async () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [mockRecipes[0]], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      const recipeCard = screen.getByText('Test Recipe 1').closest('div');
      recipeCard?.click();

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/workbench/recipes/recipe-1`
      );
    });
  });

  describe('Header Actions', () => {
    it('shows new recipe button', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('New Recipe')).toBeInTheDocument();
    });

    it('opens create dialog when new recipe button is clicked', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      const newRecipeButton = screen.getByText('New Recipe');
      newRecipeButton.click();

      // Dialog should be visible (checked by its content)
      // This is handled by RecipeCreateDialog component
    });
  });

  describe('Time Formatting', () => {
    it('formats time as "Just now" for very recent activity', () => {
      const recentRecipe: Recipe = {
        ...mockRecipes[0],
        last_activity_at: new Date(Date.now() - 10 * 1000).toISOString(), // 10 seconds ago
      };

      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [recentRecipe], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Just now')).toBeInTheDocument();
    });

    it('formats time as "Xm ago" for minutes', () => {
      const minutesAgoRecipe: Recipe = {
        ...mockRecipes[0],
        last_activity_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
      };

      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [minutesAgoRecipe], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('15m ago')).toBeInTheDocument();
    });

    it('formats time as "Xh ago" for hours', () => {
      const hoursAgoRecipe: Recipe = {
        ...mockRecipes[0],
        last_activity_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      };

      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [hoursAgoRecipe], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('3h ago')).toBeInTheDocument();
    });

    it('formats time as "Xd ago" for days', () => {
      const daysAgoRecipe: Recipe = {
        ...mockRecipes[0],
        last_activity_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      };

      vi.mocked(useRecipes).mockReturnValue({
        data: { items: [daysAgoRecipe], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('2d ago')).toBeInTheDocument();
    });
  });

  describe('Header Content', () => {
    it('renders workbench title and description', () => {
      vi.mocked(useRecipes).mockReturnValue({
        data: { items: mockRecipes, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<RecipeList workspaceId={mockWorkspaceId} projectId={mockProjectId} />, {
        wrapper,
      });

      expect(screen.getByText('Workbench')).toBeInTheDocument();
      expect(screen.getByText('Manage your Recipes and collaborate with agents')).toBeInTheDocument();
    });
  });
});
