import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type APIResponse, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  resolveIntegrationKeycloakBaseUrl,
} from './integration-real-helpers';

type UpstreamServer = {
  baseUrl: string;
  stop: () => Promise<void>;
  getRequestCount?: () => number;
};

type OpenAiCompatibleError = {
  code: string;
  message: string;
  type: string;
};

type EndpointModelProfile = {
  max_context_tokens: number;
  max_output_tokens: number;
  supports_file: boolean;
  supports_tool_call: boolean;
  supports_reasoning: boolean;
  price_input_per_1m: number;
  price_output_per_1m: number;
  cache_read_discount_ratio: number;
  cache_write_discount_ratio: number;
};

type UniversalProxyAdminEnv = {
  baseUrl: string;
  adminToken: string;
};

const RESPONSE_DIAGNOSTIC_BODY_LIMIT = 2000;

async function readResponseTextForDiagnostics(response: APIResponse): Promise<string> {
  const text = await response.text();
  if (!text) return '<empty>';
  return text.length > RESPONSE_DIAGNOSTIC_BODY_LIMIT
    ? `${text.slice(0, RESPONSE_DIAGNOSTIC_BODY_LIMIT)}...<truncated>`
    : text;
}

async function expectApiResponseOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) return;
  const body = await readResponseTextForDiagnostics(response);
  throw new Error(`${label}_non_2xx: status=${response.status()} ${response.statusText()} body=${body}`);
}

function resolveUpstreamAdvertiseHost(): string {
  return process.env.MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST?.trim() || '127.0.0.1';
}

function resolveUpstreamListenHost(): string {
  return process.env.MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST?.trim() ? '0.0.0.0' : '127.0.0.1';
}

async function listenUpstreamServer(server: http.Server): Promise<UpstreamServer> {
  await new Promise<void>((resolve) => server.listen(0, resolveUpstreamListenHost(), () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://${resolveUpstreamAdvertiseHost()}:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function extractResponsesText(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  };
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }
  for (const item of record.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text;
      }
    }
  }
  return null;
}

function extractOpenAiCompatibleError(body: unknown): OpenAiCompatibleError | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const record = error as { code?: unknown; message?: unknown; type?: unknown };
  if (
    typeof record.code !== 'string'
    || record.code.trim().length === 0
    || typeof record.message !== 'string'
    || record.message.trim().length === 0
    || typeof record.type !== 'string'
    || record.type.trim().length === 0
  ) {
    return null;
  }
  return {
    code: record.code,
    message: record.message,
    type: record.type,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireUniversalProxyAdminEnv(): UniversalProxyAdminEnv {
  const baseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL?.trim().replace(/\/+$/, '');
  const adminToken = process.env.MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN?.trim();
  if (!baseUrl || !adminToken) {
    throw new Error('universal_proxy_admin_env_missing');
  }
  return { baseUrl, adminToken };
}

function readNamespaceConfigLike(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nestedConfig = value.config;
  if (isRecord(nestedConfig) && Array.isArray(nestedConfig.upstreams)) {
    return nestedConfig;
  }
  if (Array.isArray(value.upstreams)) {
    return value;
  }
  return null;
}

function findNamespaceConfigInAdminState(
  value: unknown,
  namespace: string,
  seen = new Set<unknown>(),
): Record<string, unknown> | null {
  if (!isRecord(value) && !Array.isArray(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (isRecord(value)) {
    const namedNamespace =
      value.namespace === namespace
      || value.name === namespace
      || value.id === namespace;
    if (namedNamespace) {
      const config = readNamespaceConfigLike(value);
      if (config) return config;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === namespace) {
        const config = readNamespaceConfigLike(child);
        if (config) return config;
      }
      const found = findNamespaceConfigInAdminState(child, namespace, seen);
      if (found) return found;
    }
    return null;
  }

  for (const child of value) {
    const found = findNamespaceConfigInAdminState(child, namespace, seen);
    if (found) return found;
  }
  return null;
}

function readPrimaryUpstream(config: Record<string, unknown>): Record<string, unknown> {
  const upstreams = config.upstreams;
  if (!Array.isArray(upstreams)) {
    throw new Error('universal_proxy_namespace_upstreams_missing');
  }
  const primary = upstreams.find((item) => isRecord(item) && item.name === 'primary');
  if (!isRecord(primary)) {
    throw new Error('universal_proxy_primary_upstream_missing');
  }
  return primary;
}

async function readUniversalProxyNamespaceConfig(page: Page, namespace: string): Promise<Record<string, unknown>> {
  const { baseUrl, adminToken } = requireUniversalProxyAdminEnv();
  const headers = { Authorization: `Bearer ${adminToken}` };
  const configMisses: string[] = [];
  const stateResponse = await page.request.get(`${baseUrl}/admin/state`, { headers });
  await expectApiResponseOk(stateResponse, 'universal_proxy_admin_state');
  const adminState = (await stateResponse.json()) as unknown;
  const stateConfig = findNamespaceConfigInAdminState(adminState, namespace);
  if (stateConfig) return stateConfig;

  const encodedNamespace = encodeURIComponent(namespace);
  const namespaceStateResponse = await page.request.get(
    `${baseUrl}/admin/namespaces/${encodedNamespace}/state`,
    { headers },
  );
  if (namespaceStateResponse.ok()) {
    const namespaceStateConfig = readNamespaceConfigLike(await namespaceStateResponse.json());
    if (namespaceStateConfig) return namespaceStateConfig;
    configMisses.push('namespace_state_missing_config');
  } else {
    configMisses.push(
      `namespace_state_status=${namespaceStateResponse.status()} body=${await readResponseTextForDiagnostics(namespaceStateResponse)}`,
    );
  }

  const namespaceConfigResponse = await page.request.get(
    `${baseUrl}/admin/namespaces/${encodedNamespace}/config`,
    { headers },
  );
  if (namespaceConfigResponse.ok()) {
    const namespaceConfig = readNamespaceConfigLike(await namespaceConfigResponse.json());
    if (namespaceConfig) return namespaceConfig;
    configMisses.push('namespace_config_missing_config');
  } else {
    configMisses.push(
      `namespace_config_status=${namespaceConfigResponse.status()} body=${await readResponseTextForDiagnostics(namespaceConfigResponse)}`,
    );
  }

  throw new Error(`universal_proxy_namespace_config_missing:${namespace}:${configMisses.join(';')}`);
}

async function issueDevToken(page: Page): Promise<string> {
  const keycloakBaseUrl = resolveIntegrationKeycloakBaseUrl(process.env, { target: 'host' });
  const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'mbos';
  const response = await page.request.post(`${keycloakBaseUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      grant_type: 'password',
      client_id: 'agentsmith',
      username: KEYCLOAK_DEV_ADMIN_USERNAME,
      password: KEYCLOAK_DEV_ADMIN_PASSWORD,
    },
  });
  await expectApiResponseOk(response, 'keycloak_dev_token');
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
      description: 'Universal proxy backend-real integration project',
    },
  });
  await expectApiResponseOk(response, 'create_project');
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
  await expectApiResponseOk(response, 'create_credential');
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
    upstreamProtocol: 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';
    modelProfile?: EndpointModelProfile;
  },
): Promise<string> {
  const providerFamily = args.upstreamProtocol === 'anthropic_messages' ? 'anthropic' : 'custom';
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
        type: 'custom',
        base_url: args.baseUrl,
        credential_ref: args.credentialRef,
        provider_family: providerFamily,
        upstream_protocol: args.upstreamProtocol,
        capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: args.model }],
        models: [{ capability: 'chat_completion', model_id: args.model, display_name: args.model }],
        defaults: { chat_model_id: args.model },
        ...(args.modelProfile ? { model_profile: args.modelProfile } : {}),
      },
    },
  );
  await expectApiResponseOk(response, 'create_endpoint');
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('endpoint_id_missing');
  return body.id;
}

async function startOpenAiChatCompletionsUpstream(replyText: string): Promise<UpstreamServer> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
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

  return listenUpstreamServer(server);
}

async function startOpenAiChatCompletionsRateLimitThenRecoveryUpstream(args: {
  throttledMessage: string;
  replyText: string;
}): Promise<UpstreamServer> {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      requestCount += 1;
      if (requestCount === 1) {
        res.statusCode = 429;
        res.setHeader('content-type', 'application/json');
        res.setHeader('retry-after', '1');
        res.end(
          JSON.stringify({
            error: {
              code: 'rate_limit_exceeded',
              message: args.throttledMessage,
              type: 'rate_limit_error',
            },
          }),
        );
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'chat.completion',
          id: 'chatcmpl_it_recovered',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: args.replyText,
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      );
    })();
  });

  const upstream = await listenUpstreamServer(server);
  return {
    ...upstream,
    getRequestCount: () => requestCount,
  };
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
          id: 'resp_it',
          object: 'response',
          output_text: replyText,
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: replyText }],
            },
          ],
        }),
      );
    })();
  });

  return listenUpstreamServer(server);
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

  return listenUpstreamServer(server);
}

test.describe('@lane-real integration universal proxy endpoint routes', () => {
  test('responses proxy works against openai-compatible endpoint in dev environment', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startOpenAiChatCompletionsUpstream('dev-universal-responses-ok');

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-responses-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-openai-${Date.now()}`,
        model: 'placeholder-model',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        upstreamProtocol: 'openai_chat_completions',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: 'placeholder-model',
            input: 'reply with exactly dev-universal-responses-ok',
            max_output_tokens: 64,
          },
        },
      );
      await expectApiResponseOk(response, 'proxy_openai_responses_from_chat_completions');
      const body = (await response.json()) as unknown;
      expect(extractResponsesText(body)).toBe('dev-universal-responses-ok');
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
        model: 'placeholder-model',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        upstreamProtocol: 'anthropic_messages',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/anthropic/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          data: {
            model: 'placeholder-model',
            max_tokens: 64,
            stream: true,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          },
        },
      );
      await expectApiResponseOk(response, 'proxy_anthropic_messages_stream');
      const body = await response.text();
      expect(response.headers()['content-type']).toContain('text/event-stream');
      expect(body).toContain('dev-universal-anthropic-ok');
    } finally {
      await upstream.stop();
    }
  });

  test('responses proxy passes through responses-native upstreams in dev environment', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startOpenAiResponsesUpstream('dev-universal-responses-native-ok');

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-responses-native-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-responses-native-${Date.now()}`,
        model: 'placeholder-model',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        upstreamProtocol: 'openai_responses',
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: 'placeholder-model',
            input: 'reply with exactly dev-universal-responses-native-ok',
            max_output_tokens: 64,
          },
        },
      );
      await expectApiResponseOk(response, 'proxy_openai_responses_native');
      const body = (await response.json()) as unknown;
      expect(extractResponsesText(body)).toBe('dev-universal-responses-native-ok');
    } finally {
      await upstream.stop();
    }
  });

  test('model profile runtime config is accepted and retained by the real universal proxy container', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startOpenAiResponsesUpstream('dev-universal-model-profile-ok');
    const model = 'it-model-profile-runtime';
    const modelProfile: EndpointModelProfile = {
      max_context_tokens: 200_000,
      max_output_tokens: 128_000,
      supports_file: true,
      supports_tool_call: true,
      supports_reasoning: true,
      price_input_per_1m: 0,
      price_output_per_1m: 0,
      cache_read_discount_ratio: 0,
      cache_write_discount_ratio: 0,
    };

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-model-profile-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-model-profile-${Date.now()}`,
        model,
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        upstreamProtocol: 'openai_responses',
        modelProfile,
      });

      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model,
            input: 'reply with exactly dev-universal-model-profile-ok',
            max_output_tokens: 64,
          },
        },
      );
      await expectApiResponseOk(response, 'proxy_model_profile_openai_responses');
      expect(extractResponsesText((await response.json()) as unknown)).toBe('dev-universal-model-profile-ok');

      const namespace = `ws_default__${projectId}__${endpointId}`;
      const config = await readUniversalProxyNamespaceConfig(page, namespace);
      const primary = readPrimaryUpstream(config);
      expect(primary).toMatchObject({
        name: 'primary',
        api_root: upstream.baseUrl,
        fixed_upstream_format: 'openai-responses',
        limits: {
          context_window: modelProfile.max_context_tokens,
          max_output_tokens: modelProfile.max_output_tokens,
        },
        surface_defaults: {
          modalities: {
            input: expect.arrayContaining(['text', 'file']),
            output: expect.arrayContaining(['text']),
          },
          tools: {
            supports_search: false,
            supports_view_image: false,
            apply_patch_transport: 'freeform',
            supports_parallel_calls: false,
          },
        },
      });
    } finally {
      await upstream.stop();
    }
  });

  test('responses proxy surfaces provider capacity errors clearly and recovers on the next explicit retry', async ({ page }) => {
    test.setTimeout(240_000);
    const upstream = await startOpenAiChatCompletionsRateLimitThenRecoveryUpstream({
      throttledMessage: 'Selected model is at capacity. Please retry shortly.',
      replyText: 'dev-universal-capacity-recovered',
    });

    try {
      const token = await issueDevToken(page);
      const projectId = await createProjectViaApi(page, token, `it-upx-capacity-${Date.now()}`);
      const credentialId = await createCredentialViaApi(page, token, projectId);
      const endpointId = await createEndpointViaApi(page, token, projectId, {
        name: `it-upx-capacity-${Date.now()}`,
        model: 'placeholder-model',
        baseUrl: upstream.baseUrl,
        credentialRef: credentialId,
        upstreamProtocol: 'openai_chat_completions',
      });

      const throttledResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: 'placeholder-model',
            input: 'trigger transient provider capacity',
            max_output_tokens: 64,
          },
        },
      );
      expect(throttledResponse.status()).toBe(429);
      expect(upstream.getRequestCount?.()).toBe(1);
      const throttledBody = (await throttledResponse.json()) as unknown;
      const throttledError = extractOpenAiCompatibleError(throttledBody);
      expect(throttledError).toEqual(expect.objectContaining({
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        message: expect.any(String),
      }));
      expect(throttledError?.message).toContain('Selected model is at capacity');
      expect(throttledError?.message).toMatch(/retry/i);

      const recoveredResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai/responses`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            model: 'placeholder-model',
            input: 'retry after provider capacity clears',
            max_output_tokens: 64,
          },
        },
      );
      await expectApiResponseOk(recoveredResponse, 'proxy_openai_responses_capacity_recovery');
      const recoveredBody = (await recoveredResponse.json()) as unknown;
      expect(extractResponsesText(recoveredBody)).toBe('dev-universal-capacity-recovered');
      expect(upstream.getRequestCount?.()).toBe(2);
    } finally {
      await upstream.stop();
    }
  });
});
