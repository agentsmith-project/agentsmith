import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { FileLibrary } from '@/lib/api/types';

export type FileSortBy = 'name' | 'size_bytes' | 'last_modified';
export type FileSortOrder = 'asc' | 'desc';
export const DEFAULT_FILES_BROWSE_PREFIX = '';

type UseSourcesUrlStateOptions = {
  defaultPrefix?: string;
  resetBrowseStateOnMount?: boolean;
};

export function parseFileSortBy(value: string | null): FileSortBy {
  if (value === 'size_bytes' || value === 'last_modified') return value;
  return 'name';
}

function parseFileSortOrder(value: string | null): FileSortOrder {
  if (value === 'desc') return 'desc';
  return 'asc';
}

function normalizeBrowsePrefix(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  const withoutLeading = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return withoutLeading.endsWith('/') ? withoutLeading : `${withoutLeading}/`;
}

function readBrowsePrefix(params: URLSearchParams, defaultPrefix: string): string {
  if (!params.has('prefix')) return defaultPrefix;
  return normalizeBrowsePrefix(params.get('prefix'));
}

function writeBrowsePrefix(params: URLSearchParams, prefix: string, defaultPrefix: string) {
  const nextPrefix = normalizeBrowsePrefix(prefix);
  if (nextPrefix === defaultPrefix) {
    params.delete('prefix');
    return;
  }
  if (!nextPrefix) {
    if (defaultPrefix) {
      params.set('prefix', '/');
    } else {
      params.delete('prefix');
    }
    return;
  }
  params.set('prefix', nextPrefix);
}

function hasLibrary(libraries: FileLibrary[], libraryId: string | null): libraryId is string {
  return Boolean(libraryId && libraries.some((library) => library.id === libraryId));
}

function resolveLibrarySelection(
  libraries: FileLibrary[],
  queryLibraryId: string | null,
): string | null {
  if (hasLibrary(libraries, queryLibraryId)) {
    return queryLibraryId;
  }
  return libraries[0]?.id ?? null;
}

export function useFilesUrlState(
  libraries: FileLibrary[],
  { defaultPrefix = '', resetBrowseStateOnMount = false }: UseSourcesUrlStateOptions = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const routerRef = useRef(router);
  const actualSearchParamsKeyRef = useRef(searchParamsKey);
  const actualSearchParamsGenerationRef = useRef(0);
  const optimisticSearchParamsKeyRef = useRef(searchParamsKey);
  const defaultBrowsePrefix = normalizeBrowsePrefix(defaultPrefix);
  const previousLibrariesLengthRef = useRef(libraries.length);
  const previousLibrariesLength = previousLibrariesLengthRef.current;

  const pendingSearchWriteRef = useRef<string | null>(null);
  const [, setOptimisticRevision] = useState(0);
  const [localPrefix, setLocalPrefix] = useState(defaultBrowsePrefix);
  const [localSearchInput, setLocalSearchInput] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [localSortBy, setLocalSortBy] = useState<FileSortBy>('name');
  const [localSortOrder, setLocalSortOrder] = useState<FileSortOrder>('asc');
  const [searchInputDraft, setSearchInputDraft] = useState<{
    actualSearchParamsGeneration: number;
    value: string;
  } | null>(null);
  const browseResetAppliedRef = useRef(false);
  const ignoreInitialBrowseQueryRef = useRef(resetBrowseStateOnMount);

  if (actualSearchParamsKeyRef.current !== searchParamsKey) {
    actualSearchParamsKeyRef.current = searchParamsKey;
    actualSearchParamsGenerationRef.current += 1;
    optimisticSearchParamsKeyRef.current = searchParamsKey;
    pendingSearchWriteRef.current = null;
  }

  const effectiveSearchParamsKey = optimisticSearchParamsKeyRef.current;
  const effectiveSearchParams = useMemo(
    () => new URLSearchParams(effectiveSearchParamsKey),
    [effectiveSearchParamsKey],
  );
  const querySearch = effectiveSearchParams.get('search') ?? '';
  const querySearchInput = searchInputDraft?.actualSearchParamsGeneration === actualSearchParamsGenerationRef.current
    ? searchInputDraft.value
    : querySearch;
  const prefix = resetBrowseStateOnMount
    ? localPrefix
    : readBrowsePrefix(effectiveSearchParams, defaultBrowsePrefix);
  const searchInput = resetBrowseStateOnMount ? localSearchInput : querySearchInput;
  const search = resetBrowseStateOnMount ? localSearch : querySearch.trim();
  const sortBy = resetBrowseStateOnMount ? localSortBy : parseFileSortBy(effectiveSearchParams.get('sort_by'));
  const sortOrder = resetBrowseStateOnMount ? localSortOrder : parseFileSortOrder(effectiveSearchParams.get('sort_order'));
  const selectedLibraryId = resolveLibrarySelection(libraries, effectiveSearchParams.get('library_id'));

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!resetBrowseStateOnMount) return;
    const timer = window.setTimeout(() => {
      setLocalSearch(localSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localSearchInput, resetBrowseStateOnMount]);

  const replaceQueryParams = useCallback(
    (updater: (params: URLSearchParams) => boolean) => {
      const params = new URLSearchParams(optimisticSearchParamsKeyRef.current);
      if (!updater(params)) return;
      const query = params.toString();
      if (query === optimisticSearchParamsKeyRef.current) return;
      optimisticSearchParamsKeyRef.current = query;
      setOptimisticRevision((revision) => revision + 1);
      routerRef.current.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname],
  );

  const setSelectedLibraryId = useCallback(
    (nextLibraryId: string | null) => {
      const validNextLibraryId = nextLibraryId && hasLibrary(libraries, nextLibraryId) ? nextLibraryId : null;
      replaceQueryParams((params) => {
        const currentLibraryId = params.get('library_id');
        const defaultLibraryId = libraries[0]?.id ?? null;
        if (!validNextLibraryId || validNextLibraryId === defaultLibraryId) {
          if (!currentLibraryId) return false;
          params.delete('library_id');
          return true;
        }
        if (currentLibraryId === validNextLibraryId) return false;
        params.set('library_id', validNextLibraryId);
        return true;
      });
    },
    [libraries, replaceQueryParams],
  );

  useEffect(() => {
    if (!resetBrowseStateOnMount) return;
    const params = new URLSearchParams(searchParamsKey);

    if (ignoreInitialBrowseQueryRef.current) {
      const hasBrowseKeys = ['prefix', 'search', 'sort_by', 'sort_order'].some((key) => params.has(key));
      if (hasBrowseKeys) {
        if (!browseResetAppliedRef.current) {
          browseResetAppliedRef.current = true;
          replaceQueryParams((nextParams) => {
            let changed = false;
            for (const key of ['prefix', 'search', 'sort_by', 'sort_order']) {
              if (nextParams.has(key)) {
                nextParams.delete(key);
                changed = true;
              }
            }
            return changed;
          });
        }
        return;
      }
      ignoreInitialBrowseQueryRef.current = false;
    }
  }, [replaceQueryParams, resetBrowseStateOnMount, searchParamsKey]);

  useEffect(() => {
    if (resetBrowseStateOnMount) return;
    const pendingSearch = pendingSearchWriteRef.current;
    if (pendingSearch === null) return;
    const timer = window.setTimeout(() => {
      const nextSearch = pendingSearchWriteRef.current;
      if (nextSearch === null) return;
      replaceQueryParams((params) => {
        const currentSearch = params.get('search') ?? '';
        if (nextSearch === currentSearch) return false;
        if (nextSearch) {
          params.set('search', nextSearch);
        } else {
          params.delete('search');
        }
        return true;
      });
      pendingSearchWriteRef.current = null;
      setSearchInputDraft(null);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [replaceQueryParams, resetBrowseStateOnMount, searchInput]);

  useEffect(() => {
    replaceQueryParams((params) => {
      const currentLibraryId = params.get('library_id');
      if (!currentLibraryId) return false;
      if (hasLibrary(libraries, currentLibraryId)) return false;
      if (libraries.length === 0 && previousLibrariesLength === 0) return false;
      params.delete('library_id');
      return true;
    });
  }, [libraries, previousLibrariesLength, replaceQueryParams]);

  useEffect(() => {
    previousLibrariesLengthRef.current = libraries.length;
  }, [libraries.length]);

  const setPrefix = useCallback((value: string) => {
    const nextPrefix = normalizeBrowsePrefix(value);
    if (resetBrowseStateOnMount) {
      setLocalPrefix((prev) => (prev === nextPrefix ? prev : nextPrefix));
      return;
    }
    replaceQueryParams((params) => {
      const currentPrefix = readBrowsePrefix(params, defaultBrowsePrefix);
      if (currentPrefix === nextPrefix) return false;
      writeBrowsePrefix(params, nextPrefix, defaultBrowsePrefix);
      return true;
    });
  }, [defaultBrowsePrefix, replaceQueryParams, resetBrowseStateOnMount]);

  const setSearchInput = useCallback((value: string) => {
    if (resetBrowseStateOnMount) {
      setLocalSearchInput(value);
      return;
    }
    pendingSearchWriteRef.current = value.trim();
    setSearchInputDraft({
      actualSearchParamsGeneration: actualSearchParamsGenerationRef.current,
      value,
    });
  }, [resetBrowseStateOnMount]);

  const setSearchImmediately = useCallback((value: string) => {
    const nextSearch = value.trim();
    if (resetBrowseStateOnMount) {
      setLocalSearchInput(value);
      setLocalSearch(nextSearch);
      return;
    }
    pendingSearchWriteRef.current = null;
    setSearchInputDraft({
      actualSearchParamsGeneration: actualSearchParamsGenerationRef.current,
      value,
    });
    replaceQueryParams((params) => {
      const currentSearch = params.get('search') ?? '';
      if (nextSearch === currentSearch) return false;
      if (nextSearch) {
        params.set('search', nextSearch);
      } else {
        params.delete('search');
      }
      return true;
    });
  }, [replaceQueryParams, resetBrowseStateOnMount]);

  const updateSort = useCallback(
    (nextSortBy: FileSortBy, nextSortOrder: FileSortOrder) => {
      if (resetBrowseStateOnMount) {
        setLocalSortBy(nextSortBy);
        setLocalSortOrder(nextSortOrder);
        return;
      }
      replaceQueryParams((params) => {
        const currentSortBy = parseFileSortBy(params.get('sort_by'));
        const currentSortOrder = parseFileSortOrder(params.get('sort_order'));
        if (currentSortBy === nextSortBy && currentSortOrder === nextSortOrder) return false;
        if (nextSortBy === 'name') {
          params.delete('sort_by');
        } else {
          params.set('sort_by', nextSortBy);
        }
        if (nextSortOrder === 'asc') {
          params.delete('sort_order');
        } else {
          params.set('sort_order', nextSortOrder);
        }
        return true;
      });
    },
    [replaceQueryParams, resetBrowseStateOnMount],
  );

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}
