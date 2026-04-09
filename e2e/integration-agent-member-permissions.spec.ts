import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createFileLibraryViaUi,
  createNotebookTaskViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
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

test.describe('@lane-real ordinary members can use agents but cannot manage them', () => {
  test('member can create tasks with agents and gets 403 on manage APIs', async ({ browser, page }) => {
    test.setTimeout(900_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Agent Member Permissions', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `Agent Permissions Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `Agent Permissions Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'member-use-only-agent',
    });
    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
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
      await waitForAgentPresenceOnline(page, workspaceId, projectId, agentBundle.agentId);

      const memberLibraryName = `Agent Member Library ${Date.now()}`;
      const memberLibraryId = await createFileLibraryViaUi(memberPage, workspaceId, projectId, memberLibraryName);
      const taskId = await createNotebookTaskViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        title: `Agent Member Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId: memberLibraryId,
      });
      expect(taskId).toBeTruthy();

      const memberToken = await readStoredAuthToken(memberPage);
      const patchResponse = await memberPage.request.patch(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentBundle.agentId}`,
        {
          headers: {
            Authorization: `Bearer ${memberToken}`,
            'Content-Type': 'application/json',
          },
          data: { name: `forbidden-${Date.now()}` },
        },
      );
      expect(patchResponse.status()).toBe(403);

      const keyResponse = await memberPage.request.post(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentBundle.agentId}/keys`,
        {
          headers: {
            Authorization: `Bearer ${memberToken}`,
            'Content-Type': 'application/json',
          },
          data: { note: 'member should not issue keys' },
        },
      );
      expect(keyResponse.status()).toBe(403);

      const deleteResponse = await memberPage.request.delete(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentBundle.agentId}`,
        {
          headers: { Authorization: `Bearer ${memberToken}` },
        },
      );
      expect(deleteResponse.status()).toBe(403);
    } finally {
      await runner.stop();
      await memberContext.close();
    }
  });
});
