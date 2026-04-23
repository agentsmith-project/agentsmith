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
    await coordinator.requestHardTeardown(holder);
    expect(releasePod).not.toHaveBeenCalled();

    await coordinator.releaseHolder(holder);
    expect(releasePod).toHaveBeenCalledTimes(1);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', 'chat_session_1');

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
});
