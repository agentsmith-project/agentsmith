import type { ProjectStorageTeardownResult } from '@mbos/api-entry-node';

export type WorkspaceStorageLifecycleReason = 'workspace_disable' | 'workspace_delete';

export interface WorkspaceStorageLifecycleInput {
  workspaceId: string;
  reason: WorkspaceStorageLifecycleReason;
  requestId?: string;
}

type WorkspaceStorageLifecycleRunner = (input: WorkspaceStorageLifecycleInput) => Promise<void>;

let lifecycleRunnerForTest: WorkspaceStorageLifecycleRunner | null = null;

export function setWorkspaceStorageLifecycleRunnerForTest(runner: WorkspaceStorageLifecycleRunner | null): void {
  lifecycleRunnerForTest = runner;
}

function hasRetryableStorageTeardown(results: ProjectStorageTeardownResult[]): boolean {
  return results.some((result) => result.retryable || result.status === 'retryable');
}

export async function runWorkspaceStorageLifecycleTeardown(input: WorkspaceStorageLifecycleInput): Promise<void> {
  if (lifecycleRunnerForTest) {
    await lifecycleRunnerForTest(input);
    return;
  }

  const { createNodeApiDepsFromEnv } = await import('@mbos/api-entry-node');
  const { deps, lifecycle } = createNodeApiDepsFromEnv(process.env);
  try {
    const results = await deps.projectStorageLifecycleService.beginWorkspaceStorageTeardown({
      workspaceId: input.workspaceId,
      actorUserId: 'system-admin',
      requestId: input.requestId,
      reason: input.reason,
    });
    if (hasRetryableStorageTeardown(results)) {
      throw Object.assign(new Error('workspace_storage_lifecycle_teardown_retryable'), {
        code: 'WORKSPACE_STORAGE_LIFECYCLE_TEARDOWN_RETRYABLE',
      });
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw error;
    }
    throw Object.assign(new Error('workspace_storage_lifecycle_teardown_failed'), {
      code: 'WORKSPACE_STORAGE_LIFECYCLE_TEARDOWN_FAILED',
    });
  } finally {
    await lifecycle.shutdown?.();
  }
}
