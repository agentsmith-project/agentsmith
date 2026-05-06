import type { TaskTraceEventRecord } from './notebook-trace-store.js';

type ProjectedTraceDetails = Record<string, unknown>;

const PUBLIC_TRACE_NAME_BY_INTERNAL_NAME: Record<string, string> = {
  'codex.command': 'codex.command',
  'codex.exec': 'codex.command',
  'codex.output': 'codex.output',
  'codex.progress': 'codex.progress',
  'codex.reasoning': 'codex.reasoning',
  'codex.thinking': 'codex.thinking',
  'codex.tool': 'codex.tool',
  'execution.terminal': 'execution.terminal',
  'runner.artifact': 'runner.artifact',
  'run.lifecycle': 'run.lifecycle',
  'run.summary': 'run.summary',
  'run.user_cancel': 'run.user_cancel',
  sandbox_starting: 'run.lifecycle',
  'workspace.files_changed': 'workspace.files_changed',
};

const PUBLIC_TASK_ERROR_CODES = new Set([
  'AGENT_CANCELLED',
  'AGENT_FINALIZE_PERSIST_FAILED',
  'AGENT_OFFLINE',
  'AGENT_PROTOCOL_ERROR',
  'AGENT_REQUEST_TIMEOUT',
  'AGENT_SANDBOX_NOT_CONFIGURED',
  'AGENT_STREAM_TERMINAL_MISSING',
  'AGENT_TERMINAL_TIMEOUT',
  'AGENT_UPSTREAM_ERROR',
  'ENDPOINT_MODEL_CONTEXT_WINDOW_INVALID',
  'TASK_AGENT_ENDPOINT_NOT_CONFIGURED',
  'VALIDATION_ERROR',
  'WORKSPACE_FILE_LIBRARY_ID_REQUIRED',
]);

const CANONICAL_ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readTraceCategory(value: unknown): TaskTraceEventRecord['category'] | null {
  if (
    value === 'lifecycle' ||
    value === 'progress' ||
    value === 'tool' ||
    value === 'artifact' ||
    value === 'warning' ||
    value === 'error' ||
    value === 'debug'
  ) {
    return value;
  }
  return null;
}

function readTracePhase(value: unknown): TaskTraceEventRecord['phase'] | null {
  if (value === 'start' || value === 'update' || value === 'end') {
    return value;
  }
  return null;
}

function readTraceStatus(value: unknown): TaskTraceEventRecord['status'] | null {
  if (value === 'running' || value === 'success' || value === 'error' || value === 'cancelled') {
    return value;
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTaskTraceEventRecord(value: unknown): value is TaskTraceEventRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.task_id)) return false;
  if (!isNonEmptyString(value.message_id)) return false;
  if (!isNonEmptyString(value.run_id)) return false;
  if (!isFiniteNumber(value.seq)) return false;
  if (!isNonEmptyString(value.at)) return false;
  if (!readTraceCategory(value.category)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (typeof value.summary !== 'string') return false;
  if (value.phase !== undefined && !readTracePhase(value.phase)) return false;
  if (value.status !== undefined && !readTraceStatus(value.status)) return false;
  if (value.details !== undefined && !isRecord(value.details)) return false;
  return true;
}

function projectTraceNameForDisplay(value: unknown): string {
  const name = readString(value);
  if (!name) return 'run.event';
  return PUBLIC_TRACE_NAME_BY_INTERNAL_NAME[name] ?? 'run.event';
}

function projectTraceAtForDisplay(value: unknown): string {
  if (typeof value !== 'string') return nowIso();
  const at = value.trim();
  if (!CANONICAL_ISO_DATE_TIME.test(at)) return nowIso();
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== at) return nowIso();
  return at;
}

function isSafeBasename(value: string): boolean {
  if (value === '.' || value === '..') return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value);
}

function readSafeStatus(value: unknown): 'success' | 'error' | 'cancelled' | null {
  return value === 'success' || value === 'error' || value === 'cancelled'
    ? value
    : null;
}

function readSafeRunPhase(value: unknown): string | null {
  if (
    value === 'queued' ||
    value === 'dispatching' ||
    value === 'running' ||
    value === 'streaming' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'finalizing'
  ) {
    return value;
  }
  return null;
}

function summarizeCommand(event: TaskTraceEventRecord): string {
  if (event.status === 'error') return 'Command failed';
  if (event.status === 'success' || event.phase === 'end') return 'Command completed';
  return 'Running command';
}

function summarizeTool(event: TaskTraceEventRecord): string {
  if (event.status === 'error') return 'Tool failed';
  if (event.status === 'success' || event.phase === 'end') return 'Tool completed';
  return 'Using tool';
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeFileChanges(details: Record<string, unknown> | undefined): string {
  const added = countArray(details?.added);
  const modified = countArray(details?.modified);
  const deleted = countArray(details?.deleted);
  if (added || modified || deleted) {
    return `${added} added · ${modified} modified · ${deleted} deleted`;
  }
  return 'Workspace files updated';
}

function summarizeRunLifecycle(details: Record<string, unknown> | undefined): string {
  switch (readSafeRunPhase(details?.run_phase)) {
    case 'queued':
      return 'Run queued';
    case 'dispatching':
      return 'Run dispatching';
    case 'running':
    case 'streaming':
      return 'Run in progress';
    case 'completed':
      return 'Run completed';
    case 'failed':
      return 'Run failed';
    case 'cancelled':
      return 'Run cancelled';
    case 'finalizing':
      return 'Run finalizing';
    default:
      return 'Run updated';
  }
}

function summarizeRunSummary(event: TaskTraceEventRecord, details: Record<string, unknown> | undefined): string {
  const finalStatus = readSafeStatus(details?.final_status) ?? readSafeStatus(event.status);
  if (finalStatus === 'success') return 'Run completed';
  if (finalStatus === 'error') return 'Run failed';
  if (finalStatus === 'cancelled') return 'Run cancelled';
  return 'Run summary updated';
}

function summarizeTraceEvent(event: TaskTraceEventRecord, details: Record<string, unknown> | undefined): string {
  if (event.name === 'codex.command') return summarizeCommand(event);
  if (event.name === 'codex.tool') return summarizeTool(event);
  if (event.name === 'workspace.files_changed') return summarizeFileChanges(details);
  if (event.name === 'runner.artifact') return 'Generated output';
  if (event.name === 'run.lifecycle') return summarizeRunLifecycle(details);
  if (event.name === 'run.summary') return summarizeRunSummary(event, details);
  if (event.name === 'run.user_cancel') return 'Run cancelled';
  if (event.name === 'execution.terminal') {
    if (event.status === 'error') return 'Execution failed';
    if (event.status === 'success') return 'Execution completed';
    if (event.status === 'cancelled') return 'Execution cancelled';
    return 'Execution updated';
  }
  if (event.name === 'codex.output') return 'Preparing response';
  if (event.category === 'error' || event.status === 'error') return 'Step failed';
  if (event.category === 'warning') return 'Step needs attention';
  if (event.category === 'tool') return 'Tool activity';
  if (event.category === 'artifact') return 'Workspace updated';
  if (event.category === 'lifecycle') return 'Run updated';
  if (event.category === 'debug') return 'System update';
  return 'Progress update';
}

function projectTraceDetails(event: TaskTraceEventRecord): ProjectedTraceDetails | undefined {
  const details = isRecord(event.details) ? event.details : undefined;
  if (event.name === 'workspace.files_changed') {
    return {
      added_count: countArray(details?.added),
      modified_count: countArray(details?.modified),
      deleted_count: countArray(details?.deleted),
    };
  }
  if (event.name === 'runner.artifact') {
    const filename = readString(details?.filename);
    return filename && isSafeBasename(filename) ? { filename } : undefined;
  }
  if (event.name === 'run.summary') {
    const projected: ProjectedTraceDetails = {};
    const finalStatus = readSafeStatus(details?.final_status);
    if (finalStatus) projected.final_status = finalStatus;
    if (typeof details?.duration_ms === 'number' && Number.isFinite(details.duration_ms)) {
      projected.duration_ms = Math.max(0, Math.trunc(details.duration_ms));
    }
    return Object.keys(projected).length > 0 ? projected : undefined;
  }
  if (event.name === 'run.lifecycle') {
    const runPhase = readSafeRunPhase(details?.run_phase);
    return runPhase ? { run_phase: runPhase } : undefined;
  }
  if (event.category === 'debug') {
    const transportKind = details?.transport_kind;
    const transportPhase = details?.transport_phase;
    if (
      (transportKind === 'gap_fill' || transportKind === 'reconcile') &&
      (transportPhase === 'start' || transportPhase === 'done' || transportPhase === 'error')
    ) {
      return { transport_kind: transportKind, transport_phase: transportPhase };
    }
  }
  return undefined;
}

export function projectTaskTraceEventForDisplay(event: TaskTraceEventRecord): TaskTraceEventRecord {
  const details = isRecord(event.details) ? event.details : undefined;
  const category = readTraceCategory(event.category) ?? 'progress';
  const phase = readTracePhase(event.phase);
  const status = readTraceStatus(event.status);
  const publicName = projectTraceNameForDisplay(event.name);
  const eventForProjection: TaskTraceEventRecord = {
    ...event,
    category,
    ...(phase ? { phase } : {}),
    ...(status ? { status } : {}),
    name: publicName,
  };
  const projected: TaskTraceEventRecord = {
    id: event.id,
    task_id: event.task_id,
    message_id: event.message_id,
    run_id: event.run_id,
    seq: event.seq,
    at: projectTraceAtForDisplay(event.at),
    category,
    ...(phase ? { phase } : {}),
    ...(status ? { status } : {}),
    name: publicName,
    summary: summarizeTraceEvent(eventForProjection, details),
  };
  const projectedDetails = projectTraceDetails(eventForProjection);
  if (projectedDetails) {
    projected.details = projectedDetails;
  }
  return projected;
}

function projectPublicTaskErrorCode(value: unknown): string {
  const code = readString(value)?.toUpperCase();
  if (code && PUBLIC_TASK_ERROR_CODES.has(code)) return code;
  return 'TASK_RUN_ERROR';
}

function summarizeTaskError(code: string): string {
  return code === 'AGENT_CANCELLED' ? 'Task run cancelled' : 'Task run failed';
}

function projectNotebookTaskErrorPayloadForDisplay(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : {};
  const code = projectPublicTaskErrorCode(data.code ?? data.error_code ?? payload.code ?? payload.error_code);
  const summary = summarizeTaskError(code);
  return {
    type: 'error',
    data: {
      code,
      message: summary,
      summary,
    },
  };
}

function projectKnownNotebookTaskPayloadForDisplay(
  payload: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  if ('data' in payload) {
    return { type, data: payload.data };
  }
  return { type };
}

function projectGenericNotebookTaskPayloadForDisplay(): Record<string, unknown> {
  return {
    type: 'run.event',
    data: {
      code: 'TASK_EVENT_UPDATED',
      summary: 'Task event updated',
    },
  };
}

export function projectNotebookTaskSsePayloadForDisplay(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return projectGenericNotebookTaskPayloadForDisplay();
  }
  const type = readString(payload.type);
  if (type === 'trace_event') {
    if (!isTaskTraceEventRecord(payload.data)) {
      return projectGenericNotebookTaskPayloadForDisplay();
    }
    return {
      type,
      data: projectTaskTraceEventForDisplay(payload.data),
    };
  }
  if (type === 'error') {
    return projectNotebookTaskErrorPayloadForDisplay(payload);
  }
  if (type === 'ping') {
    return { type: 'ping' };
  }
  if (
    type === 'activity_item' ||
    type === 'artifact' ||
    type === 'task_update'
  ) {
    return projectKnownNotebookTaskPayloadForDisplay(payload, type);
  }
  return projectGenericNotebookTaskPayloadForDisplay();
}
