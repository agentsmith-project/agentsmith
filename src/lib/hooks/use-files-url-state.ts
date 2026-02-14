import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { FileLibrary } from '@/lib/api/types';

export type FileSortBy = 'name' | 'size_bytes' | 'last_modified';
export type FileSortOrder = 'asc' | 'desc';

type UseSourcesUrlStateOptions = {
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

export function useFilesUrlState(
  libraries: FileLibrary[],
  { resetBrowseStateOnMount = false }: UseSourcesUrlStateOptions = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const librarySelectionInitializedRef = useRef(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(resetBrowseStateOnMount ? '' : normalizeBrowsePrefix(searchParams.get('prefix')));
  const [searchInput, setSearchInput] = useState(resetBrowseStateOnMount ? '' : (searchParams.get('search') ?? ''));
  const [search, setSearch] = useState(resetBrowseStateOnMount ? '' : (searchParams.get('search')?.trim() ?? ''));
  const [sortBy, setSortBy] = useState<FileSortBy>(
    resetBrowseStateOnMount ? 'name' : parseFileSortBy(searchParams.get('sort_by')),
  );
  const [sortOrder, setSortOrder] = useState<FileSortOrder>(
    resetBrowseStateOnMount ? 'asc' : parseFileSortOrder(searchParams.get('sort_order')),
  );
  const browseResetAppliedRef = useRef(false);
  const ignoreInitialBrowseQueryRef = useRef(resetBrowseStateOnMount);

  useEffect(() => {
    if (libraries.length === 0) {
      if (selectedLibraryId !== null) {
        setSelectedLibraryId(null);
      }
      librarySelectionInitializedRef.current = false;
      return;
    }

    const params = new URLSearchParams(searchParamsKey);
    const queryLibraryId = params.get('library_id');
    const hasQueryLibrary = queryLibraryId
      ? libraries.some((library) => library.id === queryLibraryId)
      : false;

    const hasSelectedLibrary = selectedLibraryId
      ? libraries.some((library) => library.id === selectedLibraryId)
      : false;
    if (!librarySelectionInitializedRef.current) {
      librarySelectionInitializedRef.current = true;
      if (hasQueryLibrary && selectedLibraryId !== queryLibraryId) {
        setSelectedLibraryId(queryLibraryId);
        return;
      }
      if (!hasSelectedLibrary) {
        setSelectedLibraryId(libraries[0].id);
      }
      return;
    }

    if (hasSelectedLibrary) return;

    if (hasQueryLibrary && selectedLibraryId !== queryLibraryId) {
      setSelectedLibraryId(queryLibraryId);
      return;
    }
    setSelectedLibraryId(libraries[0].id);
  }, [libraries, searchParamsKey, selectedLibraryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const replaceQueryParams = useCallback(
    (updater: (params: URLSearchParams) => boolean) => {
      const params = new URLSearchParams(searchParamsKey);
      if (!updater(params)) return;
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParamsKey],
  );

  useEffect(() => {
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
    if (resetBrowseStateOnMount) {
      return;
    }

    const querySortBy = parseFileSortBy(params.get('sort_by'));
    const querySortOrder = parseFileSortOrder(params.get('sort_order'));
    const querySearch = params.get('search') ?? '';
    const queryPrefix = normalizeBrowsePrefix(params.get('prefix'));
    const trimmedQuerySearch = querySearch.trim();
    setSortBy((prev) => (prev === querySortBy ? prev : querySortBy));
    setSortOrder((prev) => (prev === querySortOrder ? prev : querySortOrder));
    setSearchInput((prev) => (prev === querySearch ? prev : querySearch));
    setSearch((prev) => (prev === trimmedQuerySearch ? prev : trimmedQuerySearch));
    setPrefix((prev) => (prev === queryPrefix ? prev : queryPrefix));
  }, [replaceQueryParams, resetBrowseStateOnMount, searchParamsKey]);

  useEffect(() => {
    if (resetBrowseStateOnMount) return;
    replaceQueryParams((params) => {
      const currentSearch = params.get('search') ?? '';
      const nextSearch = search.trim();
      if (nextSearch === currentSearch) return false;
      if (nextSearch) {
        params.set('search', nextSearch);
      } else {
        params.delete('search');
      }
      return true;
    });
  }, [replaceQueryParams, resetBrowseStateOnMount, search]);

  useEffect(() => {
    replaceQueryParams((params) => {
      const currentLibraryId = params.get('library_id');
      if (!selectedLibraryId) {
        if (!currentLibraryId) return false;
        params.delete('library_id');
      } else if (currentLibraryId !== selectedLibraryId) {
        params.set('library_id', selectedLibraryId);
      } else {
        return false;
      }
      return true;
    });
  }, [replaceQueryParams, selectedLibraryId]);

  useEffect(() => {
    if (resetBrowseStateOnMount) return;
    replaceQueryParams((params) => {
      const currentPrefix = normalizeBrowsePrefix(params.get('prefix'));
      const nextPrefix = normalizeBrowsePrefix(prefix);
      if (currentPrefix === nextPrefix) return false;
      if (!nextPrefix) {
        params.delete('prefix');
      } else {
        params.set('prefix', nextPrefix);
      }
      return true;
    });
  }, [prefix, replaceQueryParams, resetBrowseStateOnMount]);

  const setSearchImmediately = useCallback((value: string) => {
    setSearchInput(value);
    setSearch(value.trim());
  }, []);

  const updateSort = useCallback(
    (nextSortBy: FileSortBy, nextSortOrder: FileSortOrder) => {
      setSortBy(nextSortBy);
      setSortOrder(nextSortOrder);
      if (resetBrowseStateOnMount) return;
      replaceQueryParams((params) => {
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
      setSearchImmediately,
      sortBy,
      sortOrder,
      updateSort,
    ],
  );
}
