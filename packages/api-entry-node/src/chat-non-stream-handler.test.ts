import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { ChatResourceService } from './chat-resource-service.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import {
  ACTIVE_CHAT_STREAMS,
  readSessionExecutionRecord,
  readStreamRegistry,
  writeSessionExecutionRecord,
  writeStreamRegistry,
} from './chat-stream-state.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { NodeApiDeps } from './node-api-deps.js';

class SessionExecutionReadBarrierCache extends InMemoryCache {
  private blockedReads = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly barrierReadCount: number) {
    super();
  }

  override async get(key: string): Promise<string | null> {
    if (key.startsWith('chat:session-stream:') && this.blockedReads < this.barrierReadCount) {
      this.blockedReads += 1;
      if (this.blockedReads >= this.barrierReadCount) {
        for (const resolve of this.waiters.splice(0)) resolve();
      } else {
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    }
    return super.get(key);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

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
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
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

  it('returns cooperative cancel truth when terminate is unavailable for direct provider sessions', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
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
    const res = {} as http.ServerResponse;
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
      res,
      deps,
      user: { id: session.owner_user_id, name: 'Direct Terminate User', email: 'direct-terminate@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
      json,
      readBody: async () => ({ mode: 'terminate' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(res, 202, {
      success: true,
      session_id: session.id,
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const detailJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionItem',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'GET',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Direct Terminate User', email: 'direct-terminate@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}`),
      json: detailJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);
    const detailBody = detailJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(detailBody).toMatchObject({
      id: session.id,
      execution_status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const listJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessions',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
      },
      method: 'GET',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Direct Terminate User', email: 'direct-terminate@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions`),
      json: listJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);
    const listBody = listJson.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>> };
    expect(listBody.items?.[0]).toMatchObject({
      id: session.id,
      execution_status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });
  });

  it('exposes active internal stop capability truth on session detail and list', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_truth',
      projectId: 'proj_chat_internal_truth',
      ownerUserId: 'user_chat_internal_truth',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_truth',
      title: 'Internal Chat Truth',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_truth',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator: {
        requestHardTeardown: vi.fn(async () => undefined),
      },
    } as unknown as NodeApiDeps;

    const detailJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessionItem',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'GET',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Internal Truth User', email: 'internal-truth@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}`),
      json: detailJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);
    const detailBody = detailJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(detailBody).toMatchObject({
      id: session.id,
      execution_status: 'running',
      stop_mode: 'cancel',
      can_escalate: true,
    });
    expect(detailBody).not.toHaveProperty('escalation_reason');

    const listJson = vi.fn();
    await expect(handleChatNonStreamRoute({
      route: {
        kind: 'chatSessions',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
      },
      method: 'GET',
      req: { headers: {} } as http.IncomingMessage,
      res: {} as http.ServerResponse,
      deps,
      user: { id: session.owner_user_id, name: 'Internal Truth User', email: 'internal-truth@example.com' },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions`),
      json: listJson,
      readBody: async () => ({}),
    })).resolves.toBe(true);
    const listBody = listJson.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>> };
    expect(listBody.items?.[0]).toMatchObject({
      id: session.id,
      execution_status: 'running',
      stop_mode: 'cancel',
      can_escalate: true,
    });
    expect(listBody.items?.[0]).not.toHaveProperty('escalation_reason');
  });

  it('requests internal chat terminate hard teardown once and keeps terminating truth', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const requestHardTeardown = vi.fn(async () => undefined);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_terminate',
      projectId: 'proj_chat_internal_terminate',
      ownerUserId: 'user_chat_internal_terminate',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_terminate',
      title: 'Internal Chat Terminate',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_terminate',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );

    const deps = {
      cache,
      docStore,
      chatResourceService,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_chat_internal_terminate',
          workspace_id: session.workspace_id,
          project_id: session.project_id,
          name: 'internal-terminate',
          mode: 'internal',
          status: 'enabled',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      internalWorkloadCoordinator: {
        requestHardTeardown,
      },
    } as unknown as NodeApiDeps;

    const callStop = async () => {
      const res = {} as http.ServerResponse;
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
        res,
        deps,
        user: { id: session.owner_user_id, name: 'Internal Terminate User', email: 'internal-terminate@example.com' },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json;
    };

    expect(await callStop()).toHaveBeenCalledWith(expect.anything(), 202, {
      success: true,
      session_id: session.id,
      state: 'terminating',
      status: 'terminating',
      stop_mode: 'terminate',
      can_escalate: false,
    });
    expect(await callStop()).toHaveBeenCalledWith(expect.anything(), 202, {
      success: true,
      session_id: session.id,
      state: 'terminating',
      status: 'terminating',
      stop_mode: 'terminate',
      can_escalate: false,
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    expect(requestHardTeardown).toHaveBeenCalledWith({
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      epoch: 'stream_internal_terminate',
    });
  });

  it('retries internal chat terminate hard teardown after a failed side effect', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const requestHardTeardown = vi.fn()
      .mockRejectedValueOnce(new Error('teardown api unavailable'))
      .mockResolvedValueOnce(undefined);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_terminate_retry',
      projectId: 'proj_chat_internal_terminate_retry',
      ownerUserId: 'user_chat_internal_terminate_retry',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_terminate_retry',
      title: 'Internal Chat Terminate Retry',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_terminate_retry',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator: {
        requestHardTeardown,
      },
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Terminate Retry User',
          email: 'internal-terminate-retry@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'teardown api unavailable',
    });

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(2);
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution).toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
    });
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();
  });

  it('retries existing pending internal chat hard teardown debt and clears it after release succeeds', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const teardown = createDeferred<void>();
    const requestHardTeardown = vi.fn(async () => teardown.promise);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_pending_retry',
      projectId: 'proj_chat_internal_pending_retry',
      ownerUserId: 'user_chat_internal_pending_retry',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_pending_retry',
      title: 'Internal Chat Pending Retry',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_pending_retry',
        ownerInstanceId: 'api-crashed-before-dispatch',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'terminating',
        phase: 'dispatching',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:01.000Z',
        stopRequestedAt: '2026-04-23T12:00:01.000Z',
        stopReason: 'session_stop',
        stopMode: 'terminate',
        hardTeardownStatus: 'pending',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator: {
        requestHardTeardown,
      },
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Pending Retry User',
          email: 'internal-pending-retry@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    const responsesPromise = Promise.all([callStop(), callStop()]);
    await vi.waitFor(() => {
      expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    });
    teardown.resolve();
    await expect(responsesPromise).resolves.toEqual([
      expect.objectContaining({
        state: 'terminating',
        stop_mode: 'terminate',
      }),
      expect.objectContaining({
        state: 'terminating',
        stop_mode: 'terminate',
      }),
    ]);
    expect(requestHardTeardown).toHaveBeenCalledWith({
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      epoch: 'stream_internal_pending_retry',
    });
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution).toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
    });
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();
  });

  it('marks existing pending internal chat hard teardown debt failed when dispatch fails so it remains retryable', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const requestHardTeardown = vi.fn()
      .mockRejectedValueOnce(new Error('pending retry dispatch failed'))
      .mockResolvedValueOnce(undefined);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_pending_retry_fail',
      projectId: 'proj_chat_internal_pending_retry_fail',
      ownerUserId: 'user_chat_internal_pending_retry_fail',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_pending_retry_fail',
      title: 'Internal Chat Pending Retry Failure',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_pending_retry_fail',
        ownerInstanceId: 'api-crashed-before-dispatch',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'terminating',
        phase: 'dispatching',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:01.000Z',
        stopRequestedAt: '2026-04-23T12:00:01.000Z',
        stopReason: 'session_stop',
        stopMode: 'terminate',
        hardTeardownStatus: 'pending',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator: {
        requestHardTeardown,
      },
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Pending Retry Failure User',
          email: 'internal-pending-retry-failure@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'pending retry dispatch failed',
    });

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(2);
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();
  });

  it('keeps internal chat terminate retryable when real releasePod fails in the coordinator', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('release pod failed'))
      .mockResolvedValueOnce(undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_real_release_retry',
      projectId: 'proj_chat_internal_real_release_retry',
      ownerUserId: 'user_chat_internal_real_release_retry',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_real_release_retry',
      title: 'Internal Chat Real Release Retry',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_real_release_retry',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator,
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Real Release Retry User',
          email: 'internal-real-release-retry@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(1);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'release pod failed',
    });

    await expect(callStop()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(2);
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution).toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
    });
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('rejects a late internal chat holder after active truth was terminated before holder registration', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_late_holder',
      projectId: 'proj_chat_internal_late_holder',
      ownerUserId: 'user_chat_internal_late_holder',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_late_holder',
      title: 'Internal Chat Late Holder',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_late_holder',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'bootstrapping',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator,
    } as unknown as NodeApiDeps;
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
      user: {
        id: session.owner_user_id,
        name: 'Internal Late Holder User',
        email: 'internal-late-holder@example.com',
      },
      requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
      json,
      readBody: async () => ({ mode: 'terminate' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 202, expect.objectContaining({
      state: 'terminating',
      stop_mode: 'terminate',
    }));
    expect(releasePod).toHaveBeenCalledTimes(1);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
    });
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();

    await expect(internalWorkloadCoordinator.acquireHolder({
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      holderKind: 'chat_stream',
      holderId: session.id,
      epoch: 'stream_internal_late_holder',
    })).rejects.toMatchObject({
      code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
    });
    await expect(internalWorkloadCoordinator.acquireHolder({
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      holderKind: 'chat_stream',
      holderId: 'session_internal_late_holder_next',
      epoch: 'stream_internal_late_holder_next',
    })).resolves.toBeUndefined();
    await internalWorkloadCoordinator.releaseHolder({
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      holderKind: 'chat_stream',
      holderId: 'session_internal_late_holder_next',
      epoch: 'stream_internal_late_holder_next',
    });

    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);
    await internalWorkloadCoordinator.shutdown();
  });

  it('keeps live-holder internal chat terminate pending until real release completes and retries after releasePod failure', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const firstRelease = createDeferred<void>();
    const secondRelease = createDeferred<void>();
    const releaseAttempts = [firstRelease, secondRelease];
    let releaseAttemptIndex = 0;
    const releasePod = vi.fn(async () => {
      const release = releaseAttempts[releaseAttemptIndex];
      releaseAttemptIndex += 1;
      if (release) {
        await release.promise;
      }
    });
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_live_release_retry',
      projectId: 'proj_chat_internal_live_release_retry',
      ownerUserId: 'user_chat_internal_live_release_retry',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_live_release_retry',
      title: 'Internal Chat Live Release Retry',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_live_release_retry',
        ownerInstanceId: 'api-local',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const holder = {
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      workloadId: sanitizeWorkloadId(session.id),
      holderKind: 'chat_stream' as const,
      holderId: session.id,
    };
    await internalWorkloadCoordinator.acquireHolder(holder);

    const abortController = new AbortController();
    const holderReleaseErrors: unknown[] = [];
    ACTIVE_CHAT_STREAMS.set('stream_internal_live_release_retry', {
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      sessionId: session.id,
      abortController,
      startedAt: '2026-04-23T12:00:00.000Z',
      status: 'running',
      assistantMessageId: 'msg_internal_live_release_retry',
      parentMessageId: null,
      endpointId: 'agent:agent_chat_internal_live_release_retry',
      model: 'gpt-5-codex',
      contentSoFar: '',
      clients: new Set(),
    });
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator,
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Live Release Retry User',
          email: 'internal-live-release-retry@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    const firstStop = callStop();
    await vi.waitFor(() => {
      expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
        {
          workspaceId: session.workspace_id,
          projectId: session.project_id,
          workloadId: sanitizeWorkloadId(session.id),
          holders: [`chat_stream:${session.id}`],
          hardTeardownRequested: true,
        },
      ]);
    });
    expect(releasePod).not.toHaveBeenCalled();
    void internalWorkloadCoordinator.releaseHolder(holder).catch((error: unknown) => {
      holderReleaseErrors.push(error);
    });
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(1);
    });
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'requested',
    });

    firstRelease.reject(new Error('live release pod failed'));
    await expect(firstStop).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    await vi.waitFor(() => {
      expect(holderReleaseErrors).toHaveLength(1);
    });
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'live release pod failed',
    });

    const secondStop = callStop();
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(2);
    });
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'requested',
    });

    secondRelease.resolve();
    await expect(secondStop).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    const releasedExecution = await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    );
    expect(releasedExecution).toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
    });
    expect(releasedExecution?.hardTeardownStatus).toBeUndefined();
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('retries hard teardown after the internal chat runner has already finalized terminal truth', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('terminal release failed'))
      .mockResolvedValueOnce(undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_terminal_debt',
      projectId: 'proj_chat_terminal_debt',
      ownerUserId: 'user_chat_terminal_debt',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_terminal_debt',
      title: 'Internal Chat Terminal Debt',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_chat_terminal_debt',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:10.000Z',
        externalAgentId: session.external_agent_id,
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'failed',
        hardTeardownLastAttemptAt: '2026-04-23T12:00:10.000Z',
        hardTeardownLastError: 'terminal release failed',
        hardTeardownAttemptCount: 1,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator,
    } as unknown as NodeApiDeps;

    const callTerminate = async () => {
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
        user: {
          id: session.owner_user_id,
          name: 'Internal Chat Terminal Debt User',
          email: 'internal-chat-terminal-debt@example.com',
        },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callTerminate()).resolves.toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(1);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toMatchObject({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'terminal release failed',
    });

    const [second, concurrent] = await Promise.all([callTerminate(), callTerminate()]);
    expect(second).toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(concurrent).toMatchObject({
      state: 'terminating',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(2);
    await expect(readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toEqual(expect.objectContaining({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
    }));
    expect((await readSessionExecutionRecord(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    ))?.hardTeardownStatus).toBeUndefined();
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('requests internal chat terminate hard teardown only once for concurrent session stops', async () => {
    const cache = new SessionExecutionReadBarrierCache(2);
    const docStore = new InMemoryJsonDocStore();
    const chatResourceService = new ChatResourceService(docStore);
    const teardown = createDeferred<void>();
    const requestHardTeardown = vi.fn(async () => teardown.promise);
    const session = await chatResourceService.createSession({
      workspaceId: 'ws_chat_internal_terminate_race',
      projectId: 'proj_chat_internal_terminate_race',
      ownerUserId: 'user_chat_internal_terminate_race',
      model: 'gpt-5-codex',
      endpointId: '',
      externalAgentId: 'agent_chat_internal_terminate_race',
      title: 'Internal Chat Terminate Race',
    });
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
        streamId: 'stream_internal_terminate_race',
        ownerInstanceId: 'api-remote',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        externalAgentId: session.external_agent_id,
      },
      60,
    );
    const deps = {
      cache,
      docStore,
      chatResourceService,
      internalWorkloadCoordinator: {
        requestHardTeardown,
      },
    } as unknown as NodeApiDeps;

    const callStop = async () => {
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
        user: { id: session.owner_user_id, name: 'Internal Terminate Race User', email: 'internal-terminate-race@example.com' },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/${session.workspace_id}/projects/${session.project_id}/chat/sessions/${session.id}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    const responsesPromise = Promise.all([callStop(), callStop()]);
    await vi.waitFor(() => {
      expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    });
    teardown.resolve();
    const responses = await responsesPromise;

    expect(responses).toEqual([
      expect.objectContaining({
        state: 'terminating',
        stop_mode: 'terminate',
        can_escalate: false,
      }),
      expect.objectContaining({
        state: 'terminating',
        stop_mode: 'terminate',
        can_escalate: false,
      }),
    ]);
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
  });

  it('accepts terminate on a stream stop but reports unavailable escalation for direct provider streams', async () => {
    const cache = new InMemoryCache();
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_chat_stream_direct_terminate',
        projectId: 'proj_chat_stream_direct_terminate',
        sessionId: 'sess_chat_stream_direct_terminate',
        streamId: 'stream_chat_stream_direct_terminate',
        ownerInstanceId: 'api-test',
        transport: 'direct_provider',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: 'ep_chat_stream_direct_terminate',
      },
      60,
    );
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

    const res = {} as http.ServerResponse;
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
      res,
      deps: {
        cache,
      } as unknown as NodeApiDeps,
      user: { id: 'user_stream_direct_terminate', name: 'Stream Direct Terminate', email: 'stream-direct-terminate@example.com' },
      requestUrl: new URL('http://localhost/api/v1/workspaces/ws_chat_stream_direct_terminate/projects/proj_chat_stream_direct_terminate/chat/sessions/sess_chat_stream_direct_terminate/messages/streams/stream_chat_stream_direct_terminate/stop'),
      json,
      readBody: async () => ({ mode: 'terminate' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(res, 202, {
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
      const requestHardTeardown = vi.fn(async () => undefined);
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

      const res = {} as http.ServerResponse;
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
        res,
        deps: {
          cache,
          internalWorkloadCoordinator: {
            requestHardTeardown,
          },
        } as unknown as NodeApiDeps,
        user: { id: 'user_chat_final_registry', name: 'Final Registry User', email: 'final-registry@example.com' },
        requestUrl: new URL(`http://localhost/api/v1/workspaces/ws_chat_final_registry/projects/proj_chat_final_registry/chat/sessions/sess_chat_final_registry/messages/streams/stream_chat_final_${finalStatus}/stop`),
        json,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(res, 202, {
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
