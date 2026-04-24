import type { InternalAgentPodManager } from './internal-agent-pod-manager.js';

export type InternalWorkloadHolderKind = 'notebook_run' | 'chat_stream' | 'terminal_session';

export interface InternalWorkloadHolderRef {
  workspaceId: string;
  projectId: string;
  workloadId: string;
  holderKind: InternalWorkloadHolderKind;
  holderId: string;
  epoch?: string;
}

interface InternalWorkloadCoordinatorOptions {
  keepaliveIntervalMs?: number;
  closedEpochTombstoneLimit?: number;
}

type InternalWorkloadCoordinatorDeps = {
  internalWorkloadCoordinator?: InternalWorkloadCoordinator;
  internalAgentPodManager?: Pick<InternalAgentPodManager, 'keepalive'> & {
    releasePod?: InternalAgentPodManager['releasePod'];
  };
};

type WorkloadState = {
  key: string;
  workspaceId: string;
  projectId: string;
  workloadId: string;
  epoch?: string;
  hardTeardownEpoch?: string;
  holderRefs: Map<string, number>;
  hardTeardownRequested: boolean;
  hardTeardownWaiter?: HardTeardownWaiter;
  releasePromise?: Promise<void>;
  keepaliveTimer?: NodeJS.Timeout;
};

type HardTeardownWaiter = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const DEFAULT_KEEPALIVE_INTERVAL_MS = 60_000;
const DEFAULT_CLOSED_EPOCH_TOMBSTONE_LIMIT = 32;
const fallbackCoordinators = new Map<object, InternalWorkloadCoordinator>();

export class InternalWorkloadHardTeardownPendingError extends Error {
  readonly code = 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING';

  constructor(workloadId: string) {
    super(`internal_workload_hard_teardown_pending:${workloadId}`);
    this.name = 'InternalWorkloadHardTeardownPendingError';
  }
}

function buildWorkloadKey(input: Pick<InternalWorkloadHolderRef, 'workspaceId' | 'projectId' | 'workloadId'>): string {
  return `${input.workspaceId}/${input.projectId}/${input.workloadId}`;
}

function buildHolderKey(input: Pick<InternalWorkloadHolderRef, 'holderKind' | 'holderId'>): string {
  return `${input.holderKind}:${input.holderId}`;
}

function createHardTeardownWaiter(): HardTeardownWaiter {
  let resolveWaiter: (() => void) | undefined;
  let rejectWaiter: ((error: unknown) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveWaiter = resolve;
    rejectWaiter = reject;
  });
  if (!resolveWaiter || !rejectWaiter) {
    throw new Error('hard_teardown_waiter_not_initialized');
  }
  return {
    promise,
    resolve: resolveWaiter,
    reject: rejectWaiter,
  };
}

export class InternalWorkloadCoordinator {
  private readonly workloads = new Map<string, WorkloadState>();
  private readonly closedEpochsByWorkload = new Map<string, Set<string>>();
  private readonly keepaliveIntervalMs: number;
  private readonly closedEpochTombstoneLimit: number;

  constructor(
    private readonly internalAgentPodManager: Pick<InternalAgentPodManager, 'keepalive'> & {
      releasePod?: InternalAgentPodManager['releasePod'];
    },
    options?: InternalWorkloadCoordinatorOptions,
  ) {
    this.keepaliveIntervalMs = Math.max(1000, options?.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS);
    this.closedEpochTombstoneLimit = Math.max(
      1,
      options?.closedEpochTombstoneLimit ?? DEFAULT_CLOSED_EPOCH_TOMBSTONE_LIMIT,
    );
  }

  async acquireHolder(input: InternalWorkloadHolderRef): Promise<void> {
    const key = buildWorkloadKey(input);
    if (input.epoch && this.isEpochClosed(key, input.epoch)) {
      throw new InternalWorkloadHardTeardownPendingError(input.workloadId);
    }
    const state = this.getOrCreateState(input);
    if (state.hardTeardownRequested || state.releasePromise) {
      throw new InternalWorkloadHardTeardownPendingError(input.workloadId);
    }
    if (input.epoch) {
      if (state.epoch && state.epoch !== input.epoch) {
        throw new InternalWorkloadHardTeardownPendingError(input.workloadId);
      }
      state.epoch = input.epoch;
    }
    const holderKey = buildHolderKey(input);
    state.holderRefs.set(holderKey, (state.holderRefs.get(holderKey) ?? 0) + 1);

    if (!state.keepaliveTimer) {
      state.keepaliveTimer = setInterval(() => {
        void this.keepaliveWorkload(state);
      }, this.keepaliveIntervalMs);
      void this.keepaliveWorkload(state);
    }
  }

  async releaseHolder(input: InternalWorkloadHolderRef): Promise<void> {
    const state = this.workloads.get(buildWorkloadKey(input));
    if (!state) return;

    const holderKey = buildHolderKey(input);
    const refCount = state.holderRefs.get(holderKey) ?? 0;
    if (refCount <= 1) {
      state.holderRefs.delete(holderKey);
    } else {
      state.holderRefs.set(holderKey, refCount - 1);
    }

    if (state.holderRefs.size > 0) {
      return;
    }

    this.stopKeepaliveLoop(state);
    if (state.hardTeardownRequested) {
      await this.releaseWorkload(state);
      return;
    }
    this.workloads.delete(state.key);
  }

  async requestHardTeardown(input: Pick<InternalWorkloadHolderRef, 'workspaceId' | 'projectId' | 'workloadId' | 'epoch'>): Promise<void> {
    const key = buildWorkloadKey(input);
    const existing = this.workloads.get(key);
    if (!existing && input.epoch && this.isEpochClosed(key, input.epoch)) {
      return;
    }
    if (existing?.epoch && input.epoch && existing.epoch !== input.epoch) {
      return;
    }
    const state = existing ?? this.getOrCreateState(input);
    if (input.epoch) {
      state.hardTeardownEpoch = input.epoch;
      if (!state.epoch) {
        state.epoch = input.epoch;
      }
    }
    state.hardTeardownRequested = true;
    if (state.holderRefs.size > 0) {
      await this.waitForHardTeardownRelease(state);
      return;
    }
    this.stopKeepaliveLoop(state);
    await this.releaseWorkload(state);
  }

  async shutdown(): Promise<void> {
    for (const state of this.workloads.values()) {
      this.stopKeepaliveLoop(state);
    }
    this.workloads.clear();
    this.closedEpochsByWorkload.clear();
  }

  readSnapshotForTests(): Array<{
    workspaceId: string;
    projectId: string;
    workloadId: string;
    holders: string[];
    hardTeardownRequested: boolean;
  }> {
    return [...this.workloads.values()]
      .map((state) => ({
        workspaceId: state.workspaceId,
        projectId: state.projectId,
        workloadId: state.workloadId,
        holders: [...state.holderRefs.keys()].sort((left, right) => left.localeCompare(right)),
        hardTeardownRequested: state.hardTeardownRequested,
      }))
      .sort((left, right) => left.workloadId.localeCompare(right.workloadId));
  }

  private getOrCreateState(input: Pick<InternalWorkloadHolderRef, 'workspaceId' | 'projectId' | 'workloadId'>): WorkloadState {
    const key = buildWorkloadKey(input);
    const existing = this.workloads.get(key);
    if (existing) return existing;

    const created: WorkloadState = {
      key,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workloadId: input.workloadId,
      holderRefs: new Map<string, number>(),
      hardTeardownRequested: false,
    };
    this.workloads.set(key, created);
    return created;
  }

  private stopKeepaliveLoop(state: WorkloadState): void {
    if (!state.keepaliveTimer) return;
    clearInterval(state.keepaliveTimer);
    state.keepaliveTimer = undefined;
  }

  private isEpochClosed(workloadKey: string, epoch: string): boolean {
    return this.closedEpochsByWorkload.get(workloadKey)?.has(epoch) ?? false;
  }

  private rememberClosedEpoch(state: WorkloadState): void {
    const epoch = state.hardTeardownEpoch ?? state.epoch;
    if (!epoch) return;
    let closedEpochs = this.closedEpochsByWorkload.get(state.key);
    if (!closedEpochs) {
      closedEpochs = new Set<string>();
      this.closedEpochsByWorkload.set(state.key, closedEpochs);
    }
    closedEpochs.add(epoch);
    while (closedEpochs.size > this.closedEpochTombstoneLimit) {
      const oldest = closedEpochs.values().next().value;
      if (typeof oldest !== 'string') break;
      closedEpochs.delete(oldest);
    }
  }

  private async keepaliveWorkload(state: WorkloadState): Promise<void> {
    await this.internalAgentPodManager.keepalive(
      state.workspaceId,
      state.projectId,
      state.workloadId,
    ).catch(() => undefined);
  }

  private async releaseWorkload(state: WorkloadState): Promise<void> {
    if (state.releasePromise) {
      await state.releasePromise;
      return;
    }

    const releasePromise = this.releasePodForState(state);
    state.releasePromise = releasePromise;
    const hardTeardownWaiter = state.hardTeardownWaiter;

    try {
      await releasePromise;
      if (state.hardTeardownWaiter === hardTeardownWaiter) {
        state.hardTeardownWaiter = undefined;
        hardTeardownWaiter?.resolve();
      }
      if (this.workloads.get(state.key) === state) {
        this.rememberClosedEpoch(state);
        this.workloads.delete(state.key);
      }
    } catch (error) {
      if (state.releasePromise === releasePromise) {
        state.releasePromise = undefined;
      }
      if (state.hardTeardownWaiter === hardTeardownWaiter) {
        state.hardTeardownWaiter = undefined;
        hardTeardownWaiter?.reject(error);
      }
      throw error;
    }
  }

  private async waitForHardTeardownRelease(state: WorkloadState): Promise<void> {
    if (state.releasePromise) {
      await state.releasePromise;
      return;
    }
    state.hardTeardownWaiter ??= createHardTeardownWaiter();
    await state.hardTeardownWaiter.promise;
  }

  private async releasePodForState(state: WorkloadState): Promise<void> {
    if (typeof this.internalAgentPodManager.releasePod === 'function') {
      await this.internalAgentPodManager.releasePod(
        state.workspaceId,
        state.projectId,
        state.workloadId,
      );
    }
  }
}

export function resolveInternalWorkloadCoordinator(
  deps: InternalWorkloadCoordinatorDeps,
): InternalWorkloadCoordinator | undefined {
  if (deps.internalWorkloadCoordinator) {
    return deps.internalWorkloadCoordinator;
  }
  if (!deps.internalAgentPodManager) {
    return undefined;
  }
  const registryKey = deps.internalAgentPodManager as object;
  const existing = fallbackCoordinators.get(registryKey);
  if (existing) {
    return existing;
  }
  const created = new InternalWorkloadCoordinator(deps.internalAgentPodManager);
  fallbackCoordinators.set(registryKey, created);
  return created;
}

export function readInternalWorkloadHolderSnapshotForTests(): Array<{
  workspaceId: string;
  projectId: string;
  workloadId: string;
  holders: string[];
}> {
  return [...fallbackCoordinators.values()]
    .flatMap((coordinator) => coordinator.readSnapshotForTests())
    .sort((left, right) => left.workloadId.localeCompare(right.workloadId));
}

export function resetInternalWorkloadHolderCoordinatorForTests(): void {
  for (const coordinator of fallbackCoordinators.values()) {
    void coordinator.shutdown();
  }
  fallbackCoordinators.clear();
}
