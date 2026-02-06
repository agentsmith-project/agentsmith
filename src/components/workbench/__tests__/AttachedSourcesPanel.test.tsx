/**
 * Tests for AttachedSourcesPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttachedSourcesPanel } from '../AttachedSourcesPanel';
import type { SourceFileWithAIReady } from '@/lib/api/types';

// Mock hooks
vi.mock('@/lib/hooks/use-recipe', () => ({
  useRemoveSource: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-sources', () => ({
  useSources: () => ({
    data: {
      items: mockSources,
      total: 3,
      page: 1,
      page_size: 1000,
    },
    isLoading: false,
  }),
}));

// Mock components
vi.mock('@/components/ui/loading', () => ({
  EmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
    </div>
  ),
}));

vi.mock('@/components/sources/AIReadyStatusBadge', () => ({
  AIReadyStatusBadge: ({ status }: any) => (
    <div data-testid={`ai-ready-${status}`}>AI Ready: {status}</div>
  ),
}));

const mockSources: SourceFileWithAIReady[] = [
  {
    id: 'source-1',
    filename: 'document1.txt',
    file_type: 'text/plain',
    file_size: 1024,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ai_ready: {
      status: 'ready',
      tokens: 100,
      chunks: 5,
    },
  },
  {
    id: 'source-2',
    filename: 'document2.pdf',
    file_type: 'application/pdf',
    file_size: 2048000,
    created_at: '2024-01-01T01:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    ai_ready: {
      status: 'processing',
    },
  },
  {
    id: 'source-3',
    filename: 'document3.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 512000,
    created_at: '2024-01-01T02:00:00Z',
    updated_at: '2024-01-01T02:00:00Z',
    ai_ready: {
      status: 'failed',
      error: 'Processing failed',
    },
  },
];

describe('AttachedSourcesPanel', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockRecipeId = 'recipe-1';
  const mockOnAddClick = vi.fn();

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

  const renderComponent = (attachedSourceIds: string[] = ['source-1', 'source-2']) => {
    return render(
      <AttachedSourcesPanel
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        recipeId={mockRecipeId}
        attachedSourceIds={attachedSourceIds}
        onAddClick={mockOnAddClick}
      />,
      { wrapper }
    );
  };

  describe('Header', () => {
    it('renders title', () => {
      renderComponent();

      expect(screen.getByText('Attached Sources')).toBeInTheDocument();
    });

    it('renders description', () => {
      renderComponent();

      expect(screen.getByText('Files attached to this recipe')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no sources attached', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('empty-title')).toHaveTextContent('No sources attached');
    });

    it('shows empty state description', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-description')).toHaveTextContent(/Add AIReady files/);
    });
  });

  describe('Source List Rendering', () => {
    it('renders attached sources', () => {
      renderComponent(['source-1', 'source-2']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document2.pdf')).toBeInTheDocument();
    });

    it('does not render unattached sources', () => {
      renderComponent(['source-1']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.queryByText('document2.pdf')).not.toBeInTheDocument();
    });

    it('filters sources by attached IDs', () => {
      renderComponent(['source-1', 'source-3']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document3.docx')).toBeInTheDocument();
      expect(screen.queryByText('document2.pdf')).not.toBeInTheDocument();
    });

    it('displays file sizes in human readable format', () => {
      renderComponent(['source-1']);

      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

    it('displays AI ready status badge', () => {
      renderComponent(['source-1']);

      expect(screen.getByTestId('ai-ready-ready')).toBeInTheDocument();
    });

    it('shows processing status', () => {
      renderComponent(['source-2']);

      expect(screen.getByTestId('ai-ready-processing')).toBeInTheDocument();
    });

    it('shows failed status', () => {
      renderComponent(['source-3']);

      expect(screen.getByTestId('ai-ready-failed')).toBeInTheDocument();
    });
  });

  describe('Remove Source', () => {
    it('shows remove button on hover', () => {
      renderComponent(['source-1']);

      const sourceItem = screen.getByText('document1.txt').closest('.group');
      expect(sourceItem).toBeInTheDocument();

      const removeButton = sourceItem?.querySelector('button[aria-label="Remove source"]');
      expect(removeButton).toBeInTheDocument();
    });

    it('calls remove handler when remove is clicked', async () => {
      const user = userEvent.setup();
      renderComponent(['source-1']);

      const sourceItem = screen.getByText('document1.txt').closest('.group');
      const removeButton = sourceItem?.querySelector('button[aria-label="Remove source"]') as HTMLButtonElement;

      await user.click(removeButton);

      // The remove mutation is called internally
    });
  });

  describe('Add Sources Button', () => {
    it('renders add sources button', () => {
      renderComponent();

      expect(screen.getByRole('button', { name: /Add Sources/i })).toBeInTheDocument();
    });

    it('calls onAddClick when add sources button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const addButton = screen.getByRole('button', { name: /Add Sources/i });
      await user.click(addButton);

      expect(mockOnAddClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Layout and Styling', () => {
    it('has correct panel structure', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.h-full.flex.flex-col');
      expect(panel).toBeInTheDocument();
    });

    it('has right border', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.border-r');
      expect(panel).toBeInTheDocument();
    });

    it('has correct background', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.bg-surface');
      expect(panel).toBeInTheDocument();
    });
  });

  describe('Source Item Rendering', () => {
    it('displays file icon', () => {
      renderComponent(['source-1']);

      const iconContainer = document.querySelector('.w-8.h-8');
      expect(iconContainer).toBeInTheDocument();
    });

    it('shows filename with truncation', () => {
      renderComponent(['source-1']);

      const filename = screen.getByText('document1.txt');
      expect(filename).toHaveClass('truncate');
    });

    it('groups remove button visibility', () => {
      renderComponent(['source-1']);

      const sourceItem = screen.getByText('document1.txt').closest('.group');
      expect(sourceItem).toHaveClass('group');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty attached source IDs', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('handles non-existent source IDs', () => {
      renderComponent(['non-existent-id']);

      // Should show empty state since the ID doesn't match any sources
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('handles multiple attached sources', () => {
      renderComponent(['source-1', 'source-2', 'source-3']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document2.pdf')).toBeInTheDocument();
      expect(screen.getByText('document3.docx')).toBeInTheDocument();
    });

    it('handles large file sizes', () => {
      // The original mock has source-2 with file_size: 2048000 (~2.0 MB)
      renderComponent(['source-2']);

      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('handles loading state gracefully', () => {
      vi.doMock('@/lib/hooks/use-sources', () => ({
        useSources: () => ({
          data: undefined,
          isLoading: true,
        }),
      }));

      renderComponent(['source-1']);

      // Component should render without errors
      expect(screen.getByText('Attached Sources')).toBeInTheDocument();
    });
  });
});
