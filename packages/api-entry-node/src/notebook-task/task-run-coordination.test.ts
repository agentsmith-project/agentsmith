import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  clearNotebookTaskRunCoordination,
  getNotebookTaskRunCancellationRequest,
  getNotebookTaskRunState,
  isNotebookTaskRunActive,
  markNotebookTaskRunDispatched,
  requestNotebookTaskRunCancellation,
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

  it('rejects a second lease and stores cancel requests separately', async () => {
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

    await requestNotebookTaskRunCancellation(cache, {
      task_id: 'task_2',
      run_id: 'run_a',
      requested_at: '2026-03-18T02:00:03.000Z',
      actor_user_id: 'user_1',
    });

    await expect(getNotebookTaskRunCancellationRequest(cache, 'task_2')).resolves.toMatchObject({
      task_id: 'task_2',
      run_id: 'run_a',
      actor_user_id: 'user_1',
    });
  });
});
