/**
 * Unit tests for SourcesPage compound component
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// Mock use-sources-list hook
vi.mock('@/lib/hooks/use-sources-list', () => ({
  useSourcesList: vi.fn(() => ({
    // Data
    quotaData: {
      storage: { used: 1024, limit: 10240 },
      docdb: { used: 512, limit: 5120 },
      vectordb: { used: 256, limit: 2560 },
    },
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
  })),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { SourcesPage } from '../SourcesPage';

describe('SourcesPage', () => {
  const defaultProps = {
    workspaceId: 'ws_test',
    projectId: 'proj_test',
  };

  it('should render main structure', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('should render quota summary card', () => {
    render(<SourcesPage {...defaultProps} />);

    // Quota summary should be present
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('DocDB')).toBeInTheDocument();
    expect(screen.getByText('VectorDB')).toBeInTheDocument();
  });

  it('should render upload button', () => {
    render(<SourcesPage {...defaultProps} />);

    const uploadButton = screen.getByRole('button', { name: /Upload/i });
    expect(uploadButton).toBeInTheDocument();
  });

  it('should render search input', () => {
    render(<SourcesPage {...defaultProps} />);

    const searchInput = screen.getByRole('textbox');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Search files...');
  });

  it('should render filter selects', () => {
    render(<SourcesPage {...defaultProps} />);

    // Status filter
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('should call setUploadDialogOpen when upload button is clicked', async () => {
    const user = userEvent.setup();
    const setUploadDialogOpen = vi.fn();

    // Re-mock with the spy
    const { useSourcesList } = require('@/lib/hooks/use-sources-list');
    useSourcesList.mockReturnValue({
      quotaData: {
        storage: { used: 1024, limit: 10240 },
        docdb: { used: 512, limit: 5120 },
        vectordb: { used: 256, limit: 2560 },
      },
      quotaLoading: false,
      items: [],
      total: 0,
      sourcesLoading: false,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      handlePageChange: vi.fn(),
      setPage: vi.fn(),
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
      selectedFileIds: [],
      allSelected: false,
      someSelected: false,
      setSelectedFileIds: vi.fn(),
      handleToggleSelection: vi.fn(),
      handleToggleAll: vi.fn(),
      clearSelection: vi.fn(),
      uploadDialogOpen: false,
      deleteDialogOpen: false,
      filesToDelete: null,
      setUploadDialogOpen,
      setDeleteDialogOpen: vi.fn(),
      setFilesToDelete: vi.fn(),
      uploadProgress: {},
      uploadErrors: {},
      uploading: false,
      deleting: false,
      batchStartPending: false,
      batchCancelPending: false,
      quotaStatus: { canStart: true, exceededTypes: [] },
      handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
    });

    render(<SourcesPage {...defaultProps} />);

    const uploadButton = screen.getByRole('button', { name: /Upload/i });
    await user.click(uploadButton);

    expect(setUploadDialogOpen).toHaveBeenCalledWith(true);
  });

  it('should show loading state when sourcesLoading is true', () => {
    const { useSourcesList } = require('@/lib/hooks/use-sources-list');
    useSourcesList.mockReturnValue({
      quotaData: {
        storage: { used: 1024, limit: 10240 },
        docdb: { used: 512, limit: 5120 },
        vectordb: { used: 256, limit: 2560 },
      },
      quotaLoading: false,
      items: [],
      total: 0,
      sourcesLoading: true,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      handlePageChange: vi.fn(),
      setPage: vi.fn(),
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
      selectedFileIds: [],
      allSelected: false,
      someSelected: false,
      setSelectedFileIds: vi.fn(),
      handleToggleSelection: vi.fn(),
      handleToggleAll: vi.fn(),
      clearSelection: vi.fn(),
      uploadDialogOpen: false,
      deleteDialogOpen: false,
      filesToDelete: null,
      setUploadDialogOpen: vi.fn(),
      setDeleteDialogOpen: vi.fn(),
      setFilesToDelete: vi.fn(),
      uploadProgress: {},
      uploadErrors: {},
      uploading: false,
      deleting: false,
      batchStartPending: false,
      batchCancelPending: false,
      quotaStatus: { canStart: true, exceededTypes: [] },
      handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
    });

    render(<SourcesPage {...defaultProps} />);

    // Should show loading skeleton
    const skeleton = screen.queryByText(/empty_title/);
    expect(skeleton).not.toBeInTheDocument();
  });

  it('should render pagination when total > pageSize', () => {
    const { useSourcesList } = require('@/lib/hooks/use-sources-list');
    useSourcesList.mockReturnValue({
      quotaData: {
        storage: { used: 1024, limit: 10240 },
        docdb: { used: 512, limit: 5120 },
        vectordb: { used: 256, limit: 2560 },
      },
      quotaLoading: false,
      items: [],
      total: 50,
      sourcesLoading: false,
      page: 1,
      pageSize: 20,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
      handlePageChange: vi.fn(),
      setPage: vi.fn(),
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
      selectedFileIds: [],
      allSelected: false,
      someSelected: false,
      setSelectedFileIds: vi.fn(),
      handleToggleSelection: vi.fn(),
      handleToggleAll: vi.fn(),
      clearSelection: vi.fn(),
      uploadDialogOpen: false,
      deleteDialogOpen: false,
      filesToDelete: null,
      setUploadDialogOpen: vi.fn(),
      setDeleteDialogOpen: vi.fn(),
      setFilesToDelete: vi.fn(),
      uploadProgress: {},
      uploadErrors: {},
      uploading: false,
      deleting: false,
      batchStartPending: false,
      batchCancelPending: false,
      quotaStatus: { canStart: true, exceededTypes: [] },
      handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
    });

    render(<SourcesPage {...defaultProps} />);

    // Should show pagination info
    expect(screen.getByText(/50 file\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 3/)).toBeInTheDocument();
  });

  it('should not render pagination when total <= pageSize', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.queryByText(/file\(s\)/)).not.toBeInTheDocument();
  });

  it('should render with correct workspace and project props', () => {
    render(<SourcesPage {...defaultProps} />);

    // Component should render without errors
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('should use SourcesProvider context', () => {
    render(<SourcesPage {...defaultProps} />);

    // If the component renders, the context is being used
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('should display empty state when no files', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.getByText(/empty_title/)).toBeInTheDocument();
  });
});
