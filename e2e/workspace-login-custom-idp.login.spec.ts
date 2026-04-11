import { expect, test } from '@playwright/test';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

const LOCALE = 'zh-CN';
const WORKSPACE_ID = 'ws_default';
const CUSTOM_IDP_URL = 'https://custom-idp.example.com';
const CUSTOM_IDP_REALM = 'custom-realm';
const CUSTOM_IDP_CLIENT_ID = 'custom-web-client';

const MOCK_PUBLIC_WORKSPACE_CONFIG = {
  id: WORKSPACE_ID,
  name: 'Default Workspace Override',
  login_idp: {
    kind: 'keycloak' as const,
    url: CUSTOM_IDP_URL,
    realm: CUSTOM_IDP_REALM,
    client_id: CUSTOM_IDP_CLIENT_ID,
  },
};

test('workspace login page uses the workspace-specific keycloak config in mock mode', async ({ page }) => {
  await page.addInitScript(({ workspaceId, publicConfig }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const url = new URL(target, window.location.origin);
      if (url.pathname === `/api/public/workspaces/${workspaceId}`) {
        return new Response(JSON.stringify(publicConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  }, {
    workspaceId: WORKSPACE_ID,
    publicConfig: MOCK_PUBLIC_WORKSPACE_CONFIG,
  });

  await gotoAndWait(page, `/${LOCALE}/workspaces/${WORKSPACE_ID}/login`);
  await waitForPageReady(page);

  await expect(page.getByTestId('workspace-login__heading')).toHaveText('Default Workspace Override');
  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible();

  const publicConfig = await page.evaluate(async (workspaceId) => {
    const response = await fetch(`/api/public/workspaces/${workspaceId}`, { cache: 'no-store' });
    return response.json();
  }, WORKSPACE_ID);

  expect(publicConfig).toMatchObject({
    ...MOCK_PUBLIC_WORKSPACE_CONFIG,
  });
});
