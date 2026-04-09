import { WebSocket } from 'ws';
import { test, expect, type Page } from '@playwright/test';

async function issuePasswordGrantToken(username: string, password: string): Promise<string> {
  const keycloakBase = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
  const response = await fetch(`${keycloakBase}/realms/mbos/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'agentsmith',
      username,
      password,
    }),
  });
  expect(response.ok).toBeTruthy();
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

  for (let cycle = 0; cycle < 2; cycle += 1) {
    if (!new RegExp(`/${locale}/workspaces/ws_default/login`).test(page.url())) {
      await page.goto(`/${locale}/workspaces/ws_default/login`);
    }

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
    await page.goto(`/${locale}/workspaces/ws_default/projects`);
    return;
  }

  throw new Error('Unable to complete workspace selection after Keycloak login retries.');
}

async function createProjectViaApi(apiBase: string, token: string): Promise<string> {
  const projectName = `it-agent-${Date.now()}`;
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
        description: 'External agent execution ticket backend-real project',
      }),
    });
    if (response.ok) {
      const project = (await response.json()) as { id?: string };
      expect(project.id).toBeTruthy();
      return project.id!;
    }
    lastErrorText = await response.text().catch(() => '');
    const retryableConnectionReset = response.status === 400 && lastErrorText.includes('read ECONNRESET');
    if (!retryableConnectionReset || attempt === 2) {
      throw new Error(`create_project_failed:${response.status}:${lastErrorText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`create_project_failed:unknown:${lastErrorText}`);
}

async function createExternalAgentBundle(args: {
  apiBase: string;
  token: string;
  projectId: string;
  multimodal: boolean;
  title: string;
}): Promise<{ agentId: string; wsUrl: string; agentKey: string; sessionId: string }> {
  const createAgentRes = await fetch(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `it-external-agent-${Date.now()}`,
        mode: 'external',
        interaction_kind: 'chat',
        capabilities: {
          streaming_completion: true,
          multimodal_completion: args.multimodal,
          accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain'],
          max_file_count: 8,
          max_total_bytes: 62914560,
        },
      }),
    },
  );
  expect(createAgentRes.ok).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };

  const createKeyRes = await fetch(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/keys`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  expect(createKeyRes.ok).toBeTruthy();
  const keyPayload = (await createKeyRes.json()) as { key: string };

  const connectionRes = await fetch(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/connection-info`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${args.token}` },
    },
  );
  expect(connectionRes.ok).toBeTruthy();
  const connectionInfo = (await connectionRes.json()) as { ws_url: string };

  const createSessionRes = await fetch(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/chat/sessions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: args.title,
        model: 'external-agent',
        external_agent_id: createdAgent.id,
      }),
    },
  );
  expect(createSessionRes.ok).toBeTruthy();
  const session = (await createSessionRes.json()) as { id: string };

  return {
    agentId: createdAgent.id,
    wsUrl: connectionInfo.ws_url.replace('ws://localhost:20000', args.apiBase.replace('http://', 'ws://')),
    agentKey: keyPayload.key,
    sessionId: session.id,
  };
}

async function postChatMessageStream(args: {
  apiBase: string;
  token: string;
  projectId: string;
  sessionId: string;
  content: string;
}): Promise<Response> {
  return fetch(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages/stream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { role: 'user', content: args.content },
      }),
    },
  );
}

async function openChatSession(page: Page, locale: string, projectId: string, expectedTitle: string): Promise<void> {
  await page.goto(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`);
  await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });

  const target = page.getByTestId('chat__thread-item').filter({ hasText: expectedTitle }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  await expect(page.getByTestId('chat__composer').locator('textarea')).toBeVisible({ timeout: 30_000 });
}

function connectEchoWs(args: {
  wsUrl: string;
  agentKey: string;
  mode: 'normal' | 'slow' | 'multimodal' | 'protocol';
  onRequestStart?: (msg: {
    request_id?: string;
    payload?: {
      execution_context?: {
        execution_ticket?: string;
        user_bearer_token?: string;
        session_id?: string;
      };
    };
  }) => void;
  onRequestCancel?: (msg: { request_id?: string }) => void;
}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(args.wsUrl, {
      headers: { Authorization: `Bearer ${args.agentKey}` },
    });

    const activeTimers = new Map<string, NodeJS.Timeout>();

    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'agent.ready',
        timestamp: new Date().toISOString(),
        payload: {
          capabilities: {
            wire_api: 'responses',
            streaming_completion: true,
            multimodal_completion: args.mode === 'multimodal',
          },
        },
      }));

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: { messages?: Array<{ role?: string; content?: unknown }> };
        };

        if (msg.type === 'server.request.cancel' && msg.request_id) {
          args.onRequestCancel?.(msg);
          const timer = activeTimers.get(msg.request_id);
          if (timer) {
            clearInterval(timer);
            activeTimers.delete(msg.request_id);
          }
          return;
        }

        if (msg.type !== 'server.request.start' || !msg.request_id) {
          return;
        }
        args.onRequestStart?.(msg);

        const allMessages = msg.payload?.messages ?? [];
        const lastUser = [...allMessages].reverse().find((item) => item.role === 'user');
        const userContent = lastUser?.content;

        if (args.mode === 'multimodal' && Array.isArray(userContent)) {
          const hasImagePart = userContent.some(
            (part) =>
              typeof part === 'object'
              && part !== null
              && (part as { type?: string }).type === 'image_url',
          );
          const reply = hasImagePart ? 'saw image attachment' : 'no image attachment';
          ws.send(JSON.stringify({
            type: 'agent.response.delta',
            request_id: msg.request_id,
            timestamp: new Date().toISOString(),
            payload: { delta: reply },
          }));
          ws.send(JSON.stringify({
            type: 'agent.response.done',
            request_id: msg.request_id,
            timestamp: new Date().toISOString(),
            payload: { finish_reason: 'stop', usage_tokens: reply.length },
          }));
          return;
        }

        if (args.mode === 'protocol') {
          ws.send(JSON.stringify({
            type: 'agent.response.delta',
            request_id: msg.request_id,
            timestamp: new Date().toISOString(),
            payload: { delta: 12345 },
          }));
          return;
        }

        const textContent = typeof userContent === 'string' ? userContent : JSON.stringify(userContent ?? '');
        const output = `echo: ${textContent}`;

        if (args.mode === 'slow') {
          const chunks = ['echo: ', textContent.slice(0, 6), textContent.slice(6), ' [END_MARKER]'];
          let index = 0;
          const timer = setInterval(() => {
            if (ws.readyState !== ws.OPEN) {
              clearInterval(timer);
              activeTimers.delete(msg.request_id!);
              return;
            }
            if (index >= chunks.length) {
              clearInterval(timer);
              activeTimers.delete(msg.request_id!);
              ws.send(JSON.stringify({
                type: 'agent.response.done',
                request_id: msg.request_id,
                timestamp: new Date().toISOString(),
                payload: { finish_reason: 'stop', usage_tokens: output.length },
              }));
              return;
            }
            ws.send(JSON.stringify({
              type: 'agent.response.delta',
              request_id: msg.request_id,
              timestamp: new Date().toISOString(),
              payload: { delta: chunks[index] },
            }));
            index += 1;
          }, 900);
          activeTimers.set(msg.request_id, timer);
          return;
        }

        ws.send(JSON.stringify({
          type: 'agent.response.delta',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { delta: 'echo: ' },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.delta',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { delta: output.replace(/^echo:\s*/, '') },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { finish_reason: 'stop', usage_tokens: output.length },
        }));
      });

      ws.on('close', () => {
        for (const timer of activeTimers.values()) {
          clearInterval(timer);
        }
        activeTimers.clear();
      });

      resolve(ws);
    });

    ws.once('error', reject);
  });
}

test.describe('@lane-real integration external agent chat stream', () => {
  test('chat streams through external agent websocket', async () => {
    test.setTimeout(180_000);

    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    const token = await issuePasswordGrantToken(username, password);
    const projectId = await createProjectViaApi(apiBase, token);

    const title = `External Agent Session ${Date.now()}`;
    const bundle = await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: true,
      title,
    });
    let observedExecutionTicket = '';
    let observedLegacyBearer = '';
    let observedSessionId = '';
    let requestStarted = false;
    const ws = await connectEchoWs({
      wsUrl: bundle.wsUrl,
      agentKey: bundle.agentKey,
      mode: 'normal',
      onRequestStart: (msg) => {
        observedExecutionTicket = msg.payload?.execution_context?.execution_ticket ?? '';
        observedLegacyBearer = msg.payload?.execution_context?.user_bearer_token ?? '';
        observedSessionId = msg.payload?.execution_context?.session_id ?? '';
        requestStarted = true;
      },
    });
    const prompt = `integration ping ${Date.now()}`;
    const streamRes = await postChatMessageStream({
      apiBase,
      token,
      projectId,
      sessionId: bundle.sessionId,
      content: prompt,
    });

    expect(streamRes.ok).toBeTruthy();
    const streamTextPromise = streamRes.text();

    await expect.poll(() => requestStarted, { timeout: 30_000 }).toBe(true);

    expect(observedExecutionTicket).toMatch(/^exec_/);
    expect(observedLegacyBearer).toBe('');
    expect(observedSessionId).toBe(bundle.sessionId);
    await expect(streamTextPromise).resolves.toContain('event: done');

    ws.close();
  });

  test('stop cancels external agent stream and prevents full tail output', async () => {
    test.setTimeout(180_000);

    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    const token = await issuePasswordGrantToken(username, password);
    const projectId = await createProjectViaApi(apiBase, token);

    const title = `External Agent Stop Session ${Date.now()}`;
    const bundle = await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: false,
      title,
    });
    let observedExecutionTicket = '';
    let observedLegacyBearer = '';
    let observedCancelRequestId = '';
    let requestStarted = false;
    let cancelReceived = false;
    const ws = await connectEchoWs({
      wsUrl: bundle.wsUrl,
      agentKey: bundle.agentKey,
      mode: 'slow',
      onRequestStart: (msg) => {
        observedExecutionTicket = msg.payload?.execution_context?.execution_ticket ?? '';
        observedLegacyBearer = msg.payload?.execution_context?.user_bearer_token ?? '';
        requestStarted = true;
      },
      onRequestCancel: (msg) => {
        observedCancelRequestId = msg.request_id ?? '';
        cancelReceived = true;
      },
    });

    const prompt = `slow stream ${Date.now()}`;
    const streamRes = await postChatMessageStream({
      apiBase,
      token,
      projectId,
      sessionId: bundle.sessionId,
      content: prompt,
    });
    expect(streamRes.ok).toBeTruthy();
    const streamTextPromise = streamRes.text();

    await expect.poll(() => requestStarted, { timeout: 30_000 }).toBe(true);

    const stopResponse = await fetch(
      `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/chat/sessions/${bundle.sessionId}/stop`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    expect(stopResponse.ok).toBeTruthy();

    await expect.poll(() => cancelReceived, { timeout: 30_000 }).toBe(true);
    expect(observedCancelRequestId).toBeTruthy();

    expect(observedExecutionTicket).toMatch(/^exec_/);
    expect(observedLegacyBearer).toBe('');
    await expect(streamTextPromise).resolves.toContain('event: error');
    await expect(streamTextPromise).resolves.toContain('AGENT_CANCEL_TIMEOUT');

    ws.close();
  });

  test('multimodal external agent receives image attachment and offline shows stream error', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const token = await issuePasswordGrantToken(username, password);
    const projectId = await createProjectViaApi(apiBase, token);

    const multimodalTitle = `External Agent Multimodal ${Date.now()}`;
    const multimodalBundle = await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: true,
      title: multimodalTitle,
    });
    const ws = await connectEchoWs({ wsUrl: multimodalBundle.wsUrl, agentKey: multimodalBundle.agentKey, mode: 'multimodal' });

    await openChatSession(page, locale, projectId, multimodalTitle);

    const composer = page.getByTestId('chat__composer');
    await expect(composer.getByTestId('chat__attach-local-btn')).toBeVisible({ timeout: 15_000 });

    const attachmentInitResponse = page.waitForResponse((res) =>
      res.request().method() === 'POST' &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/attachments\/init$/.test(res.url()),
    );
    await page.locator('input[type="file"][multiple]').first().setInputFiles({
      name: 'integration-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    const initRes = await attachmentInitResponse;
    if (!initRes.ok()) {
      const reqBody = initRes.request().postData() ?? '';
      throw new Error(
        `attachment_init_failed_${initRes.status()}:${await initRes.text().catch(() => '')};request=${reqBody}`,
      );
    }

    await composer.locator('textarea').fill('describe this image');
    await expect
      .poll(async () => await page.getByTestId('chat__send-btn').isEnabled(), { timeout: 30_000 })
      .toBe(true);
    await page.getByTestId('chat__send-btn').click();

    await expect
      .poll(async () => {
        const messages = await page.getByTestId('chat__message').allTextContents();
        return messages.join('\n');
      }, { timeout: 60_000 })
      .toContain('saw image attachment');

    ws.close();

    const offlineTitle = `External Agent Offline ${Date.now()}`;
    await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: false,
      title: offlineTitle,
    });

    await openChatSession(page, locale, projectId, offlineTitle);
    await page.getByTestId('chat__composer').locator('textarea').fill('offline ping');
    await page.getByTestId('chat__send-btn').click();

    await expect(page.getByText(/External agent is offline|外部 Agent 当前离线/)).toBeVisible({ timeout: 20_000 });
  });

  test('external agent protocol error shows specific stream banner', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const token = await issuePasswordGrantToken(username, password);
    const projectId = await createProjectViaApi(apiBase, token);

    const title = `External Agent Protocol ${Date.now()}`;
    const bundle = await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: false,
      title,
    });
    const ws = await connectEchoWs({ wsUrl: bundle.wsUrl, agentKey: bundle.agentKey, mode: 'protocol' });

    await openChatSession(page, locale, projectId, title);
    await page.getByTestId('chat__composer').locator('textarea').fill('protocol test');
    await page.getByTestId('chat__send-btn').click();

    await expect(page.getByText(/External agent protocol error|外部 Agent 协议错误/)).toBeVisible({ timeout: 20_000 });

    ws.close();
  });

  test('non-multimodal external agent disables file attachments in composer', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const token = await issuePasswordGrantToken(username, password);
    const projectId = await createProjectViaApi(apiBase, token);

    const title = `External Agent Text Only ${Date.now()}`;
    await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: false,
      title,
    });

    await openChatSession(page, locale, projectId, title);

    const composer = page.getByTestId('chat__composer');
    await expect(composer.getByTestId('chat__attach-local-btn')).toHaveCount(0);
    await expect(composer.getByTestId('chat__attach-library-btn')).toHaveCount(0);
    await expect(
      composer.getByText(/does not support|不支持图片|不支持文件|切换到多模态/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('agent websocket rejects invalid api key', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const token = await readStoredAuthToken(page);
    const projectId = await createProjectViaApi(apiBase, token);

    const title = `External Agent Invalid Key ${Date.now()}`;
    const bundle = await createExternalAgentBundle({
      apiBase,
      token,
      projectId,
      multimodal: false,
      title,
    });

    const wsAuthRejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(bundle.wsUrl, { headers: { Authorization: 'Bearer invalid-key' } });
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      ws.on('open', () => {
        ws.close();
        finish(false);
      });
      ws.on('error', () => finish(true));
      ws.on('close', () => finish(true));
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(false);
      }, 5_000);
    });

    expect(wsAuthRejected).toBeTruthy();
  });
});
