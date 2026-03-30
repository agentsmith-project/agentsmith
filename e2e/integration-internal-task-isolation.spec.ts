import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createInternalCodexAgent,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  createNotebookTaskViaApi,
  sendTaskMessage,
  sanitizeWorkloadId,
  waitForWorkloadPodIdentity,
  LOCALE,
  API_BASE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireInternalEnv(): { namespace: string; apiKey: string } {
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  const apiKey = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!namespace) {
    throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  }
  if (!apiKey) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
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
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

test.describe('@lane-real internal notebook task isolation by user', () => {
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
    const agent = await createInternalCodexAgent(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'internal-user-isolation',
      idleTimeoutSec: 300,
      maxLifetimeSec: 3600,
    });
    const ownerFileLibraryId = await createFileLibrary(page, workspaceId, projectId, `Owner Isolation ${Date.now()}`);
    const memberFileLibraryId = await createFileLibrary(page, workspaceId, projectId, `Member Isolation ${Date.now()}`);
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

      const ownerTaskId = await createNotebookTaskViaApi({
        page,
        workspaceId,
        projectId,
        title: `Owner Internal Task ${Date.now()}`,
        agentId: agent.agentId,
        fileLibraryId: ownerFileLibraryId,
      });
      const memberTaskId = await createNotebookTaskViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        title: `Member Internal Task ${Date.now()}`,
        agentId: agent.agentId,
        fileLibraryId: memberFileLibraryId,
      });

      const ownerToken = await readStoredAuthToken(page);
      const memberToken = await readStoredAuthToken(memberPage);

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

      await sendTaskMessage({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        content: `Reply with OWNER_TASK_ISOLATION_${Date.now()}`,
      });
      await sendTaskMessage({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        content: `Reply with MEMBER_TASK_ISOLATION_${Date.now()}`,
      });

      const ownerPod = await waitForWorkloadPodIdentity({
        namespace,
        workloadId: sanitizeWorkloadId(ownerTaskId),
        timeoutMs: 180_000,
      });
      const memberPod = await waitForWorkloadPodIdentity({
        namespace,
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
