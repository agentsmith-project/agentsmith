import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  startCodexRunnerProcess,
} from './integration-real-helpers';
import { ensureWorkspaceProjectCreatorAccess } from './integration-workspace-access';

type UpstreamServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

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

async function createCredentialViaApi(page: Page, token: string, projectId: string): Promise<{ id: string; name: string }> {
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
        value: 'sk-it-upx-notebook',
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
            model: 'glm-5-turbo',
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
  expect(response.ok()).toBeTruthy();
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

async function startOpenAiResponsesUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
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
        res.write('event: response.created\n');
        res.write(
          'data: {"type":"response.created","sequence_number":1,"response":{"id":"resp_mock","object":"response","created_at":1,"status":"in_progress","background":false,"error":null,"output":[]}}\n\n',
        );
        res.write('event: response.in_progress\n');
        res.write(
          'data: {"type":"response.in_progress","sequence_number":2,"response":{"id":"resp_mock","object":"response","created_at":1,"status":"in_progress"}}\n\n',
        );
        res.write('event: response.output_item.added\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            sequence_number: 3,
            output_index: 0,
            item: {
              id: 'msg_resp_1',
              type: 'message',
              role: 'assistant',
              content: [],
            },
          })}\n\n`,
        );
        res.write('event: response.content_part.added\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.content_part.added',
            sequence_number: 4,
            item_id: 'msg_resp_1',
            output_index: 0,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
            },
          })}\n\n`,
        );
        res.write('event: response.output_text.delta\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.output_text.delta',
            sequence_number: 5,
            item_id: 'msg_resp_1',
            output_index: 0,
            content_index: 0,
            delta: replyText,
          })}\n\n`,
        );
        res.write('event: response.output_text.done\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.output_text.done',
            sequence_number: 6,
            item_id: 'msg_resp_1',
            output_index: 0,
            content_index: 0,
            text: replyText,
          })}\n\n`,
        );
        res.write('event: response.content_part.done\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.content_part.done',
            sequence_number: 7,
            item_id: 'msg_resp_1',
            output_index: 0,
            content_index: 0,
            part: {
              type: 'output_text',
              text: replyText,
            },
          })}\n\n`,
        );
        res.write('event: response.output_item.done\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.output_item.done',
            sequence_number: 8,
            output_index: 0,
            item: {
              id: 'msg_resp_1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: replyText }],
            },
          })}\n\n`,
        );
        res.write('event: response.completed\n');
        res.write(
          `data: ${JSON.stringify({
            type: 'response.completed',
            sequence_number: 9,
            response: {
              id: 'resp_mock',
              object: 'response',
              created_at: 1,
              status: 'completed',
              output: [
                {
                  id: 'msg_resp_1',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: replyText }],
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          })}\n\n`,
        );
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'resp_mock',
          object: 'response',
          created_at: 1,
          status: 'completed',
          output: [
            {
              id: 'msg_resp_1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: replyText }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
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
    await ensureWorkspaceProjectCreatorAccess({
      page,
      apiBase: API_BASE,
      token,
      username: KEYCLOAK_DEV_ADMIN_USERNAME,
    });
    const projectId = await createProjectViaApi(page, token, `it-upx-notebook-${Date.now()}`);
    const credential = await createCredentialViaApi(page, token, projectId);

    const cases = [
      {
        kind: 'openai' as const,
        replyToken: `UPX_NOTEBOOK_OPENAI_${Date.now()}`,
        startUpstream: startOpenAiResponsesUpstream,
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
        } finally {
          await runner.stop();
        }
      } finally {
        await upstream.stop();
      }
    }
  });
});
