import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createFileLibraryViaUi,
  createInternalCodexAgent,
  createNotebookTaskViaApi,
  createProjectInWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  keycloakLoginToWorkspace,
  patchWorkloadPodExpiry,
  runInternalSandboxControl,
  sanitizeWorkloadId,
  sendTaskMessage,
  waitForAssistantToken,
  waitForWorkloadPodDeleted,
  waitForWorkloadPodIdentity,
  waitForWorkloadPodPresent,
} from './integration-real-helpers';

function requireReclaimEnv(): { namespace: string } {
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) throw new Error('missing_SANDBOX_MANAGER_URL');
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) throw new Error('missing_SANDBOX_SERVICE_KEY');
  if (!process.env.INTERNAL_SANDBOX_REAL_STATE_FILE?.trim()) throw new Error('missing_INTERNAL_SANDBOX_REAL_STATE_FILE');
  if (!namespace) throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  return { namespace };
}

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

function buildNotebookCommand(token: string, fileName: string): string {
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
  test('reclaims idle workload pods, preserves unexpired pods across manager restart, and cleans expired pods after restart', async ({ page }) => {
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
    const internalAgent = await createInternalCodexAgent(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'internal-sandbox-reclaim',
      idleTimeoutSec: 180,
      maxLifetimeSec: 3600,
    });

    const taskId1 = await createNotebookTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `Idle Reclaim Task ${Date.now()}`,
      agentId: internalAgent.agentId,
      fileLibraryId,
    });
    const token1 = `INTERNAL_IDLE_RECLAIM_${Date.now()}`;
    await sendTaskMessage({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId1,
      content: buildNotebookCommand(token1, `idle-reclaim-${Date.now()}.md`),
    });
    await waitForAssistantToken({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId1,
      token: token1,
    });

    const workloadId1 = sanitizeWorkloadId(taskId1);
    await waitForWorkloadPodPresent({ namespace, workloadId: workloadId1, timeoutMs: 120_000 });
    await page.waitForTimeout(15_000);
    await waitForWorkloadPodPresent({ namespace, workloadId: workloadId1, timeoutMs: 10_000 });
    await waitForWorkloadPodDeleted({ namespace, workloadId: workloadId1, timeoutMs: 330_000 });

    const restartFileLibraryId = await createFileLibraryViaUi(
      page,
      'ws_default',
      projectId,
      `Internal Reclaim Restart ${Date.now()}`,
    );
    const taskId2 = await createNotebookTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `Restart Reclaim Task ${Date.now()}`,
      agentId: internalAgent.agentId,
      fileLibraryId: restartFileLibraryId,
    });
    const token2 = `INTERNAL_RESTART_RECLAIM_${Date.now()}`;
    await sendTaskMessage({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId: taskId2,
      content: buildNotebookCommand(token2, `restart-reclaim-${Date.now()}.md`),
    });

    const workloadId2 = sanitizeWorkloadId(taskId2);
    const workloadPod2 = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadId2, timeoutMs: 120_000 });
    await runInternalSandboxControl('stop-cleaner');
    await runInternalSandboxControl('stop-manager');
    await runInternalSandboxControl('start-manager');

    const workloadPod2AfterRestart = await waitForWorkloadPodIdentity({
      namespace,
      workloadId: workloadId2,
      timeoutMs: 30_000,
    });
    expect(workloadPod2AfterRestart).toEqual(workloadPod2);

    await runInternalSandboxControl('run-cleaner-once');
    const workloadPod2AfterCleaner = await waitForWorkloadPodIdentity({
      namespace,
      workloadId: workloadId2,
      timeoutMs: 10_000,
    });
    expect(workloadPod2AfterCleaner).toEqual(workloadPod2);

    await patchWorkloadPodExpiry({
      namespace,
      workloadId: workloadId2,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await runInternalSandboxControl('run-cleaner-once');
    await waitForWorkloadPodDeleted({ namespace, workloadId: workloadId2, timeoutMs: 120_000 });

    expect(true).toBe(true);
  });
});
