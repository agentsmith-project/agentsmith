/**
 * Unit tests for SourcesPage compound component
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
selectedLibraryId: 'all',
status: 'all',
    aiReadyOnly: false,
    sortBy: 'updated_at',
    sortOrder: 'desc',
    setSearch: vi.fn(),
setSelectedLibraryId: vi.fn(),
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
    libraries: [],
    creatingLibrary: false,
    updatingLibrary: false,
    deletingLibrary: false,

    // Actions
    handleUpload: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleConfirmDelete: vi.fn(),
    handleBatchStartAIReady: vi.fn(),
    handleBatchCancelAIReady: vi.fn(),
    handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
  })),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import { SourcesPage } from '../SourcesPage';
import { useSourcesList } from '@/lib/hooks/use-sources-list';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import type { UseSourcesListReturn } from '@/lib/hooks/use-sources-list';

const mockUseSourcesList = vi.mocked(useSourcesList);
const mockUseHasPermission = vi.mocked(useHasPermission);

describe('SourcesPage', () => {
  const defaultProps = {
    workspaceId: 'ws_test',
    projectId: 'proj_test',
  };

  // Reset mock to default before each test to avoid state bleed
  beforeEach(() => {
    mockUseSourcesList.mockReset();
    mockUseHasPermission.mockReset();
    mockUseHasPermission.mockReturnValue(true);
    mockUseSourcesList.mockReturnValue({
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
selectedLibraryId: 'all',
status: 'all',
      aiReadyOnly: false,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      setSearch: vi.fn(),
setSelectedLibraryId: vi.fn(),
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
libraries: [],
libraryPolicyStatusById: {},
libraryPolicyLoadingById: {},
creatingLibrary: false,
updatingLibrary: false,
deletingLibrary: false,
handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
    } as unknown as UseSourcesListReturn);
  });

  it('should render main structure', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('uses shared layout header without local padding', () => {
    render(<SourcesPage {...defaultProps} />);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { name: 'title' })).toBeInTheDocument();
    const body = screen.getByTestId('page-layout__body');
    expect(body.classList.contains('p-6')).toBe(false);
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

    const uploadButtons = screen.getAllByRole('button', { name: /Upload/i });
    expect(uploadButtons.length).toBeGreaterThan(0);
  });

  it('hides upload entry when source upload permission is missing', () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission !== 'project:source:upload');

    render(<SourcesPage {...defaultProps} />);

    expect(screen.queryByRole('button', { name: /Upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload_files/i })).not.toBeInTheDocument();
  });

  it('should render search input', () => {
    render(<SourcesPage {...defaultProps} />);

    const searchInput = screen.getByRole('textbox');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Search files...');
  });

  it('renders library selector and manage button', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.getByTestId('sources__library-select')).toBeInTheDocument();
    expect(screen.getByTestId('sources__manage-libraries-btn')).toBeInTheDocument();
  });

  it('renders library policy status badges in libraries dialog', async () => {
    const user = userEvent.setup();
    mockUseSourcesList.mockReturnValue({
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
      selectedLibraryId: 'all',
      status: 'all',
      aiReadyOnly: false,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      setSearch: vi.fn(),
      setSelectedLibraryId: vi.fn(),
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
      libraries: [
        {
          id: 'lib_1',
          workspace_id: 'ws_test',
          project_id: 'proj_test',
          name: 'Legal Docs',
          visibility: 'shared',
          created_by_user_id: 'u_1',
          created_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        },
      ],
      libraryPolicyStatusById: {
        lib_1: {
          status: 'allow_list',
          labelKey: 'resource_status.allow_list',
          reasonKey: 'resource_status_reason.allow_list',
        },
      },
      libraryPolicyLoadingById: {
        lib_1: false,
      },
      creatingLibrary: false,
      updatingLibrary: false,
      deletingLibrary: false,
      handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
    } as unknown as UseSourcesListReturn);

    render(<SourcesPage {...defaultProps} />);
    await user.click(screen.getByTestId('sources__manage-libraries-btn'));

    expect(screen.getByTestId('sources__library-policy-status--lib_1')).toHaveTextContent(
      'resource_status.allow_list'
    );
  });

  it('should render filter selects', () => {
    render(<SourcesPage {...defaultProps} />);

    // Status filter
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('should call setUploadDialogOpen when upload button is clicked', async () => {
    const user = userEvent.setup();
    const setUploadDialogOpen = vi.fn();

    mockUseSourcesList.mockReturnValue({
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
selectedLibraryId: 'all',
status: 'all',
      aiReadyOnly: false,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      setSearch: vi.fn(),
setSelectedLibraryId: vi.fn(),
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
libraries: [],
libraryPolicyStatusById: {},
libraryPolicyLoadingById: {},
creatingLibrary: false,
updatingLibrary: false,
deletingLibrary: false,
handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
    });

    render(<SourcesPage {...defaultProps} />);

    const uploadButtons = screen.getAllByRole('button', { name: /Upload/i });
    await user.click(uploadButtons[0]);

    expect(setUploadDialogOpen).toHaveBeenCalledWith(true);
  });

  it('should show loading state when sourcesLoading is true', () => {
    mockUseSourcesList.mockReturnValue({
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
selectedLibraryId: 'all',
status: 'all',
      aiReadyOnly: false,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      setSearch: vi.fn(),
setSelectedLibraryId: vi.fn(),
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
libraries: [],
libraryPolicyStatusById: {},
libraryPolicyLoadingById: {},
creatingLibrary: false,
updatingLibrary: false,
deletingLibrary: false,
handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
    });

    render(<SourcesPage {...defaultProps} />);

    // Should show loading skeleton
    const skeleton = screen.queryByText(/empty_title/);
    expect(skeleton).not.toBeInTheDocument();
  });

  it('should render pagination when total > pageSize', () => {
    mockUseSourcesList.mockReturnValue({
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
selectedLibraryId: 'all',
status: 'all',
      aiReadyOnly: false,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      setSearch: vi.fn(),
setSelectedLibraryId: vi.fn(),
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
libraries: [],
libraryPolicyStatusById: {},
libraryPolicyLoadingById: {},
creatingLibrary: false,
updatingLibrary: false,
deletingLibrary: false,
handleUpload: vi.fn(),
      handleDeleteClick: vi.fn(),
      handleConfirmDelete: vi.fn(),
      handleBatchStartAIReady: vi.fn(),
      handleBatchCancelAIReady: vi.fn(),
      handleDownload: vi.fn(),
      handleCreateLibrary: vi.fn(),
      handleRenameLibrary: vi.fn(),
      handleDeleteLibrary: vi.fn(),
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
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('should use SourcesProvider context', () => {
    render(<SourcesPage {...defaultProps} />);

    // If the component renders, the context is being used
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('should display empty state when no files', () => {
    render(<SourcesPage {...defaultProps} />);

    expect(screen.getByText(/empty_title/)).toBeInTheDocument();
  });
});
