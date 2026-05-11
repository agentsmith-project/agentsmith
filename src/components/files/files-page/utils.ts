import type { FileObjectsListItem } from '@/lib/api/types';
import type { FileSortBy, FileSortOrder } from '@/lib/hooks/use-files-url-state';

export type SelectedRowId = `p:${string}` | `o:${string}`;
export type FileSelectionMode = 'single' | 'multi';
export type RuntimeSystemDotFolder = {
  prefix: string;
  name: string;
  testIdSegment: string;
};

type RuntimeSystemDotFolderCandidate =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'object'; key: string };

const RUNTIME_SYSTEM_DOT_FOLDERS: RuntimeSystemDotFolder[] = [
  { prefix: '.codex/', name: '.codex', testIdSegment: 'codex' },
  { prefix: '.agents/', name: '.agents', testIdSegment: 'agents' },
  { prefix: '.mbos/', name: '.mbos', testIdSegment: 'mbos' },
  { prefix: '.cache/', name: '.cache', testIdSegment: 'cache' },
  { prefix: '.config/', name: '.config', testIdSegment: 'config' },
  { prefix: '.local/', name: '.local', testIdSegment: 'local' },
];

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

export function getRuntimeSystemDotFolderInfo(candidate: RuntimeSystemDotFolderCandidate): RuntimeSystemDotFolder | null {
  if (candidate.kind !== 'prefix') return null;
  const normalizedPrefix = candidate.prefix.endsWith('/') ? candidate.prefix : `${candidate.prefix}/`;
  return RUNTIME_SYSTEM_DOT_FOLDERS.find((folder) => folder.prefix === normalizedPrefix) ?? null;
}

export function getRuntimeSystemDotFolderInfos(candidates: RuntimeSystemDotFolderCandidate[]) {
  const seen = new Set<string>();
  const folders: RuntimeSystemDotFolder[] = [];
  for (const candidate of candidates) {
    const folder = getRuntimeSystemDotFolderInfo(candidate);
    if (!folder || seen.has(folder.prefix)) continue;
    seen.add(folder.prefix);
    folders.push(folder);
  }
  return folders;
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
