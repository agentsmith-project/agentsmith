import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { ChatResourceService } from './chat-resource-service.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { ACTIVE_CHAT_STREAMS } from './chat-stream-state.js';
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
