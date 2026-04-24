import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { ChatResourceService } from './chat-resource-service.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { ACTIVE_CHAT_STREAMS, writeSessionExecutionRecord } from './chat-stream-state.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { NodeApiDeps } from './node-api-deps.js';

afterEach(() => {
  ACTIVE_CHAT_STREAMS.clear();
  vi.clearAllMocks();
});

describe('handleChatNonStreamRoute delete lifecycle', () => {
  it('requests hard teardown for internal chat sessions and releases the pod after the active stream holder exits', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_delete',
      projectId: 'proj_chat_delete',
      ownerUserId: 'user_chat_delete',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_delete',
      title: 'Internal Chat Delete',
    });
    const holder = {
      workspaceId: 'ws_chat_delete',
      projectId: 'proj_chat_delete',
      workloadId: sanitizeWorkloadId(session.id),
      holderKind: 'chat_stream' as const,
      holderId: session.id,
    };
    await internalWorkloadCoordinator.acquireHolder(holder);

    const abortController = new AbortController();
    const originalAbort = abortController.abort.bind(abortController);
    abortController.abort = () => {
      originalAbort();
      queueMicrotask(() => {
        void internalWorkloadCoordinator.releaseHolder(holder);
      });
    };
    ACTIVE_CHAT_STREAMS.set('stream_chat_delete', {
      workspaceId: 'ws_chat_delete',
      projectId: 'proj_chat_delete',
      sessionId: session.id,
      abortController,
      startedAt: new Date().toISOString(),
      status: 'running',
      assistantMessageId: 'msg_chat_delete',
      parentMessageId: null,
      endpointId: 'agent:agent_chat_internal_delete',
      model: 'gpt-5-codex',
      contentSoFar: '',
      clients: new Set(),
    });

    const json = vi.fn();
    const res = {} as http.ServerResponse;
    const deps = {
      cache,
      docStore,
      chatResourceService,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_chat_internal_delete',
          workspace_id: 'ws_chat_delete',
          project_id: 'proj_chat_delete',
          name: 'internal-chat-delete',
          mode: 'internal',
          status: 'enabled',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      internalWorkloadCoordinator,
    } as unknown as NodeApiDeps;

    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionItem',
        workspaceId: 'ws_chat_delete',
        projectId: 'proj_chat_delete',
        sessionId: session.id,
      },
      method: 'DELETE',
      req: { headers: {} } as http.IncomingMessage,
      res,
      deps,
      user: { id: 'user_chat_delete', name: 'Chat Delete User', email: 'chat-delete@example.com' },
      requestUrl: new URL('http://localhost/api/v1/workspaces/ws_chat_delete/projects/proj_chat_delete/chat/sessions'),
      json,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(res, 200, { success: true });
    expect(ACTIVE_CHAT_STREAMS.get('stream_chat_delete')?.status).toBe('stopping');
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledWith(
        'ws_chat_delete',
        'proj_chat_delete',
        sanitizeWorkloadId(session.id),
      );
    });
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);
    await internalWorkloadCoordinator.shutdown();
  });
});

describe('handleChatNonStreamRoute shared execution truth', () => {
  it('stops a session and lists streams from the shared execution record without a local active stream', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
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
        transport: 'direct_provider',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: session.endpoint_id,
      },
      60,
    );

    const deps = {
      cache,
      docStore,
      chatResourceService,
    } as unknown as NodeApiDeps;

    const stopRes = {} as http.ServerResponse;
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
      res: stopRes,
      deps,
      user: { id: session.owner_user_id, name: 'Shared Stop User', email: 'shared-stop@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
      json: stopJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(stopJson).toHaveBeenCalledWith(stopRes, 202, {
      success: true,
      session_id: session.id,
      state: 'stopping',
    });

    const listRes = {} as http.ServerResponse;
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
      res: listRes,
      deps,
      user: { id: session.owner_user_id, name: 'Shared Stop User', email: 'shared-stop@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/streams`),
      json: listJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(listRes, 200, {
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
});
