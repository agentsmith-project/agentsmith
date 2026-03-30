import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalCodexAgentBundle,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  createNotebookTaskViaApi,
  sendTaskMessage,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
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

test.describe('@lane-real external notebook task isolation by user', () => {
  test('different users get different external notebook tasks hidden from each other', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'External Isolation', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `External Isolation Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `External Isolation Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });

    const agentBundle = await createExternalCodexAgentBundle(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'external-user-isolation',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });

    const ownerFileLibraryId = await createFileLibrary(page, workspaceId, projectId, `Owner External Isolation ${Date.now()}`);
    const memberFileLibraryId = await createFileLibrary(page, workspaceId, projectId, `Member External Isolation ${Date.now()}`);
    const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await waitForAgentPresenceOnline(page, workspaceId, projectId, agentBundle.agentId);
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
        title: `Owner External Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId: ownerFileLibraryId,
      });
      const memberTaskId = await createNotebookTaskViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        title: `Member External Task ${Date.now()}`,
        agentId: agentBundle.agentId,
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
        content: `Reply with OWNER_EXTERNAL_TASK_ISOLATION_${Date.now()}`,
      });
      await sendTaskMessage({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        content: `Reply with MEMBER_EXTERNAL_TASK_ISOLATION_${Date.now()}`,
      });

      const memberCannotReadOwnerMessages = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${ownerTaskId}/messages`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwnerMessages.status()).toBe(404);

      const ownerCannotReadMemberMessages = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${memberTaskId}/messages`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMemberMessages.status()).toBe(404);
    } finally {
      await memberContext.close();
      await runner.stop();
    }
  });
});
