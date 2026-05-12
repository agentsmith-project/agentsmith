/**
 * Files Page - Object Browser (MinIO-like)
 *
 * This page intentionally focuses on the file manager UX:
 * libraries + folders (prefixes) + objects (keys).
 *
 * This page focuses on project file libraries and filesystem browsing.
 */

'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { PageLayout } from '@/components/layout/PageLayout';
import { FilesPageContent } from '@/components/files/files-page/FilesPageContent';
import { FileLibraryRecoveryDialog } from '@/components/files/file-library-recovery/FileLibraryRecoveryDialog';
import { LibraryDialogs } from '@/components/files/files-page/LibraryDialogs';
import { MoveDialogs } from '@/components/files/files-page/MoveDialogs';
import { ObjectOperationDialogs } from '@/components/files/files-page/ObjectOperationDialogs';

import type {
  FileObjectsListItem,
  FileObjectsListParams,
  FileObjectsListResponse,
} from '@/lib/api/types';
import { FilesAPI } from '@/lib/api/endpoints/files';
import { useFilesPageCapabilities } from '@/lib/hooks/use-permissions';
import {
  useCreateFileLibrary,
  useDeleteFileLibrary,
  useFileLibraries,
  useUpdateFileLibrary,
} from '@/lib/hooks/use-files';
import {
  useCreateFileFolder,
  useDeleteFileObjects,
  useMoveFileObject,
  useFileObjectsInfinite,
  useUploadFileObject,
} from '@/lib/hooks/use-file-objects';
import {
  DEFAULT_FILES_BROWSE_PREFIX,
  useFilesUrlState,
  type FileSortBy,
  type FileSortOrder,
} from '@/lib/hooks/use-files-url-state';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import {
  useFileUploadManager,
  type FileUploadTargetContext,
  type UploadedFileObjectIdentity,
} from '@/components/files/hooks/use-file-upload-manager';
import { useFileBatchOperations } from '@/components/files/hooks/use-file-batch-operations';
import { useFileLibraryManager } from '@/components/files/hooks/use-file-library-manager';
import { useFileFolderMoveManager } from '@/components/files/hooks/use-file-folder-move-manager';
import { useFilesSelectionState } from '@/components/files/files-page/useFilesSelectionState';
import {
  basename,
  buildCrumbs,
  getRuntimeSystemDotFolderInfos,
  parentPrefixForKey,
  parentPrefixForPrefix,
} from '@/components/files/files-page/utils';
import {
  useAuthStore,
  useAuthStoreHydration,
  selectIsAuthenticated,
  selectToken,
} from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api/client';

export interface FilesPageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
}

type FilesWorkspaceSurface = 'browser' | 'no_library';
type FileObjectsInfiniteData = { pages: FileObjectsListResponse[]; pageParams?: unknown[] };
type UploadListingParams = Omit<FileObjectsListParams, 'continuation_token'>;
type UploadTargetListingParams = Omit<FileObjectsListParams, 'continuation_token' | 'search' | 'sort_by' | 'sort_order'>;
type UploadListingSyncPageBudget = { remainingPages: number };
type UploadListingSyncOptions = { signal?: AbortSignal };
type UploadListingSyncDeadline = ReturnType<typeof createUploadListingSyncDeadline>;
type RequiredUploadListingSyncOutcome =
  | { status: 'confirmed' }
  | { status: 'missing' };
type BestEffortUploadListingSyncOutcome =
  | { status: 'best_effort_refreshed' }
  | { status: 'best_effort_failed' }
  | { status: 'best_effort_timed_out' }
  | { status: 'aborted' };
type UploadListingSyncScanState = {
  pages: FileObjectsListResponse[];
  pageParams: Array<string | undefined>;
  seenContinuationTokens: Set<string>;
  nextContinuationToken: string | undefined;
  exhausted: boolean;
};

const UPLOAD_LISTING_SYNC_TIMEOUT_MS = 5_000;
const UPLOAD_LISTING_SYNC_INITIAL_INTERVAL_MS = 100;
const UPLOAD_LISTING_SYNC_MAX_INTERVAL_MS = 750;
const UPLOAD_TARGET_LISTING_PAGE_SIZE = 200;
const UPLOAD_TARGET_LISTING_MAX_SYNC_PAGES = 25;
const UPLOAD_TARGET_LISTING_MAX_SCAN_PAGES = 5;

function createUploadListingSyncPageBudget(): UploadListingSyncPageBudget {
  return { remainingPages: UPLOAD_TARGET_LISTING_MAX_SYNC_PAGES };
}

function createUploadListingSyncScanState(): UploadListingSyncScanState {
  return {
    pages: [],
    pageParams: [],
    seenContinuationTokens: new Set<string>(),
    nextContinuationToken: undefined,
    exhausted: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectMatchesUploadedIdentity(
  item: FileObjectsListItem,
  uploadedObject: UploadedFileObjectIdentity,
) {
  if (item.kind !== 'object') return false;

  const itemStableIdentity = typeof item.key === 'string' && item.key.trim().length > 0
    ? item.key
    : undefined;
  const uploadedStableIdentities = [uploadedObject.key, uploadedObject.path]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (uploadedStableIdentities.length > 0) {
    return !!itemStableIdentity
      && uploadedStableIdentities.every((identity) => itemStableIdentity === identity);
  }

  if (itemStableIdentity) return false;
  const uploadedName = typeof uploadedObject.name === 'string' && uploadedObject.name.trim().length > 0
    ? uploadedObject.name
    : undefined;
  return !!uploadedName && item.name === uploadedName;
}

function listingContainsUploadedObjects(
  data: FileObjectsInfiniteData,
  uploadedObjects: UploadedFileObjectIdentity[],
) {
  const items = data.pages.flatMap((page) => page.items);
  return uploadedObjects.every((uploadedObject) =>
    items.some((item) => objectMatchesUploadedIdentity(item, uploadedObject)),
  );
}

function createUploadListingSyncAbortError() {
  const error = new Error('file_upload_listing_sync_aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfUploadListingSyncAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createUploadListingSyncAbortError();
  }
}

function waitForUploadListingSyncInterval(intervalMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createUploadListingSyncAbortError());
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      reject(createUploadListingSyncAbortError());
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, intervalMs);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function waitForUploadListingSyncRequest<T>(request: Promise<T>, signal?: AbortSignal) {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(createUploadListingSyncAbortError());
      return;
    }
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort);
      reject(createUploadListingSyncAbortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    request.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        if (signal.aborted) {
          reject(createUploadListingSyncAbortError());
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

function createUploadListingSyncDeadline(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => {
    controller.abort();
  };
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPLOAD_LISTING_SYNC_TIMEOUT_MS);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      window.clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function getBestEffortUploadListingSyncInterruptedOutcome(
  parentSignal: AbortSignal | undefined,
  deadline: UploadListingSyncDeadline,
): BestEffortUploadListingSyncOutcome | null {
  if (parentSignal?.aborted) return { status: 'aborted' };
  if (deadline.didTimeout()) return { status: 'best_effort_timed_out' };
  return null;
}

function getFileObjectsInfiniteQueryKey(
  workspaceId: string,
  projectId: string,
  libraryId: string,
  params: UploadListingParams | UploadTargetListingParams,
) {
  return ['file-objects', 'infinite', workspaceId, projectId, libraryId, params] as const;
}

function normalizeUploadTargetPrefix(prefix: unknown) {
  return typeof prefix === 'string' ? prefix : '';
}

function getUploadTargetListingParams(target: FileUploadTargetContext): UploadTargetListingParams {
  return {
    prefix: target.prefix || undefined,
    delimiter: '/',
    page_size: UPLOAD_TARGET_LISTING_PAGE_SIZE,
  };
}

function getUploadListingContinuationToken(page: FileObjectsListResponse) {
  const token = page.next_continuation_token;
  return typeof token === 'string' && token.trim().length > 0 ? token : undefined;
}

function fileObjectsInfiniteQueryKeyMatchesUploadTarget(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  target: FileUploadTargetContext,
) {
  if (queryKey.length < 6) return false;
  const [scope, mode, queryWorkspaceId, queryProjectId, queryLibraryId, rawParams] = queryKey;
  if (
    scope !== 'file-objects'
    || mode !== 'infinite'
    || queryWorkspaceId !== workspaceId
    || queryProjectId !== projectId
    || queryLibraryId !== target.libraryId
    || !isRecord(rawParams)
  ) {
    return false;
  }
  return normalizeUploadTargetPrefix(rawParams.prefix) === target.prefix;
}

function currentViewCanShowUploadedObjects(
  selectedLibraryId: string | null,
  prefix: string,
  search: string,
  sortBy: FileSortBy,
  sortOrder: FileSortOrder,
  target: FileUploadTargetContext,
) {
  return selectedLibraryId === target.libraryId
    && prefix === target.prefix
    && search.trim().length === 0
    && sortBy === 'name'
    && sortOrder === 'asc';
}

function cloneCanonicalFileObjectsInfiniteData(data: FileObjectsInfiniteData): FileObjectsInfiniteData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: [...page.items],
    })),
    ...(data.pageParams ? { pageParams: [...data.pageParams] } : {}),
  };
}

function getUploadListingScanData(scanState: UploadListingSyncScanState): FileObjectsInfiniteData {
  return {
    pages: [...scanState.pages],
    pageParams: [...scanState.pageParams],
  };
}

export function FilesPage({ workspaceId, projectId, locale = 'en-US' }: FilesPageProps) {
  const t = useTranslations('files');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const filesApi = React.useMemo(() => new FilesAPI(getApiClient()), []);
  const authHydrated = useAuthStoreHydration();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const token = useAuthStore(selectToken);
  const [apiClientAuthReady, setApiClientAuthReady] = React.useState(false);
  React.useEffect(() => {
    if (!authHydrated) {
      setApiClientAuthReady(false);
      return;
    }
    const client = getApiClient();
    if (token) {
      client.setToken(token);
      setApiClientAuthReady(true);
      return;
    }
    client.clearToken();
    setApiClientAuthReady(false);
  }, [authHydrated, token]);
  const authReady = authHydrated && isAuthenticated && !!token && apiClientAuthReady;
  const { canManage } = useFilesPageCapabilities();
  const { layoutMode } = useProjectLayoutMode();

  const { data: librariesData, isLoading: libsLoading } = useFileLibraries(workspaceId, projectId, {
    enabled: authReady,
  });
  const libraries = React.useMemo(() => librariesData?.items ?? [], [librariesData?.items]);
  const {
    prefix,
    search,
    searchInput,
    selectedLibraryId,
    setPrefix,
    setSearchImmediately,
    setSearchInput,
    setSelectedLibraryId,
    sortBy,
    sortOrder,
    updateSort,
  } = useFilesUrlState(libraries, { defaultPrefix: DEFAULT_FILES_BROWSE_PREFIX });
  const selectedLibrary = React.useMemo(
    () => libraries.find((library) => library.id === selectedLibraryId) ?? null,
    [libraries, selectedLibraryId],
  );
  const selectedLibraryReady = selectedLibrary?.status === 'ready';
  const workspaceSurface = React.useMemo<FilesWorkspaceSurface>(
    () => (libraries.length === 0 ? 'no_library' : 'browser'),
    [libraries.length],
  );
  const canBrowseSelectedLibrary = workspaceSurface === 'browser' && selectedLibraryId !== null;

  const listParams = React.useMemo(
    () => ({
      prefix,
      delimiter: '/' as const,
      page_size: 200,
      search: search || undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    [prefix, search, sortBy, sortOrder],
  );
  const uploadTarget = React.useMemo<FileUploadTargetContext | null>(
    () => (canManage && selectedLibraryId ? { libraryId: selectedLibraryId, prefix } : null),
    [canManage, prefix, selectedLibraryId],
  );
  const uploadViewRef = React.useRef({ selectedLibraryId, prefix, search, sortBy, sortOrder, listParams });
  uploadViewRef.current = { selectedLibraryId, prefix, search, sortBy, sortOrder, listParams };
  const objectsQuery = useFileObjectsInfinite(workspaceId, projectId, selectedLibraryId, listParams, {
    enabled: authReady && canBrowseSelectedLibrary,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const items = React.useMemo(
    () => (canBrowseSelectedLibrary ? (objectsQuery.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [canBrowseSelectedLibrary, objectsQuery.data?.pages],
  );
  const filteredItems = items;

  const createLibrary = useCreateFileLibrary();
  const updateLibrary = useUpdateFileLibrary();
  const deleteLibrary = useDeleteFileLibrary();

  const createFolder = useCreateFileFolder();
  const uploadObject = useUploadFileObject();
  const deleteObjects = useDeleteFileObjects();
  const moveObject = useMoveFileObject();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const crumbs = React.useMemo(() => buildCrumbs(prefix), [prefix]);
  const {
    allSelected,
    clearSelection,
    handleRowActivate,
    handleToggleRowCheckbox,
    hasSelection,
    navigateToPrefix,
    selectLibrary,
    selected,
    selectedIds,
    selectedObjects,
    selectionMode,
    setSelectedIds,
    toggleAll,
  } = useFilesSelectionState({
    defaultPrefix: DEFAULT_FILES_BROWSE_PREFIX,
    filteredItems,
    isFetching: objectsQuery.isFetching,
    libraries,
    prefix,
    searchInput,
    selectedLibraryId,
    sortBy,
    sortOrder,
    setPrefix,
    setSearchImmediately,
    setSelectedLibraryId,
    updateSort,
  });

  const handleRowOpen = React.useCallback(
    (item: FileObjectsListItem) => {
      if (selectionMode !== 'single') return;
      if (item.kind === 'prefix') {
        navigateToPrefix(item.prefix);
      }
    },
    [navigateToPrefix, selectionMode],
  );

  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [fileStatesOpen, setFileStatesOpen] = React.useState(false);
  const openFileStates = React.useCallback(() => {
    if (!canManage || !selectedLibraryReady) return;
    setFileStatesOpen(true);
  }, [canManage, selectedLibraryReady]);
  const handleFileStatesOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen && (!canManage || !selectedLibraryReady)) return;
    setFileStatesOpen(nextOpen);
  }, [canManage, selectedLibraryReady]);

  React.useEffect(() => {
    if (fileStatesOpen && (!canManage || !selectedLibraryReady)) {
      setFileStatesOpen(false);
    }
  }, [canManage, fileStatesOpen, selectedLibraryReady]);

  const selectedForMove = selected.length === 1 ? selected[0] : null;
  const deleteRuntimeSystemTargets = React.useMemo(
    () => getRuntimeSystemDotFolderInfos(selected),
    [selected],
  );
  const moveNamePlaceholder = selectedForMove
    ? (selectedForMove.kind === 'object' ? basename(selectedForMove.key) : basename(selectedForMove.prefix))
    : '';

  const handleUploadClick = () => {
    if (!canManage) return;
    fileInputRef.current?.click();
  };
  const refreshUploadTargetQueries = React.useCallback(
    async (target: FileUploadTargetContext, options?: UploadListingSyncOptions) => {
      throwIfUploadListingSyncAborted(options?.signal);
      await waitForUploadListingSyncRequest(
        queryClient.refetchQueries({
          predicate: (query) => fileObjectsInfiniteQueryKeyMatchesUploadTarget(
            query.queryKey,
            workspaceId,
            projectId,
            target,
          ),
          type: 'active',
        }, { throwOnError: true }),
        options?.signal,
      );
      throwIfUploadListingSyncAborted(options?.signal);
    },
    [projectId, queryClient, workspaceId],
  );
  const fetchUploadTargetListing = React.useCallback(
    async (
      target: FileUploadTargetContext,
      options?: UploadListingSyncOptions & {
        pageBudget?: UploadListingSyncPageBudget;
        scanState?: UploadListingSyncScanState;
        maxPages?: number;
        uploadedObjects?: UploadedFileObjectIdentity[];
      },
    ) => {
      const targetParams = getUploadTargetListingParams(target);
      const queryKey = getFileObjectsInfiniteQueryKey(workspaceId, projectId, target.libraryId, targetParams);
      const shouldScanContinuation = (options?.uploadedObjects?.length ?? 0) > 0;
      const pageBudget = options?.pageBudget ?? createUploadListingSyncPageBudget();
      const scanState = options?.scanState ?? createUploadListingSyncScanState();
      const maxPages = options?.maxPages ?? (shouldScanContinuation ? pageBudget.remainingPages : 1);

      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
      let scannedPages = 0;

      while (
        pageBudget.remainingPages > 0
        && scannedPages < maxPages
        && !scanState.exhausted
      ) {
        throwIfUploadListingSyncAborted(options?.signal);
        const continuationToken = scanState.nextContinuationToken;
        pageBudget.remainingPages -= 1;
        scannedPages += 1;
        const page = await waitForUploadListingSyncRequest(
          filesApi.listObjects(workspaceId, projectId, target.libraryId, {
            ...targetParams,
            ...(continuationToken ? { continuation_token: continuationToken } : {}),
          }, { signal: options?.signal }),
          options?.signal,
        );
        throwIfUploadListingSyncAborted(options?.signal);

        scanState.pages.push(page);
        scanState.pageParams.push(continuationToken);
        const data = getUploadListingScanData(scanState);
        const uploadedObjects = options?.uploadedObjects ?? [];

        if (
          shouldScanContinuation
          && listingContainsUploadedObjects(data, uploadedObjects)
        ) {
          queryClient.setQueryData<FileObjectsInfiniteData>(
            queryKey,
            cloneCanonicalFileObjectsInfiniteData(data),
          );
          return data;
        }

        const nextContinuationToken = getUploadListingContinuationToken(page);
        if (
          !shouldScanContinuation
          || !nextContinuationToken
          || scanState.seenContinuationTokens.has(nextContinuationToken)
        ) {
          scanState.nextContinuationToken = undefined;
          scanState.exhausted = true;
          queryClient.setQueryData<FileObjectsInfiniteData>(
            queryKey,
            cloneCanonicalFileObjectsInfiniteData(data),
          );
          return data;
        }

        scanState.seenContinuationTokens.add(nextContinuationToken);
        scanState.nextContinuationToken = nextContinuationToken;
      }

      const data = getUploadListingScanData(scanState);
      queryClient.setQueryData<FileObjectsInfiniteData>(
        queryKey,
        cloneCanonicalFileObjectsInfiniteData(data),
      );
      return data;
    },
    [filesApi, projectId, queryClient, workspaceId],
  );
  const syncVisibleUploadTargetCache = React.useCallback(
    (
      target: FileUploadTargetContext,
      uploadedObjects: UploadedFileObjectIdentity[],
      sourceData: FileObjectsInfiniteData,
    ) => {
      const latestView = uploadViewRef.current;
      if (!currentViewCanShowUploadedObjects(
        latestView.selectedLibraryId,
        latestView.prefix,
        latestView.search,
        latestView.sortBy,
        latestView.sortOrder,
        target,
      )) {
        return false;
      }

      const activeQueryKey = getFileObjectsInfiniteQueryKey(
        workspaceId,
        projectId,
        target.libraryId,
        latestView.listParams,
      );
      if (!listingContainsUploadedObjects(sourceData, uploadedObjects)) {
        return false;
      }
      queryClient.setQueryData<FileObjectsInfiniteData>(
        activeQueryKey,
        cloneCanonicalFileObjectsInfiniteData(sourceData),
      );

      return true;
    },
    [projectId, queryClient, workspaceId],
  );
  const syncBestEffortUploadTargetCache = React.useCallback(
    async (
      target: FileUploadTargetContext,
      options: UploadListingSyncOptions & {
        pageBudget: UploadListingSyncPageBudget;
        parentSignal?: AbortSignal;
        deadline: UploadListingSyncDeadline;
      },
    ): Promise<BestEffortUploadListingSyncOutcome> => {
      const { deadline, pageBudget, parentSignal } = options;
      if (parentSignal?.aborted) return { status: 'aborted' };

      try {
        await refreshUploadTargetQueries(target, options);
      } catch {
        const interruptedOutcome = getBestEffortUploadListingSyncInterruptedOutcome(parentSignal, deadline);
        if (interruptedOutcome) return interruptedOutcome;
      }

      const afterRefreshOutcome = getBestEffortUploadListingSyncInterruptedOutcome(parentSignal, deadline);
      if (afterRefreshOutcome) return afterRefreshOutcome;

      try {
        await fetchUploadTargetListing(target, { ...options, pageBudget });
      } catch {
        const interruptedOutcome = getBestEffortUploadListingSyncInterruptedOutcome(parentSignal, deadline);
        if (interruptedOutcome) return interruptedOutcome;
        return { status: 'best_effort_failed' };
      }

      const afterListingOutcome = getBestEffortUploadListingSyncInterruptedOutcome(parentSignal, deadline);
      if (afterListingOutcome) return afterListingOutcome;

      return { status: 'best_effort_refreshed' };
    },
    [fetchUploadTargetListing, refreshUploadTargetQueries],
  );
  const confirmVisibleUploadTargetListing = React.useCallback(
    async (
      target: FileUploadTargetContext,
      uploadedObjects: UploadedFileObjectIdentity[],
      options: UploadListingSyncOptions & { pageBudget: UploadListingSyncPageBudget },
    ): Promise<RequiredUploadListingSyncOutcome> => {
      await refreshUploadTargetQueries(target, options);
      throwIfUploadListingSyncAborted(options.signal);

      const startedAt = Date.now();
      let nextIntervalMs = UPLOAD_LISTING_SYNC_INITIAL_INTERVAL_MS;
      let scanState = createUploadListingSyncScanState();

      while (
        Date.now() - startedAt <= UPLOAD_LISTING_SYNC_TIMEOUT_MS
        && options.pageBudget.remainingPages > 0
      ) {
        throwIfUploadListingSyncAborted(options.signal);
        if (scanState.exhausted) {
          scanState = createUploadListingSyncScanState();
        }
        const data = await fetchUploadTargetListing(target, {
          ...options,
          scanState,
          maxPages: UPLOAD_TARGET_LISTING_MAX_SCAN_PAGES,
          uploadedObjects,
        });
        throwIfUploadListingSyncAborted(options.signal);
        if (listingContainsUploadedObjects(data, uploadedObjects)) {
          syncVisibleUploadTargetCache(target, uploadedObjects, data);
          return { status: 'confirmed' };
        }
        if (options.pageBudget.remainingPages <= 0) break;

        const elapsedMs = Date.now() - startedAt;
        const remainingMs = UPLOAD_LISTING_SYNC_TIMEOUT_MS - elapsedMs;
        if (remainingMs <= 0) break;

        await waitForUploadListingSyncInterval(Math.min(nextIntervalMs, remainingMs), options.signal);
        nextIntervalMs = Math.min(nextIntervalMs * 1.5, UPLOAD_LISTING_SYNC_MAX_INTERVAL_MS);
        throwIfUploadListingSyncAborted(options.signal);
        if (options.pageBudget.remainingPages > 0) {
          await refreshUploadTargetQueries(target, options);
        }
      }

      return { status: 'missing' };
    },
    [fetchUploadTargetListing, refreshUploadTargetQueries, syncVisibleUploadTargetCache],
  );
  const syncUploadedObjects = React.useCallback(
    async (
      target: FileUploadTargetContext,
      uploadedObjects: UploadedFileObjectIdentity[],
      options?: UploadListingSyncOptions,
    ) => {
      if (uploadedObjects.length === 0) return;

      const deadline = createUploadListingSyncDeadline(options?.signal);
      const syncOptions: UploadListingSyncOptions = { ...options, signal: deadline.signal };
      try {
        throwIfUploadListingSyncAborted(syncOptions.signal);
        const pageBudget = createUploadListingSyncPageBudget();
        const latestView = uploadViewRef.current;
        const shouldWaitForVisibleListing = currentViewCanShowUploadedObjects(
          latestView.selectedLibraryId,
          latestView.prefix,
          latestView.search,
          latestView.sortBy,
          latestView.sortOrder,
          target,
        );

        if (!shouldWaitForVisibleListing) {
          const outcome = await syncBestEffortUploadTargetCache(target, {
            ...syncOptions,
            pageBudget,
            parentSignal: options?.signal,
            deadline,
          });
          switch (outcome.status) {
            case 'aborted':
              throw createUploadListingSyncAbortError();
            case 'best_effort_failed':
            case 'best_effort_refreshed':
            case 'best_effort_timed_out':
              return;
          }
        }

        try {
          const outcome = await confirmVisibleUploadTargetListing(target, uploadedObjects, {
            ...syncOptions,
            pageBudget,
          });
          switch (outcome.status) {
            case 'confirmed':
              return;
            case 'missing':
              throw new Error(t('file_manager.upload_sync_missing'));
          }
        } catch (err) {
          if (deadline.didTimeout() && !options?.signal?.aborted) {
            throw new Error(t('file_manager.upload_sync_missing'));
          }
          throw err;
        }
      } finally {
        deadline.dispose();
      }
    },
    [confirmVisibleUploadTargetListing, syncBestEffortUploadTargetCache, t],
  );
  const {
    dismissUploadConflict,
    handleCancelUpload,
    handleUploadConflictOpenChange,
    handleDrop,
    handleDropEnter,
    handleDropLeave,
    handleDropOver,
    handleFilesPicked,
    isDropActive,
    resolveUploadConflictOverwrite,
    resolveUploadConflictRename,
    uploadConflictFileName,
    uploadConflictOpen,
    uploadCanCancel,
    uploadCurrentFileName,
    uploadCurrentProgress,
    uploadInProgress,
    uploadQueueCompleted,
    uploadQueueTotal,
  } = useFileUploadManager({
    workspaceId,
    projectId,
    uploadTarget,
    uploadObject: uploadObject.mutateAsync,
    syncUploadedObjects,
    t,
    tErrors,
  });

  const handleDeletePartialFailureSelection = React.useCallback(
    (failedKeys: string[]) => {
      const failedSet = new Set(failedKeys);
      setSelectedIds(
        selected
          .filter((item) => failedSet.has(item.kind === 'object' ? item.key : item.prefix))
          .map((item) => (item.kind === 'object' ? (`o:${item.key}` as const) : (`p:${item.prefix}` as const))),
      );
    },
    [selected, setSelectedIds],
  );

  const {
    batchFailedKeys,
    batchResultOpen,
    batchResultType,
    batchRetryPending,
    clearDeleteInlineError,
    closeBatchResult,
    deleteInlineError,
    handleDelete,
    handleBatchResultOpenChange,
    handleDownload,
    handleRetryBatchFailures,
  } = useFileBatchOperations({
    workspaceId,
    projectId,
    selectedLibraryId,
    selected,
    selectedObjects,
    clearSelection,
    deleteObjects: deleteObjects.mutateAsync,
    onDeletePartialFailure: handleDeletePartialFailureSelection,
    t,
    tErrors,
  });

  const {
    closeDeleteLibraryDialog,
    closeRenameLibraryDialog,
    handleCreateLibrary,
    handleDeleteLibrary,
    handleRenameLibrary,
    libraryCreateError,
    libraryCreateOpen,
    libraryDeleteConfirm,
    libraryDeleteError,
    libraryDeleteOpen,
    libraryDeleteTarget,
    libraryDescription,
    libraryName,
    libraryRenameDescription,
    libraryRenameError,
    libraryRenameName,
    libraryRenameOpen,
    libraryRenameTarget,
    openCreateLibraryDialog,
    openDeleteLibraryDialog,
    openRenameLibraryDialog,
    setLibraryCreateOpen,
    setLibraryDeleteConfirm,
    setLibraryDeleteOpen,
    setLibraryDescription,
    setLibraryName,
    setLibraryRenameDescription,
    setLibraryRenameName,
    setLibraryRenameOpen,
  } = useFileLibraryManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    setSelectedLibraryId,
    navigateToPrefix,
    createLibrary: createLibrary.mutateAsync,
    updateLibrary: updateLibrary.mutateAsync,
    deleteLibrary: deleteLibrary.mutateAsync,
    t,
    tErrors,
  });

  const {
    confirmMoveOverwrite,
    createFolderOpen,
    destPickerCrumbs,
    destPickerItems,
    destPickerOpen,
    destPickerPrefix,
    destPickerQuery,
    folderName,
    handleCreateFolder,
    handleMove,
    moveConflictOpen,
    moveDestPrefix,
    moveName,
    moveOpen,
    moveOverwrite,
    normalizeFolderPrefixInput,
    setCreateFolderOpen,
    setDestPickerOpen,
    setDestPickerPrefix,
    setFolderName,
    setMoveConflictOpen,
    setMoveDestPrefix,
    setMoveName,
    setMoveOpen,
    setMoveOverwrite,
  } = useFileFolderMoveManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    prefix,
    selectedForMove,
    refreshCurrentListing: objectsQuery.refetch,
    createFolder: createFolder.mutateAsync,
    moveObject: moveObject.mutateAsync,
    clearSelection,
    navigateToPrefix,
    t,
    tErrors,
  });

  const handleSortHeaderClick = React.useCallback(
    (nextSortBy: FileSortBy) => {
      if (sortBy === nextSortBy) {
        const nextOrder: FileSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        updateSort(nextSortBy, nextOrder);
        return;
      }
      updateSort(nextSortBy, 'asc');
    },
    [sortBy, sortOrder, updateSort],
  );

  const loadNextObjectsPage = React.useCallback(() => {
    if (objectsQuery.hasNextPage && !objectsQuery.isFetchingNextPage) {
      void objectsQuery.fetchNextPage();
    }
  }, [objectsQuery]);

  return (
    <PageLayout
      density="immersive"
      contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (!canManage) {
            e.currentTarget.value = '';
            return;
          }
          void handleFilesPicked(e.target.files);
          e.currentTarget.value = '';
        }}
      />
      <FilesPageContent
        allSelected={allSelected}
        canManage={canManage}
        crumbs={crumbs}
        fileInputRef={fileInputRef}
        filteredItems={filteredItems}
        handleCancelUpload={handleCancelUpload}
        handleDelete={() => {
          if (!canManage) return;
          clearDeleteInlineError();
          setDeleteConfirmOpen(true);
        }}
        handleDownload={handleDownload}
        handleDrop={handleDrop}
        handleDropEnter={handleDropEnter}
        handleDropLeave={handleDropLeave}
        handleDropOver={handleDropOver}
        handleLoadNextPage={loadNextObjectsPage}
        handleRefresh={() => {
          void objectsQuery.refetch();
        }}
        handleRename={() => {
          if (!canManage) return;
          if (selected.length !== 1) return;
          const target = selectedForMove;
          if (!target) return;
          const parent = target.kind === 'object'
            ? parentPrefixForKey(target.key)
            : parentPrefixForPrefix(target.prefix);
          setMoveDestPrefix(parent);
          setMoveName(moveNamePlaceholder);
          setMoveOverwrite(false);
          setMoveOpen(true);
        }}
        handleRowActivate={(event, item, id, index) => handleRowActivate(event, id, index)}
        handleRowOpen={handleRowOpen}
        handleSortHeaderClick={handleSortHeaderClick}
        handleToggleRowCheckbox={handleToggleRowCheckbox}
        handleUploadClick={handleUploadClick}
        hasSelection={hasSelection}
        isDropActive={isDropActive}
        layoutMode={layoutMode}
        libraries={libraries}
        libsLoading={libsLoading}
        moveNamePlaceholder={moveNamePlaceholder}
        objectsQuery={objectsQuery}
        onClearSelection={clearSelection}
        onCreateFolder={() => {
          if (!canManage) return;
          setCreateFolderOpen(true);
        }}
        onCreateLibrary={openCreateLibraryDialog}
        onDeleteLibrary={openDeleteLibraryDialog}
        onGoUp={() => navigateToPrefix(parentPrefixForPrefix(prefix))}
        onManageFileStates={openFileStates}
        onNavigateToPrefix={navigateToPrefix}
        onRenameLibrary={openRenameLibraryDialog}
        onSelectLibrary={selectLibrary}
        onToggleAll={toggleAll}
        prefix={prefix}
        projectId={projectId}
        searchInput={searchInput}
        selected={selected}
        selectedCount={selected.length}
        selectedForMove={selectedForMove}
        selectedIds={selectedIds}
        selectedLibraryId={selectedLibraryId}
        selectedLibraryStatus={selectedLibrary?.status ?? null}
        selectedLibraryTaskHomeBinding={selectedLibrary
          ? {
              task_home_binding_status: selectedLibrary.task_home_binding_status,
              bound_task_visible: selectedLibrary.bound_task_visible,
              bound_task_title: selectedLibrary.bound_task_title,
              bound_task_status: selectedLibrary.bound_task_status,
            }
          : null}
        selectedObjectsCount={selectedObjects.length}
        selectionMode={selectionMode}
        setSearchInput={setSearchInput}
        sortBy={sortBy}
        sortOrder={sortOrder}
        t={t}
        uploadCanCancel={uploadCanCancel}
        uploadCurrentFileName={uploadCurrentFileName}
        uploadCurrentProgress={uploadCurrentProgress}
        uploadInProgress={uploadInProgress}
        uploadQueueCompleted={uploadQueueCompleted}
        uploadQueueTotal={uploadQueueTotal}
        workspaceId={workspaceId}
        workspaceSurface={workspaceSurface}
      />

      {canManage ? (
        <>
          <FileLibraryRecoveryDialog
            library={selectedLibraryReady ? selectedLibrary : null}
            locale={locale}
            open={fileStatesOpen && selectedLibraryReady}
            projectId={projectId}
            t={t}
            workspaceId={workspaceId}
            onOpenChange={handleFileStatesOpenChange}
          />

          <LibraryDialogs
            createLibraryPending={createLibrary.isPending}
            deleteLibraryPending={deleteLibrary.isPending}
            libraryCreateError={libraryCreateError}
            libraryCreateOpen={libraryCreateOpen}
            libraryDeleteConfirm={libraryDeleteConfirm}
            libraryDeleteError={libraryDeleteError}
            libraryDeleteOpen={libraryDeleteOpen}
            libraryDeleteTarget={libraryDeleteTarget}
            libraryDescription={libraryDescription}
            libraryName={libraryName}
            libraryRenameDescription={libraryRenameDescription}
            libraryRenameError={libraryRenameError}
            libraryRenameName={libraryRenameName}
            libraryRenameOpen={libraryRenameOpen}
            libraryRenameTarget={libraryRenameTarget}
            t={t}
            updateLibraryPending={updateLibrary.isPending}
            onCloseDeleteLibraryDialog={closeDeleteLibraryDialog}
            onCloseRenameLibraryDialog={closeRenameLibraryDialog}
            onCreateLibrary={handleCreateLibrary}
            onDeleteLibrary={handleDeleteLibrary}
            onRenameLibrary={handleRenameLibrary}
            onSetLibraryCreateOpen={setLibraryCreateOpen}
            onSetLibraryDeleteConfirm={setLibraryDeleteConfirm}
            onSetLibraryDeleteOpen={setLibraryDeleteOpen}
            onSetLibraryDescription={setLibraryDescription}
            onSetLibraryName={setLibraryName}
            onSetLibraryRenameDescription={setLibraryRenameDescription}
            onSetLibraryRenameName={setLibraryRenameName}
            onSetLibraryRenameOpen={setLibraryRenameOpen}
          />

          <MoveDialogs
            confirmMoveOverwrite={confirmMoveOverwrite}
            createFolderOpen={createFolderOpen}
            destPickerCrumbs={destPickerCrumbs}
            destPickerItems={destPickerItems}
            destPickerOpen={destPickerOpen}
            destPickerPrefix={destPickerPrefix}
            destPickerQuery={destPickerQuery}
            folderName={folderName}
            moveConflictOpen={moveConflictOpen}
            moveDestPrefix={moveDestPrefix}
            moveName={moveName}
            moveNamePlaceholder={moveNamePlaceholder}
            moveOpen={moveOpen}
            moveOverwrite={moveOverwrite}
            normalizeFolderPrefixInput={normalizeFolderPrefixInput}
            selectedForMove={selectedForMove}
            selectedLibraryId={selectedLibraryId}
            t={t}
            onHandleCreateFolder={handleCreateFolder}
            onHandleMove={handleMove}
            onSetCreateFolderOpen={setCreateFolderOpen}
            onSetDestPickerOpen={setDestPickerOpen}
            onSetDestPickerPrefix={setDestPickerPrefix}
            onSetFolderName={setFolderName}
            onSetMoveConflictOpen={setMoveConflictOpen}
            onSetMoveDestPrefix={setMoveDestPrefix}
            onSetMoveName={setMoveName}
            onSetMoveOpen={setMoveOpen}
            onSetMoveOverwrite={setMoveOverwrite}
          />
        </>
      ) : null}

      <ObjectOperationDialogs
        batchFailedKeys={batchFailedKeys}
        batchResultOpen={batchResultOpen}
        batchResultType={batchResultType}
        batchRetryPending={batchRetryPending}
        canManage={canManage}
        deleteInlineError={deleteInlineError}
        deleteConfirmOpen={deleteConfirmOpen}
        deleteRuntimeSystemTargets={deleteRuntimeSystemTargets}
        selectedCount={selected.length}
        t={t}
        uploadConflictFileName={uploadConflictFileName}
        uploadConflictOpen={uploadConflictOpen}
        onCloseBatchResult={closeBatchResult}
        onClearDeleteInlineError={clearDeleteInlineError}
        onDismissUploadConflict={dismissUploadConflict}
        onHandleBatchResultOpenChange={handleBatchResultOpenChange}
        onHandleDelete={handleDelete}
        onHandleRetryBatchFailures={handleRetryBatchFailures}
        onHandleUploadConflictOpenChange={handleUploadConflictOpenChange}
        onResolveUploadConflictOverwrite={resolveUploadConflictOverwrite}
        onResolveUploadConflictRename={resolveUploadConflictRename}
        onSetDeleteConfirmOpen={setDeleteConfirmOpen}
      />
    </PageLayout>
  );
}
