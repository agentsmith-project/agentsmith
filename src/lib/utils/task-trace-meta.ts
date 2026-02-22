export interface TaskTraceMessageMeta {
  hasMore: boolean;
  nextAfterId: string | null;
}

export type TaskTraceMetaByMessageId = Record<string, TaskTraceMessageMeta>;

export function upsertTaskTraceMeta(
  prev: TaskTraceMetaByMessageId,
  messageId: string,
  input: { has_more?: boolean; next_after_id?: string | null },
): TaskTraceMetaByMessageId {
  const nextMeta: TaskTraceMessageMeta = {
    hasMore: Boolean(input.has_more),
    nextAfterId: input.next_after_id ?? null,
  };
  const current = prev[messageId];
  if (current && current.hasMore === nextMeta.hasMore && current.nextAfterId === nextMeta.nextAfterId) {
    return prev;
  }
  return { ...prev, [messageId]: nextMeta };
}

export function pruneTaskTraceMeta<T>(
  prev: Record<string, T>,
  validMessageIds: Set<string>,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [id, value] of Object.entries(prev)) {
    if (!validMessageIds.has(id)) {
      changed = true;
      continue;
    }
    next[id] = value;
  }
  return changed ? next : prev;
}

export function mapTraceHasMoreByMessageId(metaByMessageId: TaskTraceMetaByMessageId): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(metaByMessageId).map(([id, meta]) => [id, meta.hasMore]),
  );
}
