import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  REAL_LANE_ANTHROPIC_BASE_URL,
  REAL_LANE_MODEL,
  REAL_LANE_OPENAI_BASE_URL,
  REAL_LANE_OPENAI_MODEL,
  startCodexRunnerProcess,
} from './integration-real-helpers';

type UpstreamServer = {
  baseUrl: string;
  stop: () => Promise<void>;
  requests?: Array<Record<string, unknown>>;
};

function requireRealLaneApiKey(): string {
  const value = process.env.REAL_LANE_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_REAL_LANE_API_KEY');
  }
  return value;
}

async function listTaskMessages(args: {
  page: Page;
  token: string;
  projectId: string;
  taskId: string;
}): Promise<Array<{ role?: string; content?: string }>> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: { Authorization: `Bearer ${args.token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ role?: string; content?: string }>;
}

async function waitForTaskArtifacts(args: {
  page: Page;
  token: string;
  projectId: string;
  taskId: string;
  expectedPath: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
          {
            headers: { Authorization: `Bearer ${args.token}` },
          },
        );
        if (!response.ok()) return false;
        const payload = (await response.json()) as Array<{ task_relative_path?: string }>;
        return payload.some((item) => item.task_relative_path === args.expectedPath);
      },
      { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe(true);
}

async function findFileRecursively(root: string, relativeParts: string[]): Promise<string | null> {
  const directPath = path.join(root, ...relativeParts);
  try {
    await readFile(directPath, 'utf8');
    return directPath;
  } catch {
    // Keep searching.
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await findFileRecursively(path.join(root, entry.name), relativeParts);
    if (nested) return nested;
  }
  return null;
}

async function issueDevToken(page: Page): Promise<string> {
  const response = await page.request.post('http://localhost:18080/realms/mbos/protocol/openid-connect/token', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      grant_type: 'password',
      client_id: 'agentsmith',
      username: KEYCLOAK_DEV_ADMIN_USERNAME,
      password: KEYCLOAK_DEV_ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('access_token_missing');
  return body.access_token;
}

async function createProjectViaApi(page: Page, token: string, name: string): Promise<string> {
  const response = await page.request.post(`${API_BASE}/api/v1/workspaces/ws_default/projects`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      name,
      description: 'Universal proxy notebook runner real-lane project',
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('project_id_missing');
  return body.id;
}

async function createCredentialViaApi(
  page: Page,
  token: string,
  projectId: string,
  value = 'sk-it-upx-notebook',
): Promise<{ id: string; name: string }> {
  const name = `it-upx-notebook-key-${Date.now()}`;
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name,
        type: 'api_key',
        value,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('credential_id_missing');
  return { id: body.id, name };
}

async function createEndpointViaApi(args: {
  page: Page;
  token: string;
  projectId: string;
  name: string;
  model: string;
  baseUrl: string;
  credentialRef: string;
  protocol: 'openai_compatible' | 'anthropic_compatible';
  modelProfile?: {
    max_context_tokens: number;
  };
}): Promise<string> {
  const providerFamily = args.protocol === 'anthropic_compatible' ? 'anthropic' : 'openai';
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
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
        ...(args.modelProfile
          ? {
            model_profile: {
              max_context_tokens: args.modelProfile.max_context_tokens,
              max_output_tokens: 8192,
              supports_file: true,
              supports_tool_call: true,
              supports_reasoning: true,
              price_input_per_1m: 0,
              price_output_per_1m: 0,
              cache_read_discount_ratio: 0,
              cache_write_discount_ratio: 0,
            },
          }
          : {}),
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('endpoint_id_missing');
  return body.id;
}

async function createExternalNotebookAgentBundle(args: {
  page: Page;
  token: string;
  projectId: string;
  endpointId: string;
  title: string;
  model?: string;
}): Promise<{ agentId: string; agentName: string; wsUrl: string; agentKey: string }> {
  const agentName = `${args.title}-${Date.now()}`;
  const createAgentRes = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: agentName,
        mode: 'external',
        interaction_mode: 'notebook',
        execution_preferences: {
          notebook: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: args.model?.trim() || 'glm-5-turbo',
          },
        },
        capabilities: {
          streaming_completion: true,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id?: string };
  if (!createdAgent.id) throw new Error('agent_id_missing');

  const createKeyRes = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/keys`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    },
  );
  expect(createKeyRes.ok()).toBeTruthy();
  const keyPayload = (await createKeyRes.json()) as { key?: string };
  if (!keyPayload.key) throw new Error('agent_key_missing');

  const connectionRes = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${createdAgent.id}/connection-info`,
    {
      headers: { Authorization: `Bearer ${args.token}` },
    },
  );
  expect(connectionRes.ok()).toBeTruthy();
  const connectionInfo = (await connectionRes.json()) as { ws_url?: string };
  if (!connectionInfo.ws_url) throw new Error('agent_ws_url_missing');

  return {
    agentId: createdAgent.id,
    agentName,
    wsUrl: connectionInfo.ws_url.replace('ws://localhost:20000', API_BASE.replace('http://', 'ws://')),
    agentKey: keyPayload.key,
  };
}

async function createNotebookTaskViaApi(args: {
  page: Page;
  token: string;
  projectId: string;
  agentId: string;
  workspaceLibraryId: string;
  title: string;
}): Promise<string> {
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        agent_id: args.agentId,
        workspace_file_library_id: args.workspaceLibraryId,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `create_notebook_task_failed:${response.status()}:${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id!;
}

async function sendNotebookMessage(args: {
  page: Page;
  token: string;
  projectId: string;
  taskId: string;
  content: string;
}): Promise<void> {
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content: args.content,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`send_notebook_message_failed:${response.status()}:${await response.text()}`);
  }
}


async function waitForAgentPresenceOnline(args: {
  page: Page;
  token: string;
  projectId: string;
  agentId: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/agents/${args.agentId}`,
          { headers: { Authorization: `Bearer ${args.token}` } },
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { presence?: string };
        return body.presence ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe('online');
}

async function waitForAgentReply(args: {
  page: Page;
  token: string;
  projectId: string;
  taskId: string;
  expectedText: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/messages`,
          {
            headers: { Authorization: `Bearer ${args.token}` },
          },
        );
        if (!response.ok()) return null;
        const payload = (await response.json()) as Array<{ role?: string; content?: string }>;
        return payload.find((item) => item.role === 'agent' && item.content?.includes(args.expectedText))?.content ?? null;
      },
      { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toContain(args.expectedText);
}

async function waitForTaskIdle(args: {
  page: Page;
  token: string;
  projectId: string;
  taskId: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks?page=1&page_size=20`,
          {
            headers: { Authorization: `Bearer ${args.token}` },
          },
        );
        if (!response.ok()) return null;
        const payload = (await response.json()) as {
          items?: Array<{ id?: string; run_state?: string }>;
        };
        const task = payload.items?.find((item) => item.id === args.taskId);
        return task?.run_state ?? null;
      },
      { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe('idle');
}

async function createWorkspaceFileLibraryViaApi(args: {
  page: Page;
  token: string;
  projectId: string;
  name: string;
}): Promise<string> {
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/file-libraries`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: args.name,
        description: 'Universal proxy notebook runner workspace',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(body.id).toBeTruthy();
  return body.id!;
}

async function startOpenAiChatCompletionsUpstream(replyText: string): Promise<UpstreamServer> {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString('utf-8');
      const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> & { stream?: boolean } : {};
      requests.push(body);
      if (body.stream) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
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
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'chat.completion',
          id: 'chatcmpl_it',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: replyText,
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
  };
}

async function startAnthropicStreamingUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString('utf-8');
      const body = bodyText ? JSON.parse(bodyText) as { stream?: boolean } : {};
      if (body.stream) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.write('event: message_start\n');
        res.write(
          'data: {"type":"message_start","message":{"id":"msg_it","type":"message","role":"assistant","model":"claude-3","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
        );
        res.write('event: content_block_start\n');
        res.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
        res.write('event: content_block_delta\n');
        res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } })}\n\n`);
        res.write('event: content_block_stop\n');
        res.write('data: {"type":"content_block_stop","index":0}\n\n');
        res.write('event: message_delta\n');
        res.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n');
        res.write('event: message_stop\n');
        res.write('data: {"type":"message_stop"}\n\n');
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_it',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{ type: 'text', text: replyText }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 2, output_tokens: 4 },
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('@lane-real notebook runner protocol blindness via universal proxy', () => {
  test('runs notebook tasks through the same responses runner contract for openai and anthropic endpoints', async ({ page }) => {
    test.setTimeout(600_000);

    const token = await issueDevToken(page);
    const projectId = await createProjectViaApi(page, token, `it-upx-notebook-${Date.now()}`);
    const credential = await createCredentialViaApi(page, token, projectId);

    const cases = [
      {
        kind: 'openai' as const,
        replyToken: `UPX_NOTEBOOK_OPENAI_${Date.now()}`,
        startUpstream: startOpenAiChatCompletionsUpstream,
        protocol: 'openai_compatible' as const,
      },
      {
        kind: 'anthropic' as const,
        replyToken: `UPX_NOTEBOOK_ANTHROPIC_${Date.now()}`,
        startUpstream: startAnthropicStreamingUpstream,
        protocol: 'anthropic_compatible' as const,
      },
    ];

    for (const scenario of cases) {
      const upstream = await scenario.startUpstream(scenario.replyToken);
      try {
        const workspaceLibraryId = await createWorkspaceFileLibraryViaApi({
          page,
          token,
          projectId,
          name: `Universal Proxy Notebook Workspace ${scenario.kind} ${Date.now()}`,
        });
        const endpointId = await createEndpointViaApi({
          page,
          token,
          projectId,
          name: `UPX Notebook ${scenario.kind} ${Date.now()}`,
          model: 'glm-5-turbo',
          baseUrl: upstream.baseUrl,
          credentialRef: credential.id,
          protocol: scenario.protocol,
          modelProfile: {
            max_context_tokens: 128000,
          },
        });
        const agentBundle = await createExternalNotebookAgentBundle({
          page,
          token,
          projectId,
          endpointId,
          title: `upx-notebook-${scenario.kind}`,
        });
        const runner = await startCodexRunnerProcess({
          wsUrl: agentBundle.wsUrl,
          agentKey: agentBundle.agentKey,
        });
        test.info().annotations.push({ type: `runner_log_${scenario.kind}`, description: runner.logPath });

        try {
          await waitForAgentPresenceOnline({
            page,
            token,
            projectId,
            agentId: agentBundle.agentId,
          });
          const taskId = await createNotebookTaskViaApi({
            page,
            token,
            projectId,
            agentId: agentBundle.agentId,
            workspaceLibraryId,
            title: `UPX Notebook Task ${scenario.kind} ${Date.now()}`,
          });
          await sendNotebookMessage({
            page,
            token,
            projectId,
            taskId,
            content: `Reply with exactly ${scenario.replyToken} and nothing else.`,
          });
          await waitForAgentReply({
            page,
            token,
            projectId,
            taskId,
            expectedText: scenario.replyToken,
          });
          if (scenario.kind === 'openai') {
            expect(upstream.requests?.length).toBeGreaterThan(0);
            const requestBody = upstream.requests?.at(-1);
            expect(requestBody?.messages).toBeTruthy();
            expect(requestBody?.model).toBe('glm-5-turbo');
            expect(requestBody?.store).toBeUndefined();
            expect(requestBody?.reasoning).toBeUndefined();
            expect(requestBody?.messages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  role: 'user',
                }),
              ]),
            );
          }
        } finally {
          await runner.stop();
        }
      } finally {
        await upstream.stop();
      }
    }
  });
});

test.describe('@lane-real notebook runner real upstream stability via universal proxy', () => {
  test('completes long multi-turn notebook tasks for openai-compatible and anthropic-compatible upstreams', async ({ page }) => {
    test.setTimeout(1_200_000);
    const glmApiKey = requireRealLaneApiKey();
    const token = await issueDevToken(page);
    const projectId = await createProjectViaApi(page, token, `it-upx-notebook-real-${Date.now()}`);
    const credential = await createCredentialViaApi(page, token, projectId, glmApiKey);

    const scenarios = [
      {
        kind: 'openai' as const,
        protocol: 'openai_compatible' as const,
        baseUrl: REAL_LANE_OPENAI_BASE_URL,
        model: REAL_LANE_OPENAI_MODEL,
        expectedCompactLimit: 121600,
      },
      {
        kind: 'anthropic' as const,
        protocol: 'anthropic_compatible' as const,
        baseUrl: REAL_LANE_ANTHROPIC_BASE_URL,
        model: REAL_LANE_MODEL,
        expectedCompactLimit: 121600,
      },
    ];

    for (const scenario of scenarios) {
      const workspaceLibraryId = await createWorkspaceFileLibraryViaApi({
        page,
        token,
        projectId,
        name: `Universal Proxy Real Notebook Workspace ${scenario.kind} ${Date.now()}`,
      });
      const endpointId = await createEndpointViaApi({
        page,
        token,
        projectId,
        name: `UPX Real Notebook ${scenario.kind} ${Date.now()}`,
        model: scenario.model,
        baseUrl: scenario.baseUrl,
        credentialRef: credential.id,
        protocol: scenario.protocol,
        modelProfile: {
          max_context_tokens: 128000,
        },
      });
      const agentBundle = await createExternalNotebookAgentBundle({
        page,
        token,
        projectId,
        endpointId,
        title: `upx-real-notebook-${scenario.kind}`,
        model: scenario.model,
      });
      const runner = await startCodexRunnerProcess({
        wsUrl: agentBundle.wsUrl,
        agentKey: agentBundle.agentKey,
      });
      test.info().annotations.push({ type: `runner_log_real_${scenario.kind}`, description: runner.logPath });

      try {
        await waitForAgentPresenceOnline({
          page,
          token,
          projectId,
          agentId: agentBundle.agentId,
        });

        const taskId = await createNotebookTaskViaApi({
          page,
          token,
          projectId,
          agentId: agentBundle.agentId,
          workspaceLibraryId,
          title: `UPX Real Notebook Task ${scenario.kind} ${Date.now()}`,
        });
        const starryPrompt = [
          'Use Python to draw a simple starry sky image.',
          'Save the final image to exactly .artifacts/starry_sky.png.',
          'After the image is written, reply with exactly STAR_SKY_DONE: starry_sky.png.',
          'Do not skip the file creation step.',
        ].join(' ');
        await sendNotebookMessage({
          page,
          token,
          projectId,
          taskId,
          content: starryPrompt,
        });
        await waitForAgentReply({
          page,
          token,
          projectId,
          taskId,
          expectedText: 'STAR_SKY_DONE: starry_sky.png',
        });
        await waitForTaskIdle({
          page,
          token,
          projectId,
          taskId,
        });
        await waitForTaskArtifacts({
          page,
          token,
          projectId,
          taskId,
          expectedPath: '.artifacts/starry_sky.png',
        });

        const configPath = await findFileRecursively(runner.workspaceRoot, ['.codex', 'config.toml']);
        expect(configPath).toBeTruthy();
        const configText = await readFile(configPath!, 'utf8');
        expect(configText).toContain('model_context_window = 128000');
        expect(configText).toContain(`model_auto_compact_token_limit = ${scenario.expectedCompactLimit}`);
        expect(configText).toContain('model_catalog_json = ');

        const catalogPath = await findFileRecursively(runner.workspaceRoot, ['.codex', 'catalog.json']);
        expect(catalogPath).toBeTruthy();
        const catalog = JSON.parse(await readFile(catalogPath!, 'utf8')) as {
          models?: Array<Record<string, unknown>>;
        };
        expect(catalog.models?.[0]?.context_window).toBe(128000);
        expect(catalog.models?.[0]?.auto_compact_token_limit).toBe(scenario.expectedCompactLimit);
        expect(catalog.models?.[0]?.input_modalities).toEqual(['text']);
        expect(catalog.models?.[0]?.supports_search_tool).toBe(false);

        await sendNotebookMessage({
          page,
          token,
          projectId,
          taskId,
          content: '你刚才画的图中最多的颜色是什么颜色？请读取你刚才生成的图片，并以 DOMINANT_COLOR: 开头回答。',
        });
        await waitForAgentReply({
          page,
          token,
          projectId,
          taskId,
          expectedText: 'DOMINANT_COLOR:',
        });
        await waitForTaskIdle({
          page,
          token,
          projectId,
          taskId,
        });
        const messages = await listTaskMessages({
          page,
          token,
          projectId,
          taskId,
        });
        const lastAgentMessage = [...messages].reverse().find((item) => item.role === 'agent' && item.content?.includes('DOMINANT_COLOR:'));
        expect(lastAgentMessage?.content).toMatch(/DOMINANT_COLOR:\s*\S+/);

        await waitForAgentPresenceOnline({
          page,
          token,
          projectId,
          agentId: agentBundle.agentId,
        });

        const repeatToken = `REPEAT_OK_${scenario.kind.toUpperCase()}_${Date.now()}`;
        await sendNotebookMessage({
          page,
          token,
          projectId,
          taskId,
          content: `Reply with exactly ${repeatToken} and nothing else.`,
        });
        await waitForAgentReply({
          page,
          token,
          projectId,
          taskId,
          expectedText: repeatToken,
        });
        await waitForTaskIdle({
          page,
          token,
          projectId,
          taskId,
        });
      } finally {
        await runner.stop();
      }
    }
  });
});
