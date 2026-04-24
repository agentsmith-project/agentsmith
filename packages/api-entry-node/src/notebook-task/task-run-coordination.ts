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
export type NotebookTaskRunHardTeardownStatus = 'pending' | 'requested' | 'failed';

export interface NotebookTaskRunHardTeardownState {
  status: NotebookTaskRunHardTeardownStatus;
  requested_at?: string;
  last_attempt_at?: string;
  last_error?: string;
  attempt_count?: number;
  attempt_id?: string;
}

export interface NotebookTaskRunHardTeardownDebtRecord {
  task_id: string;
  run_id: string;
  request_id?: string;
  requested_at: string;
  actor_user_id?: string;
  status: NotebookTaskRunHardTeardownStatus;
  last_attempt_at?: string;
  last_error?: string;
  attempt_count?: number;
  attempt_id?: string;
}

export interface NotebookTaskRunStopRequest {
  mode: NotebookTaskRunStopMode;
  requested_at: string;
  actor_user_id?: string;
  acknowledged_at?: string;
  delivery: NotebookTaskRunStopDelivery;
  deadline_at?: string;
  hard_teardown?: NotebookTaskRunHardTeardownState;
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

export interface NotebookTaskRunStopTransitionResult {
  state: NotebookTaskRunState | null;
  previous: NotebookTaskRunState | null;
  changed: boolean;
  stopModeChanged: boolean;
  hardTeardownRequired: boolean;
  hardTeardownDispatchRequired: boolean;
}

interface NotebookTaskRunHardTeardownReleaseFenceRecord {
  kind: 'notebook_run_hard_teardown_release_fence';
  task_id: string;
  run_id: string;
  released_at: string;
  generation: number;
  attempt_id?: string;
}

function activeRunLockKey(taskId: string): string {
  return `notebook:task:${taskId}:run:lock`;
}

function activeRunStateKey(taskId: string): string {
  return `notebook:task:${taskId}:run:state`;
}

function hardTeardownDebtKey(taskId: string): string {
  return `notebook:task:${taskId}:run:hard-teardown`;
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
  await recordRunHardTeardownDebt(cache, state);
}

async function compareAndWriteRunState(
  cache: CachePort,
  expectedRaw: string | null,
  state: NotebookTaskRunState,
): Promise<boolean> {
  if (typeof cache.compareAndSet === 'function') {
    const nextRaw = JSON.stringify(state);
    const committed = await cache.compareAndSet(
      activeRunStateKey(state.task_id),
      expectedRaw,
      nextRaw,
      NOTEBOOK_RUN_LEASE_TTL_SECONDS,
    );
    if (!committed) {
      return false;
    }
    await cache.set(activeRunLockKey(state.task_id), '1', NOTEBOOK_RUN_LEASE_TTL_SECONDS);
    await recordRunHardTeardownDebt(cache, state);
    return true;
  }
  await writeRunState(cache, state);
  return true;
}

async function patchNotebookTaskRunState(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    mutate: (current: NotebookTaskRunState) => NotebookTaskRunState;
  },
): Promise<NotebookTaskRunState | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentRaw = await cache.get(activeRunStateKey(input.taskId));
    const current = parseJsonRecord<NotebookTaskRunState>(currentRaw);
    if (!current || current.run_id !== input.runId) {
      return current;
    }
    const next = input.mutate(current);
    const committed = await compareAndWriteRunState(cache, currentRaw, next);
    if (committed) return next;
  }
  return getNotebookTaskRunState(cache, input.taskId);
}

function isNotebookHardTeardownStatus(value: unknown): value is NotebookTaskRunHardTeardownStatus {
  return value === 'pending' || value === 'requested' || value === 'failed';
}

function isIncompleteNotebookHardTeardownStatus(status: NotebookTaskRunHardTeardownStatus | undefined): boolean {
  return status === 'pending' || status === 'failed' || status === 'requested';
}

export function hasIncompleteNotebookTaskRunHardTeardown(
  state: NotebookTaskRunState | null | undefined,
): state is NotebookTaskRunState {
  return state?.stop?.mode === 'terminate'
    && state.stop.delivery === 'internal_teardown_requested'
    && isIncompleteNotebookHardTeardownStatus(state.stop.hard_teardown?.status);
}

export function hasNotebookTaskRunHardTeardownDebt(
  state: NotebookTaskRunState | null | undefined,
): state is NotebookTaskRunState {
  return state?.stop?.mode === 'terminate'
    && state.stop.delivery === 'internal_teardown_requested'
    && isNotebookHardTeardownStatus(state.stop.hard_teardown?.status);
}

function parseHardTeardownDebtRecord(raw: string | null): NotebookTaskRunHardTeardownDebtRecord | null {
  const parsed = parseJsonRecord<Partial<NotebookTaskRunHardTeardownDebtRecord>>(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.task_id !== 'string' || parsed.task_id.length === 0) return null;
  if (typeof parsed.run_id !== 'string' || parsed.run_id.length === 0) return null;
  if (!isNotebookHardTeardownStatus(parsed.status)) return null;
  return {
    task_id: parsed.task_id,
    run_id: parsed.run_id,
    requested_at: typeof parsed.requested_at === 'string' ? parsed.requested_at : '',
    status: parsed.status,
    ...(typeof parsed.request_id === 'string' ? { request_id: parsed.request_id } : {}),
    ...(typeof parsed.actor_user_id === 'string' ? { actor_user_id: parsed.actor_user_id } : {}),
    ...(typeof parsed.last_attempt_at === 'string' ? { last_attempt_at: parsed.last_attempt_at } : {}),
    ...(typeof parsed.last_error === 'string' ? { last_error: parsed.last_error } : {}),
    ...(typeof parsed.attempt_count === 'number' && Number.isFinite(parsed.attempt_count)
      ? { attempt_count: parsed.attempt_count }
      : {}),
    ...(typeof parsed.attempt_id === 'string' ? { attempt_id: parsed.attempt_id } : {}),
  };
}

function parseHardTeardownReleaseFenceRecord(raw: string | null): NotebookTaskRunHardTeardownReleaseFenceRecord | null {
  const parsed = parseJsonRecord<Partial<NotebookTaskRunHardTeardownReleaseFenceRecord>>(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.kind !== 'notebook_run_hard_teardown_release_fence') return null;
  if (typeof parsed.task_id !== 'string' || parsed.task_id.length === 0) return null;
  if (typeof parsed.run_id !== 'string' || parsed.run_id.length === 0) return null;
  return {
    kind: 'notebook_run_hard_teardown_release_fence',
    task_id: parsed.task_id,
    run_id: parsed.run_id,
    released_at: typeof parsed.released_at === 'string' ? parsed.released_at : '',
    generation: typeof parsed.generation === 'number' && Number.isFinite(parsed.generation)
      ? parsed.generation
      : 0,
    ...(typeof parsed.attempt_id === 'string' ? { attempt_id: parsed.attempt_id } : {}),
  };
}

export async function getNotebookTaskRunHardTeardownDebt(
  cache: CachePort,
  taskId: string,
): Promise<NotebookTaskRunHardTeardownDebtRecord | null> {
  return parseHardTeardownDebtRecord(await cache.get(hardTeardownDebtKey(taskId)));
}

function getNotebookHardTeardownGeneration(input: {
  attempt_count?: number;
}): number {
  return typeof input.attempt_count === 'number' && Number.isFinite(input.attempt_count)
    ? input.attempt_count
    : 0;
}

function buildNotebookHardTeardownAttemptId(input: {
  taskId: string;
  runId: string;
  generation: number;
  attemptedAt: string;
}): string {
  return [input.taskId, input.runId, input.generation, input.attemptedAt].join(':');
}

function notebookHardTeardownFenceBlocksDebt(
  fence: NotebookTaskRunHardTeardownReleaseFenceRecord | null,
  record: NotebookTaskRunHardTeardownDebtRecord,
): boolean {
  return Boolean(
    fence
    && fence.task_id === record.task_id
    && fence.run_id === record.run_id
    && getNotebookHardTeardownGeneration(record) <= fence.generation,
  );
}

async function writeNotebookTaskRunHardTeardownDebt(
  cache: CachePort,
  record: NotebookTaskRunHardTeardownDebtRecord,
): Promise<void> {
  const key = hardTeardownDebtKey(record.task_id);
  const nextRaw = JSON.stringify(record);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentRaw = await cache.get(key);
    const fence = parseHardTeardownReleaseFenceRecord(currentRaw);
    if (notebookHardTeardownFenceBlocksDebt(fence, record)) {
      return;
    }
    if (typeof cache.compareAndSet === 'function') {
      if (await cache.compareAndSet(key, currentRaw, nextRaw)) return;
      continue;
    }
    await cache.set(key, nextRaw);
    return;
  }
}

async function writeNotebookTaskRunHardTeardownReleaseFence(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    releasedAt: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<void> {
  const key = hardTeardownDebtKey(input.taskId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentRaw = await cache.get(key);
    const currentDebt = parseHardTeardownDebtRecord(currentRaw);
    if (currentDebt && currentDebt.run_id !== input.runId) {
      return;
    }
    const currentFence = parseHardTeardownReleaseFenceRecord(currentRaw);
    const generation = Math.max(
      input.generation ?? 0,
      currentDebt ? getNotebookHardTeardownGeneration(currentDebt) : 0,
      currentFence?.run_id === input.runId ? currentFence.generation : 0,
    );
    const nextRaw = JSON.stringify({
      kind: 'notebook_run_hard_teardown_release_fence',
      task_id: input.taskId,
      run_id: input.runId,
      released_at: input.releasedAt,
      generation,
      ...(input.attemptId ? { attempt_id: input.attemptId } : {}),
    } satisfies NotebookTaskRunHardTeardownReleaseFenceRecord);
    if (typeof cache.compareAndSet === 'function') {
      if (await cache.compareAndSet(key, currentRaw, nextRaw, NOTEBOOK_RUN_LEASE_TTL_SECONDS)) return;
      continue;
    }
    await cache.set(key, nextRaw, NOTEBOOK_RUN_LEASE_TTL_SECONDS);
    return;
  }
}

function buildHardTeardownDebtFromRunState(state: NotebookTaskRunState): NotebookTaskRunHardTeardownDebtRecord | null {
  if (state.stop?.mode !== 'terminate' || state.stop.delivery !== 'internal_teardown_requested') {
    return null;
  }
  const hardTeardown = state.stop.hard_teardown;
  if (!isIncompleteNotebookHardTeardownStatus(hardTeardown?.status)) {
    return null;
  }
  return {
    task_id: state.task_id,
    run_id: state.run_id,
    requested_at: hardTeardown?.requested_at ?? state.stop.requested_at,
    status: hardTeardown?.status ?? 'pending',
    ...(state.request_id ? { request_id: state.request_id } : {}),
    ...(state.stop.actor_user_id ? { actor_user_id: state.stop.actor_user_id } : {}),
    ...(hardTeardown?.last_attempt_at ? { last_attempt_at: hardTeardown.last_attempt_at } : {}),
    ...(hardTeardown?.last_error ? { last_error: hardTeardown.last_error } : {}),
    ...(typeof hardTeardown?.attempt_count === 'number' ? { attempt_count: hardTeardown.attempt_count } : {}),
    ...(hardTeardown?.attempt_id ? { attempt_id: hardTeardown.attempt_id } : {}),
  };
}

async function recordRunHardTeardownDebt(cache: CachePort, state: NotebookTaskRunState | null): Promise<void> {
  if (!state) return;
  const debt = buildHardTeardownDebtFromRunState(state);
  if (debt) {
    await writeNotebookTaskRunHardTeardownDebt(cache, debt);
  }
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
  const existingState = await getNotebookTaskRunState(cache, state.task_id);
  if (existingState || await getNotebookTaskRunHardTeardownDebt(cache, state.task_id)) {
    return false;
  }
  const next = await cache.incr(activeRunLockKey(state.task_id), NOTEBOOK_RUN_LEASE_TTL_SECONDS);
  if (next !== 1) {
    return false;
  }
  const [stateAfterLock, debtAfterLock] = await Promise.all([
    getNotebookTaskRunState(cache, state.task_id),
    getNotebookTaskRunHardTeardownDebt(cache, state.task_id),
  ]);
  if (stateAfterLock || debtAfterLock) {
    await cache.del(activeRunLockKey(state.task_id));
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
  const transition = await requestNotebookTaskRunStopTransition(cache, input);
  return transition.state;
}

function buildNotebookTaskRunStopRequest(input: {
  mode: NotebookTaskRunStopMode;
  requestedAt: string;
  actorUserId?: string;
  delivery: NotebookTaskRunStopDelivery;
  acknowledgedAt?: string;
  deadlineAt?: string;
}): NotebookTaskRunStopRequest {
  const stop: NotebookTaskRunStopRequest = {
    mode: input.mode,
    requested_at: input.requestedAt,
    delivery: input.delivery,
    ...(input.actorUserId ? { actor_user_id: input.actorUserId } : {}),
    ...(input.acknowledgedAt ? { acknowledged_at: input.acknowledgedAt } : {}),
    ...(input.deadlineAt ? { deadline_at: input.deadlineAt } : {}),
  };
  if (input.mode === 'terminate' && input.delivery === 'internal_teardown_requested') {
    stop.hard_teardown = { status: 'pending' };
  }
  return stop;
}

function isNotebookRunHardTeardownRequired(state: NotebookTaskRunState | null): boolean {
  const status = state?.stop?.hard_teardown?.status;
  return state?.stop?.mode === 'terminate'
    && state.stop.delivery === 'internal_teardown_requested'
    && (status === 'pending' || status === 'failed');
}

function isNotebookRunHardTeardownDispatchRequired(state: NotebookTaskRunState | null): boolean {
  return isNotebookRunHardTeardownRequired(state);
}

function ensurePendingHardTeardown(state: NotebookTaskRunState): {
  state: NotebookTaskRunState;
  changed: boolean;
} {
  if (
    state.stop?.mode !== 'terminate' ||
    state.stop.delivery !== 'internal_teardown_requested' ||
    !state.stop.hard_teardown ||
    state.stop.hard_teardown?.status === 'requested' ||
    state.stop.hard_teardown?.status === 'pending'
  ) {
    return { state, changed: false };
  }
  return {
    state: {
      ...state,
      stop: {
        ...state.stop,
        hard_teardown: {
          ...state.stop.hard_teardown,
          status: 'pending',
        },
      },
    },
    changed: true,
  };
}

function resolveNotebookTaskRunStopTransition(
  current: NotebookTaskRunState,
  input: {
    mode: NotebookTaskRunStopMode;
    requestedAt: string;
    actorUserId?: string;
    delivery: NotebookTaskRunStopDelivery;
    acknowledgedAt?: string;
    deadlineAt?: string;
  },
): Pick<NotebookTaskRunStopTransitionResult, 'state' | 'changed' | 'stopModeChanged' | 'hardTeardownRequired' | 'hardTeardownDispatchRequired'> {
  if (current.phase === 'finalizing') {
    if (current.stop?.mode === 'terminate' && current.stop.delivery === 'internal_teardown_requested') {
      const pending = ensurePendingHardTeardown(current);
      return {
        state: pending.state,
        changed: pending.changed,
        stopModeChanged: false,
        hardTeardownRequired: isNotebookRunHardTeardownRequired(pending.state),
        hardTeardownDispatchRequired: isNotebookRunHardTeardownDispatchRequired(pending.state),
      };
    }
    return {
      state: current,
      changed: false,
      stopModeChanged: false,
      hardTeardownRequired: false,
      hardTeardownDispatchRequired: false,
    };
  }

  if (current.stop?.mode === 'terminate') {
    const pending = ensurePendingHardTeardown(current);
    if (current.phase === 'terminating') {
      return {
        state: pending.state,
        changed: pending.changed,
        stopModeChanged: false,
        hardTeardownRequired: isNotebookRunHardTeardownRequired(pending.state),
        hardTeardownDispatchRequired: isNotebookRunHardTeardownDispatchRequired(pending.state),
      };
    }
    const next = ensurePendingHardTeardown({
      ...current,
      phase: 'terminating',
    }).state;
    return {
      state: next,
      changed: true,
      stopModeChanged: false,
      hardTeardownRequired: isNotebookRunHardTeardownRequired(next),
      hardTeardownDispatchRequired: isNotebookRunHardTeardownDispatchRequired(next),
    };
  }

  if (current.stop?.mode === 'cancel' && input.mode === 'cancel') {
    if (current.phase === 'cancelling') {
      return {
        state: current,
        changed: false,
        stopModeChanged: false,
        hardTeardownRequired: false,
        hardTeardownDispatchRequired: false,
      };
    }
    return {
      state: {
        ...current,
        phase: 'cancelling',
      },
      changed: true,
      stopModeChanged: false,
      hardTeardownRequired: false,
      hardTeardownDispatchRequired: false,
    };
  }

  const nextMode = input.mode === 'terminate' ? 'terminate' : 'cancel';
  const next: NotebookTaskRunState = {
    ...current,
    phase: nextMode === 'terminate' ? 'terminating' : 'cancelling',
    stop: buildNotebookTaskRunStopRequest({
      ...input,
      mode: nextMode,
    }),
  };
  return {
    state: next,
    changed: true,
    stopModeChanged: current.stop?.mode !== nextMode,
    hardTeardownRequired: isNotebookRunHardTeardownRequired(next),
    hardTeardownDispatchRequired: isNotebookRunHardTeardownDispatchRequired(next),
  };
}

export async function requestNotebookTaskRunStopTransition(
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
): Promise<NotebookTaskRunStopTransitionResult> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentRaw = await cache.get(activeRunStateKey(input.taskId));
    const current = parseJsonRecord<NotebookTaskRunState>(currentRaw);
    if (!current || current.run_id !== input.runId) {
      return {
        state: current,
        previous: current,
        changed: false,
        stopModeChanged: false,
        hardTeardownRequired: false,
        hardTeardownDispatchRequired: false,
      };
    }

    const transition = resolveNotebookTaskRunStopTransition(current, input);
    if (!transition.changed || !transition.state) {
      if (transition.hardTeardownRequired) {
        await recordRunHardTeardownDebt(cache, transition.state);
      }
      return {
        state: transition.state,
        previous: current,
        changed: false,
        stopModeChanged: false,
        hardTeardownRequired: transition.hardTeardownRequired,
        hardTeardownDispatchRequired: transition.hardTeardownDispatchRequired,
      };
    }

    const committed = await compareAndWriteRunState(cache, currentRaw, transition.state);
    if (committed) {
      if (transition.hardTeardownRequired) {
        await recordRunHardTeardownDebt(cache, transition.state);
      }
      return {
        ...transition,
        previous: current,
      };
    }
  }

  const latest = await getNotebookTaskRunState(cache, input.taskId);
  const hardTeardownRequired = isNotebookRunHardTeardownRequired(latest);
  const hardTeardownDispatchRequired = isNotebookRunHardTeardownDispatchRequired(latest);
  if (hardTeardownRequired) {
    await recordRunHardTeardownDebt(cache, latest);
  }
  return {
    state: latest,
    previous: latest,
    changed: false,
    stopModeChanged: false,
    hardTeardownRequired,
    hardTeardownDispatchRequired,
  };
}

export async function markNotebookTaskRunHardTeardownRequested(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    requestedAt: string;
  },
): Promise<NotebookTaskRunState | null> {
  const existingRaw = await cache.get(hardTeardownDebtKey(input.taskId));
  const existingFence = parseHardTeardownReleaseFenceRecord(existingRaw);
  if (existingFence?.run_id === input.runId) {
    const currentState = await getNotebookTaskRunState(cache, input.taskId);
    return currentState?.run_id === input.runId ? currentState : null;
  }
  const currentDebt = await getNotebookTaskRunHardTeardownDebt(cache, input.taskId);
  const next = await patchNotebookTaskRunState(cache, {
    taskId: input.taskId,
    runId: input.runId,
    mutate: (current) => {
      if (current.stop?.mode !== 'terminate' || current.stop.delivery !== 'internal_teardown_requested') {
        return current;
      }
      const generation = getNotebookHardTeardownGeneration(current.stop.hard_teardown ?? {}) + 1;
      const attemptId = buildNotebookHardTeardownAttemptId({
        taskId: input.taskId,
        runId: input.runId,
        generation,
        attemptedAt: input.requestedAt,
      });
      return {
        ...current,
        stop: {
          ...current.stop,
          hard_teardown: {
            status: 'requested',
            requested_at: input.requestedAt,
            last_attempt_at: input.requestedAt,
            attempt_count: generation,
            attempt_id: attemptId,
          },
        },
        heartbeat_at: current.heartbeat_at,
      };
    },
  });
  const nextForRun = next?.run_id === input.runId ? next : null;
  const nextHardTeardown = nextForRun?.stop?.hard_teardown;
  const generation = nextHardTeardown?.attempt_count ?? (currentDebt?.attempt_count ?? 0) + 1;
  const attemptId = nextHardTeardown?.attempt_id ?? buildNotebookHardTeardownAttemptId({
    taskId: input.taskId,
    runId: input.runId,
    generation,
    attemptedAt: input.requestedAt,
  });
  await writeNotebookTaskRunHardTeardownDebt(cache, {
    task_id: input.taskId,
    run_id: input.runId,
    requested_at: nextForRun?.stop?.requested_at
      ?? currentDebt?.requested_at
      ?? input.requestedAt,
    status: 'requested',
    ...(nextForRun?.request_id ?? currentDebt?.request_id
      ? { request_id: nextForRun?.request_id ?? currentDebt?.request_id }
      : {}),
    ...(nextForRun?.stop?.actor_user_id ?? currentDebt?.actor_user_id
      ? { actor_user_id: nextForRun?.stop?.actor_user_id ?? currentDebt?.actor_user_id }
      : {}),
    last_attempt_at: input.requestedAt,
    attempt_count: generation,
    attempt_id: attemptId,
  });
  return next?.run_id === input.runId ? next : null;
}

export async function markNotebookTaskRunHardTeardownReleased(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    releasedAt?: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<NotebookTaskRunState | null> {
  const currentDebt = await getNotebookTaskRunHardTeardownDebt(cache, input.taskId);
  const currentState = await getNotebookTaskRunState(cache, input.taskId);
  if (currentDebt && currentDebt.run_id !== input.runId) {
    return currentState?.run_id === input.runId ? currentState : null;
  }
  const currentHardTeardown = currentState?.run_id === input.runId ? currentState.stop?.hard_teardown : undefined;
  await writeNotebookTaskRunHardTeardownReleaseFence(cache, {
    taskId: input.taskId,
    runId: input.runId,
    releasedAt: input.releasedAt ?? new Date().toISOString(),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    generation: Math.max(
      input.generation ?? 0,
      currentDebt ? getNotebookHardTeardownGeneration(currentDebt) : 0,
      currentHardTeardown ? getNotebookHardTeardownGeneration(currentHardTeardown) : 0,
    ),
  });
  const next = await patchNotebookTaskRunState(cache, {
    taskId: input.taskId,
    runId: input.runId,
    mutate: (current) => {
      if (current.stop?.mode !== 'terminate' || current.stop.delivery !== 'internal_teardown_requested') {
        return current;
      }
      const nextStop: NotebookTaskRunStopRequest = {
        ...current.stop,
      };
      delete nextStop.hard_teardown;
      return {
        ...current,
        stop: nextStop,
      };
    },
  });
  return next?.run_id === input.runId ? next : null;
}

export async function markNotebookTaskRunHardTeardownFailed(
  cache: CachePort,
  input: {
    taskId: string;
    runId: string;
    attemptedAt: string;
    errorMessage: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<NotebookTaskRunState | null> {
  const currentDebt = await getNotebookTaskRunHardTeardownDebt(cache, input.taskId);
  if (input.attemptId) {
    const currentRaw = await cache.get(hardTeardownDebtKey(input.taskId));
    const currentFence = parseHardTeardownReleaseFenceRecord(currentRaw);
    if (
      currentFence?.run_id === input.runId
      && (input.generation ?? 0) <= currentFence.generation
    ) {
      const currentState = await getNotebookTaskRunState(cache, input.taskId);
      return currentState?.run_id === input.runId ? currentState : null;
    }
  }
  if (input.attemptId && currentDebt && currentDebt.attempt_id !== input.attemptId) {
    return null;
  }
  if (input.attemptId && !currentDebt) {
    const currentState = await getNotebookTaskRunState(cache, input.taskId);
    const currentAttemptId = currentState?.run_id === input.runId
      ? currentState.stop?.hard_teardown?.attempt_id
      : undefined;
    if (currentAttemptId !== input.attemptId) {
      return currentState?.run_id === input.runId ? currentState : null;
    }
  }
  const next = await patchNotebookTaskRunState(cache, {
    taskId: input.taskId,
    runId: input.runId,
    mutate: (current) => {
      if (current.stop?.mode !== 'terminate' || current.stop.delivery !== 'internal_teardown_requested') {
        return current;
      }
      if (input.attemptId && current.stop.hard_teardown?.attempt_id !== input.attemptId) {
        return current;
      }
      const generation = input.generation
        ?? (
          getNotebookHardTeardownGeneration(current.stop.hard_teardown ?? {})
          || (current.stop.hard_teardown?.attempt_count ?? 0) + 1
        );
      return {
        ...current,
        stop: {
          ...current.stop,
          hard_teardown: {
            status: 'failed',
            last_attempt_at: input.attemptedAt,
            last_error: input.errorMessage,
            attempt_count: generation,
            ...(input.attemptId ?? current.stop.hard_teardown?.attempt_id
              ? { attempt_id: input.attemptId ?? current.stop.hard_teardown?.attempt_id }
              : {}),
          },
        },
      };
    },
  });
  const nextForRun = next?.run_id === input.runId ? next : null;
  const nextHardTeardown = nextForRun?.stop?.hard_teardown;
  const generation = input.generation
    ?? nextHardTeardown?.attempt_count
    ?? (currentDebt?.attempt_count ?? 0) + 1;
  if (input.attemptId) {
    const latestRaw = await cache.get(hardTeardownDebtKey(input.taskId));
    const latestFence = parseHardTeardownReleaseFenceRecord(latestRaw);
    if (latestFence?.run_id === input.runId && generation <= latestFence.generation) {
      return nextForRun;
    }
    const latestDebt = parseHardTeardownDebtRecord(latestRaw);
    const latestState = await getNotebookTaskRunState(cache, input.taskId);
    const latestAttemptId = latestDebt?.attempt_id
      ?? (latestState?.run_id === input.runId ? latestState.stop?.hard_teardown?.attempt_id : undefined);
    if (latestAttemptId !== input.attemptId) {
      return nextForRun;
    }
  }
  await writeNotebookTaskRunHardTeardownDebt(cache, {
    task_id: input.taskId,
    run_id: input.runId,
    requested_at: nextForRun?.stop?.requested_at
      ?? currentDebt?.requested_at
      ?? input.attemptedAt,
    status: 'failed',
    ...(nextForRun?.request_id ?? currentDebt?.request_id
      ? { request_id: nextForRun?.request_id ?? currentDebt?.request_id }
      : {}),
    ...(nextForRun?.stop?.actor_user_id ?? currentDebt?.actor_user_id
      ? { actor_user_id: nextForRun?.stop?.actor_user_id ?? currentDebt?.actor_user_id }
      : {}),
    last_attempt_at: input.attemptedAt,
    last_error: input.errorMessage,
    attempt_count: generation,
    ...(input.attemptId ?? nextHardTeardown?.attempt_id ?? currentDebt?.attempt_id
      ? { attempt_id: input.attemptId ?? nextHardTeardown?.attempt_id ?? currentDebt?.attempt_id }
      : {}),
  });
  return nextForRun;
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
  const debtToPreserve = buildHardTeardownDebtFromRunState(current);
  if (typeof cache.compareAndSet === 'function' && currentRaw !== null) {
    const cleared = await cache.compareAndSet(stateKey, currentRaw, null);
    if (!cleared) {
      return false;
    }
  } else {
    await cache.del(stateKey);
  }

  if (debtToPreserve) {
    await writeNotebookTaskRunHardTeardownDebt(cache, debtToPreserve);
  }

  await Promise.all([
    cache.del(activeRunLockKey(input.taskId)),
    cache.del(legacyCancelRequestKey(input.taskId)),
  ]);
  return true;
}
