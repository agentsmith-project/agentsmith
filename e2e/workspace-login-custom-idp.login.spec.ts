import { expect, test } from '@playwright/test';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

const LOCALE = 'zh-CN';
const WORKSPACE_ID = 'ws_default';
const CUSTOM_IDP_URL = 'https://custom-idp.example.com';
const CUSTOM_IDP_REALM = 'custom-realm';
const CUSTOM_IDP_CLIENT_ID = 'custom-web-client';

const seededWorkspaceRecord = {
  id: WORKSPACE_ID,
  name: 'Default Workspace Override',
  workspace_admin: 'owner@example.com',
  workspace_admin_user_id: 'kc-owner',
  workspace_admin_name: 'Owner',
  workspace_admin_binding_required: false,
  project_creators: [],
  idp: {
    kind: 'keycloak',
    url: CUSTOM_IDP_URL,
    realm: CUSTOM_IDP_REALM,
    client_id: CUSTOM_IDP_CLIENT_ID,
  },
  tenant: {
    workspace_id: WORKSPACE_ID,
    workspace_name: 'Default Workspace Override',
    substrate_label: 'primary',
    database_name: 'agentsmith_ws_default',
    collection_prefix: 'ws_default_',
    key_prefix: 'ws:default:',
  },
  provisioning_status: 'ready',
  last_initialized_at: '2026-03-29T00:00:00.000Z',
  last_init_error: null,
  created_at: '2026-03-29T00:00:00.000Z',
  updated_at: '2026-03-29T00:00:00.000Z',
};

test('workspace login page uses the workspace-specific keycloak config in mock mode', async ({ page, request }) => {
  const seedResponse = await request.post('/api/test/system/workspaces/seed', {
    data: { records: [seededWorkspaceRecord] },
  });
  expect(seedResponse.ok()).toBeTruthy();

  await gotoAndWait(page, `/${LOCALE}/workspaces/${WORKSPACE_ID}/login`);
  await waitForPageReady(page);

  await expect(page.getByTestId('workspace-login__heading')).toHaveText('Default Workspace Override');
  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible();

  const publicConfig = await page.evaluate(async (workspaceId) => {
    const response = await fetch(`/api/public/workspaces/${workspaceId}`, { cache: 'no-store' });
    return response.json();
  }, WORKSPACE_ID);

  expect(publicConfig).toMatchObject({
    id: WORKSPACE_ID,
    name: 'Default Workspace Override',
    login_idp: {
      kind: 'keycloak',
      url: CUSTOM_IDP_URL,
      realm: CUSTOM_IDP_REALM,
      client_id: CUSTOM_IDP_CLIENT_ID,
    },
  });
});
