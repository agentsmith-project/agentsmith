import { randomUUID } from 'node:crypto';
import type { AgentExecutionTraceEventPayload } from './agent-execution-service.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  recordNotebookTraceDetailsTruncated,
  recordNotebookTraceEventStored,
  recordNotebookTraceEventsTruncated,
} from './notebook-task-metrics.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

export interface TaskTraceEventRecord {
  id: string;
  task_id: string;
  message_id: string;
  run_id: string;
  seq: number;
  at: string;
  category: AgentExecutionTraceEventPayload['category'];
  phase?: AgentExecutionTraceEventPayload['phase'];
  status?: AgentExecutionTraceEventPayload['status'];
  name: string;
  summary: string;
  details?: Record<string, unknown>;
}

const TRACE_EVENTS_BY_TASK = new Map<string, TaskTraceEventRecord[]>();
const TASK_TRACE_EVENTS_COLLECTION = 'agent_task_trace_events';
const MAX_TRACE_EVENTS_PER_TASK = Math.max(100, Number(process.env.NOTEBOOK_TRACE_MAX_EVENTS ?? '1000') || 1000);
const MAX_TRACE_DETAILS_BYTES = Math.max(512, Number(process.env.NOTEBOOK_TRACE_DETAILS_MAX_BYTES ?? '16384') || 16384);

function buildId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function taskTraceEventsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASK_TRACE_EVENTS_COLLECTION, workspaceId);
}

export function getNotebookTraceStoreLimits(): {
  maxTraceEventsPerTask: number;
  maxTraceDetailsBytes: number;
} {
  return {
    maxTraceEventsPerTask: MAX_TRACE_EVENTS_PER_TASK,
    maxTraceDetailsBytes: MAX_TRACE_DETAILS_BYTES,
  };
}

export function getTaskTraceEvents(taskId: string): TaskTraceEventRecord[] {
  let existing = TRACE_EVENTS_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    TRACE_EVENTS_BY_TASK.set(taskId, existing);
  }
  return existing;
}

export function removeTaskTraceEventsFromMemory(taskId: string): void {
  TRACE_EVENTS_BY_TASK.delete(taskId);
}

export function countInMemoryTraceRecords(): number {
  return [...TRACE_EVENTS_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
}

export async function loadTaskTraceEvents(
  deps: NodeApiDeps,
  workspaceId: string,
  taskId: string,
): Promise<TaskTraceEventRecord[]> {
  const cached = TRACE_EVENTS_BY_TASK.get(taskId);
  if (cached && cached.length > 0) return cached;
  const listed = await deps.docStore.list<TaskTraceEventRecord>(taskTraceEventsCollection(workspaceId), { task_id: taskId });
  const sorted = listed.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
  TRACE_EVENTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

export async function listTaskTraceEventsFiltered(
  deps: NodeApiDeps,
  args: {
    workspaceId: string;
    taskId: string;
    messageId?: string;
    runId?: string;
  },
): Promise<TaskTraceEventRecord[]> {
  const { workspaceId, taskId, messageId, runId } = args;
  if (!messageId && !runId) {
    return loadTaskTraceEvents(deps, workspaceId, taskId);
  }
  const filter: Record<string, string> = { task_id: taskId };
  if (messageId) filter.message_id = messageId;
  if (runId) filter.run_id = runId;
  const listed = await deps.docStore.list<TaskTraceEventRecord>(taskTraceEventsCollection(workspaceId), filter);
  return listed.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
}

export async function storeTaskTraceEvent(
  deps: NodeApiDeps,
  workspaceId: string,
  taskId: string,
  event: TaskTraceEventRecord,
): Promise<void> {
  const items = getTaskTraceEvents(taskId);
  items.push(event);
  recordNotebookTraceEventStored();
  await deps.docStore.upsert<TaskTraceEventRecord>(taskTraceEventsCollection(workspaceId), event.id, event);
  if (items.length <= MAX_TRACE_EVENTS_PER_TASK) return;

  let overflow = items.length - MAX_TRACE_EVENTS_PER_TASK;
  recordNotebookTraceEventsTruncated(overflow);
  const removed = items.splice(0, overflow);
  await Promise.all(removed.map((item) => deps.docStore.delete(taskTraceEventsCollection(workspaceId), item.id)));
  if (items.length >= MAX_TRACE_EVENTS_PER_TASK) {
    const evicted = items.shift();
    if (evicted) {
      overflow += 1;
      recordNotebookTraceEventsTruncated(1);
      await deps.docStore.delete(taskTraceEventsCollection(workspaceId), evicted.id);
    }
  }
  const truncatedNotice: TaskTraceEventRecord = {
    id: buildId('trace'),
    task_id: taskId,
    message_id: event.message_id,
    run_id: event.run_id,
    seq: event.seq,
    at: nowIso(),
    category: 'warning',
    name: 'trace.buffer',
    summary: `trace events truncated (dropped ${overflow})`,
    status: 'running',
    phase: 'update',
  };
  items.push(truncatedNotice);
  await deps.docStore.upsert<TaskTraceEventRecord>(taskTraceEventsCollection(workspaceId), truncatedNotice.id, truncatedNotice);
}

export async function deleteTaskTraceEvents(deps: NodeApiDeps, workspaceId: string, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskTraceEventRecord>(taskTraceEventsCollection(workspaceId), { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(taskTraceEventsCollection(workspaceId), item.id)));
}

export function buildTaskTraceEvent(args: {
  taskId: string;
  messageId: string;
  runId: string;
  payload: AgentExecutionTraceEventPayload;
}): TaskTraceEventRecord {
  const { taskId, messageId, runId, payload } = args;
  let details: Record<string, unknown> | undefined;
  if (payload.details) {
    try {
      const serialized = JSON.stringify(payload.details);
      if (serialized && Buffer.byteLength(serialized, 'utf-8') > MAX_TRACE_DETAILS_BYTES) {
        recordNotebookTraceDetailsTruncated();
        details = {
          _truncated: true,
          _reason: 'trace_details_too_large',
          _max_bytes: MAX_TRACE_DETAILS_BYTES,
          _preview: serialized.slice(0, Math.max(64, Math.min(1024, MAX_TRACE_DETAILS_BYTES / 2))),
        };
      } else {
        details = payload.details;
      }
    } catch {
      details = {
        _truncated: true,
        _reason: 'trace_details_not_serializable',
      };
    }
  }
  return {
    id: buildId('trace'),
    task_id: taskId,
    message_id: messageId,
    run_id: runId,
    seq: payload.sequence,
    at: payload.at,
    category: payload.category,
    ...(payload.phase ? { phase: payload.phase } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    name: payload.name,
    summary: payload.summary,
    ...(details ? { details } : {}),
  };
}
