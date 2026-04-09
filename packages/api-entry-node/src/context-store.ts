import { createHash } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import { decryptSecretValue, encryptSecretValue } from './secret-crypto.js';

export type ContextScope = 'member' | 'task' | 'project' | 'workspace';
export type ContextContentType = 'text' | 'json' | 'markdown' | 'yaml';
export type ContextOwnership = 'member_owned' | 'shared';

export type ContextEntryRecord = {
  id: string;
  scope: ContextScope;
  key: string;
  content: string;
  content_type: ContextContentType;
  user_id?: string | null;
  task_id?: string | null;
  project_id?: string | null;
  workspace_id?: string | null;
  read_only: boolean;
  updated_at: string;
  updated_by: string;
};

type PersistedContextEntryRecord = Omit<ContextEntryRecord, 'content'> & {
  content: string;
};

export type ContextTarget = {
  scope: ContextScope;
  key: string;
  user_id?: string | null;
  task_id?: string | null;
  project_id?: string | null;
  workspace_id?: string | null;
};

const COLLECTION = 'context_store_entries';

const CONTEXT_SCOPE_DEFINITIONS: Record<ContextScope, {
  ownership: ContextOwnership;
}> = {
  member: {
    ownership: 'member_owned',
  },
  task: {
    ownership: 'member_owned',
  },
  project: {
    ownership: 'shared',
  },
  workspace: {
    ownership: 'shared',
  },
};

export function isContextScope(value: unknown): value is ContextScope {
  return value === 'member' || value === 'task' || value === 'project' || value === 'workspace';
}

export function isContextContentType(value: unknown): value is ContextContentType {
  return value === 'text' || value === 'json' || value === 'markdown' || value === 'yaml';
}

export function normalizeContextKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 256);
}

function buildContextId(target: ContextTarget): string {
  const normalized = normalizeTarget(target);
  const digest = createHash('sha256')
    .update([
      normalized.scope,
      normalized.key,
      normalized.user_id ?? '',
      normalized.task_id ?? '',
      normalized.project_id ?? '',
      normalized.workspace_id ?? '',
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return `ctx_${digest}`;
}

export function isMemberOwnedContextScope(scope: ContextScope): boolean {
  return CONTEXT_SCOPE_DEFINITIONS[scope].ownership === 'member_owned';
}

export function normalizeTarget(target: ContextTarget): ContextTarget {
  const base = {
    scope: target.scope,
    key: target.key,
    user_id: target.user_id ?? null,
    task_id: target.task_id ?? null,
    project_id: target.project_id ?? null,
    workspace_id: target.workspace_id ?? null,
  };
  if (target.scope === 'member') {
    return {
      ...base,
      task_id: null,
      project_id: null,
    };
  }
  if (target.scope === 'task') {
    return {
      ...base,
    };
  }
  if (target.scope === 'project') {
    return {
      ...base,
      user_id: null,
      task_id: null,
    };
  }
  return {
    ...base,
    user_id: null,
    task_id: null,
    project_id: null,
  };
}

function persistRecord(record: ContextEntryRecord): PersistedContextEntryRecord {
  return {
    ...record,
    content: encryptSecretValue(record.content),
  };
}

function hydrateRecord(record: PersistedContextEntryRecord): ContextEntryRecord {
  return {
    ...record,
    content: decryptSecretValue(record.content),
  };
}

function matchesTarget(record: ContextEntryRecord, target: ContextTarget): boolean {
  return record.scope === target.scope
    && record.key === target.key
    && (record.user_id ?? null) === (target.user_id ?? null)
    && (record.task_id ?? null) === (target.task_id ?? null)
    && (record.project_id ?? null) === (target.project_id ?? null)
    && (record.workspace_id ?? null) === (target.workspace_id ?? null);
}

export async function listContextEntries(
  docStore: JsonDocStorePort,
  filter: {
    scope?: ContextScope;
    user_id?: string | null;
    task_id?: string | null;
    project_id?: string | null;
    workspace_id?: string | null;
  },
): Promise<ContextEntryRecord[]> {
  const items = await docStore.list<PersistedContextEntryRecord>(COLLECTION);
  return items
    .map(hydrateRecord)
    .filter((item) => {
      if (filter.scope && item.scope !== filter.scope) return false;
      if (filter.user_id !== undefined && (item.user_id ?? null) !== (filter.user_id ?? null)) return false;
      if (filter.task_id !== undefined && (item.task_id ?? null) !== (filter.task_id ?? null)) return false;
      if (filter.project_id !== undefined && (item.project_id ?? null) !== (filter.project_id ?? null)) return false;
      if (filter.workspace_id !== undefined && (item.workspace_id ?? null) !== (filter.workspace_id ?? null)) return false;
      return true;
    })
    .sort((left, right) => left.key.localeCompare(right.key) || right.updated_at.localeCompare(left.updated_at));
}

export async function getContextEntry(
  docStore: JsonDocStorePort,
  target: ContextTarget,
): Promise<ContextEntryRecord | null> {
  const normalized = normalizeTarget(target);
  const direct = await docStore.get<PersistedContextEntryRecord>(COLLECTION, buildContextId(normalized));
  if (direct) {
    return hydrateRecord(direct);
  }
  const listed = await listContextEntries(docStore, {
    scope: normalized.scope,
    user_id: normalized.user_id,
    task_id: normalized.task_id,
    project_id: normalized.project_id,
    workspace_id: normalized.workspace_id,
  });
  return listed.find((item) => matchesTarget(item, normalized)) ?? null;
}

export async function putContextEntry(
  docStore: JsonDocStorePort,
  args: ContextTarget & {
    content: string;
    content_type: ContextContentType;
    updated_by: string;
  },
): Promise<ContextEntryRecord> {
  const normalized = normalizeTarget(args);
  const now = new Date().toISOString();
  const existing = await getContextEntry(docStore, normalized);
  const next: ContextEntryRecord = {
    id: buildContextId(normalized),
    scope: normalized.scope,
    key: normalized.key,
    content: args.content,
    content_type: args.content_type,
    user_id: normalized.user_id,
    task_id: normalized.task_id,
    project_id: normalized.project_id,
    workspace_id: normalized.workspace_id,
    read_only: false,
    updated_at: now,
    updated_by: args.updated_by,
  };
  await docStore.upsert(COLLECTION, next.id, persistRecord(existing ? { ...existing, ...next } : next));
  return next;
}

export async function deleteContextEntry(
  docStore: JsonDocStorePort,
  target: ContextTarget,
): Promise<boolean> {
  const normalized = normalizeTarget(target);
  const existing = await getContextEntry(docStore, normalized);
  if (!existing) return false;
  await docStore.delete(COLLECTION, existing.id);
  return true;
}
