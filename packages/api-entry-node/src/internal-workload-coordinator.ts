import type { InternalAgentPodManager } from './internal-agent-pod-manager.js';

export type InternalWorkloadHolderKind = 'notebook_run' | 'chat_stream' | 'terminal_session';

export interface InternalWorkloadHolderRef {
  workspaceId: string;
  projectId: string;
  workloadId: string;
  holderKind: InternalWorkloadHolderKind;
  holderId: string;
}

interface InternalWorkloadCoordinatorOptions {
  keepaliveIntervalMs?: number;
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
  holderRefs: Map<string, number>;
  hardTeardownRequested: boolean;
  keepaliveTimer?: NodeJS.Timeout;
};

const DEFAULT_KEEPALIVE_INTERVAL_MS = 60_000;
const fallbackCoordinators = new Map<object, InternalWorkloadCoordinator>();

function buildWorkloadKey(input: Pick<InternalWorkloadHolderRef, 'workspaceId' | 'projectId' | 'workloadId'>): string {
  return `${input.workspaceId}/${input.projectId}/${input.workloadId}`;
}

function buildHolderKey(input: Pick<InternalWorkloadHolderRef, 'holderKind' | 'holderId'>): string {
  return `${input.holderKind}:${input.holderId}`;
}

export class InternalWorkloadCoordinator {
  private readonly workloads = new Map<string, WorkloadState>();
  private readonly keepaliveIntervalMs: number;

  constructor(
    private readonly internalAgentPodManager: Pick<InternalAgentPodManager, 'keepalive'> & {
      releasePod?: InternalAgentPodManager['releasePod'];
    },
    options?: InternalWorkloadCoordinatorOptions,
  ) {
    this.keepaliveIntervalMs = Math.max(1000, options?.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS);
  }

  async acquireHolder(input: InternalWorkloadHolderRef): Promise<void> {
    const state = this.getOrCreateState(input);
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

  async requestHardTeardown(input: Pick<InternalWorkloadHolderRef, 'workspaceId' | 'projectId' | 'workloadId'>): Promise<void> {
    const state = this.workloads.get(buildWorkloadKey(input));
    if (!state) {
      if (typeof this.internalAgentPodManager.releasePod === 'function') {
        await this.internalAgentPodManager.releasePod(
          input.workspaceId,
          input.projectId,
          input.workloadId,
        ).catch(() => undefined);
      }
      return;
    }

    state.hardTeardownRequested = true;
    if (state.holderRefs.size > 0) {
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

  private async keepaliveWorkload(state: WorkloadState): Promise<void> {
    await this.internalAgentPodManager.keepalive(
      state.workspaceId,
      state.projectId,
      state.workloadId,
    ).catch(() => undefined);
  }

  private async releaseWorkload(state: WorkloadState): Promise<void> {
    this.workloads.delete(state.key);
    if (typeof this.internalAgentPodManager.releasePod === 'function') {
      await this.internalAgentPodManager.releasePod(
        state.workspaceId,
        state.projectId,
        state.workloadId,
      ).catch(() => undefined);
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
