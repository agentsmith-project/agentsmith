import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  BACKEND_REAL_OPENAI_BASE_URL,
  BACKEND_REAL_OPENAI_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
} from './integration-real-helpers';

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

function requireConfiguredBackendRealValue(name: string, value: string | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) {
    throw new Error(`missing_${name}`);
  }
  if (
    normalized.includes('provider.example')
    || normalized === 'placeholder-model'
  ) {
    throw new Error(`missing_real_${name}`);
  }
  return normalized;
}

async function createPersonalApiKey(page: import('@playwright/test').Page): Promise<string> {
  await page.goto(`/${LOCALE}/user/api-keys`);
  await expect(page.getByTestId('api-keys__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('api-keys__create-btn').click();
  const dialog = page.getByTestId('api-keys__create-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const inputs = dialog.locator('input');
  await inputs.nth(0).fill(`Gateway E2E ${Date.now()}`);
  await inputs.nth(1).fill('7');
  await dialog.getByRole('button', { name: /create/i }).click();
  const createdDialog = page.getByTestId('api-keys__key-created-dialog');
  await expect(createdDialog).toBeVisible({ timeout: 30_000 });
  const keyValue = (await createdDialog.locator('code').textContent())?.trim() || '';
  expect(keyValue).toContain('asku_');
  await createdDialog.getByRole('button', { name: /confirm/i }).click();
  return keyValue;
}

test.describe('@lane-real personal api key endpoint access', () => {
  test('user can create personal API key and use canonical openai/anthropic endpoint base urls', async ({ page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const upstreamApiKey = requireApiKey();
    const openAiBaseUrl = requireConfiguredBackendRealValue('BACKEND_REAL_OPENAI_BASE_URL', BACKEND_REAL_OPENAI_BASE_URL);
    const anthropicBaseUrl = requireConfiguredBackendRealValue('BACKEND_REAL_ANTHROPIC_BASE_URL', BACKEND_REAL_ANTHROPIC_BASE_URL);
    const anthropicModel = requireConfiguredBackendRealValue('BACKEND_REAL_MODEL', BACKEND_REAL_MODEL);
    const openAiModel = requireConfiguredBackendRealValue('BACKEND_REAL_OPENAI_MODEL', BACKEND_REAL_OPENAI_MODEL);

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Gateway API Key Access', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const openAiCredentialName = `Gateway OpenAI-Compatible Key ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, openAiCredentialName, upstreamApiKey);
    const openAiEndpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `OpenAI-Compatible Gateway Endpoint ${Date.now()}`,
      endpointModel: openAiModel,
      upstreamBaseUrl: openAiBaseUrl,
      credentialName: openAiCredentialName,
      protocol: 'openai_compatible',
    });

    const anthropicCredentialName = `Gateway Anthropic-Compatible Key ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, anthropicCredentialName, upstreamApiKey);
    const anthropicEndpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `Anthropic-Compatible Gateway Endpoint ${Date.now()}`,
      endpointModel: anthropicModel,
      upstreamBaseUrl: anthropicBaseUrl,
      credentialName: anthropicCredentialName,
      protocol: 'anthropic_compatible',
    });

    await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
    await expect(page.getByTestId('use-guide__openai-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/<endpoint-id>/proxy/openai`);
    await expect(page.getByTestId('use-guide__anthropic-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/<endpoint-id>/proxy/anthropic`);

    const apiKey = await createPersonalApiKey(page);

    const meResponse = await page.request.get(`${API_BASE}/api/v1/me/profile`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(meResponse.ok()).toBeTruthy();

    const openAiResponse = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${openAiEndpointId}/proxy/openai/responses`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: openAiModel,
          input: 'Reply exactly: ok',
        },
      },
    );
    expect(openAiResponse.ok()).toBeTruthy();

    const anthropicResponse = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${anthropicEndpointId}/proxy/anthropic/v1/messages`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        data: {
          model: anthropicModel,
          max_tokens: 64,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply exactly: ok' }] }],
        },
      },
    );
    if (!anthropicResponse.ok()) {
      throw new Error(`anthropic_endpoint_request_failed:${anthropicResponse.status()}:${await anthropicResponse.text()}`);
    }

    const legacyResponse = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${openAiEndpointId}/proxy/responses`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: openAiModel,
          input: 'legacy should fail',
        },
      },
    );
    expect(legacyResponse.status()).toBe(422);
  });
});
