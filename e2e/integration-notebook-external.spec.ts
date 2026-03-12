import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { test, expect, type Page } from '@playwright/test';

async function keycloakLogin(page: Page, locale: string, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto(`/${locale}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

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

  const workspaceCard = page.getByTestId('workspace-select__card--ws_default');
  await expect(workspaceCard).toBeVisible({ timeout: 15_000 });
  await workspaceCard.click();
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 30_000 });
}

async function ensureProject(page: Page, locale: string): Promise<string> {
  const cards = page.getByTestId('projects__card');
  let hasCard = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await cards.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      hasCard = true;
      break;
    }
  }

  if (hasCard) {
    await cards.first().click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 });
    const match = page.url().match(/\/projects\/([^/]+)\//);
    if (!match?.[1]) throw new Error('project_id_not_found');
    return match[1];
  }

  const projectName = `it-notebook-${Date.now()}`;
  const createButton = page.getByTestId('projects__create-btn');
  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click();
  } else {
    await page.getByRole('button', { name: /New Project|Create|创建|新建项目/i }).first().click();
  }
  await page.locator('#project-name').fill(projectName);
  await Promise.all([
    page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 }),
    page.getByRole('button', { name: /Create|创建/i }).click(),
  ]);
  const match = page.url().match(/\/projects\/([^/]+)\//);
  if (!match?.[1]) throw new Error('project_id_not_found_after_create');
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

function startMockOpenAIUpstream(): {
  server: Server;
  baseUrl: string;
  stop: () => Promise<void>;
} {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl_proxy_it',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-5-codex',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'upstream-proxy-ok' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(0);
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

type ExecutionWsMessage = {
  type?: string;
  request_id?: string;
  payload?: {
    resource_proxy?: {
      base_url?: string;
    };
    execution_context?: {
      user_bearer_token?: string;
      task_id?: string;
      run_id?: string;
      endpoint_id?: string;
    };
  };
};

test.describe('@lane-real integration notebook external execution service', () => {
  test('task message streams through execution->endpoint proxy chain', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);
    const upstream = startMockOpenAIUpstream();

    let ws: WebSocket | null = null;
    try {
      const createCredentialRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { name: `it-proxy-key-${Date.now()}`, type: 'api_key', value: 'sk-it-notebook' },
        },
      );
      expect(createCredentialRes.ok()).toBeTruthy();
      const credential = (await createCredentialRes.json()) as { id: string };

      const createEndpointRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: {
            name: `it-proxy-endpoint-${Date.now()}`,
            model: 'gpt-5-codex',
            type: 'openai',
            mode: 'openai',
            base_url: upstream.baseUrl,
            credential_ref: credential.id,
          },
        },
      );
      expect(createEndpointRes.ok()).toBeTruthy();
      const endpoint = (await createEndpointRes.json()) as { id: string };

      const createAgentRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: {
            name: `it-notebook-external-${Date.now()}`,
            mode: 'external',
            interaction_mode: 'notebook',
            execution_preferences: {
              notebook: {
                endpoint_id: endpoint.id,
                wire_api: 'chat',
                model: 'gpt-5-codex',
              },
            },
            capabilities: { streaming_completion: true, multimodal_completion: false },
          },
        },
      );
      expect(createAgentRes.ok()).toBeTruthy();
      const agent = (await createAgentRes.json()) as { id: string };

      const createKeyRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents/${agent.id}/keys`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: {},
        },
      );
      expect(createKeyRes.ok()).toBeTruthy();
      const keyPayload = (await createKeyRes.json()) as { key: string };

      const connInfoRes = await page.request.get(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents/${agent.id}/connection-info`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(connInfoRes.ok()).toBeTruthy();
      const connInfo = (await connInfoRes.json()) as { ws_url: string };
      const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', apiBase.replace('http://', 'ws://'));

      const executionSeen = new Promise<{
        endpointProxyBase: string;
        userToken: string;
        taskId: string;
        runId: string;
      }>((resolve, reject) => {
        let helloProxyBase = '';
        ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${keyPayload.key}` } });
        ws.once('error', reject);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf-8')) as ExecutionWsMessage;
          if (msg.type === 'server.hello') {
            helloProxyBase = msg.payload?.resource_proxy?.base_url ?? '';
            return;
          }
          if (msg.type !== 'server.request.start' || !msg.request_id) return;
          const executionContext = msg.payload?.execution_context ?? {};
          const endpointProxyBase = helloProxyBase;
          const userToken = executionContext.user_bearer_token ?? '';
          const taskId = executionContext.task_id ?? '';
          const runId = executionContext.run_id ?? '';
          resolve({ endpointProxyBase, userToken, taskId, runId });

          void (async () => {
            try {
              const upstreamViaProxy = await fetch(`${endpointProxyBase}/chat/completions`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${userToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-5-codex',
                  messages: [{ role: 'user', content: 'integration proxy hop' }],
                }),
              });
              if (!upstreamViaProxy.ok) {
                const errorText = await upstreamViaProxy.text();
                ws?.send(JSON.stringify({
                  type: 'agent.response.error',
                  request_id: msg.request_id,
                  timestamp: new Date().toISOString(),
                  payload: { error_code: 'AGENT_UPSTREAM_ERROR', error_message: errorText || 'proxy_call_failed' },
                }));
                return;
              }
              const completion = (await upstreamViaProxy.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              const content = completion.choices?.[0]?.message?.content ?? 'proxy-empty';
              ws?.send(JSON.stringify({
                type: 'agent.response.delta',
                request_id: msg.request_id,
                timestamp: new Date().toISOString(),
                payload: { delta: content },
              }));
              ws?.send(JSON.stringify({
                type: 'agent.response.done',
                request_id: msg.request_id,
                timestamp: new Date().toISOString(),
                payload: { finish_reason: 'stop', usage_tokens: content.length },
              }));
            } catch (error) {
              ws?.send(JSON.stringify({
                type: 'agent.response.error',
                request_id: msg.request_id,
                timestamp: new Date().toISOString(),
                payload: {
                  error_code: 'AGENT_UPSTREAM_ERROR',
                  error_message: error instanceof Error ? error.message : 'proxy_call_failed',
                },
              }));
            }
          })();
        });
      });

      const createTaskRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { title: `it-notebook-task-${Date.now()}`, agent_id: agent.id },
        },
      );
      expect(createTaskRes.ok()).toBeTruthy();
      const task = (await createTaskRes.json()) as { id: string };

      const postMessageRes = await page.request.post(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/messages`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { role: 'user', content: 'run notebook task' },
        },
      );
      expect(postMessageRes.ok()).toBeTruthy();

      const execution = await executionSeen;
      expect(execution.taskId).toBe(task.id);
      expect(execution.runId.length).toBeGreaterThan(0);
      expect(execution.endpointProxyBase).toBe(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/proxy`,
      );
      expect(execution.userToken.length).toBeGreaterThan(0);

      await expect
        .poll(async () => {
          const messagesRes = await page.request.get(
            `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/messages`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!messagesRes.ok()) return '';
          const messages = (await messagesRes.json()) as Array<{ role?: string; content?: string }>;
          const assistant = [...messages].reverse().find((item) => item.role === 'agent');
          return assistant?.content ?? '';
        }, { timeout: 30_000 })
        .toContain('upstream-proxy-ok');
    } finally {
      ws?.close();
      await upstream.stop();
    }
  });
});
