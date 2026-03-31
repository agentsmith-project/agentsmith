import { execFileSync } from 'node:child_process';
import http, { type Server } from 'node:http';
import { WebSocket } from 'ws';
import { test, expect, type Page } from '@playwright/test';

async function issuePasswordGrantToken(page: Page, username: string, password: string): Promise<string> {
  const keycloakBase = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
  const response = await page.request.post(`${keycloakBase}/realms/mbos/protocol/openid-connect/token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      grant_type: 'password',
      client_id: 'agentsmith',
      username,
      password,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error('access_token_missing');
  }
  return body.access_token;
}

async function keycloakLogin(page: Page, locale: string, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto(`/${locale}/workspaces/ws_default/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('workspace-login__keycloak-btn').click();
  const keycloakError = page.getByTestId('workspace-login__keycloak-error');
  if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
    throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
  }

  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });

  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await page.locator('#kc-login, button[type="submit"]').first().click();
  await expect
    .poll(() => page.url(), { timeout: 60_000 })
    .toMatch(new RegExp(`/${locale}/workspaces/ws_default(?:$|/projects)`));
  if (!new RegExp(`/${locale}/workspaces/ws_default/projects`).test(page.url())) {
    await page.goto(`/${locale}/workspaces/ws_default/projects`);
  }
  await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects(?:$|/)`), { timeout: 30_000 });
}

async function createProjectViaApi(
  page: Page,
  locale: string,
  apiBase: string,
  token: string,
): Promise<string> {
  const projectName = `it-notebook-${Date.now()}`;
  let lastErrorText = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${apiBase}/api/v1/workspaces/ws_default/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        description: 'Notebook external execution ticket backend-real project',
      }),
    });
    if (response.ok) {
      const project = (await response.json()) as { id?: string };
      expect(project.id).toBeTruthy();
      await page.goto(`/${locale}/workspaces/ws_default/projects/${project.id}/overview`);
      return project.id!;
    }
    lastErrorText = await response.text().catch(() => '');
    const retryableConnectionReset = response.status === 400 && lastErrorText.includes('read ECONNRESET');
    if (!retryableConnectionReset || attempt === 2) {
      throw new Error(`create_project_failed:${response.status}:${lastErrorText}`);
    }
    await page.waitForTimeout(1_000 * (attempt + 1));
  }
  throw new Error(`create_project_failed:unknown:${lastErrorText}`);
}

async function postJsonWithBearer<T>(args: {
  url: string;
  token: string;
  body: unknown;
  errorPrefix: string;
}): Promise<T> {
  const response = await fetch(args.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });
  if (!response.ok) {
    throw new Error(`${args.errorPrefix}:${response.status}:${await response.text().catch(() => '')}`);
  }
  return response.json() as Promise<T>;
}

async function getJsonWithBearer<T>(args: {
  url: string;
  token: string;
  errorPrefix: string;
}): Promise<T> {
  const response = await fetch(args.url, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!response.ok) {
    throw new Error(`${args.errorPrefix}:${response.status}:${await response.text().catch(() => '')}`);
  }
  return response.json() as Promise<T>;
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

  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_notebook_mock_upstream_port:${raw}`);
  }
  server.listen(port, '127.0.0.1');
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/v1`,
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
      execution_ticket?: string;
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
    const token = await issuePasswordGrantToken(page, username, password);
    await page.goto(`/${locale}/workspaces/ws_default/projects`);
    const projectId = await createProjectViaApi(page, locale, apiBase, token);
    const upstream = startMockOpenAIUpstream();

    let ws: WebSocket | null = null;
    try {
      const credential = await postJsonWithBearer<{ id: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
        token,
        body: { name: `it-proxy-key-${Date.now()}`, type: 'api_key', value: 'sk-it-notebook' },
        errorPrefix: 'create_credential_failed',
      });

      const endpoint = await postJsonWithBearer<{ id: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
        token,
        body: {
          name: `it-proxy-endpoint-${Date.now()}`,
          model: 'gpt-5-codex',
          type: 'custom',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'custom',
          model_profile: {
            max_context_tokens: 128000,
            max_output_tokens: 8192,
            supports_file: false,
            supports_tool_call: true,
            supports_reasoning: false,
            price_input_per_1m: 0,
            price_output_per_1m: 0,
            cache_read_discount_ratio: 0,
            cache_write_discount_ratio: 0,
          },
        },
        errorPrefix: 'create_endpoint_failed',
      });

      const agent = await postJsonWithBearer<{ id: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents`,
        token,
        body: {
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
        errorPrefix: 'create_agent_failed',
      });

      const keyPayload = await postJsonWithBearer<{ key: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents/${agent.id}/keys`,
        token,
        body: {},
        errorPrefix: 'create_agent_key_failed',
      });

      const connInfo = await getJsonWithBearer<{ ws_url: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/agents/${agent.id}/connection-info`,
        token,
        errorPrefix: 'agent_connection_info_failed',
      });
      const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', apiBase.replace('http://', 'ws://'));

      let resolveHelloSeen: (() => void) | null = null;
      const helloSeen = new Promise<void>((resolve) => {
        resolveHelloSeen = resolve;
      });
      const executionSeen = new Promise<{
        endpointProxyBase: string;
        executionTicket: string;
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
            resolveHelloSeen?.();
            resolveHelloSeen = null;
            return;
          }
          if (msg.type !== 'server.request.start' || !msg.request_id) return;
          const executionContext = msg.payload?.execution_context ?? {};
          const endpointProxyBase = helloProxyBase;
          const executionTicket = executionContext.execution_ticket ?? '';
          const taskId = executionContext.task_id ?? '';
          const runId = executionContext.run_id ?? '';
          expect('user_bearer_token' in executionContext).toBe(false);
          resolve({ endpointProxyBase, executionTicket, taskId, runId });

          void (async () => {
            try {
              const upstreamViaProxy = await fetch(`${endpointProxyBase}/chat/completions`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${executionTicket}`,
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
      await helloSeen;

      const task = await postJsonWithBearer<{ id: string }>({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
        token,
        body: {
          title: `it-notebook-task-${Date.now()}`,
          agent_id: agent.id,
          workspace_mode: 'create_new',
        },
        errorPrefix: 'create_task_failed',
      });

      await postJsonWithBearer({
        url: `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/messages`,
        token,
        body: { role: 'user', content: 'run notebook task' },
        errorPrefix: 'post_task_message_failed',
      });

      const execution = await executionSeen;
      expect(execution.taskId).toBe(task.id);
      expect(execution.runId.length).toBeGreaterThan(0);
      expect(execution.endpointProxyBase).toBe(
        `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpoint.id}/proxy/openai`,
      );
      expect(execution.executionTicket).toMatch(/^exec_/);

      const meRes = await page.request.get(`${apiBase}/api/v1/me/profile`, {
        headers: { Authorization: `Bearer ${execution.executionTicket}` },
      });
      expect(meRes.status()).toBe(403);
      await expect(meRes.json()).resolves.toMatchObject({
        error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
      });

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
