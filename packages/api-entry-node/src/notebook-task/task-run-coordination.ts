import type { CachePort } from '@mbos/ports';

const NOTEBOOK_RUN_LEASE_TTL_SECONDS = 300;
const NOTEBOOK_RUN_OWNER_INSTANCE_ID = process.env.NOTEBOOK_RUN_INSTANCE_ID?.trim()
  || `api-${process.pid}`;

export type NotebookTaskRunPhase = 'running' | 'cancelling' | 'terminating' | 'finalizing';
export type NotebookTaskRunStopMode = 'cancel' | 'terminate';
export type NotebookTaskRunStopDelivery =
  | 'owner_attached'
  | 'shared_owner'
  | 'internal_teardown_requested';

export interface NotebookTaskRunStopRequest {
  mode: NotebookTaskRunStopMode;
  requested_at: string;
  actor_user_id?: string;
  acknowledged_at?: string;
  delivery: NotebookTaskRunStopDelivery;
  deadline_at?: string;
}

export interface NotebookTaskRunFinalizationState {
  status: 'pending' | 'persist_failed';
  updated_at: string;
  error_code?: string;
}

export interface NotebookTaskRunState {
  task_id: string;
  run_id: string;
  owner_instance_id: string;
  phase: NotebookTaskRunPhase;
  started_at: string;
  heartbeat_at: string;
  request_id?: string;
  dispatched_at?: string;
  stop?: NotebookTaskRunStopRequest;
  finalization?: NotebookTaskRunFinalizationState;
}

function activeRunLockKey(taskId: string): string {
  return `notebook:task:${taskId}:run:lock`;
}

function activeRunStateKey(taskId: string): string {
  return `notebook:task:${taskId}:run:state`;
}

function legacyCancelRequestKey(taskId: string): string {
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

async function writeRunState(
  cache: CachePort,
  state: NotebookTaskRunState,
): Promise<void> {
  await cache.set(activeRunStateKey(state.task_id), JSON.stringify(state), NOTEBOOK_RUN_LEASE_TTL_SECONDS);
  await cache.set(activeRunLockKey(state.task_id), '1', NOTEBOOK_RUN_LEASE_TTL_SECONDS);
}

export function getNotebookRunOwnerInstanceId(): string {
  return NOTEBOOK_RUN_OWNER_INSTANCE_ID;
}

export function buildNotebookTaskRunState(input: {
  taskId: string;
  runId: string;
  ownerInstanceId?: string;
  phase?: NotebookTaskRunPhase;
  startedAt: string;
  heartbeatAt?: string;
  requestId?: string;
  dispatchedAt?: string;
  stop?: NotebookTaskRunStopRequest;
  finalization?: NotebookTaskRunFinalizationState;
}): NotebookTaskRunState {
  return {
    task_id: input.taskId,
    run_id: input.runId,
    owner_instance_id: input.ownerInstanceId?.trim() || NOTEBOOK_RUN_OWNER_INSTANCE_ID,
    phase: input.phase ?? 'running',
    started_at: input.startedAt,
    heartbeat_at: input.heartbeatAt ?? input.startedAt,
    ...(input.requestId ? { request_id: input.requestId } : {}),
    ...(input.dispatchedAt ? { dispatched_at: input.dispatchedAt } : {}),
    ...(input.stop ? { stop: input.stop } : {}),
    ...(input.finalization ? { finalization: input.finalization } : {}),
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
  await writeRunState(cache, state);
  await cache.del(legacyCancelRequestKey(state.task_id));
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
): Promise<boolean> {
  const current = await getNotebookTaskRunState(cache, state.task_id);
  if (!current || current.run_id !== state.run_id) {
    return false;
  }
  await writeRunState(cache, state);
  return true;
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
  const refreshed = await refreshNotebookTaskRunLease(cache, next);
  return refreshed ? next : await getNotebookTaskRunState(cache, input.taskId);
}

export async function requestNotebookTaskRunStop(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    mode: NotebookTaskRunStopMode;
    requestedAt: string;
    actorUserId?: string;
    delivery: NotebookTaskRunStopDelivery;
    acknowledgedAt?: string;
    deadlineAt?: string;
  },
): Promise<NotebookTaskRunState | null> {
  const current = await getNotebookTaskRunState(cache, input.taskId);
  if (!current || current.run_id !== input.runId) {
    return current;
  }
  const nextMode: NotebookTaskRunStopMode = (
    current.stop?.mode === 'terminate' || input.mode === 'terminate'
      ? 'terminate'
      : 'cancel'
  );
  const nextPhase: NotebookTaskRunPhase = (
    current.phase === 'finalizing'
      ? 'finalizing'
      : nextMode === 'terminate'
        ? 'terminating'
        : 'cancelling'
  );
  const next: NotebookTaskRunState = {
    ...current,
    phase: nextPhase,
    stop: {
      mode: nextMode,
      requested_at: input.requestedAt,
      delivery: input.delivery,
      ...(input.actorUserId ? { actor_user_id: input.actorUserId } : {}),
      ...(input.acknowledgedAt ? { acknowledged_at: input.acknowledgedAt } : {}),
      ...(input.deadlineAt ? { deadline_at: input.deadlineAt } : {}),
    },
  };
  const refreshed = await refreshNotebookTaskRunLease(cache, next);
  return refreshed ? next : await getNotebookTaskRunState(cache, input.taskId);
}

export async function getNotebookTaskRunStopRequestForRun(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
  },
): Promise<NotebookTaskRunStopRequest | null> {
  const current = await getNotebookTaskRunState(cache, input.taskId);
  if (!current || current.run_id !== input.runId) {
    return null;
  }
  return current.stop ?? null;
}

export async function markNotebookTaskRunFinalizing(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    updatedAt: string;
    errorCode?: string;
  },
): Promise<NotebookTaskRunState | null> {
  const current = await getNotebookTaskRunState(cache, input.taskId);
  if (!current || current.run_id !== input.runId) {
    return current;
  }
  const next: NotebookTaskRunState = {
    ...current,
    phase: 'finalizing',
    finalization: {
      status: input.errorCode ? 'persist_failed' : 'pending',
      updated_at: input.updatedAt,
      ...(input.errorCode ? { error_code: input.errorCode } : {}),
    },
  };
  const refreshed = await refreshNotebookTaskRunLease(cache, next);
  return refreshed ? next : await getNotebookTaskRunState(cache, input.taskId);
}

export function isNotebookTaskRunOwnerHeartbeatFresh(
  state: NotebookTaskRunState,
  input?: {
    nowMs?: number;
    maxAgeMs?: number;
  },
): boolean {
  const nowMs = input?.nowMs ?? Date.now();
  const maxAgeMs = input?.maxAgeMs ?? 0;
  const heartbeatMs = Date.parse(state.heartbeat_at);
  if (!Number.isFinite(heartbeatMs)) {
    return false;
  }
  return Math.max(0, nowMs - heartbeatMs) <= maxAgeMs;
}

export async function clearNotebookTaskRunCoordination(
  cache: CachePort,
  taskId: string,
): Promise<void> {
  await Promise.all([
    cache.del(activeRunLockKey(taskId)),
    cache.del(activeRunStateKey(taskId)),
    cache.del(legacyCancelRequestKey(taskId)),
  ]);
}

export async function isNotebookTaskRunActive(cache: CachePort, taskId: string): Promise<boolean> {
  return (await getNotebookTaskRunState(cache, taskId)) !== null;
}

export async function finalizeNotebookTaskRun(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
  },
): Promise<boolean> {
  const stateKey = activeRunStateKey(input.taskId);
  const currentRaw = await cache.get(stateKey);
  const current = parseJsonRecord<NotebookTaskRunState>(currentRaw);
  if (!current || current.run_id !== input.runId) {
    return false;
  }
  if (typeof cache.compareAndSet === 'function' && currentRaw !== null) {
    const cleared = await cache.compareAndSet(stateKey, currentRaw, null);
    if (!cleared) {
      return false;
    }
  } else {
    await cache.del(stateKey);
  }

  await Promise.all([
    cache.del(activeRunLockKey(input.taskId)),
    cache.del(legacyCancelRequestKey(input.taskId)),
  ]);
  return true;
}
