import { WebSocket } from 'ws';
import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

async function keycloakLogin(page: Page, locale: string, username: string, password: string) {
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

async function ensureProject(page: Page, locale: string): Promise<string> {
  const cards = page.getByTestId('projects__card');
  if (await cards.count() > 0) {
    await cards.first().click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 });
    const match = page.url().match(/\/projects\/([^/]+)\//);
    if (!match?.[1]) throw new Error('project_id_not_found');
    return match[1];
  }

  const projectName = `it-agent-${Date.now()}`;
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

async function createExternalAgentBundle(page: Page, args: {
  apiBase: string;
  token: string;
  projectId: string;
  multimodal: boolean;
  title: string;
}): Promise<{ agentId: string; wsUrl: string; agentKey: string; sessionId: string }> {
  const createAgentRes = await page.request.post(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `it-external-agent-${Date.now()}`,
        mode: 'external',
        interaction_mode: 'chat',
        capabilities: {
          streaming_completion: true,
          multimodal_completion: args.multimodal,
          accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain'],
          max_file_count: 8,
          max_total_bytes: 62914560,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };

  const createKeyRes = await page.request.post(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/keys`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    },
  );
  expect(createKeyRes.ok()).toBeTruthy();
  const keyPayload = (await createKeyRes.json()) as { key: string };

  const connectionRes = await page.request.get(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/connection-info`,
    {
      headers: { Authorization: `Bearer ${args.token}` },
    },
  );
  expect(connectionRes.ok()).toBeTruthy();
  const connectionInfo = (await connectionRes.json()) as { ws_url: string };

  const createSessionRes = await page.request.post(
    `${args.apiBase}/api/v1/workspaces/ws_default/projects/${args.projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        model: 'external-agent',
        external_agent_id: createdAgent.id,
      },
    },
  );
  expect(createSessionRes.ok()).toBeTruthy();
  const session = (await createSessionRes.json()) as { id: string };

  return {
    agentId: createdAgent.id,
    wsUrl: connectionInfo.ws_url.replace('ws://localhost:20000', args.apiBase.replace('http://', 'ws://')),
    agentKey: keyPayload.key,
    sessionId: session.id,
  };
}

async function openChatSession(page: Page, locale: string, projectId: string, expectedTitle: string): Promise<void> {
  await page.goto(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`);
  await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });

  const target = page.getByTestId('chat__thread-item').filter({ hasText: expectedTitle }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  await expect(page.getByTestId('chat__composer').locator('textarea')).toBeVisible({ timeout: 30_000 });
}

function startTestAgentProcess(args: {
  wsUrl: string;
  agentKey: string;
  mode?: 'echo' | 'multimodal';
}): Promise<{ proc: ChildProcessWithoutNullStreams; stop: () => Promise<void> }> {
  const scriptPath = path.resolve(
    process.cwd(),
    'packages/api-entry-node/examples/external-agent-test-runner.ts',
  );
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['tsx', scriptPath],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: args.wsUrl,
          MBOS_AGENT_KEY: args.agentKey,
          MBOS_AGENT_MODE: args.mode ?? 'echo',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('test_agent_start_timeout'));
    }, 15_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (text.includes('[test-agent] connected')) {
        clearTimeout(timeout);
        proc.stdout.off('data', onData);
        resolve({
          proc,
          stop: async () => {
            if (proc.killed || proc.exitCode !== null) return;
            proc.kill('SIGTERM');
            await new Promise<void>((done) => {
              const killTimeout = setTimeout(() => {
                if (!proc.killed && proc.exitCode === null) {
                  proc.kill('SIGKILL');
                }
                done();
              }, 3_000);
              proc.once('exit', () => {
                clearTimeout(killTimeout);
                done();
              });
            });
          },
        });
      }
    };

    proc.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`test_agent_exit_${String(code)}`));
      }
    });

    proc.stdout.on('data', onData);
  });
}

function connectEchoWs(args: {
  wsUrl: string;
  agentKey: string;
  mode: 'normal' | 'slow' | 'multimodal' | 'protocol';
}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(args.wsUrl, {
      headers: { Authorization: `Bearer ${args.agentKey}` },
    });

    const activeTimers = new Map<string, NodeJS.Timeout>();

    ws.once('open', () => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: { messages?: Array<{ role?: string; content?: unknown }> };
        };

        if (msg.type === 'server.request.cancel' && msg.request_id) {
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

test.describe('integration external agent chat stream', () => {
  test('chat streams through external agent websocket', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const title = `External Agent Session ${Date.now()}`;
    const bundle = await createExternalAgentBundle(page, {
      apiBase,
      token,
      projectId,
      multimodal: true,
      title,
    });
    const agent = await startTestAgentProcess({
      wsUrl: bundle.wsUrl,
      agentKey: bundle.agentKey,
      mode: 'echo',
    });

    try {
      await openChatSession(page, locale, projectId, title);

      const prompt = `integration ping ${Date.now()}`;
      await page.getByTestId('chat__composer').locator('textarea').fill(prompt);

      await Promise.all([
        page.waitForResponse((res) =>
          res.request().method() === 'POST'
          && /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(res.url()),
        ),
        page.getByTestId('chat__send-btn').click(),
      ]);

      await expect
        .poll(async () => {
          const messages = await page.getByTestId('chat__message').allTextContents();
          return messages.join('\n');
        }, { timeout: 60_000 })
        .toContain(`echo: ${prompt}`);
    } finally {
      await agent.stop();
    }
  });

  test('stop cancels external agent stream and prevents full tail output', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const title = `External Agent Stop Session ${Date.now()}`;
    const bundle = await createExternalAgentBundle(page, {
      apiBase,
      token,
      projectId,
      multimodal: false,
      title,
    });
    const ws = await connectEchoWs({ wsUrl: bundle.wsUrl, agentKey: bundle.agentKey, mode: 'slow' });

    await openChatSession(page, locale, projectId, title);

    const prompt = `slow stream ${Date.now()}`;
    await page.getByTestId('chat__composer').locator('textarea').fill(prompt);
    await page.getByTestId('chat__send-btn').click();

    const stopButton = page.getByTestId('chat__composer').getByRole('button', { name: /Stop|停止/i });
    await expect(stopButton).toBeVisible({ timeout: 20_000 });
    await stopButton.click();

    await expect(page.getByTestId('chat__composer').getByTestId('chat__send-btn')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => {
        const text = (await page.getByTestId('chat__message').last().textContent()) ?? '';
        return text;
      }, { timeout: 30_000 })
      .not.toContain('[END_MARKER]');

    ws.close();
  });

  test('multimodal external agent receives image attachment and offline shows stream error', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const multimodalTitle = `External Agent Multimodal ${Date.now()}`;
    const multimodalBundle = await createExternalAgentBundle(page, {
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

    await page.locator('input[type="file"][multiple]').first().setInputFiles({
      name: 'integration-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        'base64',
      ),
    });

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
    await createExternalAgentBundle(page, {
      apiBase,
      token,
      projectId,
      multimodal: false,
      title: offlineTitle,
    });

    await openChatSession(page, locale, projectId, offlineTitle);
    await page.getByTestId('chat__composer').locator('textarea').fill('offline ping');
    await page.getByTestId('chat__send-btn').click();

    const offlineError = page.getByTestId('chat__stream-error-banner');
    await expect(offlineError).toBeVisible({ timeout: 20_000 });
    await expect(offlineError).toContainText(/offline|离线/i);
  });

  test('external agent protocol error shows specific stream banner', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const title = `External Agent Protocol ${Date.now()}`;
    const bundle = await createExternalAgentBundle(page, {
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

    const protocolError = page.getByTestId('chat__stream-error-banner');
    await expect(protocolError).toBeVisible({ timeout: 20_000 });
    await expect(protocolError).toContainText(/protocol|协议/i);

    ws.close();
  });

  test('non-multimodal external agent disables file attachments in composer', async ({ page }) => {
    test.setTimeout(180_000);

    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';

    await keycloakLogin(page, locale, username, password);
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const title = `External Agent Text Only ${Date.now()}`;
    await createExternalAgentBundle(page, {
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
    const projectId = await ensureProject(page, locale);
    const token = await getAuthToken(page);

    const title = `External Agent Invalid Key ${Date.now()}`;
    const bundle = await createExternalAgentBundle(page, {
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
