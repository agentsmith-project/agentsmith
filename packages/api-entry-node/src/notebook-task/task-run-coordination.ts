import type { CachePort } from '@mbos/ports';

const NOTEBOOK_RUN_LEASE_TTL_SECONDS = 300;
const NOTEBOOK_RUN_CANCEL_TTL_SECONDS = 300;

const NOTEBOOK_RUN_OWNER_INSTANCE_ID = process.env.NOTEBOOK_RUN_INSTANCE_ID?.trim()
  || `api-${process.pid}`;

export interface NotebookTaskRunState {
  task_id: string;
  run_id: string;
  owner_instance_id: string;
  started_at: string;
  heartbeat_at: string;
  request_id?: string;
  dispatched_at?: string;
}

export interface NotebookTaskRunCancellationRequest {
  task_id: string;
  run_id: string;
  requested_at: string;
  actor_user_id?: string;
}

function activeRunLockKey(taskId: string): string {
  return `notebook:task:${taskId}:run:lock`;
}

function activeRunStateKey(taskId: string): string {
  return `notebook:task:${taskId}:run:state`;
}

function cancelRequestKey(taskId: string): string {
  return `notebook:task:${taskId}:run:cancel`;
}

function parseJsonRecord<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getNotebookRunOwnerInstanceId(): string {
  return NOTEBOOK_RUN_OWNER_INSTANCE_ID;
}

export function buildNotebookTaskRunState(input: {
  taskId: string;
  runId: string;
  ownerInstanceId?: string;
  startedAt: string;
  heartbeatAt?: string;
  requestId?: string;
  dispatchedAt?: string;
}): NotebookTaskRunState {
  return {
    task_id: input.taskId,
    run_id: input.runId,
    owner_instance_id: input.ownerInstanceId?.trim() || NOTEBOOK_RUN_OWNER_INSTANCE_ID,
    started_at: input.startedAt,
    heartbeat_at: input.heartbeatAt ?? input.startedAt,
    ...(input.requestId ? { request_id: input.requestId } : {}),
    ...(input.dispatchedAt ? { dispatched_at: input.dispatchedAt } : {}),
  };
}

export async function acquireNotebookTaskRunLease(
  cache: CachePort,
  state: NotebookTaskRunState,
): Promise<boolean> {
  const next = await cache.incr(activeRunLockKey(state.task_id), NOTEBOOK_RUN_LEASE_TTL_SECONDS);
  if (next !== 1) {
    return false;
  }
  await cache.set(activeRunStateKey(state.task_id), JSON.stringify(state), NOTEBOOK_RUN_LEASE_TTL_SECONDS);
  await cache.del(cancelRequestKey(state.task_id));
  return true;
}

export async function getNotebookTaskRunState(
  cache: CachePort,
  taskId: string,
): Promise<NotebookTaskRunState | null> {
  return parseJsonRecord<NotebookTaskRunState>(await cache.get(activeRunStateKey(taskId)));
}

export async function refreshNotebookTaskRunLease(
  cache: CachePort,
  state: NotebookTaskRunState,
): Promise<void> {
  await cache.set(activeRunLockKey(state.task_id), '1', NOTEBOOK_RUN_LEASE_TTL_SECONDS);
  await cache.set(activeRunStateKey(state.task_id), JSON.stringify(state), NOTEBOOK_RUN_LEASE_TTL_SECONDS);
}

export async function markNotebookTaskRunDispatched(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    requestId: string;
    dispatchedAt: string;
  },
): Promise<NotebookTaskRunState | null> {
  const current = await getNotebookTaskRunState(cache, input.taskId);
  if (!current || current.run_id !== input.runId) {
    return current;
  }
  const next: NotebookTaskRunState = {
    ...current,
    request_id: input.requestId,
    dispatched_at: input.dispatchedAt,
    heartbeat_at: input.dispatchedAt,
  };
  await refreshNotebookTaskRunLease(cache, next);
  return next;
}

export async function requestNotebookTaskRunCancellation(
  cache: CachePort,
  input: NotebookTaskRunCancellationRequest,
): Promise<void> {
  await cache.set(cancelRequestKey(input.task_id), JSON.stringify(input), NOTEBOOK_RUN_CANCEL_TTL_SECONDS);
}

export async function getNotebookTaskRunCancellationRequest(
  cache: CachePort,
  taskId: string,
): Promise<NotebookTaskRunCancellationRequest | null> {
  return parseJsonRecord<NotebookTaskRunCancellationRequest>(await cache.get(cancelRequestKey(taskId)));
}

export async function clearNotebookTaskRunCoordination(
  cache: CachePort,
  taskId: string,
): Promise<void> {
  await Promise.all([
    cache.del(activeRunLockKey(taskId)),
    cache.del(activeRunStateKey(taskId)),
    cache.del(cancelRequestKey(taskId)),
  ]);
}

export async function isNotebookTaskRunActive(cache: CachePort, taskId: string): Promise<boolean> {
  return (await getNotebookTaskRunState(cache, taskId)) !== null;
}
