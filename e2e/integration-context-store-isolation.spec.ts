import { expect, test } from '@playwright/test';
import {
  ensureIntegrationKeycloakUsers,
  getContextEntryViaApi,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  putContextEntryViaApi,
} from './integration-real-helpers';

test.describe('@lane-real context store isolation', () => {
  test('member context stays private between workspace members', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const contextKey = `prefs.member_private_${Date.now()}`;
    const contextValue = `private_${Date.now()}`;
    await putContextEntryViaApi({
      page,
      scope: 'member',
      workspaceId: 'ws_default',
      key: contextKey,
      content: contextValue,
    });

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        memberPage,
        'ws_default',
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );

      const lookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'member',
        workspaceId: 'ws_default',
        key: contextKey,
        expectedStatus: 404,
      });
      expect(lookup.body).toEqual(expect.objectContaining({
        error_code: 'NOT_FOUND',
        message: 'context_not_found',
      }));
    } finally {
      await memberContext.close();
    }
  });

  test('workspace shared context stays governance-controlled while member context stays private', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const sharedKey = `shared.workspace_visible_${Date.now()}`;
    const sharedValue = `shared_${Date.now()}`;
    const privateKey = `prefs.member_hidden_${Date.now()}`;
    const privateValue = `hidden_${Date.now()}`;

    await putContextEntryViaApi({
      page,
      scope: 'workspace',
      workspaceId: 'ws_default',
      key: sharedKey,
      content: sharedValue,
    });
    await putContextEntryViaApi({
      page,
      scope: 'member',
      workspaceId: 'ws_default',
      key: privateKey,
      content: privateValue,
    });

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        memberPage,
        'ws_default',
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );

      const sharedLookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'workspace',
        workspaceId: 'ws_default',
        key: sharedKey,
        expectedStatus: 403,
      });
      expect(sharedLookup.body).toEqual(expect.objectContaining({
        error_code: 'FORBIDDEN',
        message: 'context_workspace_forbidden',
      }));

      const privateLookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'member',
        workspaceId: 'ws_default',
        key: privateKey,
        expectedStatus: 404,
      });
      expect(privateLookup.body).toEqual(expect.objectContaining({
        error_code: 'NOT_FOUND',
        message: 'context_not_found',
      }));
    } finally {
      await memberContext.close();
    }
  });
});
