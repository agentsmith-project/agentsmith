import type http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { ChatMessageRecord } from './resource-models.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import {
  ACTIVE_CHAT_STREAMS,
  readSessionExecutionRecord,
  readSessionStreamState,
  requestSessionExecutionStop,
  writeSessionExecutionRecord,
  writeSessionStreamState,
} from './chat-stream-state.js';

const {
  buildChatExecutionMessagesMock,
  ensureInternalChatSessionWorkspaceMock,
} = vi.hoisted(() => ({
  buildChatExecutionMessagesMock: vi.fn(async () => ({
    messages: [{ role: 'user', content: 'hello internal holder' }],
    missingCurrentImageDataUrl: false,
  })),
  ensureInternalChatSessionWorkspaceMock: vi.fn(async ({ session }) => ({
    session,
    workspaceFileLibraryId: session.workspace_file_library_id ?? 'flib_chat_holder',
    workspaceFileLibraryName: session.workspace_file_library_name ?? 'Chat Holder Workspace',
  })),
}));

vi.mock('./chat-execution-messages.js', () => ({
  buildChatExecutionMessages: buildChatExecutionMessagesMock,
}));

vi.mock('./chat-internal-workspace.js', () => ({
  ensureInternalChatSessionWorkspace: ensureInternalChatSessionWorkspaceMock,
}));

import { handleChatStreamRoute, selectLatestCanonicalBranchLeaf } from './chat-stream-handler.js';

function buildMessage(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: overrides.id ?? 'msg_default',
    workspace_id: overrides.workspace_id ?? 'ws_1',
    project_id: overrides.project_id ?? 'proj_1',
    session_id: overrides.session_id ?? 'session_1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'message',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    tokens: overrides.tokens,
    finish_reason: overrides.finish_reason ?? null,
    message_status: overrides.message_status,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
    parent_id: overrides.parent_id ?? null,
    logical_id: overrides.logical_id,
    revision_of: overrides.revision_of ?? null,
    revision_index: overrides.revision_index,
    variant_group_id: overrides.variant_group_id,
    variant_index: overrides.variant_index,
    is_stale: overrides.is_stale ?? false,
    attachment_snapshots: overrides.attachment_snapshots,
  };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createResponse(): http.ServerResponse & {
  headers: Record<string, string>;
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  destroyed: boolean;
  end: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
} {
  const res = new EventEmitter() as http.ServerResponse & {
    headers: Record<string, string>;
    statusCode: number;
    headersSent: boolean;
    writableEnded: boolean;
    destroyed: boolean;
    end: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    flushHeaders: ReturnType<typeof vi.fn>;
  };
  res.headers = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers[name.toLowerCase()] = value;
    return res;
  });
  res.flushHeaders = vi.fn(() => {
    res.headersSent = true;
  });
  res.end = vi.fn(() => {
    res.writableEnded = true;
    res.emit('close');
    return res;
  });
  return res;
}

function createExternalAgentStreamDeps(args?: {
  cache?: InMemoryCache;
  getAgent?: ReturnType<typeof vi.fn>;
  dispatchStreamingRequest?: ReturnType<typeof vi.fn>;
}) {
  const cache = args?.cache ?? new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const messages: ChatMessageRecord[] = [];
  const createdAt = new Date().toISOString();
  const session = {
    id: 'session_external_stream',
    workspace_id: 'ws_external_stream',
    project_id: 'proj_external_stream',
    owner_user_id: 'user_external_stream',
    title: 'External Stream',
    model: 'external-agent',
    endpoint_id: '',
    external_agent_id: 'agent_external_stream',
    created_at: createdAt,
    updated_at: createdAt,
    message_count: 0,
    total_tokens: 0,
  };
  const getAgent = args?.getAgent ?? vi.fn(async () => ({
    id: 'agent_external_stream',
    workspace_id: 'ws_external_stream',
    project_id: 'proj_external_stream',
    name: 'external-stream-agent',
    mode: 'external',
    status: 'enabled',
    execution_preferences_json: {
      chat: {
        endpoint_id: 'ep_external_stream',
        wire_api: 'chat',
      },
    },
    capabilities: {
      streaming_completion: true,
      multimodal_completion: false,
    },
    created_at: createdAt,
    updated_at: createdAt,
  }));
  const dispatchStreamingRequest = args?.dispatchStreamingRequest ?? vi.fn(async () => ({
    requestId: 'req_external_stream',
    cancel: () => undefined,
    stream: (async function* stream() {
      yield { type: 'delta' as const, delta: 'hello' };
      yield { type: 'done' as const, finish_reason: 'stop', usage_tokens: 5 };
    })(),
  }));
  const createMessage = vi.fn(async (input: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    parentId?: string | null;
    variantGroupId?: string;
    variantIndex?: number;
    messageStatus?: 'streaming' | 'completed' | 'stopped' | 'failed';
  }) => {
    const created: ChatMessageRecord = {
      id: `msg_${messages.length + 1}`,
      workspace_id: session.workspace_id,
      project_id: session.project_id,
      session_id: session.id,
      role: input.role,
      content: input.content,
      created_at: createdAt,
      finish_reason: null,
      message_status: input.messageStatus,
      error_code: null,
      error_message: null,
      parent_id: input.parentId ?? null,
      variant_group_id: input.variantGroupId,
      variant_index: input.variantIndex,
      is_stale: false,
    };
    messages.push(created);
    return created;
  });
  const updateAssistantMessage = vi.fn(async (
    _workspaceId: string,
    _projectId: string,
    _sessionId: string,
    messageId: string,
    patch: Partial<ChatMessageRecord>,
  ) => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return null;
    messages[index] = {
      ...messages[index],
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.finishReason !== undefined ? { finish_reason: patch.finishReason } : {}),
      ...(patch.tokens !== undefined ? { tokens: patch.tokens } : {}),
      ...(patch.messageStatus !== undefined ? { message_status: patch.messageStatus } : {}),
      ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
      ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
    };
    return messages[index];
  });
  const deps = {
    cache,
    docStore,
    chatResourceService: {
      getSessionForUser: vi.fn(async () => session),
      listMessages: vi.fn(async () => [...messages]),
      getMessage: vi.fn(async () => null),
      createMessage,
      buildNextAssistantVariant: vi.fn(async () => ({
        variantGroupId: 'variant_external_stream',
        variantIndex: 0,
      })),
      listAttachments: vi.fn(async () => []),
      listAttachmentsByIds: vi.fn(async () => []),
      updateAssistantMessage,
    },
    agentResourceService: {
      getAgent,
    },
    agentExecutionService: {
      dispatchStreamingRequest,
    },
    downloadFileLibraryObjectUseCase: {
      execute: vi.fn(async () => {
        throw new Error('should_not_download_attachments_in_external_stream_tests');
      }),
    },
  } as unknown as NodeApiDeps;

  return {
    cache,
    deps,
    messages,
    session,
    createMessage,
    dispatchStreamingRequest,
    getAgent,
  };
}

afterEach(() => {
  ACTIVE_CHAT_STREAMS.clear();
});

describe('selectLatestCanonicalBranchLeaf', () => {
  beforeEach(() => {
    buildChatExecutionMessagesMock.mockClear();
    ensureInternalChatSessionWorkspaceMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('selects the newest non-stale branch leaf by created_at instead of relying on array order', () => {
    const root = buildMessage({
      id: 'msg_root',
      role: 'user',
      content: 'root',
      created_at: '2026-01-01T00:00:01.000Z',
    });
    const oldLeaf = buildMessage({
      id: 'msg_branch_old',
      role: 'assistant',
      content: 'old leaf',
      parent_id: root.id,
      created_at: '2026-01-01T00:00:03.000Z',
      variant_group_id: `asst_${root.id}`,
      variant_index: 0,
    });
    const newLeaf = buildMessage({
      id: 'msg_branch_new',
      role: 'assistant',
      content: 'new leaf',
      parent_id: root.id,
      created_at: '2026-01-01T00:00:05.000Z',
      variant_group_id: `asst_${root.id}`,
      variant_index: 1,
    });

    const selected = selectLatestCanonicalBranchLeaf([
      oldLeaf,
      newLeaf,
      root,
    ]);

    expect(selected?.id).toBe(newLeaf.id);
  });

  it('falls back to the newest non-stale non-system message when the graph has no leaf', () => {
    const older = buildMessage({
      id: 'msg_older',
      role: 'user',
      content: 'older',
      parent_id: 'msg_newer',
      created_at: '2026-01-01T00:00:02.000Z',
    });
    const newer = buildMessage({
      id: 'msg_newer',
      role: 'assistant',
      content: 'newer',
      parent_id: older.id,
      created_at: '2026-01-01T00:00:04.000Z',
    });

    const selected = selectLatestCanonicalBranchLeaf([
      older,
      newer,
    ]);

    expect(selected?.id).toBe(newer.id);
  });

  it('registers and releases an internal chat workload holder around the active stream', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const streamGate = createDeferred<void>();
    const keepalive = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive,
      releasePod,
    });
    const messages: ChatMessageRecord[] = [];
    const createdAt = new Date().toISOString();
    const req = {
      headers: {},
    } as http.IncomingMessage;
    const res = createResponse();
    const json = vi.fn();
    const sseWrite = vi.fn();
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_chat_internal_holder',
      cancel: () => undefined,
      stream: (async function* stream() {
        await streamGate.promise;
        yield { type: 'delta', delta: 'hello' };
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 5 };
      })(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      chatResourceService: {
        getSessionForUser: vi.fn(async () => ({
          id: 'session_internal_holder',
          workspace_id: 'ws_chat_holder',
          project_id: 'proj_chat_holder',
          owner_user_id: 'user_chat_holder',
          title: 'Internal Chat Holder',
          model: 'gpt-5-codex',
          endpoint_id: '',
          external_agent_id: 'agent_chat_internal_holder',
          workspace_file_library_id: 'flib_chat_holder',
          workspace_file_library_name: 'Chat Holder Workspace',
          created_at: createdAt,
          updated_at: createdAt,
          message_count: 0,
          total_tokens: 0,
        })),
        listMessages: vi.fn(async () => [...messages]),
        getMessage: vi.fn(async () => null),
        createMessage: vi.fn(async (input: {
          role: 'user' | 'assistant' | 'system';
          content: string;
          parentId?: string | null;
          variantGroupId?: string;
          variantIndex?: number;
          messageStatus?: 'streaming' | 'completed' | 'stopped' | 'failed';
        }) => {
          const created: ChatMessageRecord = {
            id: `msg_${messages.length + 1}`,
            workspace_id: 'ws_chat_holder',
            project_id: 'proj_chat_holder',
            session_id: 'session_internal_holder',
            role: input.role,
            content: input.content,
            created_at: createdAt,
            finish_reason: null,
            message_status: input.messageStatus,
            error_code: null,
            error_message: null,
            parent_id: input.parentId ?? null,
            variant_group_id: input.variantGroupId,
            variant_index: input.variantIndex,
            is_stale: false,
          };
          messages.push(created);
          return created;
        }),
        buildNextAssistantVariant: vi.fn(async () => ({
          variantGroupId: 'variant_chat_holder',
          variantIndex: 0,
        })),
        listAttachments: vi.fn(async () => []),
        listAttachmentsByIds: vi.fn(async () => []),
        updateAssistantMessage: vi.fn(async (
          _workspaceId: string,
          _projectId: string,
          _sessionId: string,
          messageId: string,
          patch: Partial<ChatMessageRecord>,
        ) => {
          const index = messages.findIndex((message) => message.id === messageId);
          if (index >= 0) {
            messages[index] = {
              ...messages[index],
              ...patch,
            };
            return messages[index];
          }
          return null;
        }),
      },
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_chat_internal_holder',
          workspace_id: 'ws_chat_holder',
          project_id: 'proj_chat_holder',
          name: 'internal-chat-holder',
          mode: 'internal',
          status: 'enabled',
          config: {
            image: 'runner:v1',
            _internal_raw_key: 'ask_test',
          },
          execution_preferences_json: {
            chat: {
              endpoint_id: 'ep_chat_internal_holder',
            },
          },
          created_at: createdAt,
          updated_at: createdAt,
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
      internalWorkloadCoordinator,
      internalAgentPodManager: {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'binding_chat_holder',
            mountPath: '/workspace/chat-holder',
          },
          binding: {
            file_library_id: 'flib_chat_holder',
          },
        })),
      },
      downloadFileLibraryObjectUseCase: {
        execute: vi.fn(async () => {
          throw new Error('should_not_download_attachments_in_holder_test');
        }),
      },
    } as unknown as NodeApiDeps;

    const handlePromise = handleChatStreamRoute({
      route: {
        kind: 'chatMessagesStream',
        workspaceId: 'ws_chat_holder',
        projectId: 'proj_chat_holder',
        sessionId: 'session_internal_holder',
      },
      method: 'POST',
      req,
      res,
      deps,
      user: { id: 'user_chat_holder', name: 'Chat Holder User', email: 'chat-holder@example.com' },
      json,
      readBody: async () => ({
        input: { role: 'user', content: 'hello internal holder' },
      }),
      sseWrite,
    });

    await vi.waitFor(() => {
      expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
      expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
        {
          workspaceId: 'ws_chat_holder',
          projectId: 'proj_chat_holder',
          workloadId: 'session-internal-holder',
          holders: ['chat_stream:session_internal_holder'],
          hardTeardownRequested: false,
        },
      ]);
    });
    expect(keepalive).toHaveBeenCalledTimes(1);

    streamGate.resolve();
    await expect(handlePromise).resolves.toBe(true);
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);
    expect(releasePod).not.toHaveBeenCalled();
    await internalWorkloadCoordinator.shutdown();

    if (previousPublicApiBase === undefined) {
      delete process.env.PUBLIC_API_BASE_URL;
    } else {
      process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });
});

describe('handleChatStreamRoute session state ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('treats session execution_status=stopping as an authoritative stream conflict even without an active record', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { cache, deps, dispatchStreamingRequest, createMessage } = createExternalAgentStreamDeps();
    const req = { headers: {} } as http.IncomingMessage;
    const res = createResponse();
    const json = vi.fn();

    await writeSessionStreamState(
      cache,
      'ws_external_stream',
      'proj_external_stream',
      'session_external_stream',
      'stopping',
      60,
    );

    try {
      await expect(handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req,
        res,
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json,
        readBody: async () => ({
          input: { role: 'user', content: 'hello conflict' },
        }),
        sseWrite: vi.fn(),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(res, 409, {
        error_code: 'CHAT_SESSION_STREAM_CONFLICT',
        message: 'chat_session_stream_conflict',
      });
      expect(createMessage).not.toHaveBeenCalled();
      expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it.each(['pending', 'failed', 'requested'] as const)(
    'treats terminal hard teardown %s debt as an authoritative stream conflict without overwriting it',
    async (hardTeardownStatus) => {
      const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
      process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
      const { cache, deps, dispatchStreamingRequest, createMessage } = createExternalAgentStreamDeps();
      const req = { headers: {} } as http.IncomingMessage;
      const res = createResponse();
      const json = vi.fn();

      await writeSessionExecutionRecord(
        cache,
        {
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
          streamId: `stream_terminal_${hardTeardownStatus}_debt`,
          ownerInstanceId: 'api-terminal-debt',
          transport: 'agent_runner',
          internalAgent: true,
          status: 'stopped',
          phase: 'terminal',
          startedAt: '2026-04-23T12:00:00.000Z',
          updatedAt: '2026-04-23T12:00:05.000Z',
          stopMode: 'terminate',
          stopReason: 'session_stop',
          hardTeardownStatus,
          ...(hardTeardownStatus === 'requested' ? { hardTeardownRequestedAt: '2026-04-23T12:00:06.000Z' } : {}),
          ...(hardTeardownStatus === 'failed' ? { hardTeardownLastError: 'terminal release failed' } : {}),
        },
        60,
      );

      try {
        await expect(handleChatStreamRoute({
          route: {
            kind: 'chatMessagesStream',
            workspaceId: 'ws_external_stream',
            projectId: 'proj_external_stream',
            sessionId: 'session_external_stream',
          },
          method: 'POST',
          req,
          res,
          deps,
          user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
          json,
          readBody: async () => ({
            input: { role: 'user', content: 'hello blocked by terminal debt' },
          }),
          sseWrite: vi.fn(),
        })).resolves.toBe(true);

        expect(json).toHaveBeenCalledWith(res, 409, {
          error_code: 'CHAT_SESSION_STREAM_CONFLICT',
          message: 'chat_session_stream_conflict',
          reason: 'hard_teardown_pending',
          hard_teardown_status: hardTeardownStatus,
        });
        expect(createMessage).not.toHaveBeenCalled();
        expect(dispatchStreamingRequest).not.toHaveBeenCalled();
        await expect(readSessionExecutionRecord(
          cache,
          'ws_external_stream',
          'proj_external_stream',
          'session_external_stream',
        )).resolves.toMatchObject({
          streamId: `stream_terminal_${hardTeardownStatus}_debt`,
          status: 'stopped',
          phase: 'terminal',
          stopMode: 'terminate',
          hardTeardownStatus,
        });
      } finally {
        if (previousPublicApiBase === undefined) {
          delete process.env.PUBLIC_API_BASE_URL;
        } else {
          process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
        }
      }
    },
  );

  it('allows a new stream only after terminate retries and clears terminal hard teardown debt', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { cache, deps, dispatchStreamingRequest, createMessage } = createExternalAgentStreamDeps();
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    deps.internalWorkloadCoordinator = internalWorkloadCoordinator;

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_external_stream',
        projectId: 'proj_external_stream',
        sessionId: 'session_external_stream',
        streamId: 'stream_terminal_retry_debt',
        ownerInstanceId: 'api-terminal-debt',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:05.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'failed',
        hardTeardownLastError: 'terminal release failed',
        hardTeardownAttemptCount: 1,
      },
      60,
    );

    try {
      const stopJson = vi.fn();
      await expect(handleChatNonStreamRoute({
        route: {
          kind: 'chatSessionStop',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        requestUrl: new URL('http://localhost/api/v1/workspaces/ws_external_stream/projects/proj_external_stream/chat/sessions/session_external_stream/stop'),
        json: stopJson,
        readBody: async () => ({ mode: 'terminate' }),
      })).resolves.toBe(true);

      expect(stopJson).toHaveBeenCalledWith(
        expect.anything(),
        202,
        expect.objectContaining({
          state: 'terminating',
          stop_mode: 'terminate',
        }),
      );
      expect(releasePod).toHaveBeenCalledTimes(1);
      const clearedDebt = await readSessionExecutionRecord(
        cache,
        'ws_external_stream',
        'proj_external_stream',
        'session_external_stream',
      );
      expect(clearedDebt).toMatchObject({
        status: 'stopped',
        phase: 'terminal',
        stopMode: 'terminate',
      });
      expect(clearedDebt?.hardTeardownStatus).toBeUndefined();

      await expect(handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: createResponse(),
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json: vi.fn(),
        readBody: async () => ({
          input: { role: 'user', content: 'hello after terminal debt cleared' },
        }),
        sseWrite: vi.fn(),
      })).resolves.toBe(true);

      expect(createMessage).toHaveBeenCalled();
      expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
      await expect(readSessionExecutionRecord(
        cache,
        'ws_external_stream',
        'proj_external_stream',
        'session_external_stream',
      )).resolves.toMatchObject({
        status: 'completed',
        phase: 'terminal',
      });
    } finally {
      await internalWorkloadCoordinator.shutdown();
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it('creates a bootstrapping execution record before the first message write', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { cache, deps } = createExternalAgentStreamDeps();
    const originalCreateMessage = deps.chatResourceService.createMessage;
    const seenExecutionPhases: string[] = [];
    deps.chatResourceService.createMessage = vi.fn(async (...args: Parameters<typeof originalCreateMessage>) => {
      const record = await readSessionExecutionRecord(
        cache,
        'ws_external_stream',
        'proj_external_stream',
        'session_external_stream',
      );
      seenExecutionPhases.push(`${record?.status ?? 'missing'}:${record?.phase ?? 'missing'}`);
      return originalCreateMessage(...args);
    });

    try {
      await expect(handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: createResponse(),
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json: vi.fn(),
        readBody: async () => ({
          input: { role: 'user', content: 'hello bootstrapping execution' },
        }),
        sseWrite: vi.fn(),
      })).resolves.toBe(true);

      expect(seenExecutionPhases[0]).toBe('running:bootstrapping');
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it('does not dispatch an external agent request after session stop wins in the pre-dispatch window', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const agentLookupGate = createDeferred<Awaited<ReturnType<ReturnType<typeof vi.fn>>>>();
    const getAgent = vi.fn(async () => agentLookupGate.promise);
    const { cache, deps, messages, dispatchStreamingRequest } = createExternalAgentStreamDeps({ getAgent });
    const streamReq = { headers: {} } as http.IncomingMessage;
    const streamRes = createResponse();
    const streamJson = vi.fn();
    const sseWrite = vi.fn();
    const stopRes = createResponse();
    const stopJson = vi.fn();

    try {
      const streamPromise = handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: streamReq,
        res: streamRes,
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json: streamJson,
        readBody: async () => ({
          input: { role: 'user', content: 'hello pre-dispatch stop' },
        }),
        sseWrite,
      });

      await vi.waitFor(() => {
        expect(getAgent).toHaveBeenCalledTimes(1);
      });

      await expect(handleChatNonStreamRoute({
        route: {
          kind: 'chatSessionStop',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: stopRes,
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        requestUrl: new URL('http://localhost/api/v1/workspaces/ws_external_stream/projects/proj_external_stream/chat/sessions/session_external_stream/stop'),
        json: stopJson,
        readBody: async () => ({}),
      })).resolves.toBe(true);

      expect(stopJson).toHaveBeenCalledWith(stopRes, 202, {
        success: true,
        session_id: 'session_external_stream',
        state: 'stopping',
        status: 'stopping',
        stop_mode: 'cancel',
        can_escalate: false,
        escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
      });

      agentLookupGate.resolve({
        id: 'agent_external_stream',
        workspace_id: 'ws_external_stream',
        project_id: 'proj_external_stream',
        name: 'external-stream-agent',
        mode: 'external',
        status: 'enabled',
        execution_preferences_json: {
          chat: {
            endpoint_id: 'ep_external_stream',
            wire_api: 'chat',
          },
        },
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(streamPromise).resolves.toBe(true);

      expect(dispatchStreamingRequest).not.toHaveBeenCalled();
      await expect(readSessionStreamState(
        cache,
        'ws_external_stream',
        'proj_external_stream',
        'session_external_stream',
      )).resolves.toBe('stopped');
      expect(messages.find((message) => message.role === 'assistant')?.message_status).toBe('stopped');
      expect(sseWrite).toHaveBeenCalledWith(
        streamRes,
        'done',
        expect.objectContaining({ message_status: 'stopped' }),
      );
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it('writes terminal execution_status before emitting the done event', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const doneStateReads: Array<Promise<string | null>> = [];
    const { cache, deps } = createExternalAgentStreamDeps();
    const req = { headers: {} } as http.IncomingMessage;
    const res = createResponse();
    const json = vi.fn();
    const sseWrite = vi.fn((_res: http.ServerResponse, event: string) => {
      if (event === 'done') {
        doneStateReads.push(readSessionStreamState(
          cache,
          'ws_external_stream',
          'proj_external_stream',
          'session_external_stream',
        ));
      }
    });

    try {
      await expect(handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req,
        res,
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json,
        readBody: async () => ({
          input: { role: 'user', content: 'hello terminal ordering' },
        }),
        sseWrite,
      })).resolves.toBe(true);

      expect(await Promise.all(doneStateReads)).toEqual(['completed']);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it('uses shared terminating truth to stop a running stream', async () => {
    const createdAt = new Date().toISOString();
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();
    const messages: ChatMessageRecord[] = [];
    const allowCompletion = createDeferred<void>();
    const session = {
      id: 'session_direct_stop',
      workspace_id: 'ws_direct_stop',
      project_id: 'proj_direct_stop',
      owner_user_id: 'user_direct_stop',
      title: 'Direct Provider Stop',
      model: 'deepseek-chat',
      endpoint_id: 'ep_direct_stop',
      created_at: createdAt,
      updated_at: createdAt,
      message_count: 0,
      total_tokens: 0,
    };
    const createMessage = vi.fn(async (input: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      parentId?: string | null;
      variantGroupId?: string;
      variantIndex?: number;
      messageStatus?: 'streaming' | 'completed' | 'stopped' | 'failed';
    }) => {
      const created: ChatMessageRecord = {
        id: `msg_${messages.length + 1}`,
        workspace_id: session.workspace_id,
        project_id: session.project_id,
        session_id: session.id,
        role: input.role,
        content: input.content,
        created_at: createdAt,
        finish_reason: null,
        message_status: input.messageStatus,
        error_code: null,
        error_message: null,
        parent_id: input.parentId ?? null,
        variant_group_id: input.variantGroupId,
        variant_index: input.variantIndex,
        is_stale: false,
      };
      messages.push(created);
      return created;
    });
    const updateAssistantMessage = vi.fn(async (
      _workspaceId: string,
      _projectId: string,
      _sessionId: string,
      messageId: string,
      patch: Partial<ChatMessageRecord>,
    ) => {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index >= 0) {
        messages[index] = { ...messages[index], ...patch };
        return messages[index];
      }
      return null;
    });
    const universalProxyService = {
      supportsEndpoint: vi.fn(() => true),
      ensureEndpointNamespace: vi.fn(async () => 'ns_direct_stop'),
      forwardRequest: vi.fn(async ({ providerCredential, signal }: { providerCredential?: string; signal?: AbortSignal }) => {
        expect(providerCredential).toBe('secret');
        const encoder = new TextEncoder();
        let chunkIndex = 0;
        return new Response(new ReadableStream({
          async pull(controller) {
            if (signal?.aborted) {
              controller.close();
              return;
            }
            if (chunkIndex === 0) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
              chunkIndex += 1;
              return;
            }
            await allowCompletion.promise;
            if (signal?.aborted) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            chunkIndex += 1;
          },
        }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    };
    const deps = {
      cache,
      docStore,
      chatResourceService: {
        getSessionForUser: vi.fn(async () => session),
        listMessages: vi.fn(async () => [...messages]),
        getMessage: vi.fn(async () => null),
        createMessage,
        buildNextAssistantVariant: vi.fn(async () => ({
          variantGroupId: 'variant_direct_stop',
          variantIndex: 0,
        })),
        listAttachments: vi.fn(async () => []),
        listAttachmentsByIds: vi.fn(async () => []),
        updateAssistantMessage,
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_direct_stop',
          workspace_id: session.workspace_id,
          project_id: session.project_id,
          name: 'Direct Stop Endpoint',
          model: 'deepseek-chat',
          base_url: 'https://provider.example/v1',
          status: 'active',
          credential_ref: 'cred_direct_stop',
          created_at: createdAt,
          updated_at: createdAt,
        })),
        getCredentialSecret: vi.fn(async () => 'secret'),
      },
      universalProxyService,
      downloadFileLibraryObjectUseCase: {
        execute: vi.fn(async () => {
          throw new Error('should_not_download_attachments_in_direct_stop_test');
        }),
      },
    } as unknown as NodeApiDeps;
    const req = { headers: {} } as http.IncomingMessage;
    const res = createResponse();
    const json = vi.fn();
    const sseWrite = vi.fn();

    const handlePromise = handleChatStreamRoute({
      route: {
        kind: 'chatMessagesStream',
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        sessionId: session.id,
      },
      method: 'POST',
      req,
      res,
      deps,
      user: { id: session.owner_user_id, name: 'Direct Stop User', email: 'direct-stop@example.com' },
      json,
      readBody: async () => ({
        input: { role: 'user', content: 'hello direct-provider stop' },
      }),
      sseWrite,
    });

    await vi.waitFor(() => {
      expect(sseWrite).toHaveBeenCalledWith(
        res,
        'delta',
        expect.objectContaining({ delta: 'hello' }),
      );
    });
    await requestSessionExecutionStop(cache, {
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      sessionId: session.id,
      requestedBy: session.owner_user_id,
      stopReason: 'session_stop',
      stopMode: 'terminate',
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    allowCompletion.resolve();

    await expect(handlePromise).resolves.toBe(true);
    expect(universalProxyService.ensureEndpointNamespace).toHaveBeenCalledWith(
      session.workspace_id,
      session.project_id,
      expect.objectContaining({ id: 'ep_direct_stop' }),
    );
    expect(universalProxyService.forwardRequest).toHaveBeenCalledWith(expect.objectContaining({
      providerCredential: 'secret',
    }));
    await expect(readSessionStreamState(
      cache,
      session.workspace_id,
      session.project_id,
      session.id,
    )).resolves.toBe('stopped');
    expect(sseWrite).toHaveBeenCalledWith(
      res,
      'done',
      expect.objectContaining({ message_status: 'stopped' }),
    );
  });

  it('finalizes execution truth as failed when terminal assistant persistence throws', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const { cache, deps } = createExternalAgentStreamDeps();
    const originalUpdate = deps.chatResourceService.updateAssistantMessage;
    let finalizeAttempt = false;
    deps.chatResourceService.updateAssistantMessage = vi.fn(async (...args: Parameters<typeof originalUpdate>) => {
      const patch = args[4];
      if (patch.messageStatus === 'completed' && !finalizeAttempt) {
        finalizeAttempt = true;
        throw new Error('assistant_finalize_failed');
      }
      return originalUpdate(...args);
    });

    try {
      await expect(handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_external_stream',
          projectId: 'proj_external_stream',
          sessionId: 'session_external_stream',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: createResponse(),
        deps,
        user: { id: 'user_external_stream', name: 'External Stream User', email: 'external-stream@example.com' },
        json: vi.fn(),
        readBody: async () => ({
          input: { role: 'user', content: 'hello finalize failure' },
        }),
        sseWrite: vi.fn(),
      })).resolves.toBe(true);

      await expect(readSessionStreamState(
        cache,
        'ws_external_stream',
        'proj_external_stream',
        'session_external_stream',
      )).resolves.toBe('failed');
      expect(ACTIVE_CHAT_STREAMS.size).toBe(0);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it('escalates internal agent cancellation timeout into hard teardown', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const streamGate = createDeferred<void>();
    const requestHardTeardown = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    internalWorkloadCoordinator.requestHardTeardown = requestHardTeardown;
    const messages: ChatMessageRecord[] = [];
    const createdAt = new Date().toISOString();
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      chatResourceService: {
        getSessionForUser: vi.fn(async () => ({
          id: 'session_internal_cancel_timeout',
          workspace_id: 'ws_internal_cancel_timeout',
          project_id: 'proj_internal_cancel_timeout',
          owner_user_id: 'user_internal_cancel_timeout',
          title: 'Internal Cancel Timeout',
          model: 'gpt-5-codex',
          endpoint_id: '',
          external_agent_id: 'agent_internal_cancel_timeout',
          workspace_file_library_id: 'flib_internal_cancel_timeout',
          workspace_file_library_name: 'Internal Cancel Timeout Workspace',
          created_at: createdAt,
          updated_at: createdAt,
          message_count: 0,
          total_tokens: 0,
        })),
        listMessages: vi.fn(async () => [...messages]),
        getMessage: vi.fn(async () => null),
        createMessage: vi.fn(async (input: {
          role: 'user' | 'assistant' | 'system';
          content: string;
          parentId?: string | null;
          variantGroupId?: string;
          variantIndex?: number;
          messageStatus?: 'streaming' | 'completed' | 'stopped' | 'failed';
        }) => {
          const created: ChatMessageRecord = {
            id: `msg_${messages.length + 1}`,
            workspace_id: 'ws_internal_cancel_timeout',
            project_id: 'proj_internal_cancel_timeout',
            session_id: 'session_internal_cancel_timeout',
            role: input.role,
            content: input.content,
            created_at: createdAt,
            finish_reason: null,
            message_status: input.messageStatus,
            error_code: null,
            error_message: null,
            parent_id: input.parentId ?? null,
            variant_group_id: input.variantGroupId,
            variant_index: input.variantIndex,
            is_stale: false,
          };
          messages.push(created);
          return created;
        }),
        buildNextAssistantVariant: vi.fn(async () => ({
          variantGroupId: 'variant_internal_cancel_timeout',
          variantIndex: 0,
        })),
        listAttachments: vi.fn(async () => []),
        listAttachmentsByIds: vi.fn(async () => []),
        updateAssistantMessage: vi.fn(async (
          _workspaceId: string,
          _projectId: string,
          _sessionId: string,
          messageId: string,
          patch: Partial<ChatMessageRecord>,
        ) => {
          const index = messages.findIndex((message) => message.id === messageId);
          if (index >= 0) {
            messages[index] = { ...messages[index], ...patch };
            return messages[index];
          }
          return null;
        }),
      },
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_internal_cancel_timeout',
          workspace_id: 'ws_internal_cancel_timeout',
          project_id: 'proj_internal_cancel_timeout',
          name: 'internal-cancel-timeout-agent',
          mode: 'internal',
          status: 'enabled',
          config: {
            image: 'runner:v1',
            _internal_raw_key: 'ask_test',
          },
          execution_preferences_json: {
            chat: {
              endpoint_id: 'ep_internal_cancel_timeout',
            },
          },
          created_at: createdAt,
          updated_at: createdAt,
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest: vi.fn(async () => ({
          requestId: 'req_internal_cancel_timeout',
          cancel: vi.fn(() => undefined),
          stream: (async function* stream() {
            await streamGate.promise;
            yield {
              type: 'error' as const,
              error_code: 'AGENT_CANCEL_TIMEOUT',
              error_message: 'agent_cancel_timeout',
            };
          })(),
        })),
      },
      internalWorkloadCoordinator,
      internalAgentPodManager: {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'binding_internal_cancel_timeout',
            mountPath: '/workspace/internal-cancel-timeout',
          },
          binding: {
            file_library_id: 'flib_internal_cancel_timeout',
          },
        })),
      },
      downloadFileLibraryObjectUseCase: {
        execute: vi.fn(async () => {
          throw new Error('should_not_download_attachments_in_internal_cancel_timeout_test');
        }),
      },
    } as unknown as NodeApiDeps;

    try {
      const handlePromise = handleChatStreamRoute({
        route: {
          kind: 'chatMessagesStream',
          workspaceId: 'ws_internal_cancel_timeout',
          projectId: 'proj_internal_cancel_timeout',
          sessionId: 'session_internal_cancel_timeout',
        },
        method: 'POST',
        req: { headers: {} } as http.IncomingMessage,
        res: createResponse(),
        deps,
        user: { id: 'user_internal_cancel_timeout', name: 'Internal Cancel Timeout', email: 'internal-cancel-timeout@example.com' },
        json: vi.fn(),
        readBody: async () => ({
          input: { role: 'user', content: 'hello internal cancel timeout' },
        }),
        sseWrite: vi.fn(),
      });

      await vi.waitFor(async () => {
        expect(await readSessionExecutionRecord(
          deps.cache,
          'ws_internal_cancel_timeout',
          'proj_internal_cancel_timeout',
          'session_internal_cancel_timeout',
        )).toMatchObject({ status: 'running' });
      });

      await requestSessionExecutionStop(deps.cache, {
        workspaceId: 'ws_internal_cancel_timeout',
        projectId: 'proj_internal_cancel_timeout',
        sessionId: 'session_internal_cancel_timeout',
        requestedBy: 'user_internal_cancel_timeout',
        stopReason: 'session_stop',
      });
      streamGate.resolve();

      await expect(handlePromise).resolves.toBe(true);
      expect(requestHardTeardown).toHaveBeenCalledWith({
        workspaceId: 'ws_internal_cancel_timeout',
        projectId: 'proj_internal_cancel_timeout',
        workloadId: 'session-internal-cancel-timeout',
        epoch: expect.any(String),
      });
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
      await internalWorkloadCoordinator.shutdown();
    }
  });
});
