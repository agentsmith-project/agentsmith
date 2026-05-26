import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createInternalAgentTaskRunnerViaApi,
  createAgentTaskViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  sanitizeWorkloadId,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
  waitForWorkloadPodIdentity,
  LOCALE,
  API_BASE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireInternalEnv(): { namespace: string; apiKey: string } {
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  const apiKey = process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!namespace) {
    throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  }
  if (!apiKey) {
    throw new Error('missing_PRESET_ENDPOINT_API_KEY');
  }
  return { namespace, apiKey };
}

async function createInvite(page: import('@playwright/test').Page, workspaceId: string, projectId: string, email: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/invites`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { email, expires_in_hours: 24 },
    },
  );
  if (!response.ok()) {
    throw new Error(`create_invite_failed:${response.status()}:${await response.text()}`);
  }
  const payload = await response.json() as { invite_url?: string };
  expect(payload.invite_url).toBeTruthy();
  return payload.invite_url ?? '';
}

async function createFileLibrary(page: import('@playwright/test').Page, workspaceId: string, projectId: string, name: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          name,
          description: `auto-created ${name}`,
        },
      },
    );
    if (response.ok()) {
      const payload = await response.json() as { id?: string };
      expect(payload.id).toBeTruthy();
      return payload.id ?? '';
    }
    const errorText = await response.text();
    const retryableProvisioningFailure = response.status() === 502
      && errorText.includes('FILE_LIBRARY_PROVISIONING_FAILED')
      && (errorText.includes('connection reset') || errorText.includes('ECONNRESET'));
    if (!retryableProvisioningFailure || attempt === 4) {
      throw new Error(`create_file_library_failed:${response.status()}:${errorText}`);
    }
    await page.waitForTimeout(1_000 * (attempt + 1));
  }
  throw new Error('create_file_library_retry_exhausted');
}

async function expectFilesLibraryVisibility(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  visibleLibraryName: string;
  hiddenLibraryName: string;
}): Promise<void> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  const visibleLibrary = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.visibleLibraryName }).first();
  const hiddenLibrary = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.hiddenLibraryName }).first();
  await expect(visibleLibrary).toBeVisible({ timeout: 30_000 });
  await expect(hiddenLibrary).toHaveCount(0);
}

test.describe('@lane-real internal Agent Task isolation by user', () => {
  test('different users get different tasks, hidden from each other, with different workload pods', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const { namespace, apiKey } = requireInternalEnv();
    const workspaceId = 'ws_default';
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Internal Isolation', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `Internal Isolation Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `Internal Isolation Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    await createInternalAgentTaskRunnerViaApi(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'internal-user-isolation',
      idleTimeoutSec: 300,
      maxLifetimeSec: 3600,
    });
    const ownerLibraryName = `Owner Isolation ${Date.now()}`;
    const memberLibraryName = `Member Isolation ${Date.now()}`;
    const ownerFileLibraryId = await createFileLibrary(page, workspaceId, projectId, ownerLibraryName);
    const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        memberPage,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );
      await memberPage.goto(`/${LOCALE}${invitePath}`);
      await expect(memberPage.getByTestId('join__accept-btn')).toBeVisible({ timeout: 30_000 });
      await memberPage.getByTestId('join__accept-btn').click();
      await memberPage.waitForURL(/\/login\/workspace/, { timeout: 30_000 });
      const memberFileLibraryId = await createFileLibrary(memberPage, workspaceId, projectId, memberLibraryName);

      const ownerTaskId = await createAgentTaskViaApi({
        page,
        workspaceId,
        projectId,
        title: `Owner Internal Task ${Date.now()}`,
        fileLibraryId: ownerFileLibraryId,
      });
      const memberTaskId = await createAgentTaskViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        title: `Member Internal Task ${Date.now()}`,
        fileLibraryId: memberFileLibraryId,
      });

      const ownerToken = await readStoredAuthToken(page);
      const memberToken = await readStoredAuthToken(memberPage);

      await expectFilesLibraryVisibility({
        page,
        workspaceId,
        projectId,
        visibleLibraryName: ownerLibraryName,
        hiddenLibraryName: memberLibraryName,
      });
      await expectFilesLibraryVisibility({
        page: memberPage,
        workspaceId,
        projectId,
        visibleLibraryName: memberLibraryName,
        hiddenLibraryName: ownerLibraryName,
      });

      const ownerCannotReadMemberLibrary = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${memberFileLibraryId}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMemberLibrary.status()).toBe(404);

      const memberCannotReadOwnerLibrary = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${ownerFileLibraryId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwnerLibrary.status()).toBe(404);

      const ownerCannotReadMember = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${memberTaskId}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMember.status()).toBe(404);

      const memberCannotReadOwner = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${ownerTaskId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwner.status()).toBe(404);

      const ownerReplyToken = `OWNER_TASK_ISOLATION_${Date.now()}`;
      const memberReplyToken = `MEMBER_TASK_ISOLATION_${Date.now()}`;
      const ownerRun = await startAgentTaskRunViaApi({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        intent: `Reply with ${ownerReplyToken}`,
      });
      const memberRun = await startAgentTaskRunViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        intent: `Reply with ${memberReplyToken}`,
      });
      await waitForRunnerOutputToken({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        token: ownerReplyToken,
        runnerOutputActivityId: ownerRun.runnerOutputActivityId,
        runId: ownerRun.runId,
      });
      await waitForRunnerOutputToken({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        token: memberReplyToken,
        runnerOutputActivityId: memberRun.runnerOutputActivityId,
        runId: memberRun.runId,
      });

      const ownerPod = await waitForWorkloadPodIdentity({
        namespace,
        workspaceId,
        projectId,
        workloadId: sanitizeWorkloadId(ownerTaskId),
        timeoutMs: 180_000,
      });
      const memberPod = await waitForWorkloadPodIdentity({
        namespace,
        workspaceId,
        projectId,
        workloadId: sanitizeWorkloadId(memberTaskId),
        timeoutMs: 180_000,
      });
      expect(ownerPod.uid).not.toBe(memberPod.uid);
      expect(ownerPod.name).not.toBe(memberPod.name);
    } finally {
      await memberContext.close();
    }
  });
});
