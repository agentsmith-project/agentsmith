import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { NOTEBOOK_RUNNER_SPEC } from "@mbos/agent-runner";
import { createDefaultNodeApiDeps } from "./index.js";
import {
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from "./file-library-persistence.js";
import { sanitizeWorkloadId } from "./internal-agent-pod-manager.js";
import { UniversalProxyService } from "./universal-proxy-service.js";
import {
  cleanupChatUpstreamServers,
  startUniversalProxyChatServer,
} from "./__integration__/chat-test-support.js";
import {
  apiFetch,
  apiFetchWithToken,
  startServer,
  startServerWithDeps,
} from "./__integration__/test-support.js";
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
} from "./notebook-task/task-run-coordination.js";
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from "./project-member-governance-persistence.js";

const originalGatewayReconcileInterval = process.env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS;
const originalFeishuRefreshEnabled = process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED;

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChatUpstreamServers();
  if (originalGatewayReconcileInterval === undefined) delete process.env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS;
  else process.env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS = originalGatewayReconcileInterval;
  if (originalFeishuRefreshEnabled === undefined) delete process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED;
  else process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED = originalFeishuRefreshEnabled;
});

async function createFileLibrary(
  baseUrl: string,
  name = "Notebook Workspace",
): Promise<{ id: string; name: string }> {
  const createLibraryRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/file-libraries",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: "task workspace library" }),
    },
  );
  expect(createLibraryRes.status).toBe(201);
  return (await createLibraryRes.json()) as { id: string; name: string };
}

function buildChatExecutionPreferences(
  endpointId = "ep_chat_default",
  wireApi: "chat" | "responses" | "anthropic_messages" = "chat",
) {
  return {
    chat: {
      endpoint_id: endpointId,
      wire_api: wireApi,
    },
  };
}

function buildNotebookExecutionPreferences(endpointId = "ep_notebook_default") {
  return {
    notebook: {
      endpoint_id: endpointId,
    },
  };
}

type ChatEndpointCapability = {
  type: "chat_completion" | "multimodal_completion";
  enabled: boolean;
  default_model_id?: string;
};

function buildOpenAIStreamResponse(
  chunks = ["echo:", " hello"],
  usageTokens = 6,
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(
            encoder.encode(
              `data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"delta":{"content":${JSON.stringify(chunk)}},"finish_reason":null}]}\n\n`,
            ),
          );
        });
        controller.enqueue(
          encoder.encode(
            `data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":${usageTokens}}}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function buildSlowOpenAIStreamResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          ),
        );
        setTimeout(() => {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":" after stop"},"finish_reason":null}]}\n\n',
            ),
          );
        }, 250);
        setTimeout(() => {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n',
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }, 500);
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function installMockUniversalProxy(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  responseFactory: () => Response = () => buildOpenAIStreamResponse(),
) {
  const service = new UniversalProxyService("http://127.0.0.1:9");
  const ensureEndpointNamespace = vi
    .spyOn(service, "ensureEndpointNamespace")
    .mockResolvedValue("ns_chat_test");
  const forwardRequest = vi
    .spyOn(service, "forwardRequest")
    .mockImplementation(async () => responseFactory());
  deps.universalProxyService = service;
  return { ensureEndpointNamespace, forwardRequest };
}

async function createChatEndpoint(
  baseUrl: string,
  input?: {
    name?: string;
    model?: string;
    baseUrl?: string;
    capabilities?: ChatEndpointCapability[];
  },
): Promise<{ id: string; model: string }> {
  const model = input?.model ?? "deepseek-chat";
  const createCredential = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/credentials",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `${input?.name ?? "chat-endpoint"}-key`,
        type: "api_key",
        value: "sk-chat-test",
      }),
    },
  );
  expect(createCredential.status).toBe(201);
  const credential = (await createCredential.json()) as { id: string };

  const capabilities = input?.capabilities ?? [
    {
      type: "chat_completion" as const,
      enabled: true,
      default_model_id: model,
    },
  ];
  const createEndpoint = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/endpoints",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input?.name ?? `chat-endpoint-${Math.random().toString(16).slice(2)}`,
        model,
        type: "custom",
        base_url: input?.baseUrl ?? "https://provider.example/v1",
        credential_ref: credential.id,
        provider_family: "custom",
        upstream_protocol: "openai_chat_completions",
        capabilities,
        models: [{ capability: "chat_completion", model_id: model }],
        defaults: { chat_model_id: model },
      }),
    },
  );
  expect(createEndpoint.status).toBe(201);
  const endpoint = (await createEndpoint.json()) as { id: string };
  return { id: endpoint.id, model };
}

async function createEndpointChatSession(
  baseUrl: string,
  input?: {
    name?: string;
    model?: string;
    capabilities?: ChatEndpointCapability[];
  },
): Promise<{ endpoint: { id: string; model: string }; session: { id: string } }> {
  const endpoint = await createChatEndpoint(baseUrl, input);
  const createSession = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint_id: endpoint.id,
        model: endpoint.model,
      }),
    },
  );
  expect(createSession.status).toBe(201);
  const session = (await createSession.json()) as { id: string };
  return { endpoint, session };
}

async function createProjectWithAgentRunnerManage(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
): Promise<string> {
  const project = await deps.createProjectUseCase.execute({
    workspaceId: "ws_default",
    actorId: "user_test",
    input: {
      name: `Agent Runner Route ${Math.random().toString(16).slice(2)}`,
      visibility: "private",
      join_policy: "approval_required",
    },
  });
  await upsertProjectMembershipRecord(deps.docStore, "ws_default", project.id, {
    project_id: project.id,
    user_id: "user_test",
    user_email: "test@example.com",
    user_name: "Test User",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  await upsertProjectMemberPermissionState(
    deps.docStore,
    "ws_default",
    project.id,
    "user_test",
    {
      mode: "custom",
      template: null,
      permissions: [
        "project:agent_runner:read",
        "project:agent_runner:manage",
      ],
    },
  );
  return project.id;
}

const NOTEBOOK_RUNNER_DISPATCH_TIMEOUT_MS = 1_500;
const NOTEBOOK_RUNNER_SETTLE_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildNotebookRunnerWsUrl(
  wsUrl: string,
  baseUrl: string,
  sessionId?: string,
): string {
  const resolved = new URL(
    wsUrl.replace("ws://localhost:20000", baseUrl.replace("http://", "ws://")),
  );
  if (sessionId) {
    resolved.searchParams.set("runner_session_id", sessionId);
  }
  return resolved.toString();
}

async function disposeWebSocket(
  ws: WebSocket | null | undefined,
): Promise<void> {
  if (!ws || ws.readyState === ws.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore test cleanup failures
      }
      resolve();
    }, 100);
    ws.once("close", finish);
    try {
      ws.close();
    } catch {
      try {
        ws.terminate();
      } catch {
        // ignore test cleanup failures
      }
      finish();
    }
  });
}

async function expectNotebookRunnerDispatch(
  dispatchPromise: Promise<{ requestId: string }>,
  label: string,
): Promise<{ requestId: string }> {
  return Promise.race([
    dispatchPromise,
    delay(NOTEBOOK_RUNNER_DISPATCH_TIMEOUT_MS).then(() => {
      throw new Error(
        `timed out waiting for ${label} to receive notebook server.request.start`,
      );
    }),
  ]);
}

async function createNotebookExternalAgentFixture(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  baseUrl: string,
  workspaceLibraryName: string,
): Promise<{
  agent: { id: string };
  agentKey: string;
  runnerWsUrl: string;
  workspaceLibrary: { id: string; name: string };
}> {
  const createCredential = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/credentials",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "glm-key",
        type: "api_key",
        value: "sk-placeholder-test",
      }),
    },
  );
  expect(createCredential.status).toBe(201);
  const credential = (await createCredential.json()) as { id: string };

  const createEndpoint = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/endpoints",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "glm-coding",
        type: "custom",
        provider_family: "custom",
        upstream_protocol: "openai_chat_completions",
        status: "active",
        wire_api: "responses",
        base_url: "https://example.com",
        model: "placeholder-model",
        capabilities: [
          {
            type: "chat_completion",
            enabled: true,
            default_model_id: "placeholder-model",
          },
        ],
        models: [
          {
            capability: "chat_completion",
            model_id: "placeholder-model",
            display_name: "placeholder-model",
          },
        ],
        defaults: { chat_model_id: "placeholder-model" },
        model_profile: {
          max_context_tokens: 204800,
          max_output_tokens: 128000,
          supports_file: false,
          supports_tool_call: true,
          supports_reasoning: false,
          price_input_per_1m: 0,
          price_output_per_1m: 0,
          cache_read_discount_ratio: 0,
          cache_write_discount_ratio: 0,
        },
        credential_ref: credential.id,
      }),
    },
  );
  expect(createEndpoint.status).toBe(201);
  const endpoint = (await createEndpoint.json()) as { id: string };

  const agent = await deps.agentResourceService.createAgent(
    "ws_default",
    "proj_1",
    {
      name: "Notebook task runner",
      runner_provider: "developer",
      status: "enabled",
      presence: "offline",
      runner_status: "ready",
      is_default: true,
      default_endpoint_id: endpoint.id,
      execution_preferences_json: {
        agent_task: {
          endpoint_id: endpoint.id,
          wire_api: "openai_responses",
        },
      },
      capabilities: {
        streaming_completion: true,
        multimodal_completion: false,
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
      owner_id: "user_test",
      visibility: "private",
    },
  );
  await deps.agentResourceService.clearDefaultAgentRunnersExcept(
    "ws_default",
    "proj_1",
    agent.id,
  );

  const workspaceLibrary = await createFileLibrary(baseUrl, workspaceLibraryName);

  const agentKey = await deps.agentResourceService.createAgentKey(
    "ws_default",
    "proj_1",
    agent.id,
  );
  const connectionInfo = deps.agentResourceService.buildConnectionInfo(agent);

  return {
    agent,
    agentKey: agentKey.key,
    runnerWsUrl: connectionInfo.ws_url,
    workspaceLibrary,
  };
}

async function createNotebookTask(
  baseUrl: string,
  workspaceFileLibraryId: string,
  title: string,
): Promise<{ id: string }> {
  const createTaskRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        workspace_file_library_id: workspaceFileLibraryId,
      }),
    },
  );
  expect(createTaskRes.status).toBe(201);
  return (await createTaskRes.json()) as { id: string };
}

async function postNotebookTaskRun(
  baseUrl: string,
  taskId: string,
  content: string,
): Promise<Response> {
  return apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: content }),
    },
  );
}

async function openNotebookRunnerSocket(input: {
  baseUrl: string;
  runnerWsUrl: string;
  agentKey: string;
  sessionId?: string;
  onRequestStart?: (ws: WebSocket, requestId: string) => void;
}): Promise<{
  ws: WebSocket;
  firstDispatch: Promise<{ requestId: string }>;
  getDispatchCount: () => number;
}> {
  let dispatchCount = 0;
  let resolveFirstDispatch: ((value: { requestId: string }) => void) | null =
    null;
  const firstDispatch = new Promise<{ requestId: string }>((resolve) => {
    resolveFirstDispatch = resolve;
  });

  const ws = new WebSocket(
    buildNotebookRunnerWsUrl(input.runnerWsUrl, input.baseUrl, input.sessionId),
    { headers: { Authorization: `Bearer ${input.agentKey}` } },
  );

  await new Promise<void>((resolve, reject) => {
    let ready = false;
    ws.once("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf-8")) as {
        type?: string;
        request_id?: string;
      };
      if (msg.type === "server.hello" && !ready) {
        ready = true;
        ws.send(
          JSON.stringify({
            type: "agent.ready",
            payload: {
              runner_spec: NOTEBOOK_RUNNER_SPEC,
              capabilities: { wire_api: "responses" },
            },
          }),
        );
        resolve();
        return;
      }
      if (msg.type !== "server.request.start" || !msg.request_id) return;
      dispatchCount += 1;
      if (resolveFirstDispatch) {
        resolveFirstDispatch({ requestId: msg.request_id });
        resolveFirstDispatch = null;
      }
      input.onRequestStart?.(ws, msg.request_id);
    });
  });

  return {
    ws,
    firstDispatch,
    getDispatchCount: () => dispatchCount,
  };
}

describe("api-entry-node me routes", () => {
  it("shuts down file library gateways when the server closes", async () => {
    const deps = createDefaultNodeApiDeps();
    const shutdown = vi.fn(async () => undefined);
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile: vi.fn(async () => undefined),
        shutdown,
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("waits for file library gateway shutdown before resolving server.close", async () => {
    const deps = createDefaultNodeApiDeps();
    let resolveShutdown: (() => void) | null = null;
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    );
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile: vi.fn(async () => undefined),
        shutdown,
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    let closeResolved = false;
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        closeResolved = true;
        resolve();
      });
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(closeResolved).toBe(false);

    resolveShutdown?.();
    await closePromise;

    expect(closeResolved).toBe(true);
  });

  it("still triggers gateway manager shutdown when reconcile is hung", async () => {
    process.env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS = "60000";
    process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED = "false";

    const deps = createDefaultNodeApiDeps();
    let resolveReconcile: (() => void) | null = null;
    let resolveShutdown: (() => void) | null = null;
    const reconcile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReconcile = resolve;
        }),
    );
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReconcile?.();
          resolveShutdown = resolve;
        }),
    );
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile,
        shutdown,
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    let closeResolved = false;
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        closeResolved = true;
        resolve();
      });
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(closeResolved).toBe(false);

    resolveShutdown?.();
    await closePromise;

    expect(closeResolved).toBe(true);
  });

  it("shuts down terminal and agent execution lifecycle services before resolving server.close", async () => {
    const deps = createDefaultNodeApiDeps();
    const terminalShutdown = vi.fn(async () => undefined);
    const executionShutdown = vi.fn(async () => undefined);
    vi.spyOn(deps.notebookTerminalService, "shutdown").mockImplementation(terminalShutdown);
    vi.spyOn(deps.agentExecutionService, "shutdown").mockImplementation(executionShutdown);
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(terminalShutdown).toHaveBeenCalledTimes(1);
    expect(executionShutdown).toHaveBeenCalledTimes(1);
    expect(terminalShutdown.mock.invocationCallOrder[0]).toBeLessThan(executionShutdown.mock.invocationCallOrder[0]);
  });

  it("waits for docStore.close before resolving server.close", async () => {
    const deps = createDefaultNodeApiDeps();
    let resolveDocStoreClose: (() => void) | null = null;
    const closeDocStore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDocStoreClose = resolve;
        }),
    );
    Object.defineProperty(deps.docStore, "close", {
      configurable: true,
      value: closeDocStore,
    });
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    let closeResolved = false;
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        closeResolved = true;
        resolve();
      });
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(closeDocStore).toHaveBeenCalledTimes(1);
    expect(closeResolved).toBe(false);

    resolveDocStoreClose?.();
    await closePromise;

    expect(closeResolved).toBe(true);
  });

  it("runs gateway reconcile on a single-flight interval and clears it during shutdown", async () => {
    process.env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS = "60000";
    process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED = "false";

    const deps = createDefaultNodeApiDeps();
    let resolveFirstReconcile: (() => void) | null = null;
    const reconcile = vi.fn(() => new Promise<void>((resolve) => {
      if (!resolveFirstReconcile) {
        resolveFirstReconcile = resolve;
        return;
      }
      resolve();
    }));
    const shutdown = vi.fn(async () => undefined);
    const intervalCallbacks: Array<() => void> = [];
    const intervalHandle = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler) => {
      intervalCallbacks.push(callback as () => void);
      return intervalHandle;
    }) as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);

    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        ...deps.fileLibraryGatewayManager,
        reconcile,
        shutdown,
      },
    });

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    expect(intervalCallbacks).toHaveLength(1);

    intervalCallbacks[0]();
    intervalCallbacks[0]();
    await Promise.resolve();
    expect(reconcile).toHaveBeenCalledTimes(1);

    resolveFirstReconcile?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    intervalCallbacks[0]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("returns unread notification count for authenticated user", async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(
      baseUrl,
      "/api/v1/me/notifications/unread-count",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unread_count: 0 });
  });

  it("returns desktop file libraries for the authenticated owner sorted newest first", async () => {
    const { baseUrl } = startServer();
    const older = await createFileLibrary(baseUrl, "Older Library");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createFileLibrary(baseUrl, "Newer Library");

    const response = await apiFetch(
      baseUrl,
      "/api/v1/me/desktop/file-libraries",
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    expect(payload.items.slice(0, 2)).toEqual([
      expect.objectContaining({ id: newer.id, name: "Newer Library" }),
      expect.objectContaining({ id: older.id, name: "Older Library" }),
    ]);
  });

  it("filters desktop file libraries down to mountable ready libraries", async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);
    const ready = await createFileLibrary(baseUrl, "Ready Library");

    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);
    const backendRepo = new JsonDocProjectFileLibraryBackendRepo(deps.docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(
      deps.docStore,
    );
    await catalogRepo.save({
      id: "flib_failed",
      workspace_id: "ws_default",
      project_id: "proj_1",
      name: "Failed Library",
      description: "broken",
      status: "failed",
      filesystem_name: "flib-failed",
      created_by_user_id: "user_test",
      created_at: new Date(Date.now() + 50).toISOString(),
      updated_at: new Date(Date.now() + 50).toISOString(),
    });
    await catalogRepo.save({
      id: "flib_ready_missing_mount",
      workspace_id: "ws_default",
      project_id: "proj_1",
      name: "Ready Missing Mount",
      description: "missing mount access",
      status: "ready",
      filesystem_name: "flib-ready-missing-mount",
      created_by_user_id: "user_test",
      created_at: new Date(Date.now() + 100).toISOString(),
      updated_at: new Date(Date.now() + 100).toISOString(),
    });
    await backendRepo.save("ws_default", "proj_1", "flib_ready_missing_mount", {
      library_id: "flib_ready_missing_mount",
      filesystem_name: "flib-ready-missing-mount",
      provisioning_status: "ready",
      gateway_status: "not_started",
      postgres: {
        host: "127.0.0.1",
        port: 15432,
        database: "jfs_ready_missing_mount",
        username: "jfsu_ready_missing_mount",
      },
      minio: {
        endpoint: "http://127.0.0.1:19000",
        bucket: "flib-ready-missing-mount",
      },
      metadata_url:
        "postgres://user:pass@127.0.0.1:15432/jfs_ready_missing_mount?sslmode=disable",
      internal_metadata_url:
        "postgres://user:pass@127.0.0.1:15432/jfs_ready_missing_mount?sslmode=disable",
    });
    await mountAccessRepo.save("ws_default", "proj_1", ready.id, {
      filesystem_name: "flib-ready-library",
      metadata_url:
        "postgres://user:pass@127.0.0.1:15432/jfs_ready_library?sslmode=disable",
      storage_bucket_url: "http://127.0.0.1:19000/flib-ready-library",
      recommended_mount_path: "~/Agentsmith/Ready Library",
      platform_notes: [],
      recommended_mount_commands: {
        linux: "noop",
        macos: "noop",
        windows: "noop",
      },
      created_at: new Date().toISOString(),
    });

    const response = await apiFetch(
      baseUrl,
      "/api/v1/me/desktop/file-libraries",
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    expect(payload.items).toEqual([
      expect.objectContaining({ id: ready.id, name: "Ready Library" }),
    ]);
  });
});

describe("api-entry-node brokered desktop auth routes", () => {
  it("starts, completes, exchanges, and accepts desktop sessions for desktop me routes", async () => {
    const { baseUrl } = startServer();

    const startResponse = await fetch(`${baseUrl}/api/v1/desktop/auth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deployment_base_url: "http://localhost:3101",
      }),
    });
    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as {
      request_id: string;
      browser_start_url: string;
      poll_url: string;
      poll_interval_ms: number;
    };
    expect(started.request_id).toMatch(/^dreq_/);
    expect(started.browser_start_url).toContain(
      "/en-US/desktop/auth/request?desktop_auth_request_id=",
    );

    const pendingResponse = await fetch(`${baseUrl}${started.poll_url}`);
    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      request_id: started.request_id,
      status: "pending",
    });

    const completeResponse = await apiFetch(
      baseUrl,
      `/api/v1/me/desktop/auth/requests/${started.request_id}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as {
      status: "authenticated";
      exchange_ticket: string;
    };
    expect(completed.exchange_ticket).toMatch(/^dext_/);

    const authenticatedResponse = await fetch(`${baseUrl}${started.poll_url}`);
    expect(authenticatedResponse.status).toBe(200);
    await expect(authenticatedResponse.json()).resolves.toMatchObject({
      request_id: started.request_id,
      status: "authenticated",
      exchange_ticket: completed.exchange_ticket,
      authenticated_user: expect.objectContaining({
        id: "user_test",
      }),
    });

    const exchangeResponse = await fetch(
      `${baseUrl}/api/v1/desktop/auth/exchange`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: started.request_id,
          exchange_ticket: completed.exchange_ticket,
        }),
      },
    );
    expect(exchangeResponse.status).toBe(200);
    const exchanged = (await exchangeResponse.json()) as {
      access_token: string;
      signed_in_user: {
        id: string;
        email: string;
      };
    };
    expect(exchanged.access_token).toMatch(/^dsk_/);
    expect(exchanged.signed_in_user).toMatchObject({
      id: "user_test",
      email: "test@example.com",
    });

    const meResponse = await fetch(
      `${baseUrl}/api/v1/me/desktop/file-libraries`,
      {
        headers: { authorization: `Bearer ${exchanged.access_token}` },
      },
    );
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });
});

describe("api-entry-node sse ticket routes", () => {
  it("returns an sse ticket for authenticated requests", async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(baseUrl, "/api/v1/sse-ticket", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticket: string;
      expires_at: string;
      max_connections: number;
      sso_url: string;
    };
    expect(body.ticket).toMatch(/^sse_/);
    expect(body.ticket).not.toBe("test-token");
    expect(body.max_connections).toBe(1);
    expect(body.sso_url).toContain(
      `/api/v1/events?ticket=${encodeURIComponent(body.ticket)}`,
    );
    expect(typeof body.expires_at).toBe("string");
    expect(Number.isNaN(Date.parse(body.expires_at))).toBe(false);
  });
});

describe("api-entry-node projects routes", () => {
  it("streams chat via endpoint universal proxy with canonical endpoint request", async () => {
    const { baseUrl, deps } = startServer();
    const { forwardRequest } = installMockUniversalProxy(deps);
    const { endpoint, session } = await createEndpointChatSession(baseUrl, {
      name: "chat-proxy-stream",
    });

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "evil.example",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({
          input: { role: "user", content: "hello" },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    const text = await streamRes.text();
    expect(text).toContain("event: delta");
    expect(text).toContain("echo:");
    expect(text).toContain("event: done");
    expect(forwardRequest).toHaveBeenCalledTimes(1);
    const dispatch = forwardRequest.mock.calls[0]?.[0];
    expect(dispatch).toMatchObject({
      namespace: "ns_chat_test",
      proxyPath: "openai/chat/completions",
      model: endpoint.model,
      providerCredential: "sk-chat-test",
    });
    expect(dispatch?.requestBody).toMatchObject({
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(dispatch?.requestBody).not.toHaveProperty("execution_context");
  });

  it("stops an endpoint chat stream through session stop state", async () => {
    const { baseUrl, deps } = startServer();
    const { forwardRequest } = installMockUniversalProxy(
      deps,
      buildSlowOpenAIStreamResponse,
    );
    const { session } = await createEndpointChatSession(baseUrl, {
      name: "chat-proxy-stop",
    });

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { role: "user", content: "stop me" },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stopRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/stop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(stopRes.status).toBe(202);
    await expect(stopRes.json()).resolves.toMatchObject({
      state: "stopping",
      stop_mode: "cancel",
    });
    const streamText = await streamRes.text();
    expect(forwardRequest).toHaveBeenCalledTimes(1);
    expect(streamText).toContain("event: done");
    expect(streamText).toContain('"message_status":"stopped"');
  });

  it("filters historical chat image data urls before dispatching endpoint requests", async () => {
    const { baseUrl, deps } = startServer();
    const { forwardRequest } = installMockUniversalProxy(deps);
    const { endpoint, session } = await createEndpointChatSession(baseUrl, {
      name: "history-filter-endpoint",
      capabilities: [
        {
          type: "chat_completion",
          enabled: true,
          default_model_id: "deepseek-chat",
        },
        {
          type: "multimodal_completion",
          enabled: true,
          default_model_id: "deepseek-chat",
        },
      ],
    });

    const historicalAttachment = await deps.chatResourceService.initAttachment({
      workspaceId: "ws_default",
      projectId: "proj_1",
      sessionId: session.id,
      fileName: "history.png",
      fileType: "image/png",
      fileSize: 4,
      contentBase64: "AAAA",
    });
    await deps.chatResourceService.createMessage({
      workspaceId: "ws_default",
      projectId: "proj_1",
      sessionId: session.id,
      role: "user",
      content: "history image",
      attachmentSnapshots: [
        {
          id: historicalAttachment.id,
          file_name: historicalAttachment.file_name,
          file_type: historicalAttachment.file_type,
          file_size: historicalAttachment.file_size,
        },
      ],
    });
    const currentAttachment = await deps.chatResourceService.initAttachment({
      workspaceId: "ws_default",
      projectId: "proj_1",
      sessionId: session.id,
      fileName: "current.png",
      fileType: "image/png",
      fileSize: 4,
      contentBase64: "BBBB",
    });

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          input: {
            role: "user",
            content: "current image",
            attachments: [currentAttachment.id],
          },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    await streamRes.text();

    const requestBody = forwardRequest.mock.calls[0]?.[0].requestBody as {
      messages?: Array<Record<string, unknown>>;
    };
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages?.[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "history image" },
        {
          type: "text",
          text: "[attached_image] history.png (image/png, 4B)",
        },
      ],
    });
    expect(requestBody.messages?.[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "current image" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,BBBB" },
        },
      ],
    });
  });

  it("falls back to the latest visible session leaf when branch_leaf_message_id is omitted", async () => {
    const deps = createDefaultNodeApiDeps();
    const { forwardRequest } = installMockUniversalProxy(deps);
    const { baseUrl } = startServerWithDeps(deps);
    const { endpoint } = await createEndpointChatSession(baseUrl, {
      name: "leaf-fallback-endpoint",
    });
    const session = await deps.chatResourceService.createSession({
      workspaceId: "ws_default",
      projectId: "proj_1",
      ownerUserId: "user_test",
      model: endpoint.model,
      endpointId: endpoint.id,
    });
    const historyUser = await deps.chatResourceService.createMessage({
      workspaceId: "ws_default",
      projectId: "proj_1",
      sessionId: session.id,
      role: "user",
      content: "history prompt",
    });

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: {
            role: "user",
            content: "follow-up prompt",
          },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    await streamRes.text();

    expect(forwardRequest).toHaveBeenCalledTimes(1);
    expect(forwardRequest.mock.calls[0]?.[0].requestBody).toMatchObject({
      messages: [
        { role: "user", content: "history prompt" },
        { role: "user", content: "follow-up prompt" },
      ],
    });

    const messages = await deps.chatResourceService.listMessages(
      "ws_default",
      "proj_1",
      session.id,
    );
    const followupUser = messages.find((item) => item.content === "follow-up prompt");
    expect(followupUser?.parent_id).toBe(historyUser.id);
  });

  it("rejects legacy external chat Agent Runner create wire", async () => {
    const { baseUrl } = startServer();

    const createAgentRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agent-runners",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "legacy-external-chat-agent",
          mode: "external",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          capabilities: {
            streaming_completion: true,
            multimodal_completion: true,
          },
        }),
      },
    );
    expect(createAgentRes.status).toBe(400);
    await expect(createAgentRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "unsupported_field",
      fields: ["mode", "interaction_kind", "execution_preferences"],
    });
  });

  it("enforces endpoint requests_per_minute policy for chat stream preflight", async () => {
    const upstream = await startUniversalProxyChatServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);

    const credentialRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/credentials",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "chat-rate-cred", value: "sk-chat-rate" }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/endpoints",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "chat-rate-endpoint",
          model: "deepseek-chat",
          type: "custom",
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: "custom",
          upstream_protocol: "openai_chat_completions",
          capabilities: [
            {
              type: "chat_completion",
              enabled: true,
              default_model_id: "deepseek-chat",
            },
          ],
          models: [
            { capability: "chat_completion", model_id: "deepseek-chat" },
          ],
          defaults: { chat_model_id: "deepseek-chat" },
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const patchPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          access_mode: "allow_all_members",
          allowed_subjects: [],
          rate_limits: {
            rules: [{ key: "endpoint.requests_per_minute", value: 1 }],
          },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const createSessionRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: "deepseek-chat",
        }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    // Keep both preflight checks inside the same minute bucket so this route test
    // validates policy enforcement instead of depending on wall-clock rollover.
    const currentNow = Date.now();
    const sameMinuteBucketNow =
      Math.floor(currentNow / 60_000) * 60_000 + 10_000;
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(sameMinuteBucketNow);
    try {
      const firstStreamRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint_id: endpoint.id,
            model: "deepseek-chat",
            input: { role: "user", content: "first" },
          }),
        },
      );
      expect(firstStreamRes.status).toBe(200);
      await firstStreamRes.text();

      const secondStreamRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint_id: endpoint.id,
            model: "deepseek-chat",
            input: { role: "user", content: "second" },
          }),
        },
      );
      expect(secondStreamRes.status).toBe(429);
      const secondBody = (await secondStreamRes.json()) as {
        error_code?: string;
        message?: string;
        resource_type?: string;
        resource_id?: string;
        retry_after_seconds?: number;
      };
      expect(secondBody).toMatchObject({
        error_code: "RESOURCE_POLICY_RATE_LIMITED",
        message: "resource_policy_rate_limited",
        resource_type: "endpoint",
        resource_id: endpoint.id,
      });
      expect(typeof secondBody.retry_after_seconds).toBe("number");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects legacy external_agent_id chat sessions", async () => {
    const { baseUrl } = startServer();

    const createSessionRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_agent_id: "ag_legacy_chat",
          model: "external-echo",
        }),
      },
    );
    expect(createSessionRes.status).toBe(400);
    await expect(createSessionRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "external_agent_id",
    });
  });

  it("rejects legacy Agent Runner public fields on create/update", async () => {
    const deps = createDefaultNodeApiDeps();
    const projectId = await createProjectWithAgentRunnerManage(deps);
    const { baseUrl } = startServerWithDeps(deps);
    const agentRunnerPath = `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners`;
    const ownerFetch = (path: string, init?: RequestInit) =>
      apiFetchWithToken(baseUrl, path, "test-token", init);

    const createWithoutKindRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "missing-kind-agent",
          mode: "external",
          execution_preferences: buildChatExecutionPreferences(),
        }),
      },
    );
    expect(createWithoutKindRes.status).toBe(400);
    await expect(createWithoutKindRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["mode", "execution_preferences"],
    });

    const createWithInvalidKindRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "invalid-kind-agent",
          mode: "external",
          interaction_kind: "legacy",
          execution_preferences: buildChatExecutionPreferences(),
        }),
      },
    );
    expect(createWithInvalidKindRes.status).toBe(400);
    await expect(createWithInvalidKindRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["mode", "interaction_kind", "execution_preferences"],
    });

    const createChatWithoutEndpointRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "chat-agent-invalid",
          mode: "external",
          interaction_kind: "chat",
          capabilities: {
            streaming_completion: true,
            multimodal_completion: false,
          },
        }),
      },
    );
    expect(createChatWithoutEndpointRes.status).toBe(400);
    await expect(createChatWithoutEndpointRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["mode", "interaction_kind"],
    });

    const createWithoutEndpointRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "nb-agent-invalid",
          mode: "external",
          interaction_kind: "notebook",
          capabilities: {
            streaming_completion: true,
            multimodal_completion: false,
          },
        }),
      },
    );
    expect(createWithoutEndpointRes.status).toBe(400);
    await expect(createWithoutEndpointRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["mode", "interaction_kind"],
    });

    const createChatAgentRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "agent-runner-patch-target",
          status: "ready",
          default_endpoint_id: "ep_chat_patch",
          capabilities: {
            task_execution: true,
            terminal: true,
          },
        }),
      },
    );
    expect(createChatAgentRes.status).toBe(201);
    const created = (await createChatAgentRes.json()) as {
      id: string;
      default_endpoint_id?: string;
    };
    expect(created.default_endpoint_id).toBe("ep_chat_patch");

    const patchInvalidRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction_kind: "legacy",
          execution_preferences:
            buildNotebookExecutionPreferences("ep_notebook_patch"),
        }),
      },
    );
    expect(patchInvalidRes.status).toBe(400);
    await expect(patchInvalidRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["interaction_kind", "execution_preferences"],
    });

    const patchMissingNotebookPrefRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction_kind: "notebook",
        }),
      },
    );
    expect(patchMissingNotebookPrefRes.status).toBe(400);
    await expect(patchMissingNotebookPrefRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: ["interaction_kind"],
    });
  });

  it("returns target Agent Runner readiness shape from create/list/get", async () => {
    const deps = createDefaultNodeApiDeps();
    const projectId = await createProjectWithAgentRunnerManage(deps);
    const { baseUrl } = startServerWithDeps(deps);
    const agentRunnerPath = `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners`;
    const ownerFetch = (path: string, init?: RequestInit) =>
      apiFetchWithToken(baseUrl, path, "test-token", init);

    const createRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "shape-agent",
          status: "ready",
          is_default: true,
          default_endpoint_id: "ep_shape_chat",
          capabilities: {
            task_execution: true,
            terminal: true,
          },
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.status).toBe("ready");
    expect(created.default_endpoint_id).toBe("ep_shape_chat");
    expect(created).not.toHaveProperty("interaction_mode");
    expect(created).not.toHaveProperty("interaction_kind");
    expect(created).not.toHaveProperty("execution_preferences_json");
    expect(created).not.toHaveProperty("execution_preferences");
    expect(created).not.toHaveProperty("mode");
    expect(created).not.toHaveProperty("config");

    const listRes = await ownerFetch(
      agentRunnerPath,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Record<string, unknown>[];
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed?.status).toBe("ready");
    expect(listed?.default_endpoint_id).toBe("ep_shape_chat");
    expect(listed).not.toHaveProperty("interaction_mode");
    expect(listed).not.toHaveProperty("interaction_kind");
    expect(listed).not.toHaveProperty("execution_preferences_json");
    expect(listed).not.toHaveProperty("execution_preferences");
    expect(listed).not.toHaveProperty("mode");
    expect(listed).not.toHaveProperty("config");

    const itemRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as Record<string, unknown>;
    expect(itemBody.status).toBe("ready");
    expect(itemBody.default_endpoint_id).toBe("ep_shape_chat");
    expect(itemBody).not.toHaveProperty("interaction_mode");
    expect(itemBody).not.toHaveProperty("interaction_kind");
    expect(itemBody).not.toHaveProperty("execution_preferences_json");
    expect(itemBody).not.toHaveProperty("execution_preferences");
    expect(itemBody).not.toHaveProperty("mode");
    expect(itemBody).not.toHaveProperty("config");
  });

  it("rejects legacy internal Agent Runner create payloads before sandbox checks", async () => {
    const { baseUrl } = startServer();

    const createInternalRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agent-runners",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "internal-no-sandbox",
          mode: "internal",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          config: {
            image: "runner:v1",
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(400);
    await expect(createInternalRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "unsupported_field",
      fields: [
        "mode",
        "interaction_kind",
        "execution_preferences",
        "config.image",
      ],
    });
  });

  it("rejects legacy internal Agent Runner idle timeout create payloads", async () => {
    const { baseUrl } = startServer();

    const createInternalRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agent-runners",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "internal-too-low-idle",
          mode: "internal",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          config: {
            image: "runner:v1",
            idle_timeout_sec: 120,
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(400);
    await expect(createInternalRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: [
        "mode",
        "interaction_kind",
        "execution_preferences",
        "config.image",
      ],
    });
  });

  it("rejects legacy internal Agent Runner patch config fields", async () => {
    const deps = createDefaultNodeApiDeps();
    const projectId = await createProjectWithAgentRunnerManage(deps);
    const { baseUrl } = startServerWithDeps(deps);
    const agentRunnerPath = `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners`;
    const ownerFetch = (path: string, init?: RequestInit) =>
      apiFetchWithToken(baseUrl, path, "test-token", init);

    const createInternalRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "agent-runner-patch-config-target",
          status: "ready",
          default_endpoint_id: "ep_internal_target",
        }),
      },
    );
    expect(createInternalRes.status).toBe(201);
    const created = (await createInternalRes.json()) as { id: string };

    const patchRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "internal",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          config: {
            image: "runner:v1",
            idle_timeout_sec: 900,
            max_lifetime_sec: 700,
          },
        }),
      },
    );
    expect(patchRes.status).toBe(400);
    await expect(patchRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      fields: [
        "mode",
        "interaction_kind",
        "execution_preferences",
        "config.image",
      ],
    });
  });

  it("rejects legacy internal chat sessions that target an Agent Runner", async () => {
    const { baseUrl } = startServer();

    const createSessionRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_agent_id: "ag_internal_chat",
          model: "gpt-5-codex",
        }),
      },
    );
    expect(createSessionRes.status).toBe(400);
    await expect(createSessionRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "external_agent_id",
    });
  });

  it("does not start internal chat keepalive for legacy Agent Runner chat sessions", async () => {
    const { baseUrl, deps } = startServer();
    const ensureAgentReady = vi.fn(async () => undefined);
    const keepalive = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive,
      releasePod: vi.fn(async () => undefined),
    };

    const createSessionRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_agent_id: "ag_internal_keepalive",
          model: "gpt-5-codex",
        }),
      },
    );
    expect(createSessionRes.status).toBe(400);
    await expect(createSessionRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "external_agent_id",
    });
    expect(ensureAgentReady).not.toHaveBeenCalled();
    expect(keepalive).not.toHaveBeenCalled();
  });

  it("releases internal workload pod when notebook task is archived", async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent(
      "ws_default",
      "proj_1",
      {
        name: "managed-agent-task-runner",
        runner_provider: "managed",
        status: "enabled",
        runner_status: "ready",
        is_default: true,
        owner_id: "user_test",
        visibility: "private",
        default_endpoint_id: "ep_internal",
        capabilities: {
          task_execution: true,
          terminal: true,
        },
      },
    );

    const taskRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Internal Task",
          workspace_mode: "create_new",
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };
    await expect(
      acquireNotebookTaskRunLease(
        deps.cache,
        buildNotebookTaskRunState({
          taskId: task.id,
          runId: "run_release_archive",
          runnerId: internalAgent.id,
          startedAt: new Date().toISOString(),
          ownerInstanceId: "index-test",
        }),
      ),
    ).resolves.toBe(true);

    const archiveRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      },
    );
    expect(archiveRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith(
      "ws_default",
      "proj_1",
      sanitizeWorkloadId(task.id),
    );
  });

  it("does not leak internal raw key in agent API responses", async () => {
    const deps = createDefaultNodeApiDeps();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    const projectId = await createProjectWithAgentRunnerManage(deps);
    const { baseUrl } = startServerWithDeps(deps);
    const agentRunnerPath = `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners`;
    const ownerFetch = (path: string, init?: RequestInit) =>
      apiFetchWithToken(baseUrl, path, "test-token", init);

    const createRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "managed-sanitized",
          status: "ready",
          default_endpoint_id: "ep_sanitized",
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      config?: Record<string, unknown>;
    };
    expect(created.config?._internal_raw_key).toBeUndefined();
    expect(created.config?._internal_key_id).toBeUndefined();

    const listRes = await ownerFetch(
      agentRunnerPath,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{ id: string; config?: Record<string, unknown> }>;
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed?.config?._internal_raw_key).toBeUndefined();
    expect(listed?.config?._internal_key_id).toBeUndefined();

    const itemRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as {
      config?: Record<string, unknown>;
    };
    expect(itemBody.config?._internal_raw_key).toBeUndefined();
    expect(itemBody.config?._internal_key_id).toBeUndefined();

    const stored = await deps.agentResourceService.getAgent(
      "ws_default",
      projectId,
      created.id,
    );
    expect(
      typeof (stored?.config as Record<string, unknown> | undefined)
        ?._internal_raw_key,
    ).toBe("string");
    expect(
      typeof (stored?.config as Record<string, unknown> | undefined)
        ?._internal_key_id,
    ).toBe("string");
  });

  it("rejects legacy task agent_id selector on create", async () => {
    const { baseUrl } = startServer();
    const taskRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Legacy Task Agent Selector",
          agent_id: "ag_legacy_task",
          workspace_mode: "create_new",
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(400);
    await expect(taskRes.json()).resolves.toMatchObject({
      error_code: "unsupported_field",
      message: "unsupported_field",
      fields: ["agent_id"],
    });
  });

  it("normalizes endpoint base_url when full chat/completions path is provided", async () => {
    const upstream = await startUniversalProxyChatServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/credentials",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "glm-key",
          type: "api_key",
          value: "sk-placeholder-test",
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/endpoints",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "glm-chat",
          model: "placeholder-model",
          type: "custom",
          base_url: `${upstream.baseUrl}/chat/completions`,
          credential_ref: credential.id,
          provider_family: "custom",
          upstream_protocol: "openai_chat_completions",
          capabilities: [
            {
              type: "chat_completion",
              enabled: true,
              default_model_id: "placeholder-model",
            },
          ],
          models: [
            { capability: "chat_completion", model_id: "placeholder-model" },
          ],
          defaults: { chat_model_id: "placeholder-model" },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as {
      id: string;
      base_url: string;
    };
    expect(endpoint.base_url.endsWith("/chat/completions")).toBe(false);

    const streamRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: "placeholder-model",
        }),
      },
    );
    expect(streamRes.status).toBe(201);
    const session = (await streamRes.json()) as { id: string };

    const sendRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { role: "user", content: "hello glm" },
        }),
      },
    );
    expect(sendRes.status).toBe(200);
    expect(upstream.lastPath().endsWith("/openai/v1/chat/completions")).toBe(
      true,
    );
  });

  it("truncates oversized notebook trace details payloads", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const socketsToClose: WebSocket[] = [];
    try {
      const { baseUrl, deps } = startServer();
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const fixture = await createNotebookExternalAgentFixture(
        deps,
        baseUrl,
        "Truncate Trace Workspace",
      );
      const agentScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
      });
      socketsToClose.push(agentScopedRunner.ws);
      const task = await createNotebookTask(
        baseUrl,
        fixture.workspaceLibrary.id,
        "Truncate trace details",
      );
      const huge = "x".repeat(40_000);
      const taskScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
        sessionId: task.id,
        onRequestStart: (ws, requestId) => {
          ws.send(
            JSON.stringify({
              type: "agent.response.event",
              request_id: requestId,
              payload: {
                sequence: 1,
                at: new Date().toISOString(),
                category: "debug",
                phase: "update",
                name: "runner.debug",
                summary: "huge details payload",
                details: { stderr: huge },
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: requestId,
              payload: { finish_reason: "stop", usage_tokens: 1 },
            }),
          );
        },
      });
      socketsToClose.push(taskScopedRunner.ws);

      const postMessageRes = await postNotebookTaskRun(baseUrl, task.id, "run");
      expect(postMessageRes.status).toBe(200);
      await expectNotebookRunnerDispatch(
        taskScopedRunner.firstDispatch,
        "truncates oversized notebook trace details payloads",
      );
      await delay(NOTEBOOK_RUNNER_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      let tracesBody: {
        items: Array<{ details?: Record<string, unknown> }>;
      } | null = null;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const tracesRes = await apiFetch(
          baseUrl,
          `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
        );
        expect(tracesRes.status).toBe(200);
        tracesBody = (await tracesRes.json()) as {
          items: Array<{ details?: Record<string, unknown> }>;
        };
        if (tracesBody.items.some((item) => item.details?._truncated === true))
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(tracesBody).not.toBeNull();
      const detailEvent = tracesBody!.items.find(
        (item) => item.details && Object.keys(item.details).length > 0,
      );
      expect(detailEvent).toBeTruthy();
      expect(detailEvent!.details?._truncated).toBe(true);
      expect(detailEvent!.details?._reason).toBe("trace_details_too_large");
      expect(typeof detailEvent!.details?._preview).toBe("string");
    } finally {
      await Promise.allSettled(socketsToClose.map((socket) => disposeWebSocket(socket)));
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 20_000);

  it("writes notebook task data to docStore (tasks/messages/traces)", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const socketsToClose: WebSocket[] = [];
    try {
      const { baseUrl } = startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const fixture = await createNotebookExternalAgentFixture(
        deps,
        baseUrl,
        "Persist Notebook Workspace",
      );
      const agentScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
      });
      socketsToClose.push(agentScopedRunner.ws);
      const task = await createNotebookTask(
        baseUrl,
        fixture.workspaceLibrary.id,
        "Persist notebook docs",
      );
      const taskScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
        sessionId: task.id,
        onRequestStart: (ws, requestId) => {
          ws.send(
            JSON.stringify({
              type: "agent.response.event",
              request_id: requestId,
              payload: {
                sequence: 1,
                at: new Date().toISOString(),
                category: "progress",
                phase: "start",
                status: "running",
                name: "codex.exec",
                summary: "Starting Codex execution",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.delta",
              request_id: requestId,
              payload: { delta: "persisted-output" },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: requestId,
              payload: { finish_reason: "stop", usage_tokens: 3 },
            }),
          );
        },
      });
      socketsToClose.push(taskScopedRunner.ws);

      const postMessageRes = await postNotebookTaskRun(baseUrl, task.id, "run");
      expect(postMessageRes.status).toBe(200);
      await expectNotebookRunnerDispatch(
        taskScopedRunner.firstDispatch,
        "writes notebook task data to docStore",
      );
      await delay(NOTEBOOK_RUNNER_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const traces = await deps.docStore.list<{ task_id: string }>(
          "ws_default_agent_task_trace_events",
          { task_id: task.id },
        );
        const msgs = await deps.docStore.list<{
          task_id: string;
          role: string;
          content: string;
        }>("ws_default_agent_task_messages", { task_id: task.id });
        if (
          traces.some((trace) => trace.task_id === task.id) &&
          msgs.some(
            (m) => m.role === "agent" && m.content.includes("persisted-output"),
          )
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const baseTasks = await deps.docStore.list<{ id: string }>(
        "agent_tasks",
        {},
      );
      const baseMessages = await deps.docStore.list<{
        task_id: string;
        role: string;
        content: string;
      }>("agent_task_messages", { task_id: task.id });
      const baseTraces = await deps.docStore.list<{
        task_id: string;
        category: string;
      }>("agent_task_trace_events", { task_id: task.id });
      const storedTasks = await deps.docStore.list<{ id: string }>(
        "ws_default_agent_tasks",
        {},
      );
      const storedMessages = await deps.docStore.list<{
        task_id: string;
        role: string;
        content: string;
      }>("ws_default_agent_task_messages", { task_id: task.id });
      const storedTraces = await deps.docStore.list<{
        task_id: string;
        category: string;
      }>("ws_default_agent_task_trace_events", { task_id: task.id });

      expect(baseTasks).toHaveLength(0);
      expect(baseMessages).toHaveLength(0);
      expect(baseTraces).toHaveLength(0);
      expect(storedTasks.some((t) => t.id === task.id)).toBe(true);
      expect(storedMessages.some((m) => m.role === "user")).toBe(true);
      expect(
        storedMessages.some(
          (m) => m.role === "agent" && m.content.includes("persisted-output"),
        ),
      ).toBe(true);
      expect(storedTraces.some((t) => t.category === "progress")).toBe(true);
    } finally {
      await Promise.allSettled(socketsToClose.map((socket) => disposeWebSocket(socket)));
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 20_000);

  it("keeps docStore traces bounded when retention truncation is triggered", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const socketsToClose: WebSocket[] = [];
    try {
      const { baseUrl } = startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const fixture = await createNotebookExternalAgentFixture(
        deps,
        baseUrl,
        "Trace Retention Workspace",
      );
      const agentScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
      });
      socketsToClose.push(agentScopedRunner.ws);
      const task = await createNotebookTask(
        baseUrl,
        fixture.workspaceLibrary.id,
        "Trace retention bound",
      );
      const taskScopedRunner = await openNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        agentKey: fixture.agentKey,
        sessionId: task.id,
        onRequestStart: (ws, requestId) => {
          for (let i = 0; i < 1010; i += 1) {
            ws.send(
              JSON.stringify({
                type: "agent.response.event",
                request_id: requestId,
                payload: {
                  sequence: i + 1,
                  at: new Date(Date.now() + i).toISOString(),
                  category: "debug",
                  phase: "update",
                  name: "runner.debug",
                  summary: `evt-${i}`,
                },
              }),
            );
          }
          ws.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: requestId,
              payload: { finish_reason: "stop", usage_tokens: 1 },
            }),
          );
        },
      });
      socketsToClose.push(taskScopedRunner.ws);

      const postMessageRes = await postNotebookTaskRun(baseUrl, task.id, "run");
      expect(postMessageRes.status).toBe(200);
      await expectNotebookRunnerDispatch(
        taskScopedRunner.firstDispatch,
        "keeps docStore traces bounded when retention truncation is triggered",
      );
      await delay(NOTEBOOK_RUNNER_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      let storedTraces: Array<{
        task_id: string;
        summary: string;
        name: string;
      }> = [];
      for (let attempt = 0; attempt < 300; attempt += 1) {
        storedTraces = await deps.docStore.list<{
          task_id: string;
          summary: string;
          name: string;
        }>("ws_default_agent_task_trace_events", { task_id: task.id });
        if (
          storedTraces.some((t) => t.name === "trace.buffer") ||
          (storedTraces.length === 1000 &&
            storedTraces.some((t) => t.summary === "evt-1009"))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(storedTraces.length).toBeLessThanOrEqual(1000);
      expect(
        storedTraces.some((t) => t.name === "trace.buffer") ||
          storedTraces.length === 1000,
      ).toBe(true);
      expect(storedTraces.some((t) => t.summary === "evt-0")).toBe(false);
      expect(storedTraces.some((t) => t.summary === "evt-1009")).toBe(true);
    } finally {
      await Promise.allSettled(socketsToClose.map((socket) => disposeWebSocket(socket)));
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 20_000);
});
