import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  clearNotebookTaskRunCoordination,
  finalizeNotebookTaskRun,
  getNotebookTaskRunStopRequestForRun,
  getNotebookTaskRunState,
  isNotebookTaskRunActive,
  markNotebookTaskRunFinalizing,
  markNotebookTaskRunDispatched,
  requestNotebookTaskRunStop,
} from './task-run-coordination.js';

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
});
