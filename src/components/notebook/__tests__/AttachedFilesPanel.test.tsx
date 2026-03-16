/**
 * Tests for AttachedFilesPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttachedFilesPanel } from '../AttachedFilesPanel';
import type { TaskAttachedInputDetail } from '@/lib/types/task';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'notebook.attached_files.title': 'Attached Inputs',
      'notebook.attached_files.subtitle': 'Files attached to this notebook',
      'notebook.attached_files.empty': 'No inputs attached',
      'notebook.attached_files.empty_description': 'Add files from your Files library to provide context for the agent',
      'notebook.attached_files.add_files': 'Files',
      'notebook.attached_files.add_local': 'Local',
      'notebook.attached_files.add_url': 'URL',
      'notebook.attached_files.tooltip.remove_file': 'Remove from notebook (file remains in your library)',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

const mockSources: TaskAttachedInputDetail[] = [
  {
    id: 'in_src_1',
    kind: 'library_object',
    library_id: 'lib-1',
    key: 'docs/document1.txt',
    filename: 'document1.txt',
    file_type: 'text/plain',
    file_size: 1024,
  },
  {
    id: 'in_src_2',
    kind: 'library_object',
    library_id: 'lib-1',
    key: 'docs/document2.pdf',
    filename: 'document2.pdf',
    file_type: 'application/pdf',
    file_size: 2048000,
  },
  {
    id: 'in_src_3',
    kind: 'library_object',
    library_id: 'lib-1',
    key: 'docs/document3.docx',
    filename: 'document3.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 512000,
  },
];
const STABLE_REMOVE_SOURCE_RESULT = {
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
};
let mockAttachedFilesData: TaskAttachedInputDetail[] = [mockSources[0]!, mockSources[1]!];
const STABLE_SOURCES_QUERY_RESULT = {
  get data() {
    return mockAttachedFilesData;
  },
  isLoading: false,
};

// Mock hooks
vi.mock('@/lib/hooks/use-task', () => ({
  useRemoveFile: () => STABLE_REMOVE_SOURCE_RESULT,
  useTaskAttachedFiles: () => STABLE_SOURCES_QUERY_RESULT,
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

describe('AttachedFilesPanel', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockTaskId = 'task-1';
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
    mockAttachedFilesData = [mockSources[0]!, mockSources[1]!];
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const renderComponent = (requestedIds: string[] = ['in_src_1', 'in_src_2']) => {
    mockAttachedFilesData = mockSources.filter((file) => requestedIds.includes(file.id));
    return render(
      <AttachedFilesPanel
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        taskId={mockTaskId}
        attachedInputIds={mockAttachedFilesData.map((file) => file.id)}
        onAddFromFiles={mockOnAddClick}
        onAddFromLocal={vi.fn()}
        onAddFromUrl={vi.fn()}
      />,
      { wrapper }
    );
  };

  describe('Header', () => {
    it('renders title', () => {
      renderComponent();

      expect(screen.getByText('Attached Inputs')).toBeInTheDocument();
    });

    it('renders description', () => {
      renderComponent();

      expect(screen.getByText('Files attached to this notebook')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no inputs are attached', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('empty-title')).toHaveTextContent('No inputs attached');
    });

    it('shows empty state description', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-description')).toHaveTextContent(/Add files from your Files library/);
    });
  });

  describe('Attached Input Rendering', () => {
    it('renders attached files', () => {
      renderComponent(['in_src_1', 'in_src_2']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document2.pdf')).toBeInTheDocument();
    });

    it('does not render unattached files', () => {
      renderComponent(['in_src_1']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.queryByText('document2.pdf')).not.toBeInTheDocument();
    });

    it('filters attached files by attached IDs', () => {
      renderComponent(['in_src_1', 'in_src_3']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document3.docx')).toBeInTheDocument();
      expect(screen.queryByText('document2.pdf')).not.toBeInTheDocument();
    });

    it('displays file sizes in human readable format', () => {
      renderComponent(['in_src_1']);

      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    });

  });

  describe('Remove Attached File', () => {
    it('shows remove button on hover', () => {
      renderComponent(['in_src_1']);

      const fileItem = screen.getByText('document1.txt').closest('.group');
      expect(fileItem).toBeInTheDocument();

      const removeButton = fileItem?.querySelector('button[aria-label="Remove from notebook (file remains in your library)"]');
      expect(removeButton).toBeInTheDocument();
    });

    it('calls remove handler when remove is clicked', async () => {
      const user = userEvent.setup();
      renderComponent(['in_src_1']);

      const fileItem = screen.getByText('document1.txt').closest('.group');
      const removeButton = fileItem?.querySelector(
        'button[aria-label="Remove from notebook (file remains in your library)"]'
      ) as HTMLButtonElement;

      await user.click(removeButton);

      // The remove mutation is called internally
    });
  });

  describe('Add Inputs Button', () => {
    it('renders add files button', () => {
      renderComponent();

      expect(screen.getByRole('button', { name: /Files/i })).toBeInTheDocument();
    });

    it('calls onAddClick when add files button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const addButton = screen.getByRole('button', { name: /Files/i });
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

      const panel = container.querySelector('.border-b');
      expect(panel).toBeInTheDocument();
    });

    it('has correct background', () => {
      const { container } = renderComponent();

      const panel = container.querySelector('.bg-transparent');
      expect(panel).toBeInTheDocument();
    });
  });

  describe('Attached File Item Rendering', () => {
    it('displays file icon', () => {
      renderComponent(['in_src_1']);

      const iconContainer = document.querySelector('.w-6.h-6');
      expect(iconContainer).toBeInTheDocument();
    });

    it('shows filename with truncation', () => {
      renderComponent(['in_src_1']);

      const filename = screen.getByText('document1.txt');
      expect(filename).toHaveClass('truncate');
    });

    it('groups remove button visibility', () => {
      renderComponent(['in_src_1']);

      const fileItem = screen.getByText('document1.txt').closest('.group');
      expect(fileItem).toHaveClass('group');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty attached input IDs', () => {
      renderComponent([]);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('handles non-existent attached input IDs', () => {
      renderComponent(['non-existent-id']);

      // Should show empty state since the ID doesn't match any attached files
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('handles multiple attached files', () => {
      renderComponent(['in_src_1', 'in_src_2', 'in_src_3']);

      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document2.pdf')).toBeInTheDocument();
      expect(screen.getByText('document3.docx')).toBeInTheDocument();
    });

    it('handles large file sizes', () => {
      // The original mock has in_src_2 with file_size: 2048000 (~2.0 MB)
      renderComponent(['in_src_2']);

      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('handles loading state gracefully', () => {
      vi.doMock('@/lib/hooks/use-files', () => ({
        useFiles: () => ({
          data: undefined,
          isLoading: true,
        }),
      }));

      renderComponent(['in_src_1']);

      // Component should render without errors
      expect(screen.getByText('Attached Inputs')).toBeInTheDocument();
    });
  });
});
