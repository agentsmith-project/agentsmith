import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';

async function gotoProjectSection(page: Page, projectId: string, section: string) {
  await page.goto(`/${LOCALE}/workspaces/ws_default/projects/${projectId}/${section}`);
}

async function openEndpointRowEditDialog(page: Page, endpointName: string): Promise<Locator> {
  const row = page.getByTestId('endpoints__table__row').filter({ hasText: endpointName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button').first().click();
  const dialog = page.getByTestId('endpoints__edit-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test.describe('@lane-real integration endpoint create/edit flows', () => {
  test('custom endpoint create and edit keep custom UX and responses protocol', async ({ page }) => {
    test.setTimeout(300_000);

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Endpoint Create Edit');
    const credentialName = `Endpoint UX Key ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, 'sk-endpoint-ux');

    await gotoProjectSection(page, projectId, 'endpoints');
    await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('endpoints__create-btn').click();
    const dialog = page.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /use guided setup/i }).click();

    const wizard = page.getByTestId('endpoints__custom-wizard');
    const endpointName = `Responses Custom ${Date.now()}`;
    await expect(wizard).toBeVisible({ timeout: 30_000 });
    await wizard.getByTestId('wizard-name-input').fill(endpointName);
    await wizard.getByTestId('protocol-openai_responses').click();
    await wizard.getByTestId('wizard-base-url-input').fill('https://responses.provider.example/v1');
    await wizard.getByRole('button', { name: /next|下一步/i }).click();
    await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
    await wizard.getByTestId('wizard-model-id-input').fill('responses-model');
    await wizard.getByRole('button', { name: /next|下一步/i }).click();
    await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled({ timeout: 30_000 });
    await wizard.getByTestId('wizard-create-button').click();
    await expect(wizard).toBeHidden({ timeout: 30_000 });
    const createDialog = page.getByTestId('endpoints__create-dialog');
    if (await createDialog.isVisible().catch(() => false)) {
      await createDialog.getByRole('button', { name: /close|cancel/i }).first().click();
      await expect(createDialog).toBeHidden({ timeout: 30_000 });
    }

    let editDialog = await openEndpointRowEditDialog(page, endpointName);
    await expect(editDialog.locator('#endpoint-base-url')).toHaveValue('https://responses.provider.example/v1');
    await expect(editDialog.locator('#endpoint-model')).toHaveValue('responses-model');
    await expect(editDialog.getByRole('button', { name: /OpenAI Responses Upstreams/i })).toBeVisible();
    await expect(editDialog.getByText('Provider')).not.toBeVisible();
    await expect(editDialog.getByText('Catalog Models')).not.toBeVisible();

    await editDialog.locator('#endpoint-description').fill('Updated custom endpoint description');
    await editDialog.getByRole('button', { name: /save changes/i }).click();
    await expect(editDialog).toBeHidden({ timeout: 30_000 });

    editDialog = await openEndpointRowEditDialog(page, endpointName);
    await expect(editDialog.locator('#endpoint-description')).toHaveValue('Updated custom endpoint description');
    await expect(editDialog.locator('#endpoint-base-url')).toHaveValue('https://responses.provider.example/v1');
    await expect(editDialog.locator('#endpoint-model')).toHaveValue('responses-model');
    await expect(editDialog.getByRole('button', { name: /OpenAI Responses Upstreams/i })).toBeVisible();
    await expect(editDialog.getByText('Provider')).not.toBeVisible();
  });

  test('catalog endpoint edit keeps catalog UX and does not fall back to custom fields', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Endpoint Catalog Edit');
    const credentialName = `Catalog Endpoint Key ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, 'sk-endpoint-catalog');

    const endpointName = `Catalog Anthropic ${Date.now()}`;
    await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName,
      endpointModel: 'claude-sonnet-catalog',
      upstreamBaseUrl: 'https://api.anthropic.com/v1',
      credentialName,
      endpointType: 'catalog',
      providerFamily: 'anthropic',
      upstreamProtocol: 'anthropic_messages',
    });

    await gotoProjectSection(page, projectId, 'endpoints');
    const editDialog = await openEndpointRowEditDialog(page, endpointName);
    await expect(editDialog.getByText('Provider')).toBeVisible();
    await expect(editDialog.getByText('Upstream Protocol')).toBeVisible();
    await expect(editDialog.getByText('Anthropic Messages')).toBeVisible();
    await expect(editDialog.locator('#endpoint-base-url')).toHaveCount(0);
    await expect(editDialog.locator('#endpoint-model')).toHaveCount(0);
    await expect(editDialog.getByText('Catalog Models')).toBeVisible();
  });
});
