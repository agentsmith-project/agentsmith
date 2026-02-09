import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';

const RUN_INTEGRATION = process.env.RUN_INTEGRATION_E2E === 'true';

async function startOpenAICompatibleUpstream(): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  return startOpenAICompatibleUpstreamWith({
    replyText: 'Hello from integration upstream.',
  });
}

async function startOpenAICompatibleUpstreamWith(args: {
  replyText: string;
  delayMs?: number;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const { replyText, delayMs = 0 } = args;
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requestCount += 1;

      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl_integration',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'integration-chat-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: replyText },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getRequestCount: () => requestCount,
  };
}

async function keycloakLogin(page: import('@playwright/test').Page, locale: string, username: string, password: string) {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('login__keycloak-btn').click();

  const keycloakError = page.getByTestId('login__keycloak-error');
  if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
    throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
  }

  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 60_000 }),
    page.locator('#kc-login, button[type="submit"]').first().click(),
  ]);
  await page.getByTestId('workspace-select__card--ws_default').click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 30_000 });
}

async function createProjectFromUi(page: import('@playwright/test').Page, locale: string): Promise<string> {
  const projectName = `it-chat-proj-${Date.now()}`;
  const createButton = page.getByTestId('projects__create-btn');
  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click();
  } else {
    await page.getByRole('button', { name: /new project|create|创建|新建项目/i }).first().click();
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('#project-name').fill(projectName);
  await dialog.locator('#project-description').fill('Integration chat project');
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 }),
    dialog.getByRole('button', { name: /create|创建/i }).click(),
  ]);
  const match = page.url().match(/\/projects\/([^/]+)\//);
  expect(match?.[1]).toBeTruthy();
  return match![1];
}

async function provisionCredentialAndEndpoint(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  upstreamBaseUrl: string,
) {
  await createCredential(page, locale, projectId, {
    credentialName: 'Integration Credential',
    credentialValue: 'integration-secret-key',
  });
  await createEndpoint(page, locale, projectId, {
    endpointName: 'Integration Endpoint',
    endpointModel: 'integration-chat-model',
    upstreamBaseUrl,
    credentialName: 'Integration Credential',
  });
}

async function createCredential(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  args: {
    credentialName: string;
    credentialValue: string;
  },
) {
  const { credentialName, credentialValue } = args;
  await page.getByRole('link', { name: /credentials|凭据/i }).first().click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/credentials`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('credentials__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('credentials__create-btn').click();
  const credDialog = page.getByTestId('credentials__create-dialog');
  await expect(credDialog).toBeVisible();
  await credDialog.locator('#cred-name').fill(credentialName);
  await credDialog.locator('#cred-value').fill(credentialValue);
  const createCredentialResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/credentials$/.test(res.url()),
  );
  await credDialog.getByRole('button', { name: /create|创建/i }).click();
  const credentialRes = await createCredentialResponse;
  expect(credentialRes.ok()).toBeTruthy();
  if (await credDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
}

async function createEndpoint(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  args: {
    endpointName: string;
    endpointModel: string;
    upstreamBaseUrl: string;
    credentialName: string;
  },
): Promise<string> {
  const { endpointName, endpointModel, upstreamBaseUrl, credentialName } = args;
  await page.getByRole('link', { name: /endpoints|端点/i }).first().click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/endpoints`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints__create-btn').click();
  const endpointDialog = page.getByTestId('endpoints__create-dialog');
  await expect(endpointDialog).toBeVisible();
  await endpointDialog.locator('#endpoint-name').fill(endpointName);
  await endpointDialog.locator('#endpoint-model').fill(endpointModel);

  const providerSelect = endpointDialog.locator('[role="combobox"]').first();
  await providerSelect.click();
  await page.getByRole('option', { name: /custom/i }).click();
  await endpointDialog.locator('#endpoint-base-url').fill(upstreamBaseUrl);

  const credentialSelect = endpointDialog.locator('[role="combobox"]').last();
  await credentialSelect.click();
  await page.getByRole('option', { name: new RegExp(credentialName, 'i') }).click();

  const createEndpointResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/endpoints$/.test(res.url()),
  );
  await endpointDialog.getByRole('button', { name: /^create$/i }).click();
  const endpointRes = await createEndpointResponse;
  expect(endpointRes.ok()).toBeTruthy();
  const endpointJson = (await endpointRes.json().catch(() => null)) as
    | { id?: string; data?: { id?: string } }
    | null;
  const endpointId = endpointJson?.id ?? endpointJson?.data?.id;
  expect(endpointId).toBeTruthy();
  if (await endpointDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByText(endpointName)).toBeVisible({ timeout: 30_000 });
  return endpointId!;
}

async function selectEndpointInChat(
  page: import('@playwright/test').Page,
  endpointId: string,
) {
  const updateSessionResponse = page.waitForResponse((res) =>
    res.request().method() === 'PATCH' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+$/.test(res.url()) &&
    res.status() === 200,
  );
  await page.getByTestId('chat__model-trigger').click();
  await page.getByTestId(`chat__model-item--${endpointId}`).click();
  await updateSessionResponse;
}

async function openChatAndSend(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  text: string,
  sessionId?: string | null,
  expectedReply = 'Hello from integration upstream.',
): Promise<string> {
  await page.getByRole('link', { name: /chat|对话/i }).first().click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });

  if (await page.getByTestId('chat__thread-item').count() === 0) {
    await page.getByTestId('chat__new-thread-btn').click();
  }
  const firstThread = page.getByTestId('chat__thread-item').first();
  await expect(firstThread).toBeVisible({ timeout: 30_000 });

  const targetThread = sessionId
    ? page.locator(`[data-testid="chat__thread-item"][data-thread-id="${sessionId}"]`).first()
    : firstThread;
  await expect(targetThread).toBeVisible({ timeout: 30_000 });
  const selectedThreadId = await targetThread.getAttribute('data-thread-id');
  expect(selectedThreadId).toBeTruthy();
  await targetThread.locator('div[role="button"]').first().click();

  const composer = page.getByTestId('chat__composer');
  await expect(composer).toBeVisible();
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);

  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()) &&
    res.status() === 200,
  );
  await sendBtn.click();
  await streamResponse;
  await expect(page.getByText(expectedReply).first()).toBeVisible({ timeout: 60_000 });
  return selectedThreadId!;
}

test.describe('integration chat flow', () => {
  test.skip(!RUN_INTEGRATION, 'Enable with RUN_INTEGRATION_E2E=true');

  test('keycloak login + create endpoint + chat stream through openai-compatible proxy', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);
      await openChatAndSend(page, locale, projectId, 'Integration chat ping');
      expect(upstream.getRequestCount()).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('chat session survives route switch and can continue conversation', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);

      const selectedThreadId = await openChatAndSend(page, locale, projectId, 'Reconnect test - message 1');
      const firstThread = page.getByTestId('chat__thread-item').first();
      const firstThreadId = await firstThread.getAttribute('data-thread-id');
      expect(firstThreadId).toBeTruthy();
      expect(selectedThreadId).toBe(firstThreadId);

      await page.getByRole('link', { name: /overview|概览/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/overview`), {
        timeout: 30_000,
      });

      const beforeSecondSend = upstream.getRequestCount();
      const threadAfterReturnId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Reconnect test - message 2',
        firstThreadId,
      );
      expect(threadAfterReturnId).toBe(firstThreadId);
      expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(beforeSecondSend + 1);
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('chat can switch endpoint and route next message to selected upstream', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstreamA = await startOpenAICompatibleUpstreamWith({ replyText: 'Reply from endpoint A' });
    const upstreamB = await startOpenAICompatibleUpstreamWith({ replyText: 'Reply from endpoint B' });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);

      await createCredential(page, locale, projectId, {
        credentialName: 'Integration Credential',
        credentialValue: 'integration-secret-key',
      });
      await createEndpoint(page, locale, projectId, {
        endpointName: 'Integration Endpoint A',
        endpointModel: 'integration-chat-model-a',
        upstreamBaseUrl: upstreamA.baseUrl,
        credentialName: 'Integration Credential',
      });
      const endpointBId = await createEndpoint(page, locale, projectId, {
        endpointName: 'Integration Endpoint B',
        endpointModel: 'integration-chat-model-b',
        upstreamBaseUrl: upstreamB.baseUrl,
        credentialName: 'Integration Credential',
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Route to endpoint A',
        null,
        'Reply from endpoint A',
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, endpointBId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Route to endpoint B',
        threadId,
        'Reply from endpoint B',
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => upstreamA.server.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamB.server.close(() => resolve()));
    }
  });
});
