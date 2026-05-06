import type { TaskRunState, TaskTraceEvent } from '@/lib/types/task';

export type RunActionKind = 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';

export type RunAction = {
  kind: RunActionKind;
  summary: string;
};

export type RecentRunAction = {
  id: string;
  kind: RunActionKind;
  summary: string;
  ageSeconds: number;
  traceName: string;
};

export type ActiveRunView = {
  messageId: string;
  runState: Exclude<TaskRunState, 'idle'> | 'reconnecting';
  latestAction: RunAction;
  recentActions: RecentRunAction[];
  startedAt: string | null;
  elapsedSeconds: number;
  cancelPending: boolean;
  onCancel: () => void;
  realtimeHealth: {
    status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
    code?: string | null;
    message?: string | null;
  };
};

type DeriveRunActionArgs = {
  event: TaskTraceEvent | undefined;
  fallbackSummary: string;
};

function countTraceItems(items: unknown, countValue: unknown): number {
  if (Array.isArray(items)) return items.length;
  return typeof countValue === 'number' && Number.isFinite(countValue)
    ? Math.max(0, Math.trunc(countValue))
    : 0;
}

function isSafeBasename(value: string): boolean {
  if (value === '.' || value === '..') return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value);
}

function readSafeArtifactFilename(details?: Record<string, unknown>): string {
  const filename = typeof details?.filename === 'string' ? details.filename.trim() : '';
  return filename && isSafeBasename(filename) ? filename : '';
}

function containsUnsafeTraceText(value: string): boolean {
  return /token|secret|required_permissions|reason_code|raw event|raw diagnostics|diagnostic_entrypoint|authorization|api[_-]?key|\/internal\//i.test(value);
}

function readSafeTraceSummary(event: TaskTraceEvent, fallbackSummary: string): string {
  const summary = event.summary.trim();
  if (summary && !containsUnsafeTraceText(summary)) return summary;
  return containsUnsafeTraceText(fallbackSummary) ? 'Working' : fallbackSummary;
}

export function deriveRunAction({ event, fallbackSummary }: DeriveRunActionArgs): RunAction {
  if (!event) {
    return {
      kind: 'system',
      summary: containsUnsafeTraceText(fallbackSummary) ? 'Working' : fallbackSummary,
    };
  }
  if (event.name === 'codex.command') {
    return {
      kind: 'command',
      summary: 'Running command',
    };
  }
  if (event.name === 'codex.tool') {
    return {
      kind: 'tool',
      summary: 'Using tool',
    };
  }
  if (event.name === 'workspace.files_changed') {
    const added = countTraceItems(event.details?.added, event.details?.added_count);
    const modified = countTraceItems(event.details?.modified, event.details?.modified_count);
    const deleted = countTraceItems(event.details?.deleted, event.details?.deleted_count);
    const summary = added || modified || deleted
      ? `${added} added · ${modified} modified · ${deleted} deleted`
      : readSafeTraceSummary(event, fallbackSummary);
    return {
      kind: 'system',
      summary,
    };
  }
  if (event.name === 'runner.artifact') {
    const filename = readSafeArtifactFilename(event.details);
    return {
      kind: 'output',
      summary: filename || 'Generated output',
    };
  }
  if (event.name === 'run.lifecycle') {
    return {
      kind: 'lifecycle',
      summary: 'Run updated',
    };
  }
  if (event.category === 'error' || event.status === 'error') {
    return {
      kind: 'error',
      summary: 'Step failed',
    };
  }
  if (event.name === 'codex.output' || event.category === 'progress') {
    return {
      kind: 'output',
      summary: readSafeTraceSummary(event, fallbackSummary),
    };
  }
  return {
    kind: 'system',
    summary: readSafeTraceSummary(event, fallbackSummary),
  };
}

export function collectRecentRunActions(args: {
  sortedActions: TaskTraceEvent[];
  fallbackSummary: string;
  now: number;
}): RecentRunAction[] {
  const allowKinds: RunActionKind[] = ['command', 'tool', 'output', 'lifecycle', 'error', 'system'];
  const selected: RecentRunAction[] = [];

  for (const event of args.sortedActions) {
    const mapped = deriveRunAction({ event, fallbackSummary: args.fallbackSummary });
    if (!allowKinds.includes(mapped.kind)) continue;
    if (mapped.summary.trim().length === 0) continue;
    if (selected.some((item) => item.summary === mapped.summary && item.kind === mapped.kind)) continue;
    const at = Date.parse(event.at);
    const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.floor((args.now - at) / 1000)) : 0;
    selected.push({
      id: event.id,
      kind: mapped.kind,
      summary: mapped.summary,
      ageSeconds,
      traceName: event.name,
    });
    if (selected.length >= 3) break;
  }

  return selected;
}

export function createPendingMessage(content: string) {
  return {
    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    createdAt: new Date().toISOString(),
  };
}
