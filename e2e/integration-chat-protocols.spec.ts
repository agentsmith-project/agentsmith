import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';

type UpstreamServer = {
  server: Server;
  baseUrl: string;
  stop: () => Promise<void>;
};

async function keycloakLogin(page: Page, locale: string, username: string, password: string): Promise<void> {
  await page.context().clearCookies();
  const clearLocalState = async () => {
    await page.goto(`/${locale}/login`);
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
    });
  };
  await clearLocalState();

  for (let cycle = 0; cycle < 3; cycle += 1) {
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
    await page.locator('#kc-login, button[type="submit"]').first().click();

    let reachedWorkspace = false;
    let callbackError = false;
    for (let tick = 0; tick < 120; tick += 1) {
      const currentUrl = page.url();
      if (new RegExp(`/${locale}/login/workspace`).test(currentUrl)) {
        reachedWorkspace = true;
        break;
      }
      if (new RegExp(`/${locale}/login/callback`).test(currentUrl)) {
        const callbackErrorNode = page.getByTestId('login-callback__error');
        if (await callbackErrorNode.isVisible({ timeout: 300 }).catch(() => false)) {
          callbackError = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    if (callbackError && cycle < 2) {
      const backToLogin = page.getByRole('button', { name: /back to login|返回登录页/i });
      if (await backToLogin.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await backToLogin.click();
      }
      await clearLocalState();
      continue;
    }

    if (!reachedWorkspace) {
      throw new Error('Keycloak login did not reach workspace selector');
    }

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

async function createProjectFromUi(page: Page, locale: string): Promise<string> {
  const projectName = `it-chat-protocols-${Date.now()}`;
  const createButton = page.getByTestId('projects__create-btn');
  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click();
  } else {
    await page.getByRole('button', { name: /new project|create|创建|新建项目/i }).first().click();
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('#project-name').fill(projectName);
  await dialog.locator('#project-description').fill('Integration chat protocol project');
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 }),
    dialog.getByRole('button', { name: /create|创建/i }).click(),
  ]);
  const match = page.url().match(/\/projects\/([^/]+)\//);
  if (!match?.[1]) throw new Error('project_id_not_found');
  return match[1];
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('agentsmith-auth');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
      return parsed.state?.token ?? null;
    } catch {
      return null;
    }
  });
  if (!token) throw new Error('auth_token_not_found');
  return token;
}

async function createCredentialViaApi(page: Page, apiBase: string, projectId: string, token: string): Promise<string> {
  const response = await page.request.post(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: `it-chat-key-${Date.now()}`, type: 'api_key', value: 'sk-chat-it' },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('credential_id_missing');
  return body.id;
}

async function createEndpointViaApi(
  page: Page,
  apiBase: string,
  projectId: string,
  token: string,
  args: {
    name: string;
    model: string;
    baseUrl: string;
    credentialRef: string;
    protocol: 'openai_compatible' | 'anthropic_compatible';
  },
): Promise<string> {
  const providerFamily = args.protocol === 'anthropic_compatible' ? 'anthropic' : 'openai';
  const response = await page.request.post(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: args.name,
        model: args.model,
        type: providerFamily,
        base_url: args.baseUrl,
        credential_ref: args.credentialRef,
        provider_family: providerFamily,
        protocol: args.protocol,
        capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: args.model }],
        models: [{ capability: 'chat_completion', model_id: args.model, display_name: args.model }],
        defaults: { chat_model_id: args.model },
        meta: {
          compatibility_interface: args.protocol,
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('endpoint_id_missing');
  return body.id;
}

async function ensureChatAndThread(page: Page, locale: string, projectId: string): Promise<void> {
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
}

async function selectEndpoint(page: Page, endpointId: string): Promise<void> {
  const updateSessionResponse = page.waitForResponse((res) =>
    res.request().method() === 'PATCH' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+$/.test(res.url()) &&
    res.status() === 200,
  );
  await page.getByTestId('chat__model-trigger').click();
  await page.getByTestId(`chat__model-item--${endpointId}`).click();
  const response = await updateSessionResponse;
  const body = (await response.json().catch(() => null)) as { endpoint_id?: string } | null;
  expect(body?.endpoint_id).toBe(endpointId);
}

async function sendMessageAndExpectReply(page: Page, message: string, expectedReply: string): Promise<void> {
  const composer = page.getByTestId('chat__composer');
  const textarea = composer.locator('textarea');
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  await expect(textarea).toBeEditable({ timeout: 30_000 });
  await textarea.fill(message);

  const streamResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' &&
    /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
  );
  await page.getByTestId('chat__send-btn').click();
  const response = await streamResponse;
  if (!response.ok()) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`chat_stream_failed(${response.status()}): ${bodyText}`);
  }
  await expect(page.getByText(expectedReply).first()).toBeVisible({ timeout: 60_000 });
}

async function startOpenAiCompatibleStreamingUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      const payload = JSON.stringify({
        id: 'chatcmpl_it',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'glm-5',
        choices: [{ index: 0, delta: { content: replyText }, finish_reason: 'stop' }],
      });
      res.write(`data: ${payload}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startAnthropicCompatibleStreamingUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');

      res.write(`data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_it' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('@lane-real integration chat endpoint protocols', () => {
  test('chat streams successfully with openai-compatible endpoint', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';
    const upstream = await startOpenAiCompatibleStreamingUpstream('openai-compatible-ok');

    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const token = await getAuthToken(page);
      const credentialId = await createCredentialViaApi(page, apiBase, projectId, token);
      const endpointId = await createEndpointViaApi(page, apiBase, projectId, token, {
        name: `it-openai-endpoint-${Date.now()}`,
        model: 'glm-5',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        protocol: 'openai_compatible',
      });
      await ensureChatAndThread(page, locale, projectId);
      await selectEndpoint(page, endpointId);
      await sendMessageAndExpectReply(page, 'ping openai compat', 'openai-compatible-ok');
    } finally {
      await upstream.stop();
    }
  });

  test('chat streams successfully with anthropic-compatible endpoint', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';
    const upstream = await startAnthropicCompatibleStreamingUpstream('anthropic-compatible-ok');

    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const token = await getAuthToken(page);
      const credentialId = await createCredentialViaApi(page, apiBase, projectId, token);
      const endpointId = await createEndpointViaApi(page, apiBase, projectId, token, {
        name: `it-anthropic-endpoint-${Date.now()}`,
        model: 'glm-5',
        baseUrl: `${upstream.baseUrl}/v1`,
        credentialRef: credentialId,
        protocol: 'anthropic_compatible',
      });
      await ensureChatAndThread(page, locale, projectId);
      await selectEndpoint(page, endpointId);
      await sendMessageAndExpectReply(page, 'ping anthropic compat', 'anthropic-compatible-ok');
    } finally {
      await upstream.stop();
    }
  });
});
