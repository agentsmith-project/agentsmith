import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { UniversalProxyService } from '../universal-proxy-service.js';
import { apiFetchWithToken, startServerWithDeps } from './test-support.js';
import {
  cleanupChatUpstreamServers,
  startOpenAICompatibleUpstreamServer,
} from './chat-test-support.js';

afterEach(async () => {
  await cleanupChatUpstreamServers();
});

async function createChatEndpointAndSession(baseUrl: string): Promise<{ endpointId: string; sessionId: string }> {
  const upstream = startOpenAICompatibleUpstreamServer();
  const createCredential = await apiFetchWithToken(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
    'test-token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'chat-key',
        type: 'api_key',
        value: 'sk-chat',
      }),
    },
  );
  expect(createCredential.status).toBe(201);
  const credential = (await createCredential.json()) as { id: string };

  const createEndpoint = await apiFetchWithToken(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    'test-token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'chat-endpoint',
        model: 'deepseek-chat',
        type: 'custom',
        base_url: upstream.baseUrl,
        credential_ref: credential.id,
        provider_family: 'openai',
        upstream_protocol: 'openai_chat_completions',
        capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'deepseek-chat' }],
        models: [{ capability: 'chat_completion', model_id: 'deepseek-chat' }],
        defaults: { chat_model_id: 'deepseek-chat' },
      }),
    },
  );
  expect(createEndpoint.status).toBe(201);
  const endpoint = (await createEndpoint.json()) as { id: string };

  const createSession = await apiFetchWithToken(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
    'test-token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat' }),
    },
  );
  expect(createSession.status).toBe(201);
  const session = (await createSession.json()) as { id: string };
  return { endpointId: endpoint.id, sessionId: session.id };
}

describe('api-entry-node chat isolation', () => {
  it('isolates chat sessions and messages by owner user', async () => {
    const upstream = startOpenAICompatibleUpstreamServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl.replace(/\/v1$/, ''));
    const { baseUrl } = startServerWithDeps(deps);
    const { sessionId } = await createChatEndpointAndSession(baseUrl);

    const createMessage = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
      'test-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'hello from owner' }),
      },
    );
    expect(createMessage.status).toBe(201);

    const ownerList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      'test-token',
    );
    expect(ownerList.status).toBe(200);
    const ownerListBody = (await ownerList.json()) as { items: Array<{ id: string }> };
    expect(ownerListBody.items.map((item) => item.id)).toContain(sessionId);

    const otherList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      'owner-token',
    );
    expect(otherList.status).toBe(200);
    const otherListBody = (await otherList.json()) as { items: Array<{ id: string }> };
    expect(otherListBody.items).toEqual([]);

    const otherGet = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}`,
      'owner-token',
    );
    expect(otherGet.status).toBe(404);

    const otherMessages = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
      'owner-token',
    );
    expect(otherMessages.status).toBe(404);

    const otherPost = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'cross user write' }),
      },
    );
    expect(otherPost.status).toBe(404);

    const otherStream = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { role: 'user', content: 'stream' } }),
      },
    );
    expect(otherStream.status).toBe(404);
  });
});
