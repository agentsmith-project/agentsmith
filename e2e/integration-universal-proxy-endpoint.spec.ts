import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
} from './integration-real-helpers';

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
      description: 'Universal proxy real-lane integration project',
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('project_id_missing');
  return body.id;
}

async function createCredentialViaApi(page: Page, token: string, projectId: string): Promise<string> {
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `it-upx-key-${Date.now()}`,
        type: 'api_key',
        value: 'sk-it-upx',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('credential_id_missing');
  return body.id;
}

async function createEndpointViaApi(
  page: Page,
  token: string,
  projectId: string,
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
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
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

async function startOpenAiResponsesUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'response',
          status: 'completed',
          output: [
            {
              id: 'msg_resp_1',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: replyText }],
            },
          ],
          output_text: replyText,
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
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.write('event: message_start\n');
      res.write('data: {"type":"message_start","message":{"id":"msg_it"}}\n\n');
      res.write('event: content_block_delta\n');
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } })}\n\n`);
      res.write('event: message_stop\n');
      res.write('data: {"type":"message_stop"}\n\n');
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('@lane-real integration universal proxy endpoint routes', () => {
  test('responses proxy works against openai-compatible endpoint in dev environment', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startOpenAiResponsesUpstream('dev-universal-responses-ok');

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-responses-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-openai-${Date.now()}`,
        model: 'glm-5-turbo',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        protocol: 'openai_compatible',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: 'glm-5-turbo',
            input: 'reply with exactly dev-universal-responses-ok',
            max_output_tokens: 64,
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as { output_text?: string };
      expect(body.output_text).toBe('dev-universal-responses-ok');
    } finally {
      await upstream.stop();
    }
  });

  test('messages proxy streams against anthropic-compatible endpoint in dev environment', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startAnthropicStreamingUpstream('dev-universal-anthropic-ok');

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-messages-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-anth-${Date.now()}`,
        model: 'glm-5-turbo',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        protocol: 'anthropic_compatible',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          data: {
            model: 'glm-5-turbo',
            max_tokens: 64,
            stream: true,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      const body = await response.text();
      expect(response.headers()['content-type']).toContain('text/event-stream');
      expect(body).toContain('dev-universal-anthropic-ok');
    } finally {
      await upstream.stop();
    }
  });
});
