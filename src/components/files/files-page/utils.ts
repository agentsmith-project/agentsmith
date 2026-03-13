import type { FileObjectsListItem } from '@/lib/api/types';
import type { FileSortBy, FileSortOrder } from '@/lib/hooks/use-files-url-state';

export type SelectedRowId = `p:${string}` | `o:${string}`;
export type FileSelectionMode = 'single' | 'multi';

export interface LibraryViewSnapshot {
  prefix: string;
  searchInput: string;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
  selectedIds: SelectedRowId[];
  selectionMode: FileSelectionMode;
}

export function rowId(item: FileObjectsListItem): SelectedRowId {
  return item.kind === 'prefix' ? (`p:${item.prefix}` as const) : (`o:${item.key}` as const);
}

export function parseSelectedRowId(
  id: SelectedRowId,
): { kind: 'prefix'; prefix: string } | { kind: 'object'; key: string } {
  if (id.startsWith('p:')) return { kind: 'prefix', prefix: id.slice(2) };
  return { kind: 'object', key: id.slice(2) };
}

export function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function buildCrumbs(prefix: string) {
  const normalized = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  const parts = (normalized || '').split('/').filter(Boolean);
  const crumbs: Array<{ label: string; prefix: string }> = [{ label: '', prefix: '' }];
  let cur = '';
  for (const part of parts) {
    cur = `${cur}${part}/`;
    crumbs.push({ label: part, prefix: cur });
  }
  return crumbs;
}

export function parentPrefixForKey(key: string) {
  const idx = key.lastIndexOf('/');
  if (idx < 0) return '';
  return key.slice(0, idx + 1);
}

export function parentPrefixForPrefix(prefix: string) {
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '';
  return normalized.slice(0, idx + 1);
}
