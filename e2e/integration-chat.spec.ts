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
  statusCode?: number;
  errorMessage?: string;
  errorCode?: string;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const {
    replyText,
    delayMs = 0,
    statusCode = 200,
    errorMessage = 'upstream_error',
    errorCode = 'UPSTREAM_ERROR',
  } = args;
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

      if (statusCode >= 400) {
        res.statusCode = statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error_code: errorCode,
            message: errorMessage,
          }),
        );
        return;
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
  const suffix = Date.now();
  const credentialName = `Integration Credential ${suffix}`;
  const endpointName = `Integration Endpoint ${suffix}`;
  await createCredential(page, locale, projectId, {
    credentialName,
    credentialValue: 'integration-secret-key',
  });
  await createEndpoint(page, locale, projectId, {
    endpointName,
    endpointModel: 'integration-chat-model',
    upstreamBaseUrl,
    credentialName,
  });
}

async function sendExpectStreamError(
  page: import('@playwright/test').Page,
  text: string,
) {
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  await sendBtn.click();
  await expect(page.getByTestId('chat__stream-status')).toHaveText('Error', { timeout: 60_000 });
}

async function sendExpectStreamErrorMessage(
  page: import('@playwright/test').Page,
  text: string,
  expectedMessage: string,
) {
  await sendExpectStreamError(page, text);
  await expect(page.getByText(expectedMessage).first()).toBeVisible({ timeout: 30_000 });
}

async function sendAndStopDuringGeneration(
  page: import('@playwright/test').Page,
  text: string,
) {
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  await sendBtn.click();

  const stopBtn = page.getByRole('button', { name: /Stop/i });
  await expect(stopBtn).toBeVisible({ timeout: 10_000 });
  await stopBtn.click();
  await expect(page.getByTestId('chat__stream-status')).toHaveText('Stopped', { timeout: 30_000 });
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
  if (!credentialRes.ok()) {
    const errorBody = await credentialRes.text().catch(() => '');
    throw new Error(`Create credential failed (${credentialRes.status()}): ${errorBody}`);
  }
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
  const updateRes = await updateSessionResponse;
  const json = (await updateRes.json().catch(() => null)) as { endpoint_id?: string } | null;
  expect(json?.endpoint_id).toBe(endpointId);
}

async function createNewThreadInChat(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
): Promise<string> {
  await page.getByRole('link', { name: /chat|对话/i }).first().click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
    timeout: 30_000,
  });
  const items = page.getByTestId('chat__thread-item');
  const beforeCount = await items.count();
  await page.getByTestId('chat__new-thread-btn').click();
  await expect(items).toHaveCount(beforeCount + 1, { timeout: 30_000 });
  const newThread = items.first();
  const threadId = await newThread.getAttribute('data-thread-id');
  expect(threadId).toBeTruthy();
  await newThread.locator('div[role="button"]').first().click();
  return threadId!;
}

async function renameThreadInChat(
  page: import('@playwright/test').Page,
  threadId: string,
  nextTitle: string,
) {
  const thread = page.locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`).first();
  await expect(thread).toBeVisible({ timeout: 30_000 });
  await thread.getByTestId('chat__thread-actions-btn').click();
  await page.getByTestId('chat__thread-rename-action').click();
  const titleInput = thread.locator('input').first();
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.fill(nextTitle);
  await titleInput.press('Enter');
  await expect(thread.getByText(nextTitle)).toBeVisible({ timeout: 30_000 });
}

async function deleteThreadInChat(
  page: import('@playwright/test').Page,
  threadId: string,
) {
  const thread = page.locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`).first();
  await expect(thread).toBeVisible({ timeout: 30_000 });
  await thread.getByTestId('chat__thread-actions-btn').click();
  await page.getByTestId('chat__thread-delete-action').click();
  await expect(page.getByTestId('chat__delete-thread-confirm')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('chat__delete-thread-confirm').click();
  await expect(page.locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`)).toHaveCount(0, {
    timeout: 30_000,
  });
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

async function openChatAttachAndSend(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  args: {
    text: string;
    fileName: string;
    fileContent: string;
    expectedReply: string;
    sessionId?: string | null;
  },
): Promise<string> {
  const { text, fileName, fileContent, expectedReply, sessionId } = args;
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

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(fileContent, 'utf8'),
  });
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 30_000 });

  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const createMessageRequest = page.waitForRequest((req) =>
    req.method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages$/.test(req.url()),
  );
  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()) &&
    res.status() === 200,
  );
  await sendBtn.click();
  const msgReq = await createMessageRequest;
  const body = msgReq.postDataJSON() as { attachments?: string[] } | null;
  expect(Array.isArray(body?.attachments)).toBeTruthy();
  expect((body?.attachments ?? []).length).toBeGreaterThan(0);
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
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: 'integration-secret-key',
      });
      await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint A ${suffix}`,
        endpointModel: 'integration-chat-model-a',
        upstreamBaseUrl: upstreamA.baseUrl,
        credentialName,
      });
      const endpointBId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint B ${suffix}`,
        endpointModel: 'integration-chat-model-b',
        upstreamBaseUrl: upstreamB.baseUrl,
        credentialName,
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

  test('chat can recover by switching endpoint after upstream failure', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const failingUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'never-used',
      statusCode: 500,
      errorMessage: 'integration forced upstream failure',
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered from healthy endpoint',
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: 'integration-secret-key',
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: 'integration-chat-model-healthy',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const failingEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Failing ${suffix}`,
        endpointModel: 'integration-chat-model-fail',
        upstreamBaseUrl: failingUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup with failing endpoint selection',
        null,
        'Recovered from healthy endpoint',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, failingEndpointId);
      await sendExpectStreamError(page, 'This should fail via failing endpoint');
      expect(failingUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover with healthy endpoint',
        threadId,
        'Recovered from healthy endpoint',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => failingUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat can stop generation and continue via healthy endpoint', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const slowUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Slow upstream response',
      delayMs: 12_000,
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after stop',
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: 'integration-secret-key',
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: 'integration-chat-model-healthy',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const slowEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Slow ${suffix}`,
        endpointModel: 'integration-chat-model-slow',
        upstreamBaseUrl: slowUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after stop',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, slowEndpointId);
      await sendAndStopDuringGeneration(page, 'Stop this slow request');
      expect(slowUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Continue after stop with healthy endpoint',
        threadId,
        'Recovered after stop',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => slowUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat threads keep endpoint isolation when switching between sessions', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstreamA = await startOpenAICompatibleUpstreamWith({ replyText: 'Thread A reply' });
    const upstreamB = await startOpenAICompatibleUpstreamWith({ replyText: 'Thread B reply' });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: 'integration-secret-key',
      });
      await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint A ${suffix}`,
        endpointModel: 'integration-chat-model-a',
        upstreamBaseUrl: upstreamA.baseUrl,
        credentialName,
      });
      const endpointBId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint B ${suffix}`,
        endpointModel: 'integration-chat-model-b',
        upstreamBaseUrl: upstreamB.baseUrl,
        credentialName,
      });

      const threadAId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread A message 1',
        null,
        'Thread A reply',
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(1);

      const threadBId = await createNewThreadInChat(page, locale, projectId);
      await selectEndpointInChat(page, endpointBId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread B message 1',
        threadBId,
        'Thread B reply',
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(1);

      const beforeA2 = upstreamA.getRequestCount();
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread A message 2',
        threadAId,
        'Thread A reply',
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(beforeA2 + 1);

      const beforeB2 = upstreamB.getRequestCount();
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread B message 2',
        threadBId,
        'Thread B reply',
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(beforeB2 + 1);
    } finally {
      await new Promise<void>((resolve) => upstreamA.server.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamB.server.close(() => resolve()));
    }
  });

  test('thread rename persists and deleted thread is removed cleanly', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstreamWith({ replyText: 'Thread lifecycle reply' });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);

      const threadAId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread A initial message',
        null,
        'Thread lifecycle reply',
      );
      const threadBId = await createNewThreadInChat(page, locale, projectId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread B initial message',
        threadBId,
        'Thread lifecycle reply',
      );

      const renamedTitle = `Renamed Thread ${Date.now()}`;
      await renameThreadInChat(page, threadAId, renamedTitle);
      await deleteThreadInChat(page, threadBId);

      await page.getByRole('link', { name: /overview|概览/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/overview`), {
        timeout: 30_000,
      });

      const beforeResume = upstream.getRequestCount();
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Thread A after lifecycle operations',
        threadAId,
        'Thread lifecycle reply',
      );
      const threadA = page.locator(`[data-testid="chat__thread-item"][data-thread-id="${threadAId}"]`).first();
      await expect(threadA.getByText(renamedTitle)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`[data-testid="chat__thread-item"][data-thread-id="${threadBId}"]`)).toHaveCount(0);
      expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(beforeResume + 1);
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('chat sends message with attachment ids when file is attached', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstreamWith({ replyText: 'Attachment reply' });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);

      await openChatAttachAndSend(page, locale, projectId, {
        text: 'Message with attached file',
        fileName: `integration-note-${Date.now()}.txt`,
        fileContent: 'integration attachment body',
        expectedReply: 'Attachment reply',
      });
      expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('chat surfaces upstream 429 message and can recover', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const throttledUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'never-used',
      statusCode: 429,
      errorCode: 'UPSTREAM_RATE_LIMIT',
      errorMessage: 'upstream rate limited for integration test',
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after 429',
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: 'integration-secret-key',
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: 'integration-chat-model-healthy',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const throttledEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Throttled ${suffix}`,
        endpointModel: 'integration-chat-model-throttled',
        upstreamBaseUrl: throttledUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after 429',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, throttledEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        'This request should hit 429',
        'upstream rate limited for integration test',
      );
      expect(throttledUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover after throttling',
        threadId,
        'Recovered after 429',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => throttledUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

});
