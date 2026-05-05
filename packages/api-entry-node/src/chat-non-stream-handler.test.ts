import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { ChatResourceService } from './chat-resource-service.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import {
  ACTIVE_CHAT_STREAMS,
  readStreamRegistry,
  writeSessionExecutionRecord,
  writeStreamRegistry,
} from './chat-stream-state.js';
import type { NodeApiDeps } from './node-api-deps.js';

afterEach(() => {
  ACTIVE_CHAT_STREAMS.clear();
  vi.clearAllMocks();
});

function createChatDeps() {
  const cache = new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  return {
    cache,
    docStore,
    chatResourceService,
    deps: {
      cache,
      docStore,
      chatResourceService,
    } as unknown as NodeApiDeps,
  };
}

describe('handleChatNonStreamRoute endpoint-only session contracts', () => {
  it('rejects external_agent_id on chat session create and update', async () => {
    const { deps } = createChatDeps();
    const json = vi.fn();

    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessions',
        workspaceId: 'ws_chat_contract',
        projectId: 'proj_chat_contract',
      },
      method: 'POST',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: 'user_chat_contract', name: 'Chat Contract', email: 'chat-contract@example.com' },
      requestUrl: new URL('http://localhost/api/v1/workspaces/ws_chat_contract/projects/proj_chat_contract/chat/sessions'),
      json,
      readBody: async () => ({
        title: 'Unsupported binding',
        model: 'gpt-5-codex',
        endpoint_id: 'ep_chat_contract',
        external_agent_id: 'agent_unsupported',
      }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenLastCalledWith(expect.anything(), 400, {
      error_code: 'unsupported_field',
      message: 'external_agent_id',
    });

    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionItem',
        workspaceId: 'ws_chat_contract',
        projectId: 'proj_chat_contract',
        sessionId: 'sess_chat_contract',
      },
      method: 'PATCH',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: 'user_chat_contract', name: 'Chat Contract', email: 'chat-contract@example.com' },
      requestUrl: new URL('http://localhost/api/v1/workspaces/ws_chat_contract/projects/proj_chat_contract/chat/sessions/sess_chat_contract'),
      json,
      readBody: async () => ({ external_agent_id: 'agent_unsupported' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenLastCalledWith(expect.anything(), 400, {
      error_code: 'unsupported_field',
      message: 'external_agent_id',
    });
  });

  it('deletes an endpoint chat session without requesting runner teardown', async () => {
    const { cache, docStore, chatResourceService } = createChatDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    const getAgent = vi.fn(async () => null);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_delete',
      projectId: 'proj_chat_delete',
      ownerUserId: 'user_chat_delete',
      model: 'gpt-5-codex',
      endpointId: 'ep_chat_delete',
      title: 'Endpoint Chat Delete',
    });

    const deps = {
      cache,
      docStore,
      chatResourceService,
      agentResourceService: { getAgent },
      internalWorkloadCoordinator: { requestHardTeardown },
    } as unknown as NodeApiDeps;
    const res = {} as http.ServerResponse;
    const json = vi.fn();

    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionItem',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'DELETE',
      req: { headers: {} } as http.IncomingMessage,
      res,
      deps,
      user: { id: session.owner_user_id, name: 'Chat Delete User', email: 'chat-delete@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}`),
      json,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(res, 200, { success: true });
    expect(getAgent).not.toHaveBeenCalled();
    expect(requestHardTeardown).not.toHaveBeenCalled();
  });
});

describe('handleChatNonStreamRoute endpoint-only stop truth', () => {
  it('stops a session and lists streams from the shared direct-provider execution record', async () => {
    const { cache, chatResourceService, deps } = createChatDeps();
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_shared',
      projectId: 'proj_chat_shared',
      ownerUserId: 'user_chat_shared',
      model: 'deepseek-chat',
      endpointId: 'ep_chat_shared',
      title: 'Shared Execution Session',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_shared_truth',
        ownerInstanceId: 'api-remote',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: session.endpoint_id,
      },
      60,
    );

    const stopJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionStop',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'POST',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Shared Stop User', email: 'shared-stop@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
      json: stopJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(stopJson).toHaveBeenCalledWith(expect.anything(), 202, {
      success: true,
      session_id: session.id,
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const listJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionStreams',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'GET',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Shared Stop User', email: 'shared-stop@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/streams`),
      json: listJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        {
          stream_id: 'stream_shared_truth',
          status: 'stopping',
          started_at: '2026-04-23T12:00:00.000Z',
        },
      ],
      total: 1,
    });
  });

  it('downgrades terminate to cooperative cancel for direct-provider session stop', async () => {
    const { cache, chatResourceService, deps } = createChatDeps();
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_direct_terminate',
      projectId: 'proj_chat_direct_terminate',
      ownerUserId: 'user_chat_direct_terminate',
      model: 'deepseek-chat',
      endpointId: 'ep_chat_direct_terminate',
      title: 'Direct Provider Terminate',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_direct_terminate',
        ownerInstanceId: 'api-remote',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: session.endpoint_id,
      },
      60,
    );

    const json = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionStop',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'POST',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Direct Stop User', email: 'direct-stop@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
      json,
      readBody: async () => ({ mode: 'terminate' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 202, {
      success: true,
      session_id: session.id,
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });
  });

  it('downgrades terminate to cooperative cancel for direct-provider stream stop', async () => {
    const cache = new InMemoryCache();
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');
    ACTIVE_CHAT_STREAMS.set('stream_chat_stream_direct_terminate', {
      workspaceId: 'ws_chat_stream_direct_terminate',
      projectId: 'proj_chat_stream_direct_terminate',
      sessionId: 'sess_chat_stream_direct_terminate',
      abortController,
      startedAt: '2026-04-23T12:00:00.000Z',
      status: 'running',
      assistantMessageId: 'msg_chat_stream_direct_terminate',
      parentMessageId: null,
      endpointId: 'ep_chat_stream_direct_terminate',
      model: 'deepseek-chat',
      contentSoFar: '',
      clients: new Set(),
    });

    const json = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatMessagesStreamStop',
        workspaceId: 'ws_chat_stream_direct_terminate',
        projectId: 'proj_chat_stream_direct_terminate',
        sessionId: 'sess_chat_stream_direct_terminate',
        streamId: 'stream_chat_stream_direct_terminate',
      },
      method: 'POST',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps: { cache } as unknown as NodeApiDeps,
      user: { id: 'user_stream_direct_terminate', name: 'Stream Direct Terminate', email: 'stream-direct-terminate@example.com' },
      requestUrl: new URL('http://localhost/api/v1/workspaces/ws_chat_stream_direct_terminate/projects/proj_chat_stream_direct_terminate/chat/sessions/sess_chat_stream_direct_terminate/messages/streams/stream_chat_stream_direct_terminate/stop'),
      json,
      readBody: async () => ({ mode: 'terminate' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 202, {
      success: true,
      stream_id: 'stream_chat_stream_direct_terminate',
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });
    expect(ACTIVE_CHAT_STREAMS.get('stream_chat_stream_direct_terminate')?.status).toBe('stopping');
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'stopped', 'failed'] as const)(
    'treats late terminate for a final %s stream registry as finished truth',
    async (finalStatus) => {
      const cache = new InMemoryCache();
      await writeStreamRegistry(
        cache,
        {
          streamId: `stream_chat_final_${finalStatus}`,
          workspaceId: 'ws_chat_final_registry',
          projectId: 'proj_chat_final_registry',
          sessionId: 'sess_chat_final_registry',
          status: finalStatus,
          updatedAt: '2026-04-23T12:00:00.000Z',
        },
        60,
      );

      const requestHardTeardown = vi.fn(async () => undefined);
      const json = vi.fn();
      await expect(handleChatNonStreamRoute({
        route: {
          kind: 'chatMessagesStreamStop',
          workspaceId: 'ws_chat_final_registry',
          projectId: 'proj_chat_final_registry',
          sessionId: 'sess_chat_final_registry',
          streamId: `stream_chat_final_${finalStatus}`,
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        deps: {
          cache,
          internalWorkloadCoordinator: { requestHardTeardown },
        } as unknown as NodeApiDeps,
        user: { id: 'user_chat_final_registry', name: 'Final Registry User', email: 'final-registry@example.com' },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/ws_chat_final_registry/projects/proj_chat_final_registry/chat/sessions/sess_chat_final_registry/messages/streams/stream_chat_final_${finalStatus}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(expect.anything(), 202, {
        success: true,
        stream_id: `stream_chat_final_${finalStatus}`,
        state: 'not_found_or_finished',
        status: 'not_found_or_finished',
        stop_mode: 'terminate',
        can_escalate: false,
        escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
      });
      await expect(readStreamRegistry(cache, `stream_chat_final_${finalStatus}`)).resolves.toMatchObject({
        status: finalStatus,
      });
      expect(requestHardTeardown).not.toHaveBeenCalled();
    },
  );
});

describe('handleChatNonStreamRoute endpoint-only message bindings', () => {
  it('validates attachment sends against endpoint capabilities without consulting agents', async () => {
    const { chatResourceService, deps } = createChatDeps();
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_message',
      projectId: 'proj_chat_message',
      ownerUserId: 'user_chat_message',
      model: 'gpt-5-codex',
      endpointId: 'ep_chat_text_only',
      title: 'Attachment Send',
    });
    const getAgent = vi.fn(async () => null);
    const getEndpoint = vi.fn(async () => ({
      id: 'ep_chat_text_only',
      workspace_id: session.workspace_id,
      project_id: session.project_id,
      name: 'Text only',
      provider: 'openai',
      model: session.model,
      status: 'active',
      capabilities: [{ type: 'chat_completion', enabled: true }],
      created_at: '2026-04-23T12:00:00.000Z',
      updated_at: '2026-04-23T12:00:00.000Z',
    }));
    const json = vi.fn();

    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatMessages',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'POST',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps: {
        ...deps,
        agentResourceService: { getAgent },
        endpointResourceService: { getEndpoint },
      } as unknown as NodeApiDeps,
      user: { id: session.owner_user_id, name: 'Chat Message User', email: 'chat-message@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/messages`),
      json,
      readBody: async () => ({
        role: 'user',
        content: 'Please inspect this file',
        inputs: [{ kind: 'url', url: 'https://example.com/image.png' }],
      }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 422, {
      error_code: 'VALIDATION_ERROR',
      message: 'chat_endpoint_not_multimodal',
    });
    expect(getEndpoint).toHaveBeenCalledWith(session.workspace_id, session.project_id, session.endpoint_id);
    expect(getAgent).not.toHaveBeenCalled();
  });
});
