/**
 * Unit tests for useFilesList hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock use-files hooks
vi.mock('../use-files', () => ({
  useFiles: vi.fn(() => ({
    data: { items: [], total: 0 },
    isLoading: false,
  })),
  useLimitSummary: vi.fn(() => ({
    data: {
      storage: { used: 1024, limit: 10240 },
      docdb: { used: 512, limit: 5120 },
      vectordb: { used: 256, limit: 2560 },
    },
    isLoading: false,
  })),
  useUploadFile: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useDeleteFile: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })),
  useBatchAIReadyActions: vi.fn(() => ({
    batchStart: {
      mutate: vi.fn(),
      isPending: false,
    },
    batchCancel: {
      mutate: vi.fn(),
      isPending: false,
    },
  })),
  useFileLibraries: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
  })),
  useCreateFileLibrary: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useUpdateFileLibrary: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useDeleteFileLibrary: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })),
}));

// Mock other dependencies
vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function() {
    return {
      download: vi.fn().mockResolvedValue(new Blob()),
    };
  }),
  MemberAPI: vi.fn().mockImplementation(function() {
    return {
      getResourcePolicy: vi.fn().mockResolvedValue({
        resource_type: 'source_library',
        resource_id: 'lib_1',
        access_mode: 'allow_all_members',
        allowed_subjects: [],
        rate_limits: { rules: [] },
        spending_limits: { rules: [] },
      }),
    };
  }),
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    files: {
      list: vi.fn(() => ['files']),
    },
    limits: {
      detail: vi.fn(() => ['limits']),
    },
    fileLibraries: {
      list: vi.fn(() => ['file-libraries']),
    },
  },
}));

vi.mock('../use-error-handler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

import { useFilesList } from '../use-files-list';

const workspaceId = 'ws_test';
const projectId = 'proj_test';

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

describe('useFilesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(
      () => useFilesList({ workspaceId, projectId }),
      {
        wrapper: createTestWrapper(),
      }
    );

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.search).toBe('');
    expect(result.current.status).toBe('all');
    expect(result.current.aiReadyOnly).toBe(false);
    expect(result.current.selectedLibraryId).toBe('all');
    expect(result.current.libraries).toEqual([]);
    expect(result.current.selectedFileIds).toEqual([]);
    expect(result.current.uploadDialogOpen).toBe(false);
    expect(result.current.deleteDialogOpen).toBe(false);
  });

  it('should provide limit summary data', () => {
    const { result } = renderHook(
      () => useFilesList({ workspaceId, projectId }),
      {
        wrapper: createTestWrapper(),
      }
    );

    expect(result.current.limitSummaryData).toBeDefined();
    expect(result.current.limitSummaryData?.storage.used).toBe(1024);
  });

  it('should provide items array', () => {
    const { result } = renderHook(
      () => useFilesList({ workspaceId, projectId }),
      {
        wrapper: createTestWrapper(),
      }
    );

    expect(result.current.items).toEqual([]);
  });

  it('should calculate pagination values correctly', () => {
    const { result } = renderHook(
      () => useFilesList({ workspaceId, projectId }),
      {
        wrapper: createTestWrapper(),
      }
    );

    expect(result.current.total).toBe(0);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrev).toBe(false);
  });

  describe('search', () => {
    it('should update search value', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSearch('test query');
      });

      expect(result.current.search).toBe('test query');
    });

    it('should clear search value', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSearch('test');
        result.current.setSearch('');
      });

      expect(result.current.search).toBe('');
    });
  });

  describe('status filter', () => {
    it('should update status filter', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setStatus('ready');
      });

      expect(result.current.status).toBe('ready');
    });

    it('should accept "all" status', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setStatus('all');
      });

      expect(result.current.status).toBe('all');
    });
  });

  describe('aiReadyOnly filter', () => {
    it('should update aiReadyOnly filter', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setAIReadyOnly(true);
      });

      expect(result.current.aiReadyOnly).toBe(true);
    });

    it('should toggle aiReadyOnly filter', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setAIReadyOnly(true);
        result.current.setAIReadyOnly(false);
      });

      expect(result.current.aiReadyOnly).toBe(false);
    });
  });

  describe('sorting', () => {
    it('should update sortBy', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSortBy('file_size');
      });

      expect(result.current.sortBy).toBe('file_size');
    });

    it('should update sortOrder', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSortOrder('asc');
      });

      expect(result.current.sortOrder).toBe('asc');
    });
  });

  describe('pagination', () => {
    it('should update page', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setPage(2);
      });

      expect(result.current.page).toBe(2);
    });

    it('should clear selection when page changes via handlePageChange', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSelectedFileIds(['file1', 'file2']);
      });

      act(() => {
        result.current.handlePageChange(2);
      });

      expect(result.current.selectedFileIds).toEqual([]);
    });
  });

  describe('selection', () => {
    it('should update selected file IDs', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSelectedFileIds(['file1', 'file2']);
      });

      expect(result.current.selectedFileIds).toEqual(['file1', 'file2']);
    });

    it('should toggle single file selection', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.handleToggleSelection('file1');
      });

      expect(result.current.selectedFileIds).toEqual(['file1']);

      act(() => {
        result.current.handleToggleSelection('file1');
      });

      expect(result.current.selectedFileIds).toEqual([]);
    });

    it('should handle toggle all', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      // With empty items, should select nothing
      act(() => {
        result.current.handleToggleAll();
      });

      expect(result.current.selectedFileIds).toEqual([]);
    });

    it('should clear selection', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSelectedFileIds(['file1', 'file2']);
        result.current.clearSelection();
      });

      expect(result.current.selectedFileIds).toEqual([]);
    });

    it('should calculate allSelected correctly', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.allSelected).toBe(false);
    });

    it('should calculate someSelected correctly', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setSelectedFileIds(['file1']);
      });

      expect(result.current.someSelected).toBe(false); // No items to compare
    });
  });

  describe('dialogs', () => {
    it('should open upload dialog', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setUploadDialogOpen(true);
      });

      expect(result.current.uploadDialogOpen).toBe(true);
    });

    it('should close upload dialog', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setUploadDialogOpen(true);
        result.current.setUploadDialogOpen(false);
      });

      expect(result.current.uploadDialogOpen).toBe(false);
    });

    it('should open delete dialog', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setDeleteDialogOpen(true);
      });

      expect(result.current.deleteDialogOpen).toBe(true);
    });

    it('should set files to delete', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      act(() => {
        result.current.setFilesToDelete({
          ids: ['file1', 'file2'],
          hasAIReady: true,
        });
      });

      expect(result.current.filesToDelete).toEqual({
        ids: ['file1', 'file2'],
        hasAIReady: true,
      });
    });
  });

  describe('limit status', () => {
    it('should calculate limit status correctly', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.limitStatus.canStart).toBe(true);
      expect(result.current.limitStatus.exceededTypes).toEqual([]);
    });
  });

  describe('actions', () => {
    it('should have handleUpload function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleUpload).toBeDefined();
      expect(typeof result.current.handleUpload).toBe('function');
    });

    it('should have handleDeleteClick function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleDeleteClick).toBeDefined();
      expect(typeof result.current.handleDeleteClick).toBe('function');
    });

    it('should have handleConfirmDelete function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleConfirmDelete).toBeDefined();
      expect(typeof result.current.handleConfirmDelete).toBe('function');
    });

    it('should have handleBatchStartAIReady function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleBatchStartAIReady).toBeDefined();
      expect(typeof result.current.handleBatchStartAIReady).toBe('function');
    });

    it('should have handleBatchCancelAIReady function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleBatchCancelAIReady).toBeDefined();
      expect(typeof result.current.handleBatchCancelAIReady).toBe('function');
    });

    it('should have handleDownload function', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.handleDownload).toBeDefined();
      expect(typeof result.current.handleDownload).toBe('function');
    });
  });

  describe('mutation states', () => {
    it('should track uploading state', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.uploading).toBe(false);
    });

    it('should track deleting state', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.deleting).toBe(false);
    });

    it('should track batch start pending state', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.batchStartPending).toBe(false);
    });

    it('should track batch cancel pending state', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.batchCancelPending).toBe(false);
    });
  });

  describe('upload progress and errors', () => {
    it('should initialize with empty upload progress', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.uploadProgress).toEqual({});
    });

    it('should initialize with empty upload errors', () => {
      const { result } = renderHook(
        () => useFilesList({ workspaceId, projectId }),
        {
          wrapper: createTestWrapper(),
        }
      );

      expect(result.current.uploadErrors).toEqual({});
    });
  });
});
