import type http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { ChatMessageRecord } from './resource-models.js';

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
