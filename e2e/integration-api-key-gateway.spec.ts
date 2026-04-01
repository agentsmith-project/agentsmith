import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  API_BASE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
} from './integration-real-helpers';

async function startAnthropicCompatibleUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  let server: Server;
  server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'POST' && requestUrl.pathname.endsWith('/messages')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_gateway_it',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: replyText }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 4 },
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
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
  test('user can create personal API key and use one endpoint through canonical openai/anthropic base urls', async ({ page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const upstreamApiKey = 'gateway-upstream-test-key';
    const anthropicModel = 'gateway-it-model';
    const upstream = await startAnthropicCompatibleUpstream('ok');

    try {
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, 'Gateway API Key Access', {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });

      const endpointCredentialName = `Gateway Endpoint Key ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, endpointCredentialName, upstreamApiKey);
      const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
        endpointName: `Anthropic Upstream Gateway Endpoint ${Date.now()}`,
        endpointModel: anthropicModel,
        upstreamBaseUrl: upstream.baseUrl,
        credentialName: endpointCredentialName,
        upstreamProtocol: 'anthropic_messages',
      });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
      await expect(page.getByTestId('use-guide__openai-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/openai`);
      await page.getByTestId('use-guide__tab-anthropic').click();
      await expect(page.getByTestId('use-guide__anthropic-base-url')).toContainText(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic`);

      const apiKey = await createPersonalApiKey(page);

      const meResponse = await page.request.get(`${API_BASE}/api/v1/me/profile`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(meResponse.ok()).toBeTruthy();

      const openAiResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: anthropicModel,
            input: 'Reply exactly: ok',
          },
        },
      );
      if (!openAiResponse.ok()) {
        throw new Error(`openai_endpoint_request_failed:${openAiResponse.status()}:${await openAiResponse.text()}`);
      }

      const anthropicResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic/v1/messages`,
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
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/proxy/responses`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: anthropicModel,
            input: 'legacy should fail',
          },
        },
      );
      expect(legacyResponse.status()).toBe(422);
    } finally {
      await upstream.stop();
    }
  });
});
