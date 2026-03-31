import { execFileSync } from 'node:child_process';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { issueInternalTicket } from '../internal-ticket-store.js';
import { apiFetch, startServer } from './test-support.js';
import { recordUsageFact } from '../audit-usage-store.js';

const upstreamServers: Server[] = [];
function allocateMockProxyPort(): number {
  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_mock_proxy_port:${raw}`);
  }
  return port;
}
const originalUniversalProxyBaseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;

afterEach(async () => {
  await Promise.all(
    upstreamServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  upstreamServers.length = 0;
  if (originalUniversalProxyBaseUrl === undefined) {
    delete process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
  } else {
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = originalUniversalProxyBaseUrl;
  }
});

function startUniversalProxyMockServer(): {
  baseUrl: string;
  configRequests: () => Array<{ namespace: string; body: unknown }>;
  namespaceRequests: () => Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }>;
} {
  const configRequests: Array<{ namespace: string; body: unknown }> = [];
  const namespaceRequests: Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }> = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      const body = text ? JSON.parse(text) : {};

      const configMatch = requestUrl.pathname.match(/^\/admin\/namespaces\/([^/]+)\/config$/);
      if (req.method === 'POST' && configMatch) {
        configRequests.push({
          namespace: decodeURIComponent(configMatch[1]),
          body,
        });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'applied' }));
        return;
      }

      const namespaceMatch = requestUrl.pathname.match(/^\/namespaces\/([^/]+)\/(.+)$/);
      if (req.method === 'POST' && namespaceMatch) {
        namespaceRequests.push({
          method: req.method,
          path: requestUrl.pathname,
          headers: req.headers,
          body,
        });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, echoed: body }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  const port = allocateMockProxyPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    configRequests: () => configRequests,
    namespaceRequests: () => namespaceRequests,
  };
}

describe('api-entry-node endpoint and credential routes', () => {
  it('accepts scoped execution tickets for endpoint proxy and rejects misuse on other routes', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'exec-scope-key',
      value: 'sk-exec-scope',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'exec-scope-endpoint',
      model: 'scope-model',
      type: 'openai',
      base_url: 'https://openai-compatible.provider.example/v1',
      credential_ref: credential.id,
      provider_family: 'openai',
      protocol: 'openai_compatible',
    });
    const otherEndpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'other-endpoint',
      model: 'other-model',
      type: 'openai',
      base_url: 'https://openai-compatible.provider.example/v1',
      credential_ref: credential.id,
      provider_family: 'openai',
      protocol: 'openai_compatible',
    });

    const executionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      maxUses: 5,
      payload: {
        endpoint_id: endpoint.id,
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });

    const okRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'ignored',
          input: 'hello via execution ticket',
        }),
      },
    );
    expect(okRes.status).toBe(200);

    const wrongEndpointRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${otherEndpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'ignored',
          input: 'wrong endpoint',
        }),
      },
    );
    expect(wrongEndpointRes.status).toBe(403);
    await expect(wrongEndpointRes.json()).resolves.toMatchObject({
      error_code: 'INTERNAL_TICKET_SCOPE_MISMATCH',
    });

    const wrongPurposeTicket = await issueInternalTicket(deps.cache, {
      purpose: 'sse_access',
      userId: 'user_test',
      prefix: 'sse',
      maxUses: 5,
      payload: {
        bearer_token: 'jwt-token-123',
      },
    });
    const wrongPurposeRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wrongPurposeTicket.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'ignored',
          input: 'wrong purpose',
        }),
      },
    );
    expect(wrongPurposeRes.status).toBe(403);
    await expect(wrongPurposeRes.json()).resolves.toMatchObject({
      error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
    });

    const meRes = await fetch(`${baseUrl}/api/v1/me/profile`, {
      headers: {
        Authorization: `Bearer ${executionTicket.ticket}`,
      },
    });
    expect(meRes.status).toBe(403);
    await expect(meRes.json()).resolves.toMatchObject({
      error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
    });

    const sseTicketRes = await fetch(`${baseUrl}/api/v1/sse-ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${executionTicket.ticket}`,
      },
    });
    expect(sseTicketRes.status).toBe(403);
    await expect(sseTicketRes.json()).resolves.toMatchObject({
      error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
    });

    const expiredExecutionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      ttlMs: 1,
      payload: {
        endpoint_id: endpoint.id,
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const expiredRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expiredExecutionTicket.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'ignored',
          input: 'expired ticket',
        }),
      },
    );
    expect(expiredRes.status).toBe(401);
  });

  it('supports credentials and endpoints CRUD plus openai-compatible proxy', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'deepseek-key',
          type: 'api_key',
          value: 'sk-test',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string; fingerprint: string };
    expect(credential.id).toContain('cred_');
    expect(credential.fingerprint.length).toBeGreaterThan(0);

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'deepseek-chat',
          model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://openai-compatible.provider.example/v1',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };
    expect(endpoint.id).toContain('ep_');

    const proxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'will-be-overridden',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      },
    );
    expect(proxy.status).toBe(200);
    const proxied = (await proxy.json()) as { ok: boolean };
    expect(proxied.ok).toBe(true);
    expect(universalProxy.configRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/openai/v1/chat/completions`,
    );
    const echoed = universalProxy.namespaceRequests()[0]?.body as { model?: string };
    expect(echoed.model).toBe('deepseek-chat');

    const usageStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const usageEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(usageStart)}&end_time=${encodeURIComponent(usageEnd)}&resource_type=endpoint&page=1&page_size=50`,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      items: Array<{ resource_type: string; resource_id?: string; requests: number }>;
    };
    expect(
      usageBody.items.some(
        (item) => item.resource_type === 'endpoint' && item.resource_id === endpoint.id && item.requests >= 1,
      ),
    ).toBe(true);

    const denyPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'someone_else' }],
        }),
      },
    );
    expect(denyPolicyRes.status).toBe(204);

    const deniedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked' }],
        }),
      },
    );
    expect(deniedProxy.status).toBe(403);
    expect(await deniedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_DENIED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });

    const allowUserPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'user_test' }],
        }),
      },
    );
    expect(allowUserPolicyRes.status).toBe(204);

    const allowListedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'allowed via group' }],
        }),
      },
    );
    expect(allowListedProxy.status).toBe(200);

    const rateLimitPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 2 }] },
        }),
      },
    );
    expect(rateLimitPolicyRes.status).toBe(204);

    const firstRateLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'allowed first under rpm policy' }],
        }),
      },
    );
    expect(firstRateLimitedProxy.status).toBe(200);

    const secondRateLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked by rpm policy' }],
        }),
      },
    );
    expect(secondRateLimitedProxy.status).toBe(200);

    const thirdRateLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked by rpm policy' }],
        }),
      },
    );
    expect(thirdRateLimitedProxy.status).toBe(429);
    expect(await thirdRateLimitedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });

    const auditStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const auditEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(auditStart)}&end_time=${encodeURIComponent(auditEnd)}&action=resource_policy.rate_limited&page=1&page_size=20`,
    );
    expect(auditRateRes.status).toBe(200);
    const auditRateBody = (await auditRateRes.json()) as { items: Array<{ action: string; resource_type?: string }> };
    expect(
      auditRateBody.items.some((item) => item.action === 'resource_policy.rate_limited' && item.resource_type === 'endpoint'),
    ).toBe(true);

    const usageRateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(usageStart)}&end_time=${encodeURIComponent(usageEnd)}&resource_type=endpoint&page=1&page_size=100`,
    );
    expect(usageRateRes.status).toBe(200);
    const usageRateBody = (await usageRateRes.json()) as {
      items: Array<{ resource_type: string; requests: number }>;
    };
    expect(usageRateBody.items.some((item) => item.resource_type === 'endpoint' && item.requests >= 1)).toBe(true);

    const resetPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1000 }] },
          spending_limits: { rules: [] },
        }),
      },
    );
    expect(resetPolicyRes.status).toBe(204);

    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      end_user_id: 'user_test',
      requests: 3,
      result: 'ok',
    });
  });

  it('records credential and endpoint configuration changes in audit events', async () => {
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_1' },
        body: JSON.stringify({
          name: 'audit-credential',
          type: 'api_key',
          value: 'sk-audit',
        }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_2' },
        body: JSON.stringify({
          name: 'audit-endpoint',
          model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.invalid',
          credential_ref: credential.id,
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; request_id: string }>;
    };
    expect(audit.items.some((item) => item.action === 'credential.create' && item.resource_type === 'credential' && item.resource_id === credential.id && item.request_id === 'req_cfg_1')).toBe(true);
    expect(audit.items.some((item) => item.action === 'endpoint.create' && item.resource_type === 'endpoint' && item.resource_id === endpoint.id && item.request_id === 'req_cfg_2')).toBe(true);
  });
});
