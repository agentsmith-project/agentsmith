import { useCallback, useEffect, useRef, useState } from 'react';

import type { AIReadyStatus } from '@/lib/api/types';

export function useSourcesQueryState() {
  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Filters
  const [search, setSearch] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState('all');
  const [status, setStatus] = useState<AIReadyStatus | 'all'>('all');
  const [aiReadyOnly, setAIReadyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'updated_at' | 'file_size' | 'status'>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Selection
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  // Dialogs
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [filesToDelete, setFilesToDelete] = useState<{ ids: string[]; hasAIReady: boolean } | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const uploadCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timerRef = uploadCloseTimerRef;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    setSelectedFileIds([]);
  }, []);

  return {
    page,
    setPage,
    pageSize,
    search,
    setSearch,
    selectedLibraryId,
    setSelectedLibraryId,
    status,
    setStatus,
    aiReadyOnly,
    setAIReadyOnly,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    selectedFileIds,
    setSelectedFileIds,
    uploadDialogOpen,
    setUploadDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    filesToDelete,
    setFilesToDelete,
    uploadProgress,
    setUploadProgress,
    uploadErrors,
    setUploadErrors,
    uploadCloseTimerRef,
    handlePageChange,
  };
}
