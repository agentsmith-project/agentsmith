import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, startServer } from './test-support.js';
import {
  cleanupChatUpstreamServers,
  createChatSession,
  parseSseEventPayload,
  startUniversalProxyChatServer,
} from './chat-test-support.js';
import { createDefaultNodeApiDeps } from '../index.js';
import { startServerWithDeps } from './test-support.js';
import { UniversalProxyService } from '../universal-proxy-service.js';

const originalUniversalProxyBaseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;

afterEach(async () => {
  await cleanupChatUpstreamServers();
  if (originalUniversalProxyBaseUrl === undefined) {
    delete process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
  } else {
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = originalUniversalProxyBaseUrl;
  }
});

describe('api-entry-node chat stream routes', () => {
  it('returns 404 when listing streams for unknown session', async () => {
    const { baseUrl } = startServer();
    const res = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/chat_sess_unknown/streams',
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('chat_session_not_found');
  });

  it('supports chat stream via project endpoint and persists assistant reply', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const sse = await stream.text();
    expect(sse).toContain('event: meta');
    expect(sse).toContain('event: delta');
    expect(sse).toContain('"delta":"Hello"');
    expect(sse).toContain('"delta":" from universal proxy."');
    expect(sse).toContain('event: done');

    const history = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages`,
    );
    expect(history.status).toBe(200);
    const messages = (await history.json()) as {
      items: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    expect(messages.items.length).toBe(2);
    expect(messages.items[0]).toMatchObject({ role: 'user', content: 'hello from user' });
    expect(messages.items[1]).toMatchObject({ role: 'assistant', content: 'Hello from universal proxy.' });

    const upstreamBody = universalProxy.lastBody() as { model?: string; messages?: Array<{ role: string }> };
    expect(upstreamBody.model).toBe('deepseek-chat');
    expect(upstreamBody.messages?.at(-1)?.role).toBe('user');
    expect(universalProxy.configRequests()).toHaveLength(1);
    expect((universalProxy.configRequests()[0]?.body as {
      if_revision?: string | null;
      revision?: string;
    }).revision).toBeUndefined();
    expect((universalProxy.configRequests()[0]?.body as {
      if_revision?: string | null;
    }).if_revision ?? null).toBeNull();
    expect(universalProxy.configRequests()[0]?.appliedRevision).toEqual(expect.any(String));
    expect(universalProxy.lastPath()).toContain(`/namespaces/ws_default__proj_1__${endpointId}/openai/v1/chat/completions`);
  });

  it('supports stopping an active stream by session id', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    const stopBody = (await stopBySession.json()) as {
      state: string;
      status: string;
      stop_mode: string;
      can_escalate: boolean;
      escalation_reason?: string;
    };
    expect(stopBody.state).toBe('stopping');
    expect(stopBody.status).toBe('stopping');
    expect(stopBody.stop_mode).toBe('cancel');
    expect(stopBody.can_escalate).toBe(false);
    expect(stopBody.escalation_reason).toBe('STOP_ESCALATION_UNAVAILABLE');

    const sse = await stream.text();
    const done = parseSseEventPayload(sse, 'done');
    expect(done?.message_status).toBe('stopped');
  });

  it('reports cooperative cancel truth when direct-provider session terminate is unavailable', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello terminate unavailable' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'terminate' }),
      },
    );
    expect(stopBySession.status).toBe(202);
    await expect(stopBySession.json()).resolves.toMatchObject({
      success: true,
      session_id: sessionId,
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const sse = await stream.text();
    const done = parseSseEventPayload(sse, 'done');
    expect(done?.message_status).toBe('stopped');
  });

  it('lists active stream ids by session for refresh recovery', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);

    const activeStreams = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/streams`,
    );
    expect(activeStreams.status).toBe(200);
    const activeBody = (await activeStreams.json()) as {
      items: Array<{ stream_id: string; status: string; started_at: string }>;
      total: number;
    };
    expect(activeBody.total).toBe(1);
    expect(activeBody.items[0]?.stream_id).toContain('stream_');
    expect(activeBody.items[0]?.status).toBe('running');
    expect(typeof activeBody.items[0]?.started_at).toBe('string');

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    await stream.text();
  });

  it('returns empty active stream list after stream completion', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    await stream.text();

    const activeStreams = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/streams`,
    );
    expect(activeStreams.status).toBe(200);
    const activeBody = (await activeStreams.json()) as {
      items: Array<{ stream_id: string; status: string; started_at: string }>;
      total: number;
    };
    expect(activeBody.total).toBe(0);
    expect(activeBody.items).toHaveLength(0);
  });

  it('rejects starting a second active stream for the same session', async () => {
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    const { endpointId, sessionId, userMessageId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );

    const firstStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(firstStream.status).toBe(200);

    const secondStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessageId,
          input: { role: 'user', content: 'hello from user again' },
        }),
      },
    );
    expect(secondStream.status).toBe(409);
    await expect(secondStream.json()).resolves.toMatchObject({
      error_code: 'CHAT_SESSION_STREAM_CONFLICT',
      message: 'chat_session_stream_conflict',
    });

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    await firstStream.text();
  });

  it('streams branch recall turns through the endpoint and never dispatches an agent runner request', async () => {
    const deps = createDefaultNodeApiDeps();
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_runner_dispatch_unexpected',
      stream: (async function* () {
        yield { type: 'delta' as const, delta: 'SHOULD_NOT_RUN' };
      })(),
      cancel: () => undefined,
    }));
    deps.agentExecutionService.dispatchStreamingRequest =
      dispatchStreamingRequest as typeof deps.agentExecutionService.dispatchStreamingRequest;
    const universalProxy = await startUniversalProxyChatServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    deps.universalProxyService = new UniversalProxyService(universalProxy.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);

    const { endpointId, sessionId } = await createChatSession(
      baseUrl,
      'https://openai-compatible.provider.example/v1',
    );
    const rememberUser = await deps.chatResourceService.createMessage({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId,
      role: 'user',
      content: 'Remember this token for our session: CHAT_CONTINUITY_OK',
    });
    const visibleAssistant = await deps.chatResourceService.createMessage({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId,
      role: 'assistant',
      content: 'I will remember CHAT_CONTINUITY_OK',
      parentId: rememberUser.id,
      variantGroupId: `asst_${rememberUser.id}`,
      variantIndex: 0,
    });
    await deps.chatResourceService.createMessage({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId,
      role: 'assistant',
      content: 'I do not remember previous sessions',
      parentId: rememberUser.id,
      variantGroupId: `asst_${rememberUser.id}`,
      variantIndex: 1,
    });
    const recallUser = await deps.chatResourceService.createMessage({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId,
      role: 'user',
      content: 'After refresh, what token did I ask you to remember?',
      parentId: visibleAssistant.id,
    });

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpointId,
          branch_leaf_message_id: recallUser.id,
          input: { role: 'user', content: recallUser.content },
        }),
      },
    );

    expect(stream.status).toBe(200);
    await stream.text();
    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(universalProxy.lastBody()).toMatchObject({
      messages: [
        {
          role: 'user',
          content: 'Remember this token for our session: CHAT_CONTINUITY_OK',
        },
        {
          role: 'assistant',
          content: 'I will remember CHAT_CONTINUITY_OK',
        },
        {
          role: 'user',
          content: 'After refresh, what token did I ask you to remember?',
        },
      ],
    });
  });
});
