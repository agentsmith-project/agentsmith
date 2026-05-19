import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createFileLibraryViaUi,
  createInternalAgentTaskRunnerViaApi,
  createAgentTaskViaApi,
  createProjectInWorkspace,
  deleteInternalWorkloadViaAsbcp,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  keycloakLoginToWorkspace,
  patchWorkloadPodExpiry,
  runInternalSandboxControl,
  sanitizeWorkloadId,
  requestTaskWorkspaceAccess,
  startAgentTaskRunViaApi,
  waitForAgentTaskExecutionOutcome,
  waitForAfscpStorageCsiReady,
  waitForWorkloadPodDeleted,
  waitForWorkloadPodIdentity,
  waitForWorkloadPodPresent,
  waitForExpiredWorkloadReleasedViaAsbcp,
} from './integration-real-helpers';

function requireReclaimEnv(): { namespace: string } {
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  if (!process.env.ASBCP_INTERNAL_BASE_URL?.trim()) throw new Error('missing_ASBCP_INTERNAL_BASE_URL');
  if (!process.env.ASBCP_SERVICE_KEY?.trim()) throw new Error('missing_ASBCP_SERVICE_KEY');
  if (!process.env.INTERNAL_SANDBOX_REAL_STATE_FILE?.trim()) throw new Error('missing_INTERNAL_SANDBOX_REAL_STATE_FILE');
  if (!namespace) throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  return { namespace };
}

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

function buildAgentTaskIntent(token: string, fileName: string): string {
  return [
    'Run the following shell command exactly, then reply with the token and filename.',
    '```bash',
    'mkdir -p .artifacts',
    `cat <<'EOF' > .artifacts/${fileName}`,
    '# Sandbox reclaim proof',
    `- Token: ${token}`,
    'EOF',
    '```',
    `After the file is written, reply with exactly: ${token} ${fileName}`,
  ].join(' ');
}

test.describe('@lane-real internal sandbox reclaim', () => {
  test('reclaims idle workload pods, preserves unexpired pods across ASBCP restart, and releases pods through ASBCP after restart', async ({ page }) => {
    test.setTimeout(1_200_000);
    const { namespace } = requireReclaimEnv();
    const apiKey = requireApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Internal Sandbox Reclaim');
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, `Internal Reclaim ${Date.now()}`);
    const credentialName = `Reclaim Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Reclaim Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    await createInternalAgentTaskRunnerViaApi(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'internal-sandbox-reclaim',
      idleTimeoutSec: 180,
      maxLifetimeSec: 3600,
    });

    await waitForAfscpStorageCsiReady({ namespace: process.env.AFSCP_STORAGE_CSI_NAMESPACE?.trim() || "kube-system" });

    const taskId1 = await createAgentTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `Idle Reclaim Task ${Date.now()}`,
      fileLibraryId,
    });
    const token1 = `INTERNAL_IDLE_RECLAIM_${Date.now()}`;
    const firstArtifactName = `idle-reclaim-${Date.now()}.md`;
    const firstRun = await startAgentTaskRunViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId1,
      intent: buildAgentTaskIntent(token1, firstArtifactName),
    });

    const workloadId1 = sanitizeWorkloadId(taskId1);
    const workspaceAccess1 = await requestTaskWorkspaceAccess({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId1,
    });
    expect(workspaceAccess1.task_home_binding.paths.task_home_path).toMatch(/^\/home\/[a-z0-9][a-z0-9._-]*$/);
    expect(workspaceAccess1.task_home_binding.paths.workspace_path).toBe(`${workspaceAccess1.task_home_binding.paths.task_home_path}/workspace`);
    expect(workspaceAccess1.task_home_binding.paths.artifacts_path).toBe(`${workspaceAccess1.task_home_binding.paths.workspace_path}/.artifacts`);
    expect(workspaceAccess1.task_home_binding.paths.library_root_path).toBe('.');
    expect(JSON.stringify(workspaceAccess1)).not.toMatch(/metadata_url|storage_bucket_url|recommended_mount|filesystem_name|juicefs/i);
    await waitForAgentTaskExecutionOutcome({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId1,
      token: token1,
      runnerOutputActivityId: firstRun.runnerOutputActivityId,
      runId: firstRun.runId,
      namespace,
      workloadId: workloadId1,
    });

    await waitForWorkloadPodPresent({ namespace, workloadId: workloadId1, timeoutMs: 120_000 });
    await page.waitForTimeout(15_000);
    await waitForWorkloadPodPresent({ namespace, workloadId: workloadId1, timeoutMs: 10_000 });
    await patchWorkloadPodExpiry({
      namespace,
      workloadId: workloadId1,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await waitForExpiredWorkloadReleasedViaAsbcp({
      namespace,
      workloadId: workloadId1,
      timeoutMs: 60_000,
    });
    await waitForWorkloadPodDeleted({ namespace, workloadId: workloadId1, timeoutMs: 120_000 });

    await waitForAfscpStorageCsiReady({ namespace: process.env.AFSCP_STORAGE_CSI_NAMESPACE?.trim() || "kube-system" });

    const restartFileLibraryId = await createFileLibraryViaUi(
      page,
      'ws_default',
      projectId,
      `Internal Reclaim Restart ${Date.now()}`,
    );
    const taskId2 = await createAgentTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `Restart Reclaim Task ${Date.now()}`,
      fileLibraryId: restartFileLibraryId,
    });
    const token2 = `INTERNAL_RESTART_RECLAIM_${Date.now()}`;
    await startAgentTaskRunViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId2,
      intent: buildAgentTaskIntent(token2, `restart-reclaim-${Date.now()}.md`),
    });

    const workloadId2 = sanitizeWorkloadId(taskId2);
    const workloadPod2 = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadId2, timeoutMs: 120_000 });
    await runInternalSandboxControl('stop-asbcp');
    await runInternalSandboxControl('start-asbcp');

    const workloadPod2AfterRestart = await waitForWorkloadPodIdentity({
      namespace,
      workloadId: workloadId2,
      timeoutMs: 30_000,
    });
    expect(workloadPod2AfterRestart).toEqual(workloadPod2);

    await page.waitForTimeout(15_000);
    const workloadPod2AfterManagerSettled = await waitForWorkloadPodIdentity({
      namespace,
      workloadId: workloadId2,
      timeoutMs: 10_000,
    });
    expect(workloadPod2AfterManagerSettled).toEqual(workloadPod2);

    await deleteInternalWorkloadViaAsbcp({
      workspaceId: 'ws_default',
      projectId,
      workloadId: workloadId2,
    });
    await waitForWorkloadPodDeleted({ namespace, workloadId: workloadId2, timeoutMs: 120_000 });

    expect(true).toBe(true);
  });
});
