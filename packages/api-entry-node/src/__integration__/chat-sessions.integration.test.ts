import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { UniversalProxyService } from '../universal-proxy-service.js';
import { apiFetch, startServer, startServerWithDeps } from './test-support.js';
import { JsonDocProjectFileLibraryCatalogRepo } from '../file-library-persistence.js';
import {
  cleanupChatUpstreamServers,
  parseSseEventPayload,
  startOpenAICompatibleUpstreamServer,
  startUniversalProxyChatServer,
} from './chat-test-support.js';

afterEach(async () => {
  await cleanupChatUpstreamServers();
});

async function createChatEndpointAndSession(baseUrl: string, endpointBaseUrl: string): Promise<{
  endpointId: string;
  sessionId: string;
}> {
  const createCredential = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
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

  const createEndpoint = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'chat-endpoint',
        model: 'deepseek-chat',
        type: 'custom',
        base_url: endpointBaseUrl,
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

  const createSession = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
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

describe('api-entry-node chat session routes', () => {
  it('provisions a workspace file library for internal-agent chat sessions', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);
    const internalAgent = await deps.agentResourceService.createAgent(
      'ws_default',
      'proj_1',
      {
        name: 'internal-chat',
        mode: 'internal',
        interaction_kind: 'chat',
        status: 'enabled',
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_test',
        } as never,
        owner_id: 'user_test',
        visibility: 'private',
        execution_preferences_json: {
          chat: {
            endpoint_id: 'ep_internal',
          },
        },
      },
    );

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          external_agent_id: internalAgent.id,
          model: 'gpt-5-codex',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as {
      id: string;
      workspace_file_library_id?: string;
      workspace_file_library_name?: string;
    };
    expect(session.workspace_file_library_id).toMatch(/^flib_/);
    expect(session.workspace_file_library_name).toBeTruthy();

    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);
    const workspaceLibrary = await catalogRepo.getById(
      'ws_default',
      'proj_1',
      session.workspace_file_library_id ?? '',
    );
    expect(workspaceLibrary).toMatchObject({
      id: session.workspace_file_library_id,
      name: session.workspace_file_library_name,
      created_by_user_id: 'user_test',
      status: 'ready',
    });
  });

  it('applies chat pagination defaults and bounds consistently', async () => {
    const { baseUrl } = startServer();
    const upstream = await startOpenAICompatibleUpstreamServer();
    const { sessionId } = await createChatEndpointAndSession(baseUrl, upstream.baseUrl);

    const createMessage = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createMessage.status).toBe(201);

    const listSessionsInvalid = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions?page=abc&page_size=xyz',
    );
    expect(listSessionsInvalid.status).toBe(200);
    const sessionsInvalidBody = (await listSessionsInvalid.json()) as { page: number; page_size: number };
    expect(sessionsInvalidBody.page).toBe(1);
    expect(sessionsInvalidBody.page_size).toBe(100);

    const listSessionsBounded = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions?page=0&page_size=9999',
    );
    expect(listSessionsBounded.status).toBe(200);
    const sessionsBoundedBody = (await listSessionsBounded.json()) as { page: number; page_size: number };
    expect(sessionsBoundedBody.page).toBe(1);
    expect(sessionsBoundedBody.page_size).toBe(500);

    const listMessagesInvalid = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages?page=abc&page_size=xyz`,
    );
    expect(listMessagesInvalid.status).toBe(200);
    const messagesInvalidBody = (await listMessagesInvalid.json()) as { page: number; page_size: number };
    expect(messagesInvalidBody.page).toBe(1);
    expect(messagesInvalidBody.page_size).toBe(200);

    const listMessagesBounded = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages?page=0&page_size=9999`,
    );
    expect(listMessagesBounded.status).toBe(200);
    const messagesBoundedBody = (await listMessagesBounded.json()) as { page: number; page_size: number };
    expect(messagesBoundedBody.page).toBe(1);
    expect(messagesBoundedBody.page_size).toBe(500);
  });

  it('supports user revision and assistant variants for chat branching', async () => {
    const upstream = await startUniversalProxyChatServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);
    const { endpointId, sessionId } = await createChatEndpointAndSession(baseUrl, upstream.baseUrl);

    const userMsgRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'draft question' }),
      },
    );
    expect(userMsgRes.status).toBe(201);
    const userMessage = (await userMsgRes.json()) as {
      id: string;
      logical_id?: string;
      revision_index?: number;
    };
    expect(userMessage.logical_id).toBeTruthy();
    expect(userMessage.revision_index).toBe(0);

    const revisedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/${userMessage.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'revised question' }),
      },
    );
    expect(revisedRes.status).toBe(200);
    const revised = (await revisedRes.json()) as {
      id: string;
      logical_id?: string;
      revision_of?: string | null;
      revision_index?: number;
    };
    expect(revised.id).not.toBe(userMessage.id);
    expect(revised.logical_id).toBe(userMessage.logical_id);
    expect(revised.revision_of).toBe(userMessage.id);
    expect(revised.revision_index).toBe(1);

    const firstStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          from_message_id: revised.id,
        }),
      },
    );
    expect(firstStream.status).toBe(200);
    const firstSse = await firstStream.text();
    const firstDone = parseSseEventPayload(firstSse, 'done');
    expect(firstDone).toBeTruthy();
    const firstAssistantId = String(firstDone?.message_id ?? '');
    expect(firstAssistantId).toContain('chat_msg_');

    const secondStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          from_message_id: firstAssistantId,
        }),
      },
    );
    expect(secondStream.status).toBe(200);
    const secondSse = await secondStream.text();
    const secondDone = parseSseEventPayload(secondSse, 'done');
    const secondAssistantId = String(secondDone?.message_id ?? '');
    expect(secondAssistantId).toContain('chat_msg_');
    expect(secondAssistantId).not.toBe(firstAssistantId);
    expect(upstream.configRequests()).toHaveLength(1);
    expect((upstream.configRequests()[0]?.body as {
      if_revision?: string | null;
      revision?: string;
    }).revision).toBeUndefined();
    expect((upstream.configRequests()[0]?.body as {
      if_revision?: string | null;
    }).if_revision ?? null).toBeNull();
    expect(upstream.configRequests()[0]?.appliedRevision).toEqual(expect.any(String));

    const history = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
    );
    expect(history.status).toBe(200);
    const messages = (await history.json()) as {
      items: Array<{
        id: string;
        role: 'user' | 'assistant';
        parent_id?: string | null;
        revision_index?: number;
        variant_group_id?: string;
        variant_index?: number;
      }>;
    };

    const userRevisions = messages.items.filter((item) => item.role === 'user');
    expect(userRevisions.length).toBe(2);

    const assistantVariants = messages.items.filter((item) => item.role === 'assistant');
    expect(assistantVariants.length).toBe(2);
    expect(assistantVariants[0].parent_id).toBe(revised.id);
    expect(assistantVariants[1].parent_id).toBe(revised.id);
    expect(assistantVariants[0].variant_group_id).toBe(assistantVariants[1].variant_group_id);
    expect(assistantVariants[0].variant_index).toBe(0);
    expect(assistantVariants[1].variant_index).toBe(1);
  });

  it('supports paginated chat messages list', async () => {
    const { baseUrl } = startServer();
    const upstream = await startOpenAICompatibleUpstreamServer();
    const { sessionId } = await createChatEndpointAndSession(baseUrl, upstream.baseUrl);

    for (const content of ['m1', 'm2', 'm3']) {
      const created = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', content }),
        },
      );
      expect(created.status).toBe(201);
    }

    const page1 = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages?page=1&page_size=2`,
    );
    expect(page1.status).toBe(200);
    const page1Body = (await page1.json()) as {
      items: Array<{ content: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(page1Body.total).toBe(3);
    expect(page1Body.page).toBe(1);
    expect(page1Body.page_size).toBe(2);
    expect(page1Body.has_more).toBe(true);
    expect(page1Body.items.map((item) => item.content)).toEqual(['m1', 'm2']);

    const page2 = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages?page=2&page_size=2`,
    );
    expect(page2.status).toBe(200);
    const page2Body = (await page2.json()) as {
      items: Array<{ content: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(page2Body.total).toBe(3);
    expect(page2Body.page).toBe(2);
    expect(page2Body.page_size).toBe(2);
    expect(page2Body.has_more).toBe(false);
    expect(page2Body.items.map((item) => item.content)).toEqual(['m3']);
  });
});
