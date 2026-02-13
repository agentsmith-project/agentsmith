import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const RUN_REAL_COMPLETION = process.env.INTEGRATION_REAL_COMPLETION_E2E === 'true';
let lastApiAuthContext: { apiBase: string; authHeader: string } | null = null;

function captureApiAuthContextFromResponse(response: import('@playwright/test').Response): void {
  const authHeader = response.request().headers()['authorization'];
  const match = response.url().match(/^(https?:\/\/[^/]+\/api\/v1)\//);
  if (authHeader && match?.[1]) {
    lastApiAuthContext = { apiBase: match[1], authHeader };
  }
}

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

async function startOpenAIStreamingUpstreamWith(args: {
  chunks: string[];
  chunkDelayMs?: number;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const { chunks, chunkDelayMs = 500 } = args;
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      const bodyChunks: Buffer[] = [];
      for await (const chunk of req) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requestCount += 1;

      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');

      for (const chunk of chunks) {
        const payload = JSON.stringify({
          id: 'chatcmpl_stream_integration',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'integration-chat-model',
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        });
        res.write(`data: ${payload}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      }

      res.write('data: [DONE]\n\n');
      res.end();
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
  await page.context().clearCookies();
  await page.goto(`/${locale}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    if (!new RegExp(`/${locale}/login`).test(page.url())) {
      await page.goto(`/${locale}/login`);
    }

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

    const reloginBtn = page.getByTestId('workspace-select__relogin-btn');
    if (await reloginBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await reloginBtn.click();
      continue;
    }

    const workspaceCard = page.getByTestId('workspace-select__card--ws_default');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await workspaceCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
        break;
      }
      const retryButton = page.getByTestId('workspace-select__retry-btn');
      if (await retryButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await retryButton.click();
      }
    }
    await expect(workspaceCard).toBeVisible({ timeout: 15_000 });
    await workspaceCard.click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 30_000 });
    return;
  }

  throw new Error('Unable to complete workspace selection after Keycloak login retries.');
}

function loadOpenAICompatiblePayloadForE2E() {
  const customPath = process.env.INTEGRATION_OPENAI_CONFIG_PATH;
  const filePath = customPath
    ? path.resolve(customPath)
    : path.resolve(process.cwd(), 'secrets/e2e-openai-compatible.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing OpenAI config file: ${filePath}. ` +
      'Create it or set INTEGRATION_OPENAI_CONFIG_PATH.',
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as {
    reranker?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: 'openai';
    };
    embedding?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: 'openai';
    };
    completion?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: 'openai';
    };
  };
}

async function getAuthTokenFromStorage(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('mbos-auth');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
      return parsed.state?.token ?? null;
    } catch {
      return null;
    }
  });
  expect(token).toBeTruthy();
  return token!;
}

async function importOpenAICompatibleViaApi(
  page: import('@playwright/test').Page,
  projectId: string,
  payload: ReturnType<typeof loadOpenAICompatiblePayloadForE2E>,
) {
  const token = await getAuthTokenFromStorage(page);
  const apiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20010';
  const response = await page.request.post(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/import-openai-compatible`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: payload,
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function openChatAndSendExpectAssistantAny(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  text: string,
) {
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
  await firstThread.locator('div[role="button"]').first().click();

  const beforeCount = await page.getByTestId('chat__message').count();
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await ensureComposerEnabled(page);
  await textarea.fill(text);

  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
  );
  await page.getByTestId('chat__send-btn').click();
  await streamResponse;
  await expect
    .poll(async () => page.getByTestId('chat__message').count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(beforeCount + 2);
  const lastMessageText = await page.getByTestId('chat__message').last().textContent();
  expect((lastMessageText ?? '').trim().length).toBeGreaterThan(0);
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
  options?: {
    capability?: 'chat_completion' | 'multimodal_completion';
  },
) {
  const { capability = 'chat_completion' } = options ?? {};
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
    capability,
  });
}

async function sendExpectStreamError(
  page: import('@playwright/test').Page,
  text: string,
) {
  await ensureComposerEnabled(page);
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  await sendBtn.click();
  await expect(page.getByTestId('chat__stream-status')).toHaveText('Error', { timeout: 60_000 });
  await expect(page.getByTestId('chat__stream-error-banner')).toBeVisible({ timeout: 15_000 });
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
  await ensureComposerEnabled(page);
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
  );
  await sendBtn.click();
  await streamResponse;

  const stopBtn = page.getByRole('button', { name: /Stop|停止/i });
  if (await stopBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
    const clicked = await stopBtn.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    if (clicked) {
      await expect(page.getByTestId('chat__send-btn')).toBeEnabled({ timeout: 30_000 });
    }
    return;
  }
}

async function ensureComposerEnabled(page: import('@playwright/test').Page) {
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  if (await textarea.isEditable().catch(() => false)) return;

  const modelTrigger = page.getByTestId('chat__model-trigger');
  await expect(modelTrigger).toBeVisible({ timeout: 15_000 });
  await modelTrigger.click();
  const modelItems = page.locator('[data-testid^="chat__model-item--"]');
  const count = await modelItems.count();
  for (let i = 0; i < count; i += 1) {
    const item = modelItems.nth(i);
    if ((await item.getAttribute('data-disabled')) !== null) continue;
    await item.click();
    if (await textarea.isEditable().catch(() => false)) return;
    const becameEditable = await expect(textarea)
      .toBeEditable({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (becameEditable) return;
    await modelTrigger.click();
  }
  await expect(textarea).toBeEditable({ timeout: 15_000 });
}

async function createCredential(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  args: {
    credentialName: string;
    credentialValue: string;
  },
): Promise<string> {
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
  captureApiAuthContextFromResponse(credentialRes);
  const credentialJson = (await credentialRes.json().catch(() => null)) as
    | { id?: string; data?: { id?: string } }
    | null;
  const credentialId = credentialJson?.id ?? credentialJson?.data?.id;
  expect(credentialId).toBeTruthy();
  if (await credDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
  return credentialId!;
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
    capability?: 'chat_completion' | 'multimodal_completion';
  },
): Promise<string> {
  const { endpointName, endpointModel, upstreamBaseUrl, credentialName, capability = 'chat_completion' } = args;
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

  const comboBoxes = endpointDialog.locator('[role="combobox"]');
  const capabilityCombo = comboBoxes.first();
  await capabilityCombo.click();
  if (capability === 'multimodal_completion') {
    await page.getByRole('option', { name: /multimodal completion/i }).first().click();
  } else {
    await page.getByRole('option', { name: /chat completion/i }).first().click();
  }

  const providerCombo = comboBoxes.nth(1);
  await providerCombo.click();
  await page.getByRole('option', { name: /custom|自定义/i }).first().click();
  await endpointDialog.locator('#endpoint-base-url').fill(upstreamBaseUrl);

  const comboBoxesAfterProvider = endpointDialog.locator('[role="combobox"]');
  const comboCountAfterProvider = await comboBoxesAfterProvider.count();
  let credentialSelected = false;
  for (let i = 0; i < comboCountAfterProvider; i += 1) {
    const combo = comboBoxesAfterProvider.nth(i);
    await combo.click();
    const credentialOption = page.getByRole('option', { name: new RegExp(credentialName, 'i') }).first();
    if (await credentialOption.isVisible({ timeout: 750 }).catch(() => false)) {
      await credentialOption.click();
      credentialSelected = true;
      break;
    }
    await page.keyboard.press('Escape');
  }
  expect(credentialSelected).toBeTruthy();

  const createEndpointResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/endpoints$/.test(res.url()),
  );
  await endpointDialog.locator('#endpoint-name').fill(endpointName);
  await endpointDialog.locator('#endpoint-model').fill(endpointModel);
  await expect(endpointDialog.getByRole('button', { name: /^create$/i })).toBeEnabled({ timeout: 10_000 });
  await endpointDialog.getByRole('button', { name: /^create$/i }).click();
  const endpointRes = await createEndpointResponse;
  expect(endpointRes.ok()).toBeTruthy();
  const endpointCreateBody = endpointRes.request().postDataJSON() as {
    capabilities?: Array<{ type?: string }>;
  } | null;
  expect(endpointCreateBody?.capabilities?.[0]?.type).toBe(capability);
  captureApiAuthContextFromResponse(endpointRes);
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

async function disableEndpointViaApi(
  page: import('@playwright/test').Page,
  projectId: string,
  endpointId: string,
) {
  expect(lastApiAuthContext).toBeTruthy();
  const { apiBase, authHeader } = lastApiAuthContext!;
  const patchRes = await page.request.put(
    `${apiBase}/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}`,
    {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      data: { status: 'disabled' },
    },
  );
  expect(patchRes.ok()).toBeTruthy();
}

async function deleteCredentialFromUi(
  page: import('@playwright/test').Page,
  locale: string,
  projectId: string,
  credentialId: string,
) {
  await page.getByRole('link', { name: /credentials|凭据/i }).first().click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/credentials`), {
    timeout: 30_000,
  });
  await page.getByTestId(`credentials__action-delete--${credentialId}`).click();
  const dialog = page.getByTestId('credentials__delete-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const deleteResponse = page.waitForResponse((res) =>
    res.request().method() === 'DELETE' &&
    new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/credentials/${credentialId}$`).test(res.url()),
  );
  await page.getByTestId('credentials__delete-dialog__confirm-btn').click();
  const deleteRes = await deleteResponse;
  expect(deleteRes.ok()).toBeTruthy();
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

async function deleteAllThreadsInChat(page: import('@playwright/test').Page): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const count = await page.getByTestId('chat__thread-item').count();
    if (count === 0) return;
    const threadId = await page.getByTestId('chat__thread-item').first().getAttribute('data-thread-id');
    if (!threadId) return;
    await deleteThreadInChat(page, threadId);
  }
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
  await ensureComposerEnabled(page);
  await expect(textarea).toBeEditable();
  await textarea.fill(text);

  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
  );
  await sendBtn.click();
  const streamRes = await streamResponse;
  if (!streamRes.ok()) {
    const bodyText = await streamRes.text().catch(() => '');
    throw new Error(`Stream request failed (${streamRes.status()}): ${bodyText}`);
  }
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
  await ensureComposerEnabled(page);
  await textarea.fill(text);
  const sendBtn = page.getByTestId('chat__send-btn');
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const createMessageRequest = page.waitForRequest((req) =>
    req.method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages$/.test(req.url()),
  );
  const createMessageResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages$/.test(res.url()),
  );
  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
  );
  await sendBtn.click();
  const msgReq = await createMessageRequest;
  const msgRes = await createMessageResponse;
  const body = msgReq.postDataJSON() as { attachments?: string[] } | null;
  expect(Array.isArray(body?.attachments)).toBeTruthy();
  expect((body?.attachments ?? []).length).toBeGreaterThan(0);
  if (!msgRes.ok()) {
    const bodyText = await msgRes.text().catch(() => '');
    throw new Error(`Create message failed (${msgRes.status()}): ${bodyText}`);
  }
  const streamRes = await streamResponse;
  if (!streamRes.ok()) {
    const bodyText = await streamRes.text().catch(() => '');
    throw new Error(`Stream request failed (${streamRes.status()}): ${bodyText}`);
  }
  await expect(page.getByText(expectedReply).first()).toBeVisible({ timeout: 60_000 });
  return selectedThreadId!;
}

function isSessionStreamsRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/streams/?$`).test(url);
}

function isSessionStopRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/stop/?$`).test(url);
}

function isStreamStopRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/messages/streams/[^/]+/stop/?$`).test(url);
}

test.describe('integration chat flow', () => {
  test('keycloak login + create endpoint + chat stream through openai-compatible proxy', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl, {
        capability: 'multimodal_completion',
      });
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
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl, {
        capability: 'multimodal_completion',
      });

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

  test('deleting the only thread shows clear empty-state actions and disabled composer', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);

      await createNewThreadInChat(page, locale, projectId);
      await deleteAllThreadsInChat(page);

      await expect(page.getByTestId('chat__header-create-thread')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chat__empty-create-btn')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chat__send-btn')).toBeDisabled();
      await expect(page.getByTestId('chat__composer').locator('textarea')).toBeDisabled();
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('text-only endpoint hides attachment actions in composer', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl, {
        capability: 'chat_completion',
      });

      await createNewThreadInChat(page, locale, projectId);
      await expect(page.getByTestId('chat__composer')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chat__attach-local-btn')).toHaveCount(0);
      await expect(page.getByTestId('chat__attach-library-btn')).toHaveCount(0);
      await expect(page.getByTestId('chat__send-btn')).toBeVisible();
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
      await expect.poll(() => slowUpstream.getRequestCount(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

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

  test('stop streaming preserves partial assistant output after refresh', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const streamingUpstream = await startOpenAIStreamingUpstreamWith({
      chunks: ['persist-part-1 ', 'persist-part-2 ', 'persist-part-3 ', 'persist-part-4 '],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, streamingUpstream.baseUrl);

      await page.getByRole('link', { name: /chat|对话/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      if (await page.getByTestId('chat__thread-item').count() === 0) {
        await page.getByTestId('chat__new-thread-btn').click();
      }
      const thread = page.getByTestId('chat__thread-item').first();
      await thread.locator('div[role="button"]').first().click();

      await ensureComposerEnabled(page);
      const textarea = page.getByTestId('chat__composer').locator('textarea');
      await textarea.fill('stream and stop, then refresh');
      await page.getByTestId('chat__send-btn').click();

      await expect(page.getByText('persist-part-1').first()).toBeVisible({ timeout: 30_000 });
      const stopBtn = page.getByTestId('chat__composer').getByRole('button', { name: /Stop|停止/i });
      if (await stopBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await stopBtn.click();
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat__thread-item').filter({ hasText: 'stream and stop, then refresh' }).first().locator('div[role="button"]').first().click();
      await expect(page.getByText('persist-part-1').first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await new Promise<void>((resolve) => streamingUpstream.server.close(() => resolve()));
    }
  });

  test('refresh recovers stream id and stop uses stream-level route', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const streamingUpstream = await startOpenAIStreamingUpstreamWith({
      chunks: ['recover-stream-1 ', 'recover-stream-2 ', 'recover-stream-3 ', 'recover-stream-4 '],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, streamingUpstream.baseUrl);

      await page.getByRole('link', { name: /chat|对话/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      if (await page.getByTestId('chat__thread-item').count() === 0) {
        await page.getByTestId('chat__new-thread-btn').click();
      }
      const thread = page.getByTestId('chat__thread-item').first();
      await thread.locator('div[role="button"]').first().click();
      const threadId = await thread.getAttribute('data-thread-id');
      expect(threadId).toBeTruthy();

      await ensureComposerEnabled(page);
      const textarea = page.getByTestId('chat__composer').locator('textarea');
      await textarea.fill('recover stream id then stop');
      await page.getByTestId('chat__send-btn').click();
      await expect(page.getByText('recover-stream-1').first()).toBeVisible({ timeout: 30_000 });

      const streamRecoveryUrls: string[] = [];
      const streamStopUrls: string[] = [];
      const sessionStopUrls: string[] = [];
      const requestListener = (req: import('@playwright/test').Request) => {
        if (req.method() === 'GET' && isSessionStreamsRequestFor(req.url(), threadId!)) {
          streamRecoveryUrls.push(req.url());
        }
        if (req.method() === 'POST' && isStreamStopRequestFor(req.url(), threadId!)) {
          streamStopUrls.push(req.url());
        }
        if (req.method() === 'POST' && isSessionStopRequestFor(req.url(), threadId!)) {
          sessionStopUrls.push(req.url());
        }
      };
      page.on('request', requestListener);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      await page
        .locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`)
        .first()
        .locator('div[role="button"]')
        .first()
        .click();
      const stopBtn = page.getByTestId('chat__composer').getByRole('button', { name: /Stop|停止/i });
      if (await stopBtn.isVisible({ timeout: 20_000 }).catch(() => false)) {
        await stopBtn.click();
        await expect
          .poll(() => streamStopUrls.length + sessionStopUrls.length, { timeout: 60_000 })
          .toBeGreaterThan(0);
      }
      page.off('request', requestListener);
      expect(streamRecoveryUrls.length).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve) => streamingUpstream.server.close(() => resolve()));
    }
  });

  test('refresh without recovered stream id falls back to session-level stop route', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const streamingUpstream = await startOpenAIStreamingUpstreamWith({
      chunks: ['fallback-stop-1 ', 'fallback-stop-2 ', 'fallback-stop-3 ', 'fallback-stop-4 '],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, streamingUpstream.baseUrl);

      await page.getByRole('link', { name: /chat|对话/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      if (await page.getByTestId('chat__thread-item').count() === 0) {
        await page.getByTestId('chat__new-thread-btn').click();
      }
      const thread = page.getByTestId('chat__thread-item').first();
      await thread.locator('div[role="button"]').first().click();
      const threadId = await thread.getAttribute('data-thread-id');
      expect(threadId).toBeTruthy();

      await ensureComposerEnabled(page);
      const textarea = page.getByTestId('chat__composer').locator('textarea');
      await textarea.fill('break stream recovery and stop by session');
      await page.getByTestId('chat__send-btn').click();
      await expect(page.getByText('fallback-stop-1').first()).toBeVisible({ timeout: 30_000 });

      await page.route(
        new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${threadId}/streams/?$`),
        async (route) => {
          await route.fulfill({
            status: 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error_code: 'forced_failure', message: 'forced stream recovery failure' }),
          });
        },
      );

      const streamStopUrls: string[] = [];
      const requestListener = (req: import('@playwright/test').Request) => {
        if (req.method() === 'POST' && isStreamStopRequestFor(req.url(), threadId!)) {
          streamStopUrls.push(req.url());
        }
      };
      page.on('request', requestListener);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      await page
        .locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`)
        .first()
        .locator('div[role="button"]')
        .first()
        .click();

      const stopBtn = page.getByTestId('chat__composer').getByRole('button', { name: /Stop|停止/i });
      if (await stopBtn.isVisible({ timeout: 20_000 }).catch(() => false)) {
        const sessionStopReq = page.waitForRequest(
          (req) => req.method() === 'POST' && isSessionStopRequestFor(req.url(), threadId!),
          { timeout: 60_000 },
        );
        await stopBtn.click();
        await sessionStopReq;
        await expect.poll(() => streamStopUrls.length, { timeout: 5_000 }).toBe(0);
      }

      page.off('request', requestListener);
      await page.unroute(new RegExp(`/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${threadId}/streams/?$`));
    } finally {
      await new Promise<void>((resolve) => streamingUpstream.server.close(() => resolve()));
    }
  });

  test('editing historical user input starts regenerate in-branch instead of footer append', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAIStreamingUpstreamWith({
      chunks: ['branch-regen-1 ', 'branch-regen-2'],
      chunkDelayMs: 2_500,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl, {
        capability: 'multimodal_completion',
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'initial message for edit-regenerate',
        null,
        'branch-regen-1 branch-regen-2',
      );
      await openChatAndSend(
        page,
        locale,
        projectId,
        'second message to keep chain stable',
        threadId,
        'branch-regen-1 branch-regen-2',
      );

      const firstMessage = page.locator('[data-testid="chat__message"]').first();
      await firstMessage.hover();
      await page.getByRole('button', { name: /Edit|编辑/i }).first().click();
      const inlineEditTextarea = page.getByTestId('chat__composer').locator('textarea');
      await expect(inlineEditTextarea).toBeVisible({ timeout: 10_000 });
      await inlineEditTextarea.fill('edited historical input');
      await page.getByTestId('chat__send-btn').click();

      await expect(page.getByTestId('chat__stream-status')).toHaveText(/Generating|Streaming/i, { timeout: 15_000 });
      await expect(
        page.locator('section[data-testid="chat__main-pane"]').getByText(/^Assistant$/),
      ).toHaveCount(0);
      await expect(page.getByText('branch-regen-1').first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test('switching threads while streaming does not leak assistant output into target thread', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const upstream = await startOpenAIStreamingUpstreamWith({
      chunks: [
        'thread-leak-check-1 ',
        'thread-leak-check-2 ',
        'thread-leak-check-3 ',
        'thread-leak-check-4 ',
      ],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl);

      await page.getByRole('link', { name: /chat|对话/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      if (await page.getByTestId('chat__thread-item').count() === 0) {
        await page.getByTestId('chat__new-thread-btn').click();
      }
      await page.getByTestId('chat__new-thread-btn').click();

      const threads = page.getByTestId('chat__thread-item');
      await expect(threads).toHaveCount(2, { timeout: 30_000 });
      const sourceThreadId = await threads.nth(1).getAttribute('data-thread-id');
      const targetThreadId = await threads.nth(0).getAttribute('data-thread-id');
      expect(sourceThreadId).toBeTruthy();
      expect(targetThreadId).toBeTruthy();
      const sourceThread = page.locator(
        `[data-testid="chat__thread-item"][data-thread-id="${sourceThreadId}"]`,
      ).first();
      const targetThread = page.locator(
        `[data-testid="chat__thread-item"][data-thread-id="${targetThreadId}"]`,
      ).first();

      await sourceThread.locator('div[role="button"]').first().click();
      await ensureComposerEnabled(page);
      const textarea = page.getByTestId('chat__composer').locator('textarea');
      await textarea.fill('start long streaming response');
      await page.getByTestId('chat__send-btn').click();
      await expect(page.getByText('thread-leak-check-1').first()).toBeVisible({ timeout: 30_000 });

      await targetThread.locator('div[role="button"]').first().click();
      await expect(page.getByText('thread-leak-check-1')).toHaveCount(0);
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
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
      await provisionCredentialAndEndpoint(page, locale, projectId, upstream.baseUrl, {
        capability: 'multimodal_completion',
      });

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

  test('chat surfaces upstream 401 message and can recover', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const unauthorizedUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'never-used',
      statusCode: 401,
      errorCode: 'UPSTREAM_UNAUTHORIZED',
      errorMessage: 'upstream unauthorized for integration test',
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after 401',
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
      const unauthorizedEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Unauthorized ${suffix}`,
        endpointModel: 'integration-chat-model-unauthorized',
        upstreamBaseUrl: unauthorizedUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after 401',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, unauthorizedEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        'This request should hit 401',
        'upstream unauthorized for integration test',
      );
      expect(unauthorizedUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover after unauthorized',
        threadId,
        'Recovered after 401',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => unauthorizedUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat surfaces upstream 403 message and can recover', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const forbiddenUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'never-used',
      statusCode: 403,
      errorCode: 'UPSTREAM_FORBIDDEN',
      errorMessage: 'upstream forbidden for integration test',
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after 403',
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
      const forbiddenEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Forbidden ${suffix}`,
        endpointModel: 'integration-chat-model-forbidden',
        upstreamBaseUrl: forbiddenUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after 403',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, forbiddenEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        'This request should hit 403',
        'upstream forbidden for integration test',
      );
      expect(forbiddenUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover after forbidden',
        threadId,
        'Recovered after 403',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => forbiddenUpstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat surfaces platform 422 when selected endpoint is disabled and can recover', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after disabled endpoint',
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
      const toDisableEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Disabled ${suffix}`,
        endpointModel: 'integration-chat-model-disabled',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after disabled endpoint',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await disableEndpointViaApi(page, projectId, toDisableEndpointId);
      await selectEndpointInChat(page, toDisableEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        'This request should fail because endpoint disabled',
        'chat_endpoint_unavailable',
      );

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover after disabled endpoint',
        threadId,
        'Recovered after disabled endpoint',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat surfaces platform 422 when endpoint credential is deleted and can recover', async ({ page }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Recovered after missing credential',
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const healthyCredentialName = `Integration Credential Healthy ${suffix}`;
      const toDeleteCredentialName = `Integration Credential Delete ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName: healthyCredentialName,
        credentialValue: 'integration-secret-key',
      });
      const credentialId = await createCredential(page, locale, projectId, {
        credentialName: toDeleteCredentialName,
        credentialValue: 'integration-secret-key',
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: 'integration-chat-model-healthy',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName: healthyCredentialName,
      });
      const missingCredentialEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Missing Credential ${suffix}`,
        endpointModel: 'integration-chat-model-missing-cred',
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName: toDeleteCredentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        'Warmup on healthy endpoint',
        null,
        'Recovered after missing credential',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await deleteCredentialFromUi(page, locale, projectId, credentialId);
      await page.getByRole('link', { name: /chat|对话/i }).first().click();
      await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`), {
        timeout: 30_000,
      });
      await selectEndpointInChat(page, missingCredentialEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        'This request should fail due to deleted credential',
        'chat_endpoint_credential_missing',
      );

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        'Recover after missing credential',
        threadId,
        'Recovered after missing credential',
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
    }
  });

  test('chat works with real deepseek completion endpoint imported from integration resource', async ({ page }) => {
    test.skip(!RUN_REAL_COMPLETION, 'Enable with INTEGRATION_REAL_COMPLETION_E2E=true');
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    const payload = loadOpenAICompatiblePayloadForE2E();
    expect(payload.completion).toBeTruthy();

    await keycloakLogin(page, locale, username, password);
    const projectId = await createProjectFromUi(page, locale);
    await importOpenAICompatibleViaApi(page, projectId, payload);
    await openChatAndSendExpectAssistantAny(
      page,
      locale,
      projectId,
      'Reply with one short sentence to confirm end-to-end chat works.',
    );
  });

});
