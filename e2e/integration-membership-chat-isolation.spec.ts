import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
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

function readUserIdFromJwt(token: string): string {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new Error('invalid_jwt_payload');
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { sub?: string };
  if (!decoded.sub?.trim()) {
    throw new Error('jwt_sub_missing');
  }
  return decoded.sub;
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
      data: {
        email,
        expires_in_hours: 24,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`create_invite_failed:${response.status()}:${await response.text()}`);
  }
  const payload = await response.json() as { invite_url?: string };
  expect(payload.invite_url).toBeTruthy();
  return payload.invite_url ?? '';
}

async function createChatSession(page: import('@playwright/test').Page, workspaceId: string, projectId: string, endpointId: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: `owner-session-${Date.now()}`,
        model: BACKEND_REAL_MODEL,
        endpoint_id: endpointId,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

async function postChatMessage(page: import('@playwright/test').Page, workspaceId: string, projectId: string, sessionId: string, content: string): Promise<void> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content,
      },
    },
  );
  expect(response.status()).toBe(201);
}

test.describe('@lane-real invite flow and chat isolation', () => {
  test('accepted invite joins as normal member and chat sessions stay private by user', async ({ browser, page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Invite Chat Isolation', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `Invite Chat Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `Invite Chat Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });

    const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');
    const ownerSessionId = await createChatSession(page, workspaceId, projectId, endpointId);
    await postChatMessage(page, workspaceId, projectId, ownerSessionId, `OWNER_PRIVATE_MESSAGE_${Date.now()}`);

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

      const memberToken = await readStoredAuthToken(memberPage);
      const memberUserId = readUserIdFromJwt(memberToken);
      const projectAccessResponse = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(projectAccessResponse.ok()).toBeTruthy();

      const memberSessionsResponse = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberSessionsResponse.ok()).toBeTruthy();
      const memberSessions = await memberSessionsResponse.json() as { items?: Array<{ id: string }> };
      expect(memberSessions.items?.map((item) => item.id) ?? []).not.toContain(ownerSessionId);

      const memberGetOwnerSession = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${ownerSessionId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberGetOwnerSession.status()).toBe(404);

      const ownerToken = await readStoredAuthToken(page);
      const groupsResponse = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/groups`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(groupsResponse.ok()).toBeTruthy();
      const groupsPayload = await groupsResponse.json() as {
        items?: Array<{ id: string; member_ids: string[] }>;
      };
      const memberIds = groupsPayload.items?.find((group) => group.id === 'grp_project_members')?.member_ids ?? [];
      const adminIds = groupsPayload.items?.find((group) => group.id === 'grp_project_admins')?.member_ids ?? [];
      expect(memberIds).toContain(memberUserId);
      expect(adminIds).not.toContain(memberUserId);
    } finally {
      await memberContext.close();
    }
  });
});
