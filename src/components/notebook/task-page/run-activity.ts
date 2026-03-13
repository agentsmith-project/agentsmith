import type { TaskTraceEvent } from '@/lib/types/task';

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

type DeriveRunActionArgs = {
  event: TaskTraceEvent | undefined;
  fallbackSummary: string;
};

export function deriveRunAction({ event, fallbackSummary }: DeriveRunActionArgs): RunAction {
  if (!event) {
    return {
      kind: 'system',
      summary: fallbackSummary,
    };
  }
  if (event.name === 'codex.command') {
    const command = typeof event.details?.command === 'string' ? event.details.command.trim() : '';
    return {
      kind: 'command',
      summary: command || event.summary || fallbackSummary,
    };
  }
  if (event.name === 'codex.tool') {
    const toolName = typeof event.details?.tool_name === 'string' ? event.details.tool_name.trim() : '';
    return {
      kind: 'tool',
      summary: toolName ? `tool: ${toolName}` : (event.summary || fallbackSummary),
    };
  }
  if (event.name === 'runner.artifact') {
    const filename = typeof event.details?.filename === 'string' ? event.details.filename.trim() : '';
    return {
      kind: 'artifact',
      summary: filename || event.summary || fallbackSummary,
    };
  }
  if (event.name === 'run.lifecycle') {
    return {
      kind: 'lifecycle',
      summary: event.summary || fallbackSummary,
    };
  }
  if (event.category === 'error' || event.status === 'error') {
    return {
      kind: 'error',
      summary: event.summary || fallbackSummary,
    };
  }
  if (event.name === 'codex.output' || event.category === 'progress') {
    return {
      kind: 'output',
      summary: event.summary || fallbackSummary,
    };
  }
  return {
    kind: 'system',
    summary: event.summary || fallbackSummary,
  };
}

export function collectRecentRunActions(args: {
  sortedActions: TaskTraceEvent[];
  fallbackSummary: string;
  now: number;
}): RecentRunAction[] {
  const allowKinds: RunActionKind[] = ['command', 'tool', 'artifact', 'lifecycle', 'error'];
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
