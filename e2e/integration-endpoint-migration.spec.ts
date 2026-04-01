import { expect, test, type Locator, type Page } from '@playwright/test';
import { MongoJsonDocStore } from '@mbos/adapters-private';
import type { EndpointRecord } from '../packages/api-entry-node/src/resource-models';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';

type LegacyEndpointRecord = Omit<EndpointRecord, 'type' | 'upstream_protocol'> & {
  type?: 'openai' | 'anthropic' | 'custom' | 'catalog';
  protocol?: 'openai_compatible' | 'anthropic_compatible';
};

async function issueDevToken(page: Page): Promise<string> {
  const response = await page.request.post('http://localhost:18080/realms/mbos/protocol/openid-connect/token', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      grant_type: 'password',
      client_id: 'agentsmith',
      username: KEYCLOAK_DEV_ADMIN_USERNAME,
      password: KEYCLOAK_DEV_ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('access_token_missing');
  return body.access_token;
}

async function createCredentialViaApi(page: Page, token: string, projectId: string, name: string): Promise<string> {
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name,
        type: 'api_key',
        value: 'sk-endpoint-migration',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('credential_id_missing');
  return body.id;
}

async function withMongoDocStore<T>(fn: (store: MongoJsonDocStore) => Promise<T>): Promise<T> {
  const mongoUrl = process.env.MONGO_URL?.trim() || 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
  const mongoDbName = process.env.MONGO_DB_NAME?.trim() || 'mbos';
  const store = new MongoJsonDocStore({ url: mongoUrl, dbName: mongoDbName });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

async function seedLegacyEndpoint(record: LegacyEndpointRecord): Promise<void> {
  await withMongoDocStore(async (store) => {
    await store.upsert(`ws_default_endpoints`, record.id, record);
  });
}

async function openEndpointRowEditDialog(page: Page, endpointName: string): Promise<Locator> {
  const row = page.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button').first().click();
  const dialog = page.getByTestId('endpoints__edit-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

async function gotoProjectSection(page: Page, projectId: string, section: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/ws_default/projects/${projectId}/${section}`);
}

test.describe('@lane-real integration endpoint migration', () => {
  test('legacy custom endpoint migrates to custom edit UX and new protocol label', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const token = await issueDevToken(page);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Endpoint Legacy Custom');
    const credentialId = await createCredentialViaApi(page, token, projectId, `Legacy Custom Key ${Date.now()}`);
    const now = new Date().toISOString();
    const endpointName = `Legacy Custom ${Date.now()}`;

    await seedLegacyEndpoint({
      id: `ep_legacy_custom_${Date.now()}`,
      workspace_id: 'ws_default',
      project_id: projectId,
      name: endpointName,
      description: 'legacy custom endpoint',
      model: 'legacy-custom-model',
      type: 'custom',
      protocol: 'openai_compatible',
      base_url: 'https://legacy-custom.provider.example/v1',
      status: 'active',
      credential_ref: credentialId,
      provider_family: 'custom',
      capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'legacy-custom-model' }],
      models: [{ capability: 'chat_completion', model_id: 'legacy-custom-model', display_name: 'legacy-custom-model' }],
      defaults: { chat_model_id: 'legacy-custom-model' },
      created_at: now,
      updated_at: now,
    });

    await gotoProjectSection(page, projectId, 'endpoints');
    const row = page.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
    await expect(row).toContainText('OpenAI Chat Completions');

    const editDialog = await openEndpointRowEditDialog(page, endpointName);
    await expect(editDialog.locator('#endpoint-base-url')).toHaveValue('https://legacy-custom.provider.example/v1');
    await expect(editDialog.locator('#endpoint-model')).toHaveValue('legacy-custom-model');
    await expect(editDialog.getByRole('button', { name: /OpenAI Chat Completions Upstreams/i })).toBeVisible();
    await expect(editDialog.getByText('Provider')).not.toBeVisible();
    await expect(editDialog.getByText('Catalog Models')).not.toBeVisible();
  });

  test('legacy anthropic catalog endpoint migrates to catalog edit UX and anthropic protocol label', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const token = await issueDevToken(page);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Endpoint Legacy Catalog');
    const credentialId = await createCredentialViaApi(page, token, projectId, `Legacy Catalog Key ${Date.now()}`);
    const now = new Date().toISOString();
    const endpointName = `Legacy Catalog ${Date.now()}`;

    await seedLegacyEndpoint({
      id: `ep_legacy_catalog_${Date.now()}`,
      workspace_id: 'ws_default',
      project_id: projectId,
      name: endpointName,
      description: 'legacy anthropic catalog endpoint',
      model: 'claude-legacy',
      type: 'anthropic',
      protocol: 'anthropic_compatible',
      base_url: 'https://api.anthropic.com/v1',
      status: 'active',
      credential_ref: credentialId,
      provider_family: 'anthropic',
      capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'claude-legacy' }],
      models: [{ capability: 'chat_completion', model_id: 'claude-legacy', display_name: 'claude-legacy' }],
      defaults: { chat_model_id: 'claude-legacy' },
      created_at: now,
      updated_at: now,
    });

    await gotoProjectSection(page, projectId, 'endpoints');
    const row = page.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
    await expect(row).toContainText('Anthropic Messages');

    const editDialog = await openEndpointRowEditDialog(page, endpointName);
    await expect(editDialog.getByText('Provider')).toBeVisible();
    await expect(editDialog.getByText('Catalog Models')).toBeVisible();
    await expect(editDialog.getByText('Anthropic Messages')).toBeVisible();
    await expect(editDialog.locator('#endpoint-base-url')).toHaveCount(0);
    await expect(editDialog.locator('#endpoint-model')).toHaveCount(0);
  });
});
