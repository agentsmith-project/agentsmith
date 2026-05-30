import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { AGENT_TASK_RUNNER_SPEC } from "@mbos/agent-runner-contract";
import { createDefaultNodeApiDeps } from "./index.js";
import { AgentTaskModelSettingService } from "./agent-task-model-setting-service.js";
import { sanitizeWorkloadId } from "./internal-agent-pod-manager.js";
import { UniversalProxyService } from "./universal-proxy-service.js";
import {
  cleanupChatUpstreamServers,
  startUniversalProxyChatServer,
} from "./__integration__/chat-test-support.js";
import {
  apiFetch,
  apiFetchWithToken,
  startServer as startBaseServer,
  startServerWithDeps as startBaseServerWithDeps,
} from "./__integration__/test-support.js";
import {
  configureAfscpReadyFileLibraryTestDeps,
} from "./__integration__/afscp-file-library-test-support.js";
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
} from "./notebook-task/task-run-coordination.js";
import {
  __resetTaskFileLibraryBindingsForTests,
} from "./notebook-task/task-file-library-bindings.js";
import {
  ACTIVE_RUNS_BY_TASK,
  ACTIVE_RUN_CANCEL_BY_TASK,
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK,
  ARTIFACTS_BY_TASK,
  MESSAGES_BY_TASK,
  TASKS_BY_PROJECT,
} from "./notebook-task/task-runtime-state.js";
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from "./project-member-governance-persistence.js";

const originalManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
const originalInternalAgentImage = process.env.INTERNAL_AGENT_IMAGE;
const INDEX_TEST_MANAGED_RUNNER_IMAGE = `kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${"7".repeat(64)}`;
type NodeApiTestDeps = ReturnType<typeof createDefaultNodeApiDeps>;
type GetProjectInput = Parameters<NodeApiTestDeps["getProjectUseCase"]["execute"]>[0];
type GetProjectResult = Awaited<ReturnType<NodeApiTestDeps["getProjectUseCase"]["execute"]>>;
const defaultProjectFallbackDeps = new WeakSet<NodeApiTestDeps>();

beforeEach(() => {
  ACTIVE_RUNS_BY_TASK.clear();
  ACTIVE_RUN_CANCEL_BY_TASK.clear();
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.clear();
  ARTIFACTS_BY_TASK.clear();
  MESSAGES_BY_TASK.clear();
  TASKS_BY_PROJECT.clear();
  __resetTaskFileLibraryBindingsForTests();
  process.env.INTERNAL_AGENT_IMAGE = INDEX_TEST_MANAGED_RUNNER_IMAGE;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChatUpstreamServers();
  __resetTaskFileLibraryBindingsForTests();
  if (originalManagedExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  else process.env.AGENT_EXECUTION_HTTP_BASE_URL = originalManagedExecutionHttpBase;
  if (originalInternalAgentImage === undefined) delete process.env.INTERNAL_AGENT_IMAGE;
  else process.env.INTERNAL_AGENT_IMAGE = originalInternalAgentImage;
});

function ensureDefaultProjectUseCaseFallback(deps: NodeApiTestDeps): void {
  if (defaultProjectFallbackDeps.has(deps)) return;
  const originalExecute = deps.getProjectUseCase.execute.bind(deps.getProjectUseCase);
  deps.getProjectUseCase.execute = async (input: GetProjectInput): Promise<GetProjectResult> => {
    try {
      return await originalExecute(input);
    } catch (error) {
      if (input.workspaceId !== "ws_default" || input.projectId !== "proj_1") {
        throw error;
      }
      return {
        id: "proj_1",
        workspace_id: "ws_default",
        name: "Default Project",
        owner_id: "user_test",
        governance_json: null,
      } as GetProjectResult;
    }
  };
  defaultProjectFallbackDeps.add(deps);
}

function configureIndexTestDeps(deps: NodeApiTestDeps): void {
  configureAfscpReadyFileLibraryTestDeps(deps);
  ensureDefaultProjectUseCaseFallback(deps);
}

function startServer(): ReturnType<typeof startBaseServer> {
  const started = startBaseServer();
  configureIndexTestDeps(started.deps);
  return started;
}

function startServerWithDeps(
  deps: NodeApiTestDeps,
): ReturnType<typeof startBaseServerWithDeps> {
  configureIndexTestDeps(deps);
  return startBaseServerWithDeps(deps);
}

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

async function seedAgentTaskModelSetting(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  endpointId: string,
  projectId = "proj_1",
): Promise<void> {
  const service = new AgentTaskModelSettingService(deps);
  const current = await service.getSetting("ws_default", projectId);
  await service.patchSetting({
    workspaceId: "ws_default",
    projectId,
    endpointId,
    expectedSettingRevision: current?.setting_revision ?? null,
    actorUserId: "user_test",
  });
}

async function grantNotebookTaskRunnerPermissions(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  projectId = "proj_1",
): Promise<void> {
  await upsertProjectMembershipRecord(deps.docStore, "ws_default", projectId, {
    project_id: projectId,
    user_id: "user_test",
    user_email: "test@example.com",
    user_name: "Test User",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  await upsertProjectMemberPermissionState(
    deps.docStore,
    "ws_default",
    projectId,
    "user_test",
    {
      mode: "custom",
      template: null,
      permissions: [
        "project:agent_task:use",
        "project:agent_runner:manage",
        "project:files:update",
      ],
    },
  );
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

function configureManagedNotebookTaskRuntimeDeps(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
): void {
  deps.internalAgentPodManager ??= {
    ensureAgentReady: async () => undefined,
    keepalive: async () => undefined,
    releasePod: async () => undefined,
  } as never;
  deps.internalAgentWorkspaceBindingManager ??= {
    ensureWorkspaceBinding: async (input: {
      workspaceId: string;
      projectId: string;
      fileLibraryId: string;
      taskId: string;
    }) => ({
      binding: {
        id: `bind_${input.taskId}`,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        file_library_id: input.fileLibraryId,
        provider: "afscp",
        status: "ready",
        task_home_binding_id: `bind_${input.taskId}`,
        task_home_path: `/home/${input.taskId}`,
        workspace_path: `/home/${input.taskId}/workspace`,
        artifacts_path: `/home/${input.taskId}/workspace/.artifacts`,
        library_root_path: ".",
        created_at: "2026-04-05T00:00:00.000Z",
        updated_at: "2026-04-05T00:00:00.000Z",
      },
      workspaceMount: {
        bindingId: `bind_${input.taskId}`,
        mountPath: `/home/${input.taskId}`,
        taskHomePath: `/home/${input.taskId}`,
        workspacePath: `/home/${input.taskId}/workspace`,
        artifactsPath: `/home/${input.taskId}/workspace/.artifacts`,
        subPath: `agent-tasks/${input.taskId}`,
        fileLibraryId: input.fileLibraryId,
      },
    }),
  } as never;
  deps.internalWorkloadCoordinator ??= {
    acquireHolder: async () => undefined,
    releaseHolder: async () => undefined,
    requestHardTeardown: async () => undefined,
  } as never;
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
  process.env.AGENT_EXECUTION_HTTP_BASE_URL = `${baseUrl}/api/v1`;
  configureManagedNotebookTaskRuntimeDeps(deps);
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
  await seedAgentTaskModelSetting(deps, endpoint.id);
  await grantNotebookTaskRunnerPermissions(deps);

  const agent = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner(
    "ws_default",
    "proj_1",
    {
      name: "Notebook task runner",
      runner_provider: "managed",
      status: "enabled",
      presence: "managed",
      runner_status: "ready",
      is_default: true,
      endpointId: endpoint.id,
      execution_preferences_json: {
        task: {
          endpoint_id: endpoint.id,
          wire_api: "openai_responses",
          model: "placeholder-model",
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
  _agentId: string,
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
        workspace_mode: "use_existing",
        workspace_file_library_id: workspaceFileLibraryId,
      }),
    },
  );
  expect(createTaskRes.status, await createTaskRes.clone().text()).toBe(201);
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
              runner_spec: AGENT_TASK_RUNNER_SPEC,
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
  it("does not start retired background refresh intervals", async () => {
    const deps = createDefaultNodeApiDeps();
    const reconcile = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => undefined);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { server } = startServerWithDeps({
      ...deps,
      fileLibraryGatewayManager: {
        reconcile,
        shutdown,
      },
    } as never);

    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", () => resolve());
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(shutdown).not.toHaveBeenCalled();
  });

  it("shuts down terminal and agent execution lifecycle services before resolving server.close", async () => {
    const deps = createDefaultNodeApiDeps();
    const terminalShutdown = vi.fn(async () => undefined);
    const executionShutdown = vi.fn(async () => undefined);
    vi.spyOn(deps.notebookTerminalService, "shutdown").mockImplementation(terminalShutdown);
    vi.spyOn(deps.agentExecutionService, "shutdown").mockImplementation(executionShutdown);
    const { server } = startServerWithDeps(deps);

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
    const { server } = startServerWithDeps(deps);

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

  it("returns unread notification count for authenticated user", async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(
      baseUrl,
      "/api/v1/me/notifications/unread-count",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unread_count: 0 });
  });

  it("returns 404 for the removed desktop file libraries route", async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(
      baseUrl,
      "/api/v1/me/desktop/file-libraries",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "NOT_FOUND",
    });
  });
});

describe("api-entry-node removed desktop auth routes", () => {
  it("lets unauthenticated desktop auth routes fail through the generic auth gate", async () => {
    const { baseUrl } = startServer();

    const responses = [
      await fetch(`${baseUrl}/api/v1/desktop/auth/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deployment_base_url: "http://localhost:3101",
        }),
      }),
      await fetch(`${baseUrl}/api/v1/desktop/auth/requests/dreq_removed`),
      await fetch(`${baseUrl}/api/v1/desktop/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: "dreq_removed",
          exchange_ticket: "dext_removed",
        }),
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error_code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      });
    }
  });

  it("lets authenticated desktop auth routes fall through to the generic unknown route response", async () => {
    const { baseUrl } = startServer();

    const startResponse = await apiFetch(baseUrl, "/api/v1/desktop/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deployment_base_url: "http://localhost:3101",
      }),
    });
    expect(startResponse.status).toBe(404);
    await expect(startResponse.json()).resolves.toMatchObject({
      error_code: "NOT_FOUND",
      message: "Route not found",
    });

    const pollResponse = await apiFetch(
      baseUrl,
      "/api/v1/desktop/auth/requests/dreq_removed",
    );
    expect(pollResponse.status).toBe(404);
    await expect(pollResponse.json()).resolves.toMatchObject({
      error_code: "NOT_FOUND",
      message: "Route not found",
    });

    const exchangeResponse = await apiFetch(baseUrl, "/api/v1/desktop/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "dreq_removed",
        exchange_ticket: "dext_removed",
      }),
    });
    expect(exchangeResponse.status).toBe(404);
    await expect(exchangeResponse.json()).resolves.toMatchObject({
      error_code: "NOT_FOUND",
      message: "Route not found",
    });
  });

  it("returns 404 for authenticated desktop auth completion under me routes", async () => {
    const { baseUrl } = startServer();

    const completeResponse = await apiFetch(
      baseUrl,
      "/api/v1/me/desktop/auth/requests/dreq_removed/complete",
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(404);
    await expect(completeResponse.json()).resolves.toMatchObject({
      error_code: "NOT_FOUND",
      message: "Route not found",
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
      mode: "cancel",
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
      fields: [
        "mode",
        "interaction_kind",
        "execution_preferences",
        "capabilities",
      ],
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
      fields: ["mode", "interaction_kind", "capabilities"],
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
      fields: ["mode", "interaction_kind", "capabilities"],
    });

    const createChatAgentRes = await ownerFetch(
      agentRunnerPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "agent-runner-patch-target",
          description: "Developer runner patch target",
        }),
      },
    );
    expect(createChatAgentRes.status).toBe(201);
    const created = (await createChatAgentRes.json()) as {
      id: string;
      kind?: string;
    };
    expect(created.kind).toBe("developer");

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
          description: "Developer runner shape",
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      name: "shape-agent",
      description: "Developer runner shape",
      kind: "developer",
      source: "developer",
      read_only: false,
      is_default: false,
      status: "draft",
      diagnostics: expect.objectContaining({
        presence: "offline",
      }),
      actions: expect.objectContaining({
        edit: expect.objectContaining({ visible: true }),
        delete: expect.objectContaining({ visible: true }),
        issue_connection_key: expect.objectContaining({ visible: true }),
      }),
    });
    expect(created).not.toHaveProperty("interaction_mode");
    expect(created).not.toHaveProperty("interaction_kind");
    expect(created).not.toHaveProperty("execution_preferences_json");
    expect(created).not.toHaveProperty("execution_preferences");
    expect(created).not.toHaveProperty("mode");
    expect(created).not.toHaveProperty("runner_runtime");
    expect(created).not.toHaveProperty("default_endpoint_id");
    expect(created).not.toHaveProperty("config");

    const listRes = await ownerFetch(
      agentRunnerPath,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Record<string, unknown>[];
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toMatchObject({
      name: "shape-agent",
      kind: "developer",
      source: "developer",
      read_only: false,
      is_default: false,
      status: "draft",
    });
    expect(listed).not.toHaveProperty("interaction_mode");
    expect(listed).not.toHaveProperty("interaction_kind");
    expect(listed).not.toHaveProperty("execution_preferences_json");
    expect(listed).not.toHaveProperty("execution_preferences");
    expect(listed).not.toHaveProperty("mode");
    expect(listed).not.toHaveProperty("runner_runtime");
    expect(listed).not.toHaveProperty("default_endpoint_id");
    expect(listed).not.toHaveProperty("config");

    const itemRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as Record<string, unknown>;
    expect(itemBody).toMatchObject({
      name: "shape-agent",
      kind: "developer",
      source: "developer",
      read_only: false,
      is_default: false,
      status: "draft",
    });
    expect(itemBody).not.toHaveProperty("interaction_mode");
    expect(itemBody).not.toHaveProperty("interaction_kind");
    expect(itemBody).not.toHaveProperty("execution_preferences_json");
    expect(itemBody).not.toHaveProperty("execution_preferences");
    expect(itemBody).not.toHaveProperty("mode");
    expect(itemBody).not.toHaveProperty("runner_runtime");
    expect(itemBody).not.toHaveProperty("default_endpoint_id");
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
            image: INDEX_TEST_MANAGED_RUNNER_IMAGE,
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
        "config",
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
            image: INDEX_TEST_MANAGED_RUNNER_IMAGE,
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
        "config",
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
          description: "Developer runner config patch target",
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
            image: INDEX_TEST_MANAGED_RUNNER_IMAGE,
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
        "config",
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

    const endpoint = await createChatEndpoint(baseUrl, {
      name: "internal-task-endpoint",
      model: "gpt-5-codex",
    });
    await seedAgentTaskModelSetting(deps, endpoint.id);
    await grantNotebookTaskRunnerPermissions(deps);
    const internalAgent = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner(
      "ws_default",
      "proj_1",
      {
        name: "managed-agent-task-runner",
        status: "enabled",
        presence: "managed",
        runner_status: "ready",
        endpointId: endpoint.id,
        owner_id: "user_test",
        visibility: "private",
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
          file_inputs: true,
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
          input_refs: [],
        }),
      },
    );
    expect(taskRes.status, await taskRes.clone().text()).toBe(201);
    const task = (await taskRes.json()) as { id: string };
    await expect(
      acquireNotebookTaskRunLease(
        deps.cache,
        buildNotebookTaskRunState({
          taskId: task.id,
          runId: "run_release_archive",
          runnerId: internalAgent.id,
          resolvedRunnerId: internalAgent.id,
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

    const created = await deps.agentResourceService.createAgent(
      "ws_default",
      projectId,
      {
        name: "managed-sanitized",
        runner_provider: "managed",
        status: "enabled",
        presence: "managed",
        runner_status: "ready",
        default_endpoint_id: "ep_sanitized",
        owner_id: "user_test",
        visibility: "private",
      },
    );

    const listRes = await ownerFetch(
      agentRunnerPath,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{ id: string; config?: Record<string, unknown> }>;
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed).not.toHaveProperty("config");
    expect(listed?.config?._internal_raw_key).toBeUndefined();
    expect(listed?.config?._internal_key_id).toBeUndefined();

    const itemRes = await ownerFetch(
      `${agentRunnerPath}/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as {
      config?: Record<string, unknown>;
    };
    expect(itemBody).not.toHaveProperty("config");
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
          input_refs: [],
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
        fixture.agent.id,
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

      let storedTraces: Array<{ details?: Record<string, unknown> }> = [];
      for (let attempt = 0; attempt < 200; attempt += 1) {
        storedTraces = await deps.docStore.list<{
          task_id: string;
          details?: Record<string, unknown>;
        }>(
          "ws_default_agent_task_trace_events",
          { task_id: task.id },
        );
        if (storedTraces.some((item) => item.details?._truncated === true))
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const detailEvent = storedTraces.find(
        (item) => item.details && Object.keys(item.details).length > 0,
      );
      expect(detailEvent).toBeTruthy();
      expect(detailEvent!.details?._truncated).toBe(true);
      expect(detailEvent!.details?._reason).toBe("trace_details_too_large");
      expect(typeof detailEvent!.details?._preview).toBe("string");
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      expect(JSON.stringify(await tracesRes.json())).not.toContain(huge.slice(0, 1024));
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
        fixture.agent.id,
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
        fixture.agent.id,
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
