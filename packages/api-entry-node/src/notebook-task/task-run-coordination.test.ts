import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  clearNotebookTaskRunCoordination,
  finalizeNotebookTaskRun,
  getNotebookTaskRunStopRequestForRun,
  getNotebookTaskRunState,
  getNotebookTaskRunHardTeardownDebt,
  isNotebookTaskRunActive,
  markNotebookTaskRunHardTeardownFailed,
  markNotebookTaskRunHardTeardownReleased,
  markNotebookTaskRunHardTeardownRequested,
  markNotebookTaskRunFinalizing,
  markNotebookTaskRunDispatched,
  refreshNotebookTaskRunLease,
  requestNotebookTaskRunStop,
  requestNotebookTaskRunStopTransition,
} from './task-run-coordination.js';

afterEach(() => {
  vi.useRealTimers();
});

function notebookTaskRunLockKey(taskId: string): string {
  return `notebook:task:${taskId}:run:lock`;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

class PausedRunStateCompareAndSetCache extends InMemoryCache {
  readonly compareAndSetPaused = createDeferred<void>();

  readonly resumeCompareAndSet = createDeferred<void>();

  private paused = false;

  constructor(private readonly pausedStateKey: string) {
    super();
  }

  override async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.paused && key === this.pausedStateKey && nextValue !== null) {
      this.paused = true;
      this.compareAndSetPaused.resolve();
      await this.resumeCompareAndSet.promise;
    }
    return super.compareAndSet(key, expectedValue, nextValue, ttlSeconds);
  }
}

describe('notebook task run coordination', () => {
  it('acquires, reads, updates, and clears shared run state', async () => {
    const cache = new InMemoryCache();
    const state = buildNotebookTaskRunState({
      taskId: 'task_1',
      runId: 'run_1',
      startedAt: '2026-03-18T01:00:00.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);
    await expect(isNotebookTaskRunActive(cache, 'task_1')).resolves.toBe(true);
    await expect(getNotebookTaskRunState(cache, 'task_1')).resolves.toMatchObject({
      task_id: 'task_1',
      run_id: 'run_1',
      phase: 'running',
    });

    await expect(markNotebookTaskRunDispatched(cache, {
      taskId: 'task_1',
      runId: 'run_1',
      requestId: 'req_1',
      dispatchedAt: '2026-03-18T01:00:05.000Z',
    })).resolves.toMatchObject({
      request_id: 'req_1',
      dispatched_at: '2026-03-18T01:00:05.000Z',
    });

    await clearNotebookTaskRunCoordination(cache, 'task_1');
    await expect(isNotebookTaskRunActive(cache, 'task_1')).resolves.toBe(false);
  });

  it('rejects a second lease and records stop intent in shared run control truth', async () => {
    const cache = new InMemoryCache();
    const first = buildNotebookTaskRunState({
      taskId: 'task_2',
      runId: 'run_a',
      startedAt: '2026-03-18T02:00:00.000Z',
    });
    const second = buildNotebookTaskRunState({
      taskId: 'task_2',
      runId: 'run_b',
      startedAt: '2026-03-18T02:00:01.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, first)).resolves.toBe(true);
    await expect(acquireNotebookTaskRunLease(cache, second)).resolves.toBe(false);

    await expect(requestNotebookTaskRunStop(cache, {
      taskId: 'task_2',
      runId: 'run_a',
      mode: 'cancel',
      requestedAt: '2026-03-18T02:00:03.000Z',
      actorUserId: 'user_1',
      delivery: 'owner_attached',
    })).resolves.toMatchObject({
      phase: 'cancelling',
      stop: {
        mode: 'cancel',
        actor_user_id: 'user_1',
        delivery: 'owner_attached',
      },
    });

    await expect(getNotebookTaskRunStopRequestForRun(cache, {
      taskId: 'task_2',
      runId: 'run_a',
    })).resolves.toMatchObject({
      mode: 'cancel',
      actor_user_id: 'user_1',
      delivery: 'owner_attached',
    });
  });

  it('clears stale cancel state after run closure so the next shared lease can take over cleanly', async () => {
    const cache = new InMemoryCache();
    const initial = buildNotebookTaskRunState({
      taskId: 'task_3',
      runId: 'run_initial',
      startedAt: '2026-03-18T03:00:00.000Z',
    });
    const replacement = buildNotebookTaskRunState({
      taskId: 'task_3',
      runId: 'run_replacement',
      startedAt: '2026-03-18T03:00:05.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, initial)).resolves.toBe(true);
    await requestNotebookTaskRunStop(cache, {
      taskId: 'task_3',
      runId: 'run_initial',
      mode: 'cancel',
      requestedAt: '2026-03-18T03:00:03.000Z',
      actorUserId: 'user_recovery',
      delivery: 'shared_owner',
    });

    await clearNotebookTaskRunCoordination(cache, 'task_3');

    await expect(isNotebookTaskRunActive(cache, 'task_3')).resolves.toBe(false);
    await expect(getNotebookTaskRunStopRequestForRun(cache, {
      taskId: 'task_3',
      runId: 'run_initial',
    })).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, replacement)).resolves.toBe(true);
    await expect(getNotebookTaskRunState(cache, 'task_3')).resolves.toMatchObject({
      task_id: 'task_3',
      run_id: 'run_replacement',
    });
  });

  it('does not clear a replacement lease when an older run finalizes late', async () => {
    const cache = new InMemoryCache();
    const original = buildNotebookTaskRunState({
      taskId: 'task_4',
      runId: 'run_old',
      startedAt: '2026-03-18T04:00:00.000Z',
    });
    const replacement = buildNotebookTaskRunState({
      taskId: 'task_4',
      runId: 'run_new',
      startedAt: '2026-03-18T04:01:00.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, original)).resolves.toBe(true);
    await clearNotebookTaskRunCoordination(cache, 'task_4');
    await expect(acquireNotebookTaskRunLease(cache, replacement)).resolves.toBe(true);
    await requestNotebookTaskRunStop(cache, {
      taskId: 'task_4',
      runId: 'run_new',
      mode: 'terminate',
      requestedAt: '2026-03-18T04:01:05.000Z',
      actorUserId: 'user_2',
      delivery: 'internal_teardown_requested',
    });

    await expect(finalizeNotebookTaskRun(cache, {
      taskId: 'task_4',
      runId: 'run_old',
    })).resolves.toBe(false);
    await expect(getNotebookTaskRunState(cache, 'task_4')).resolves.toMatchObject({
      task_id: 'task_4',
      run_id: 'run_new',
      phase: 'terminating',
    });
    await expect(getNotebookTaskRunStopRequestForRun(cache, {
      taskId: 'task_4',
      runId: 'run_new',
    })).resolves.toMatchObject({
      mode: 'terminate',
      delivery: 'internal_teardown_requested',
    });
  });

  it('does not clear a replacement lock or report success when an older run finalizes after state already vanished', async () => {
    const cache = new InMemoryCache();
    const taskId = 'task_finalize_no_state_lock_window';
    const lockKey = notebookTaskRunLockKey(taskId);

    await expect(cache.incr(lockKey, 300)).resolves.toBe(1);
    await expect(finalizeNotebookTaskRun(cache, {
      taskId,
      runId: 'run_old',
    })).resolves.toBe(false);

    await expect(cache.get(lockKey)).resolves.toBe('1');
    await expect(getNotebookTaskRunState(cache, taskId)).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId,
      runId: 'run_replacement_retry',
      startedAt: '2026-03-18T04:02:00.000Z',
    }))).resolves.toBe(false);
  });

  it('marks a shared run as finalizing and preserves terminal persistence failure details', async () => {
    const cache = new InMemoryCache();
    const state = buildNotebookTaskRunState({
      taskId: 'task_5',
      runId: 'run_finalizing',
      startedAt: '2026-03-18T05:00:00.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);
    await expect(markNotebookTaskRunFinalizing(cache, {
      taskId: 'task_5',
      runId: 'run_finalizing',
      updatedAt: '2026-03-18T05:00:30.000Z',
      errorCode: 'AGENT_FINALIZE_PERSIST_FAILED',
    })).resolves.toMatchObject({
      phase: 'finalizing',
      finalization: {
        status: 'persist_failed',
        error_code: 'AGENT_FINALIZE_PERSIST_FAILED',
      },
    });

    await expect(getNotebookTaskRunState(cache, 'task_5')).resolves.toMatchObject({
      task_id: 'task_5',
      run_id: 'run_finalizing',
      phase: 'finalizing',
      finalization: {
        status: 'persist_failed',
        error_code: 'AGENT_FINALIZE_PERSIST_FAILED',
      },
    });
  });

  it('keeps stop requests idempotent and monotonic across cancel and terminate retries', async () => {
    const cache = new InMemoryCache();
    const state = buildNotebookTaskRunState({
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      startedAt: '2026-03-18T06:00:00.000Z',
    });

    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      mode: 'cancel',
      requestedAt: '2026-03-18T06:00:05.000Z',
      actorUserId: 'user_1',
      delivery: 'owner_attached',
    })).resolves.toMatchObject({
      changed: true,
      stopModeChanged: true,
      state: {
        phase: 'cancelling',
        stop: {
          mode: 'cancel',
          requested_at: '2026-03-18T06:00:05.000Z',
          delivery: 'owner_attached',
        },
      },
    });

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      mode: 'cancel',
      requestedAt: '2026-03-18T06:00:10.000Z',
      actorUserId: 'user_2',
      delivery: 'shared_owner',
    })).resolves.toMatchObject({
      changed: false,
      stopModeChanged: false,
      state: {
        phase: 'cancelling',
        stop: {
          mode: 'cancel',
          requested_at: '2026-03-18T06:00:05.000Z',
          actor_user_id: 'user_1',
          delivery: 'owner_attached',
        },
      },
    });

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      mode: 'terminate',
      requestedAt: '2026-03-18T06:00:15.000Z',
      actorUserId: 'user_3',
      delivery: 'internal_teardown_requested',
    })).resolves.toMatchObject({
      changed: true,
      stopModeChanged: true,
      previous: {
        stop: {
          mode: 'cancel',
        },
      },
      state: {
        phase: 'terminating',
        stop: {
          mode: 'terminate',
          requested_at: '2026-03-18T06:00:15.000Z',
          actor_user_id: 'user_3',
          delivery: 'internal_teardown_requested',
        },
      },
    });

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      mode: 'cancel',
      requestedAt: '2026-03-18T06:00:20.000Z',
      actorUserId: 'user_4',
      delivery: 'owner_attached',
    })).resolves.toMatchObject({
      changed: false,
      stopModeChanged: false,
      state: {
        phase: 'terminating',
        stop: {
          mode: 'terminate',
          requested_at: '2026-03-18T06:00:15.000Z',
          actor_user_id: 'user_3',
          delivery: 'internal_teardown_requested',
        },
      },
    });

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_monotonic',
      runId: 'run_stop_monotonic',
      mode: 'terminate',
      requestedAt: '2026-03-18T06:00:25.000Z',
      actorUserId: 'user_5',
      delivery: 'internal_teardown_requested',
    })).resolves.toMatchObject({
      changed: false,
      stopModeChanged: false,
      state: {
        phase: 'terminating',
        stop: {
          mode: 'terminate',
          requested_at: '2026-03-18T06:00:15.000Z',
        },
      },
    });
  });

  it('does not mutate finalizing run truth when late stop requests arrive', async () => {
    const cache = new InMemoryCache();
    const state = buildNotebookTaskRunState({
      taskId: 'task_stop_finalizing',
      runId: 'run_stop_finalizing',
      phase: 'finalizing',
      startedAt: '2026-03-18T07:00:00.000Z',
      stop: {
        mode: 'cancel',
        requested_at: '2026-03-18T07:00:05.000Z',
        actor_user_id: 'user_1',
        delivery: 'owner_attached',
      },
      finalization: {
        status: 'pending',
        updated_at: '2026-03-18T07:00:10.000Z',
      },
    });

    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);
    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_stop_finalizing',
      runId: 'run_stop_finalizing',
      mode: 'terminate',
      requestedAt: '2026-03-18T07:00:15.000Z',
      actorUserId: 'user_2',
      delivery: 'internal_teardown_requested',
    })).resolves.toMatchObject({
      changed: false,
      stopModeChanged: false,
      state: {
        phase: 'finalizing',
        stop: {
          mode: 'cancel',
          requested_at: '2026-03-18T07:00:05.000Z',
          actor_user_id: 'user_1',
          delivery: 'owner_attached',
        },
      },
    });
  });

  it('keeps finalizing hard teardown debt retryable without reopening the run phase', async () => {
    const cache = new InMemoryCache();
    const state = buildNotebookTaskRunState({
      taskId: 'task_finalizing_debt',
      runId: 'run_finalizing_debt',
      phase: 'finalizing',
      startedAt: '2026-03-18T08:00:00.000Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T08:00:05.000Z',
        actor_user_id: 'user_1',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_attempt_at: '2026-03-18T08:00:10.000Z',
          last_error: 'final release failed',
          attempt_count: 1,
        },
      },
      finalization: {
        status: 'pending',
        updated_at: '2026-03-18T08:00:15.000Z',
      },
    });

    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);
    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_finalizing_debt',
      runId: 'run_finalizing_debt',
      mode: 'terminate',
      requestedAt: '2026-03-18T08:00:20.000Z',
      actorUserId: 'user_2',
      delivery: 'internal_teardown_requested',
    })).resolves.toMatchObject({
      changed: true,
      stopModeChanged: false,
      hardTeardownRequired: true,
      state: {
        phase: 'finalizing',
        stop: {
          mode: 'terminate',
          requested_at: '2026-03-18T08:00:05.000Z',
          hard_teardown: {
            status: 'pending',
            last_error: 'final release failed',
          },
        },
      },
    });
  });

  it('stores hard teardown debt outside active run state and clears it after real release succeeds', async () => {
    const cache = new InMemoryCache();

    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_terminal_debt',
      runId: 'run_terminal_debt',
      attemptedAt: '2026-03-18T09:00:00.000Z',
      errorMessage: 'release failed after run state cleared',
    })).resolves.toBeNull();

    await expect(getNotebookTaskRunState(cache, 'task_terminal_debt')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_terminal_debt')).resolves.toMatchObject({
      task_id: 'task_terminal_debt',
      run_id: 'run_terminal_debt',
      status: 'failed',
      last_error: 'release failed after run state cleared',
    });

    await expect(markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_terminal_debt',
      runId: 'run_terminal_debt',
      requestedAt: '2026-03-18T09:00:05.000Z',
    })).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_terminal_debt')).resolves.toMatchObject({
      task_id: 'task_terminal_debt',
      run_id: 'run_terminal_debt',
      status: 'requested',
    });

    await expect(markNotebookTaskRunHardTeardownReleased(cache, {
      taskId: 'task_terminal_debt',
      runId: 'run_terminal_debt',
    })).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_terminal_debt')).resolves.toBeNull();
  });

  it('does not clear a replacement lock when an older run hard teardown release arrives after state already vanished', async () => {
    const cache = new InMemoryCache();
    const taskId = 'task_release_no_state_lock_window';
    const lockKey = notebookTaskRunLockKey(taskId);

    await expect(cache.incr(lockKey, 300)).resolves.toBe(1);
    await expect(markNotebookTaskRunHardTeardownReleased(cache, {
      taskId,
      runId: 'run_old',
      releasedAt: '2026-03-18T09:01:00.000Z',
      generation: 1,
    })).resolves.toBeNull();

    await expect(cache.get(lockKey)).resolves.toBe('1');
    await expect(getNotebookTaskRunState(cache, taskId)).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId,
      runId: 'run_replacement_retry',
      startedAt: '2026-03-18T09:01:05.000Z',
    }))).resolves.toBe(false);
  });

  it('refreshes only the heartbeat without overwriting authoritative terminating run truth', async () => {
    const cache = new InMemoryCache();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_refresh_preserves_stop_truth',
      runId: 'run_refresh_preserves_stop_truth',
      phase: 'terminating',
      startedAt: '2026-03-18T09:02:00.000Z',
      heartbeatAt: '2026-03-18T09:02:01.000Z',
      requestId: 'req_refresh_preserves_stop_truth',
      dispatchedAt: '2026-03-18T09:02:00.500Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T09:02:01.000Z',
        actor_user_id: 'user_1',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
          requested_at: '2026-03-18T09:02:01.000Z',
          last_attempt_at: '2026-03-18T09:02:01.000Z',
          attempt_count: 1,
          attempt_id: 'task_refresh_preserves_stop_truth:run_refresh_preserves_stop_truth:1',
        },
      },
    }))).resolves.toBe(true);

    await expect(refreshNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_refresh_preserves_stop_truth',
      runId: 'run_refresh_preserves_stop_truth',
      startedAt: '2026-03-18T09:02:00.000Z',
      heartbeatAt: '2026-03-18T09:02:15.000Z',
    }))).resolves.toBe(true);

    await expect(getNotebookTaskRunState(cache, 'task_refresh_preserves_stop_truth')).resolves.toMatchObject({
      task_id: 'task_refresh_preserves_stop_truth',
      run_id: 'run_refresh_preserves_stop_truth',
      phase: 'terminating',
      heartbeat_at: '2026-03-18T09:02:15.000Z',
      request_id: 'req_refresh_preserves_stop_truth',
      dispatched_at: '2026-03-18T09:02:00.500Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T09:02:01.000Z',
        actor_user_id: 'user_1',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
          attempt_count: 1,
          attempt_id: 'task_refresh_preserves_stop_truth:run_refresh_preserves_stop_truth:1',
        },
      },
    });
  });

  it('clears active run coordination after hard teardown release so a replacement lease can take over', async () => {
    const cache = new InMemoryCache();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_release_clears_active',
      runId: 'run_release_clears_active',
      phase: 'terminating',
      startedAt: '2026-03-18T09:05:00.000Z',
      heartbeatAt: '2026-03-18T09:05:01.000Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T09:05:01.000Z',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
          requested_at: '2026-03-18T09:05:01.000Z',
          last_attempt_at: '2026-03-18T09:05:01.000Z',
          attempt_count: 1,
          attempt_id: 'task_release_clears_active:run_release_clears_active:1',
        },
      },
    }))).resolves.toBe(true);

    await expect(markNotebookTaskRunHardTeardownReleased(cache, {
      taskId: 'task_release_clears_active',
      runId: 'run_release_clears_active',
      releasedAt: '2026-03-18T09:05:05.000Z',
      attemptId: 'task_release_clears_active:run_release_clears_active:1',
      generation: 1,
    })).resolves.toBeNull();

    await expect(isNotebookTaskRunActive(cache, 'task_release_clears_active')).resolves.toBe(false);
    await expect(getNotebookTaskRunState(cache, 'task_release_clears_active')).resolves.toBeNull();
    await expect(getNotebookTaskRunStopRequestForRun(cache, {
      taskId: 'task_release_clears_active',
      runId: 'run_release_clears_active',
    })).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_release_clears_active')).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_release_clears_active',
      runId: 'run_release_replacement',
      startedAt: '2026-03-18T09:05:10.000Z',
    }))).resolves.toBe(true);
    await expect(getNotebookTaskRunState(cache, 'task_release_clears_active')).resolves.toMatchObject({
      run_id: 'run_release_replacement',
      phase: 'running',
    });
  });

  it('does not let a stale heartbeat refresh recreate a released run after coordination was cleared', async () => {
    const taskId = 'task_release_refresh_race';
    const runId = 'run_release_refresh_race';
    const cache = new PausedRunStateCompareAndSetCache(`notebook:task:${taskId}:run:state`);
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId,
      runId,
      phase: 'terminating',
      startedAt: '2026-03-18T09:10:00.000Z',
      heartbeatAt: '2026-03-18T09:10:01.000Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T09:10:01.000Z',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
          requested_at: '2026-03-18T09:10:01.000Z',
          last_attempt_at: '2026-03-18T09:10:01.000Z',
          attempt_count: 2,
          attempt_id: 'task_release_refresh_race:run_release_refresh_race:2',
        },
      },
    }))).resolves.toBe(true);

    const refreshPromise = refreshNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId,
      runId,
      startedAt: '2026-03-18T09:10:00.000Z',
      heartbeatAt: '2026-03-18T09:10:10.000Z',
    }));
    await cache.compareAndSetPaused.promise;

    await expect(markNotebookTaskRunHardTeardownReleased(cache, {
      taskId,
      runId,
      releasedAt: '2026-03-18T09:10:11.000Z',
      attemptId: 'task_release_refresh_race:run_release_refresh_race:2',
      generation: 2,
    })).resolves.toBeNull();

    cache.resumeCompareAndSet.resolve();

    await expect(refreshPromise).resolves.toBe(false);
    await expect(getNotebookTaskRunState(cache, taskId)).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, taskId)).resolves.toBeNull();
  });

  it('does not let a stale failed hard teardown attempt revive terminal debt after a newer release succeeds', async () => {
    const cache = new InMemoryCache();

    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      attemptedAt: '2026-03-18T09:30:00.000Z',
      errorMessage: 'seed terminal debt',
    })).resolves.toBeNull();

    await markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      requestedAt: '2026-03-18T09:30:01.000Z',
    });
    const attemptA = await getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence');
    expect(attemptA).toMatchObject({
      status: 'requested',
      attempt_count: 2,
    });

    await markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      requestedAt: '2026-03-18T09:30:02.000Z',
    });
    const attemptB = await getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence');
    expect(attemptB).toMatchObject({
      status: 'requested',
      attempt_count: 3,
    });

    await markNotebookTaskRunHardTeardownReleased(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      releasedAt: '2026-03-18T09:30:03.000Z',
      ...(attemptB?.attempt_id ? { attemptId: attemptB.attempt_id } : {}),
      ...(typeof attemptB?.attempt_count === 'number' ? { generation: attemptB.attempt_count } : {}),
    });
    await markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      requestedAt: '2026-03-18T09:30:03.500Z',
    });
    await markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_release_fence',
      runId: 'run_release_fence',
      attemptedAt: '2026-03-18T09:30:04.000Z',
      errorMessage: 'stale attempt A failed late',
      ...(attemptA?.attempt_id ? { attemptId: attemptA.attempt_id } : {}),
      ...(typeof attemptA?.attempt_count === 'number' ? { generation: attemptA.attempt_count } : {}),
    });

    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence')).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_release_fence',
      runId: 'run_after_fenced_release',
      startedAt: '2026-03-18T09:30:05.000Z',
    }))).resolves.toBe(true);
    await expect(getNotebookTaskRunState(cache, 'task_release_fence')).resolves.toMatchObject({
      run_id: 'run_after_fenced_release',
    });
  });

  it('does not let a stale hard teardown failure recreate debt after release fence outlives the run lease ttl', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T09:40:00.000Z'));
    const cache = new InMemoryCache();

    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_release_fence_ttl',
      runId: 'run_release_fence_ttl',
      attemptedAt: '2026-03-18T09:40:00.000Z',
      errorMessage: 'seed terminal debt',
    })).resolves.toBeNull();

    const requested = await markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_release_fence_ttl',
      runId: 'run_release_fence_ttl',
      requestedAt: '2026-03-18T09:40:01.000Z',
    });
    const latestAttempt = await getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence_ttl');
    expect(requested).toBeNull();
    expect(latestAttempt).toMatchObject({
      status: 'requested',
      attempt_count: 2,
    });

    await expect(markNotebookTaskRunHardTeardownReleased(cache, {
      taskId: 'task_release_fence_ttl',
      runId: 'run_release_fence_ttl',
      releasedAt: '2026-03-18T09:40:02.000Z',
      ...(latestAttempt?.attempt_id ? { attemptId: latestAttempt.attempt_id } : {}),
      ...(typeof latestAttempt?.attempt_count === 'number'
        ? { generation: latestAttempt.attempt_count }
        : {}),
    })).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence_ttl')).resolves.toBeNull();

    await vi.advanceTimersByTimeAsync(301_000);

    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_release_fence_ttl',
      runId: 'run_release_fence_ttl',
      attemptedAt: '2026-03-18T09:40:01.500Z',
      errorMessage: 'stale failure arrived after release',
    })).resolves.toBeNull();

    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_release_fence_ttl')).resolves.toBeNull();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_release_fence_ttl',
      runId: 'run_after_release_fence_ttl',
      startedAt: '2026-03-18T09:45:05.000Z',
    }))).resolves.toBe(true);
  });

  it('keeps current hard teardown failure retryable and pending debt dispatchable', async () => {
    const cache = new InMemoryCache();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_failure_fence',
      runId: 'run_failure_fence',
      phase: 'terminating',
      startedAt: '2026-03-18T09:45:00.000Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T09:45:01.000Z',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'pending',
        },
      },
    }))).resolves.toBe(true);

    const requested = await markNotebookTaskRunHardTeardownRequested(cache, {
      taskId: 'task_failure_fence',
      runId: 'run_failure_fence',
      requestedAt: '2026-03-18T09:45:02.000Z',
    });
    const attempt = requested?.stop?.hard_teardown;
    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_failure_fence',
      runId: 'run_failure_fence',
      attemptedAt: '2026-03-18T09:45:03.000Z',
      errorMessage: 'current notebook release failed',
      ...(attempt?.attempt_id ? { attemptId: attempt.attempt_id } : {}),
      ...(typeof attempt?.attempt_count === 'number' ? { generation: attempt.attempt_count } : {}),
    })).resolves.toMatchObject({
      stop: {
        hard_teardown: {
          status: 'failed',
          last_error: 'current notebook release failed',
        },
      },
    });

    await expect(requestNotebookTaskRunStopTransition(cache, {
      taskId: 'task_failure_fence',
      runId: 'run_failure_fence',
      mode: 'terminate',
      requestedAt: '2026-03-18T09:45:04.000Z',
      delivery: 'internal_teardown_requested',
    })).resolves.toMatchObject({
      hardTeardownDispatchRequired: true,
      state: {
        stop: {
          hard_teardown: {
            status: 'pending',
          },
        },
      },
    });
  });

  it.each(['pending', 'failed', 'requested'] as const)(
    'blocks a new lease while terminal hard teardown %s debt exists and allows one after release success clears it',
    async (status) => {
      const cache = new InMemoryCache();
      await cache.set(
        'notebook:task:task_terminal_lease_debt:run:hard-teardown',
        JSON.stringify({
          task_id: 'task_terminal_lease_debt',
          run_id: 'run_terminal_lease_debt',
          requested_at: '2026-03-18T10:00:00.000Z',
          status,
        }),
      );

      await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
        taskId: 'task_terminal_lease_debt',
        runId: 'run_replacement',
        startedAt: '2026-03-18T10:00:05.000Z',
      }))).resolves.toBe(false);
      await expect(getNotebookTaskRunState(cache, 'task_terminal_lease_debt')).resolves.toBeNull();
      await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_terminal_lease_debt')).resolves.toMatchObject({
        run_id: 'run_terminal_lease_debt',
        status,
      });

      await expect(markNotebookTaskRunHardTeardownReleased(cache, {
        taskId: 'task_terminal_lease_debt',
        runId: 'run_terminal_lease_debt',
      })).resolves.toBeNull();
      await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
        taskId: 'task_terminal_lease_debt',
        runId: 'run_replacement',
        startedAt: '2026-03-18T10:00:15.000Z',
      }))).resolves.toBe(true);
      await expect(getNotebookTaskRunState(cache, 'task_terminal_lease_debt')).resolves.toMatchObject({
        run_id: 'run_replacement',
      });
    },
  );

  it('keeps hard teardown debt authoritative after the run lease TTL would expire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:30:00.000Z'));
    const cache = new InMemoryCache();

    await expect(markNotebookTaskRunHardTeardownFailed(cache, {
      taskId: 'task_terminal_durable_debt',
      runId: 'run_terminal_durable_debt',
      attemptedAt: '2026-03-18T10:30:00.000Z',
      errorMessage: 'release failed before ttl expiry',
    })).resolves.toBeNull();

    await vi.advanceTimersByTimeAsync(301_000);

    await expect(getNotebookTaskRunHardTeardownDebt(cache, 'task_terminal_durable_debt')).resolves.toMatchObject({
      task_id: 'task_terminal_durable_debt',
      run_id: 'run_terminal_durable_debt',
      status: 'failed',
      last_error: 'release failed before ttl expiry',
    });
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_terminal_durable_debt',
      runId: 'run_after_ttl',
      startedAt: '2026-03-18T10:35:02.000Z',
    }))).resolves.toBe(false);
  });

  it('blocks a replacement lease from masking finalizing hard teardown debt even if the lock expired first', async () => {
    const cache = new InMemoryCache();
    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_finalizing_lease_debt',
      runId: 'run_finalizing_lease_debt',
      phase: 'finalizing',
      startedAt: '2026-03-18T11:00:00.000Z',
      stop: {
        mode: 'terminate',
        requested_at: '2026-03-18T11:00:05.000Z',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'finalizing release failed',
        },
      },
      finalization: {
        status: 'pending',
        updated_at: '2026-03-18T11:00:10.000Z',
      },
    }))).resolves.toBe(true);
    await cache.del('notebook:task:task_finalizing_lease_debt:run:lock');

    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_finalizing_lease_debt',
      runId: 'run_replacement',
      startedAt: '2026-03-18T11:00:15.000Z',
    }))).resolves.toBe(false);

    await expect(getNotebookTaskRunState(cache, 'task_finalizing_lease_debt')).resolves.toMatchObject({
      run_id: 'run_finalizing_lease_debt',
      phase: 'finalizing',
      stop: {
        mode: 'terminate',
        hard_teardown: {
          status: 'failed',
          last_error: 'finalizing release failed',
        },
      },
    });
  });
});
