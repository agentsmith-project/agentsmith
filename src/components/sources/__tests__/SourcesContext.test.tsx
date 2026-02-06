/**
 * Unit tests for SourcesContext (Provider and hook)
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { SourcesProvider, useSourcesContext } from '../SourcesContext';
import type { UseSourcesListReturn } from '@/lib/hooks/use-sources-list';

// Mock return value for useSourcesList
const mockContextValue: UseSourcesListReturn = {
  // Data
  quotaData: undefined,
  quotaLoading: false,
  items: [],
  total: 0,
  sourcesLoading: false,

  // Pagination
  page: 1,
  pageSize: 20,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
  handlePageChange: vi.fn(),
  setPage: vi.fn(),

  // Filters
  search: '',
  status: 'all',
  aiReadyOnly: false,
  sortBy: 'updated_at',
  sortOrder: 'desc',
  setSearch: vi.fn(),
  setStatus: vi.fn(),
  setAIReadyOnly: vi.fn(),
  setSortBy: vi.fn(),
  setSortOrder: vi.fn(),

  // Selection
  selectedFileIds: [],
  allSelected: false,
  someSelected: false,
  setSelectedFileIds: vi.fn(),
  handleToggleSelection: vi.fn(),
  handleToggleAll: vi.fn(),
  clearSelection: vi.fn(),

  // Dialogs
  uploadDialogOpen: false,
  deleteDialogOpen: false,
  filesToDelete: null,
  setUploadDialogOpen: vi.fn(),
  setDeleteDialogOpen: vi.fn(),
  setFilesToDelete: vi.fn(),

  // Upload state
  uploadProgress: {},
  uploadErrors: {},
  uploading: false,

  // Mutation states
  deleting: false,
  batchStartPending: false,
  batchCancelPending: false,

  // Quota status
  quotaStatus: { canStart: true, exceededTypes: [] },

  // Actions
  handleUpload: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleConfirmDelete: vi.fn(),
  handleBatchStartAIReady: vi.fn(),
  handleBatchCancelAIReady: vi.fn(),
  handleDownload: vi.fn(),
};

describe('SourcesProvider', () => {
  it('should provide context value to children', () => {
    const TestChild = () => {
      const context = useSourcesContext();
      return <div data-testid="context-received">{context.total}</div>;
    };

    render(
      <SourcesProvider value={mockContextValue}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('context-received')).toHaveTextContent('0');
  });

  it('should provide all context properties', () => {
    const TestChild = () => {
      const context = useSourcesContext();
      return (
        <div>
          <span data-testid="total">{context.total}</span>
          <span data-testid="page">{context.page}</span>
          <span data-testid="search">{context.search}</span>
        </div>
      );
    };

    render(
      <SourcesProvider value={mockContextValue}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('total')).toHaveTextContent('0');
    expect(screen.getByTestId('page')).toHaveTextContent('1');
    expect(screen.getByTestId('search')).toHaveTextContent('');
  });

  it('should update context when value prop changes', () => {
    const TestChild = () => {
      const context = useSourcesContext();
      return <div data-testid="context-total">{context.total}</div>;
    };

    const { rerender } = render(
      <SourcesProvider value={mockContextValue}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('context-total')).toHaveTextContent('0');

    const updatedValue = { ...mockContextValue, total: 10 };
    rerender(
      <SourcesProvider value={updatedValue}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('context-total')).toHaveTextContent('10');
  });

  it('should provide functions from context', () => {
    const TestChild = () => {
      const context = useSourcesContext();
      return (
        <div>
          <button onClick={() => context.setSearch('test')}>Set Search</button>
          <button onClick={() => context.setPage(2)}>Set Page</button>
        </div>
      );
    };

    render(
      <SourcesProvider value={mockContextValue}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByRole('button', { name: 'Set Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set Page' })).toBeInTheDocument();
  });
});

describe('useSourcesContext', () => {
  it('should return context value when used within provider', () => {
    const TestChild = () => {
      const context = useSourcesContext();
      expect(context).toEqual(mockContextValue);
      return null;
    };

    render(
      <SourcesProvider value={mockContextValue}>
        <TestChild />
      </SourcesProvider>
    );
  });

  it('should throw error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleError = console.error;
    console.error = vi.fn();

    const TestChild = () => {
      expect(() => useSourcesContext()).toThrow(
        'useSourcesContext must be used within SourcesProvider'
      );
      return null;
    };

    render(<TestChild />);

    console.error = consoleError;
  });

  it('should provide quota data from context', () => {
    const quotaData = {
      storage: { used: 1024, limit: 10240 },
      docdb: { used: 512, limit: 5120 },
      vectordb: { used: 256, limit: 2560 },
    };

    const valueWithQuota = { ...mockContextValue, quotaData };

    const TestChild = () => {
      const context = useSourcesContext();
      return (
        <div>
          <span data-testid="storage-used">{context.quotaData?.storage.used}</span>
        </div>
      );
    };

    render(
      <SourcesProvider value={valueWithQuota}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('storage-used')).toHaveTextContent('1024');
  });

  it('should provide upload progress from context', () => {
    const uploadProgress = { 'file1.pdf': 50, 'file2.txt': 100 };

    const valueWithProgress = { ...mockContextValue, uploadProgress };

    const TestChild = () => {
      const context = useSourcesContext();
      const file1Progress = context.uploadProgress['file1.pdf'];
      return <span data-testid="file1-progress">{file1Progress}</span>;
    };

    render(
      <SourcesProvider value={valueWithProgress}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('file1-progress')).toHaveTextContent('50');
  });

  it('should provide upload errors from context', () => {
    const uploadErrors = { 'file1.pdf': 'Upload failed' };

    const valueWithErrors = { ...mockContextValue, uploadErrors };

    const TestChild = () => {
      const context = useSourcesContext();
      const file1Error = context.uploadErrors['file1.pdf'];
      return <span data-testid="file1-error">{file1Error}</span>;
    };

    render(
      <SourcesProvider value={valueWithErrors}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('file1-error')).toHaveTextContent('Upload failed');
  });

  it('should provide selection state from context', () => {
    const selectedFileIds = ['file1', 'file2'];

    const valueWithSelection = { ...mockContextValue, selectedFileIds };

    const TestChild = () => {
      const context = useSourcesContext();
      return (
        <div>
          <span data-testid="selected-count">{context.selectedFileIds.length}</span>
        </div>
      );
    };

    render(
      <SourcesProvider value={valueWithSelection}>
        <TestChild />
      </SourcesProvider>
    );

    expect(screen.getByTestId('selected-count')).toHaveTextContent('2');
  });
});
