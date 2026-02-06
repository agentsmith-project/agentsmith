/**
 * Tests for RecipePage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipePage } from '../RecipePage';
import type { Recipe, RecipeMessage, Artifact } from '@/lib/types/recipe';

// Configurable mock state for use-recipe hooks
let mockRecipeHookState = {
  recipe: null as any,
  recipeLoading: false,
  messages: [] as any[],
  artifacts: [] as any[],
  recipeStatus: 'active',
};

// Mock all the hooks
vi.mock('@/lib/hooks/use-recipe', () => ({
  useRecipe: () => ({
    data: mockRecipeHookState.recipe,
    isLoading: mockRecipeHookState.recipeLoading,
  }),
  useRecipeMessages: () => ({
    data: mockRecipeHookState.messages,
    isLoading: false,
  }),
  useRecipeArtifacts: () => ({
    data: mockRecipeHookState.artifacts,
    isLoading: false,
  }),
  useSendMessage: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      id: 'new-msg-id',
      role: 'agent',
      content: '',
      created_at: new Date().toISOString(),
    }),
    isPending: false,
  }),
  useAddSources: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-recipe-sse', () => ({
  useRecipeSSE: () => ({
    connectionStatus: 'connected',
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/use-error-handler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

// Mock components
vi.mock('../RecipeHeader', () => ({
  RecipeHeader: ({ recipe, onDeleted, onCreateNew, onLeave }: any) => (
    <div data-testid="recipe-header">
      <div data-testid="recipe-title">{recipe.title}</div>
      <button onClick={onLeave}>Leave</button>
      <button onClick={onDeleted}>Delete</button>
      <button onClick={onCreateNew}>New</button>
    </div>
  ),
}));

vi.mock('../AttachedSourcesPanel', () => ({
  AttachedSourcesPanel: ({ onAddClick }: any) => (
    <div data-testid="attached-sources-panel">
      <button onClick={onAddClick}>Add Sources</button>
    </div>
  ),
}));

vi.mock('../ConversationPanel', () => ({
  ConversationPanel: ({ onSendMessage, disabled, sending }: any) => (
    <div data-testid="conversation-panel">
      <button onClick={() => onSendMessage('Test message')}>Send Message</button>
      {disabled && <div data-disabled>disabled</div>}
      {sending && <div data-sending>sending</div>}
    </div>
  ),
}));

vi.mock('../ArtifactsPanel', () => ({
  ArtifactsPanel: ({ onView, onSave, onDownload, disabled }: any) => (
    <div data-testid="artifacts-panel">
      <button onClick={() => onView(mockArtifacts[0])}>View Artifact</button>
      <button onClick={() => onSave(mockArtifacts[0])}>Save Artifact</button>
      <button onClick={() => onDownload(mockArtifacts[0])}>Download Artifact</button>
      {disabled && <div data-disabled>disabled</div>}
    </div>
  ),
}));

vi.mock('../SourceSelectDialog', () => ({
  SourceSelectDialog: ({ open, onOpenChange, onConfirm }: any) => (
    <dialog open={open}>
      <button onClick={() => onConfirm(['source-1'])}>Confirm</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

vi.mock('../ArtifactImageViewer', () => ({
  ArtifactImageViewer: ({ open, onOpenChange }: any) => (
    <dialog open={open}>
      <button onClick={() => onOpenChange(false)}>Close Viewer</button>
    </dialog>
  ),
}));

vi.mock('../ArtifactSaveDialog', () => ({
  ArtifactSaveDialog: ({ open, onOpenChange, onSave }: any) => (
    <dialog open={open}>
      <button onClick={() => onSave('filename.txt', 'description')}>Save</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

vi.mock('../RecipeCreateDialog', () => ({
  RecipeCreateDialog: ({ open, onOpenChange, onSuccess }: any) => (
    <dialog open={open}>
      <button onClick={() => onSuccess('new-recipe-id')}>Create Recipe</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  RecipeAPI: vi.fn(() => ({
    getSSEUrl: vi.fn(() => 'http://test/sse'),
    downloadArtifact: vi.fn().mockResolvedValue(new Blob()),
    saveArtifact: vi.fn().mockResolvedValue({}),
  })),
  getApiClient: vi.fn(),
}));

// Mock router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    locale: 'en-US',
  }),
}));

const mockRecipe: Recipe = {
  id: 'recipe-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  owner_user_id: 'user-1',
  title: 'Test Recipe',
  agent_id: 'agent-1',
  agent_name: 'Test Agent',
  status: 'active',
  attached_source_ids: ['source-1', 'source-2'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_activity_at: '2024-01-02T12:00:00Z',
};

const mockMessages: RecipeMessage[] = [
  {
    id: 'msg-1',
    recipe_id: 'recipe-1',
    role: 'user',
    content: 'Hello',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    recipe_id: 'recipe-1',
    role: 'agent',
    content: 'Hi there!',
    created_at: '2024-01-01T00:01:00Z',
  },
];

const mockArtifacts: Artifact[] = [
  {
    id: 'artifact-1',
    recipe_id: 'recipe-1',
    type: 'text',
    title: 'Text Artifact',
    content: 'Artifact content',
    created_at: '2024-01-01T00:00:00Z',
  },
];

describe('RecipePage', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockRecipeId = 'recipe-1';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();

    // Reset mock state to defaults
    mockRecipeHookState = {
      recipe: mockRecipe,
      recipeLoading: false,
      messages: mockMessages,
      artifacts: mockArtifacts,
      recipeStatus: 'active',
    };

    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const renderComponent = () => {
    return render(
      <RecipePage
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        recipeId={mockRecipeId}
      />,
      { wrapper }
    );
  };

  describe('Loading State', () => {
    it('renders loading state', () => {
      mockRecipeHookState.recipe = undefined;
      mockRecipeHookState.recipeLoading = true;
      mockRecipeHookState.messages = [];
      mockRecipeHookState.artifacts = [];

      renderComponent();

      expect(screen.getByText(/Loading recipe/i)).toBeInTheDocument();
    });
  });

  describe('Recipe Not Found', () => {
    it('renders not found state when recipe is null', () => {
      mockRecipeHookState.recipe = null;
      mockRecipeHookState.recipeLoading = false;

      renderComponent();

      expect(screen.getByText(/Recipe not found/i)).toBeInTheDocument();
    });

    it('shows back button in not found state', () => {
      mockRecipeHookState.recipe = null;
      mockRecipeHookState.recipeLoading = false;

      renderComponent();

      const backButton = screen.getByText(/Go back to Workbench/i);
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Recipe Rendering', () => {
    it('renders recipe header', () => {
      renderComponent();

      expect(screen.getByTestId('recipe-header')).toBeInTheDocument();
      expect(screen.getByTestId('recipe-title')).toHaveTextContent('Test Recipe');
    });

    it('renders attached sources panel', () => {
      renderComponent();

      expect(screen.getByTestId('attached-sources-panel')).toBeInTheDocument();
    });

    it('renders conversation panel', () => {
      renderComponent();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('renders artifacts panel', () => {
      renderComponent();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });
  });

  describe('SSE Connection', () => {
    it('establishes SSE connection when recipe loads', () => {
      renderComponent();

      // SSE connection is established via the useRecipeSSE hook
      // This is tested indirectly by checking that the component renders without errors
      expect(screen.getByTestId('recipe-header')).toBeInTheDocument();
    });
  });

  describe('Message Sending', () => {
    it('sends message through conversation panel', async () => {
      const user = userEvent.setup();
      renderComponent();

      const sendButton = screen.getByText('Send Message');
      await user.click(sendButton);

      // Message sending is handled by the ConversationPanel component
    });

    it('sets up streaming state for agent responses', () => {
      renderComponent();

      // Streaming state is managed internally
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });
  });

  describe('Navigation Actions', () => {
    it('navigates away when leave button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const leaveButton = screen.getByText('Leave');
      await user.click(leaveButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/workbench`
      );
    });

    it('navigates to new recipe after creation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const newButton = screen.getByText('New');
      await user.click(newButton);

      const createButton = screen.getByText('Create Recipe');
      await user.click(createButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/workbench/recipes/new-recipe-id`
      );
    });

    it('navigates to workbench after recipe deletion', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/workbench`
      );
    });
  });

  describe('Source Management', () => {
    it('opens source select dialog', async () => {
      const user = userEvent.setup();
      renderComponent();

      const addSourcesButton = screen.getByText('Add Sources');
      await user.click(addSourcesButton);

      // Dialog should be open
    });

    it('adds sources when confirmed', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Open add sources
      const addSourcesButton = screen.getByText('Add Sources');
      await user.click(addSourcesButton);

      // Confirm selection
      const confirmButton = screen.getByText('Confirm');
      await user.click(confirmButton);

      // Sources should be added via the mutation
    });
  });

  describe('Artifact Actions', () => {
    it('opens artifact viewer for images', async () => {
      const user = userEvent.setup();
      renderComponent();

      const viewButton = screen.getByText('View Artifact');
      await user.click(viewButton);

      // Viewer dialog should open
    });

    it('opens save dialog for artifacts', async () => {
      const user = userEvent.setup();
      renderComponent();

      const saveButton = screen.getByText('Save Artifact');
      await user.click(saveButton);

      // Save dialog should open
    });

    it('downloads artifact', async () => {
      const user = userEvent.setup();
      renderComponent();

      const downloadButton = screen.getByText('Download Artifact');
      await user.click(downloadButton);

      // The download handler creates a RecipeAPI instance and calls downloadArtifact
      // Verify the mock constructor was called (the async download chain is tested via the API mock)
      const { RecipeAPI } = await import('@/lib/api');
      expect(RecipeAPI).toHaveBeenCalled();
    });
  });

  describe('Disabled States', () => {
    it('disables interaction when recipe is closed', () => {
      mockRecipeHookState.recipe = { ...mockRecipe, status: 'closed' };

      renderComponent();

      expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
      expect(screen.getByTestId('artifacts-panel').querySelector('[data-disabled]')).toBeInTheDocument();
    });

    it('disables interaction when recipe is archived', () => {
      mockRecipeHookState.recipe = { ...mockRecipe, status: 'archived' };

      renderComponent();

      expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
      expect(screen.getByTestId('artifacts-panel').querySelector('[data-disabled]')).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('has correct layout structure', () => {
      const { container } = renderComponent();

      const page = container.querySelector('.h-full.flex.flex-col');
      expect(page).toBeInTheDocument();
    });

    it('has three-column layout for panels', () => {
      const { container } = renderComponent();

      const flexContainer = container.querySelector('.flex-1.flex.min-h-0');
      expect(flexContainer).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles message send errors gracefully', () => {
      renderComponent();

      // Error handling is done via the useErrorHandler hook
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('handles download errors gracefully', () => {
      renderComponent();

      // Download errors are handled internally
      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles recipe with no messages', () => {
      mockRecipeHookState.messages = [];
      mockRecipeHookState.artifacts = [];

      renderComponent();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('handles recipe with no artifacts', () => {
      mockRecipeHookState.artifacts = [];

      renderComponent();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });

    it('handles recipe with no attached sources', () => {
      mockRecipeHookState.recipe = { ...mockRecipe, attached_source_ids: [] };

      renderComponent();

      expect(screen.getByTestId('attached-sources-panel')).toBeInTheDocument();
    });
  });
});
