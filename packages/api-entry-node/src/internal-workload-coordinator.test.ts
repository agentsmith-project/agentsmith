import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';

describe('InternalWorkloadCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('runs a single keepalive loop per workload across multiple holder kinds without releasing the pod on normal holder completion', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const workload = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'task_1',
    };

    await coordinator.acquireHolder({
      ...workload,
      holderKind: 'notebook_run',
      holderId: 'run_1',
    });
    await coordinator.acquireHolder({
      ...workload,
      holderKind: 'chat_stream',
      holderId: 'session_1',
    });

    const keepaliveCallsAfterAcquire = keepalive.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(keepalive).toHaveBeenCalledTimes(keepaliveCallsAfterAcquire + 1);

    await coordinator.releaseHolder({
      ...workload,
      holderKind: 'notebook_run',
      holderId: 'run_1',
    });
    expect(releasePod).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(keepalive).toHaveBeenCalledTimes(keepaliveCallsAfterAcquire + 2);

    await coordinator.releaseHolder({
      ...workload,
      holderKind: 'chat_stream',
      holderId: 'session_1',
    });

    expect(releasePod).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(keepalive).toHaveBeenCalledTimes(keepaliveCallsAfterAcquire + 2);

    await coordinator.shutdown();
  });

  it('releases the pod only after hard teardown is requested and the final holder is gone', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const holder = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_1',
      holderKind: 'chat_stream' as const,
      holderId: 'sess_1',
    };

    await coordinator.acquireHolder(holder);
    const request = coordinator.requestHardTeardown(holder);
    await Promise.resolve();
    expect(releasePod).not.toHaveBeenCalled();

    await coordinator.releaseHolder(holder);
    await expect(request).resolves.toBeUndefined();
    expect(releasePod).toHaveBeenCalledTimes(1);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', 'chat_session_1');

    await coordinator.shutdown();
  });

  it('keeps the hard teardown request pending until the final live holder release finishes', async () => {
    const keepalive = vi.fn(async () => undefined);
    const firstRelease = createDeferred<void>();
    const releasePod = vi.fn(async () => {
      await firstRelease.promise;
    });
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const holder = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_live_request',
      holderKind: 'chat_stream' as const,
      holderId: 'sess_live_request',
    };

    await coordinator.acquireHolder(holder);
    const request = coordinator.requestHardTeardown(holder);
    const requestResult = vi.fn();
    void request.then(requestResult, requestResult);
    await Promise.resolve();

    expect(releasePod).not.toHaveBeenCalled();
    expect(requestResult).not.toHaveBeenCalled();

    const release = coordinator.releaseHolder(holder);
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(1);
    });
    expect(requestResult).not.toHaveBeenCalled();

    firstRelease.resolve();
    await expect(release).resolves.toBeUndefined();
    await expect(request).resolves.toBeUndefined();
    expect(requestResult).toHaveBeenCalledTimes(1);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });

  it('shares the final live-holder release result across concurrent hard teardown requests', async () => {
    const keepalive = vi.fn(async () => undefined);
    const finalRelease = createDeferred<void>();
    const releasePod = vi.fn(async () => {
      await finalRelease.promise;
    });
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const holder = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_live_concurrent',
      holderKind: 'chat_stream' as const,
      holderId: 'sess_live_concurrent',
    };

    await coordinator.acquireHolder(holder);
    const first = coordinator.requestHardTeardown(holder);
    const second = coordinator.requestHardTeardown(holder);
    const firstResult = vi.fn();
    const secondResult = vi.fn();
    void first.then(firstResult, firstResult);
    void second.then(secondResult, secondResult);
    await Promise.resolve();

    expect(releasePod).not.toHaveBeenCalled();
    expect(firstResult).not.toHaveBeenCalled();
    expect(secondResult).not.toHaveBeenCalled();

    const release = coordinator.releaseHolder(holder);
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(1);
    });
    expect(firstResult).not.toHaveBeenCalled();
    expect(secondResult).not.toHaveBeenCalled();

    finalRelease.resolve();
    await expect(release).resolves.toBeUndefined();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(firstResult).toHaveBeenCalledTimes(1);
    expect(secondResult).toHaveBeenCalledTimes(1);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });

  it('releases the pod immediately when hard teardown is requested without active holders', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    await coordinator.requestHardTeardown({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_2',
    });

    expect(releasePod).toHaveBeenCalledTimes(1);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', 'chat_session_2');

    await coordinator.shutdown();
  });

  it('rejects a late holder for an epoch after accepted hard teardown completes but allows a new epoch', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const workload = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_epoch',
    };
    const lateHolder = {
      ...workload,
      holderKind: 'chat_stream' as const,
      holderId: 'session_epoch_old',
      epoch: 'stream_epoch_old',
    };
    const nextHolder = {
      ...workload,
      holderKind: 'chat_stream' as const,
      holderId: 'session_epoch_new',
      epoch: 'stream_epoch_new',
    };

    await expect(coordinator.requestHardTeardown({
      ...workload,
      epoch: 'stream_epoch_old',
    })).resolves.toBeUndefined();
    expect(releasePod).toHaveBeenCalledTimes(1);

    await expect(coordinator.acquireHolder(lateHolder)).rejects.toMatchObject({
      code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
    });
    await expect(coordinator.acquireHolder(nextHolder)).resolves.toBeUndefined();
    await coordinator.releaseHolder(nextHolder);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });

  it('propagates immediate hard teardown releasePod failures and retries on the next request', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('sandbox release unavailable'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const workload = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'chat_session_retry',
    };

    await expect(coordinator.requestHardTeardown(workload)).rejects.toThrow('sandbox release unavailable');
    expect(releasePod).toHaveBeenCalledTimes(1);
    expect(coordinator.readSnapshotForTests()).toEqual([
      {
        ...workload,
        holders: [],
        hardTeardownRequested: true,
      },
    ]);

    await expect(coordinator.requestHardTeardown(workload)).resolves.toBeUndefined();
    expect(releasePod).toHaveBeenCalledTimes(2);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });

  it('blocks new holders while hard teardown debt is pending or failed and allows them after release succeeds', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('release debt failed'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const workload = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'debt_blocked_workload',
    };
    const activeHolder = {
      ...workload,
      holderKind: 'notebook_run' as const,
      holderId: 'run_old',
    };
    const nextHolder = {
      ...workload,
      holderKind: 'chat_stream' as const,
      holderId: 'session_new',
    };

    await coordinator.acquireHolder(activeHolder);
    const request = coordinator.requestHardTeardown(workload);
    const requestExpectation = expect(request).rejects.toThrow('release debt failed');
    await Promise.resolve();

    await expect(coordinator.acquireHolder(nextHolder)).rejects.toMatchObject({
      code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
    });

    await expect(coordinator.releaseHolder(activeHolder)).rejects.toThrow('release debt failed');
    await requestExpectation;
    await expect(coordinator.acquireHolder(nextHolder)).rejects.toMatchObject({
      code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
    });

    await expect(coordinator.requestHardTeardown(workload)).resolves.toBeUndefined();
    await expect(coordinator.acquireHolder(nextHolder)).resolves.toBeUndefined();
    await coordinator.releaseHolder(nextHolder);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });

  it('propagates final-holder releasePod failures and leaves hard teardown retryable', async () => {
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('pod release failed'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new InternalWorkloadCoordinator(
      {
        keepalive,
        releasePod,
      } as never,
      {
        keepaliveIntervalMs: 1_000,
      },
    );

    const holder = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: 'notebook_task_retry',
      holderKind: 'notebook_run' as const,
      holderId: 'run_1',
    };

    await coordinator.acquireHolder(holder);
    const request = coordinator.requestHardTeardown(holder);
    const requestExpectation = expect(request).rejects.toThrow('pod release failed');
    await Promise.resolve();
    expect(releasePod).not.toHaveBeenCalled();

    await expect(coordinator.releaseHolder(holder)).rejects.toThrow('pod release failed');
    await requestExpectation;
    expect(releasePod).toHaveBeenCalledTimes(1);
    expect(coordinator.readSnapshotForTests()).toEqual([
      {
        workspaceId: holder.workspaceId,
        projectId: holder.projectId,
        workloadId: holder.workloadId,
        holders: [],
        hardTeardownRequested: true,
      },
    ]);

    await expect(coordinator.requestHardTeardown(holder)).resolves.toBeUndefined();
    expect(releasePod).toHaveBeenCalledTimes(2);
    expect(coordinator.readSnapshotForTests()).toEqual([]);

    await coordinator.shutdown();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
