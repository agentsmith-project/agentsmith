import { expect, test } from '@playwright/test';
import {
  API_BASE,
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

test.describe('@lane-real usage stays self-scoped to the current member', () => {
  test('different members can open their own usage page without project-wide access controls', async ({ browser, page }) => {
    test.setTimeout(900_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Usage Self Scope', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `Usage Self Scope Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `Usage Self Scope Endpoint ${Date.now()}`,
      endpointModel: 'placeholder-model',
      upstreamBaseUrl: 'https://provider.example',
      credentialName,
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

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/usage`);
      await expect(page.getByTestId('usage__view')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('usage__my-scope-badge')).toBeVisible();
      await expect(page.getByTestId('usage__endpoint-count')).toBeVisible();

      await memberPage.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/usage`);
      await expect(memberPage.getByTestId('usage__view')).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByTestId('usage__my-scope-badge')).toBeVisible();
      await expect(memberPage.getByTestId('usage__endpoint-count')).toBeVisible();
    } finally {
      await memberContext.close();
    }
  });
});
