import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AGENT_TASK_RUNNER_SPEC } from "@mbos/agent-runner-contract";
import { clearNotebookTaskEventState } from "../notebook-task-sse-broker.js";
import {
  ARTIFACTS_BY_TASK,
  MESSAGES_BY_TASK,
  TASKS_BY_PROJECT,
} from "../notebook-task/task-runtime-state.js";
import {
  notebookTaskArtifactsCollection,
  notebookTaskMessagesCollection,
} from "../notebook-task/task-store.js";
import {
  buildTaskTraceEvent,
  removeTaskTraceEventsFromMemory,
  storeTaskTraceEvent,
} from "../notebook-trace-store.js";
import { apiFetch, startServer } from "./test-support.js";
import { AgentTaskModelSettingService } from "../agent-task-model-setting-service.js";
import {
  upsertProjectMembershipRecord,
  upsertProjectMemberPermissionState,
} from "../project-member-governance-persistence.js";

const sockets: WebSocket[] = [];
const RUNNER_DISPATCH_TIMEOUT_MS = 1_500;
const NO_DISPATCH_SETTLE_MS = 300;
const originalManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;

function ensureProjectUseCaseFallback(
  deps: ReturnType<typeof startServer>["deps"],
): void {
  const originalGetProject = deps.getProjectUseCase.execute.bind(deps.getProjectUseCase);
  deps.getProjectUseCase.execute = async (input: { workspaceId: string; projectId: string }) => {
    try {
      return await originalGetProject(input);
    } catch {
      if (input.workspaceId !== "ws_default" || input.projectId !== "proj_1") {
        throw new Error("project_not_found");
      }
      return {
        id: "proj_1",
        workspace_id: "ws_default",
        name: "proj_1",
        owner_id: "user_test",
        governance_json: null,
      } as never;
    }
  };
}

async function seedNotebookTaskCreateReadiness(
  deps: ReturnType<typeof startServer>["deps"],
  endpointId: string,
): Promise<void> {
  ensureProjectUseCaseFallback(deps);
  await new AgentTaskModelSettingService(deps).patchSetting({
    workspaceId: "ws_default",
    projectId: "proj_1",
    endpointId,
    expectedSettingRevision: null,
    actorUserId: "user_test",
  });
  await upsertProjectMembershipRecord(deps.docStore, "ws_default", "proj_1", {
    project_id: "proj_1",
    user_id: "user_test",
    user_email: "test@example.com",
    user_name: "Test User",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  await upsertProjectMemberPermissionState(deps.docStore, "ws_default", "proj_1", "user_test", {
    mode: "custom",
    template: null,
    permissions: [
      "project:agent_task:use",
      "project:agent_runner:manage",
      "project:files:update",
    ],
  });
}

type ParsedDefaultSseBlock = {
  id: string | null;
  payload: Record<string, unknown> | null;
};

function parseDefaultSseBlocks(text: string): ParsedDefaultSseBlock[] {
  const blocks = text
    .split("\n\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const parsed: ParsedDefaultSseBlock[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const dataLine = lines.find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const idLine = lines.find((line) => line.startsWith("id:"));
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(dataLine.slice("data:".length).trim()) as Record<
        string,
        unknown
      >;
    } catch {
      payload = null;
    }
    parsed.push({
      id: idLine ? idLine.slice("id:".length).trim() : null,
      payload,
    });
  }
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildRunnerWsUrl(
  wsUrl: string,
  baseUrl: string,
  sessionId?: string,
): string {
  const resolved = new URL(wsUrl);
  const localBase = new URL(baseUrl);
  resolved.protocol = localBase.protocol === "https:" ? "wss:" : "ws:";
  resolved.host = localBase.host;
  if (sessionId) {
    resolved.searchParams.set("runner_session_id", sessionId);
  }
  return resolved.toString();
}

function configureManagedTaskRunnerRuntimeDeps(
  deps: ReturnType<typeof startServer>["deps"],
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

async function expectRunnerDispatch(
  dispatchPromise: Promise<{ requestId: string }>,
  label: string,
): Promise<{ requestId: string }> {
  return Promise.race([
    dispatchPromise,
    delay(RUNNER_DISPATCH_TIMEOUT_MS).then(() => {
      throw new Error(
        `timed out waiting for ${label} to receive server.request.start`,
      );
    }),
  ]);
}

async function openReadyNotebookRunnerSocket(input: {
  baseUrl: string;
  runnerWsUrl: string;
  runnerKey: string;
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
    buildRunnerWsUrl(input.runnerWsUrl, input.baseUrl, input.sessionId),
    {
      headers: { Authorization: `Bearer ${input.runnerKey}` },
    },
  );
  sockets.push(ws);

  await new Promise<void>((resolve, reject) => {
    ws.once("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf-8")) as {
        type?: string;
        request_id?: string;
      };
      if (msg.type === "server.hello") {
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

async function readSseBlocks(
  response: Response,
  minBlocks: number,
  timeoutMs = 1_000,
): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  const countBlocks = (): number =>
    text
      .split("\n\n")
      .map((item) => item.trim())
      .filter(Boolean).length;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader!.read(),
      new Promise<{ done: true; value?: undefined }>((resolve) => {
        setTimeout(() => resolve({ done: true }), remaining);
      }),
    ]);
    if (result.value) {
      text += decoder.decode(result.value, { stream: !result.done });
      if (countBlocks() >= minBlocks) {
        await reader?.cancel().catch(() => undefined);
        return text;
      }
    }
    if (result.done) {
      break;
    }
  }

  await reader?.cancel().catch(() => undefined);
  return text;
}

afterEach(() => {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  sockets.length = 0;
  if (originalManagedExecutionHttpBase === undefined) {
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  } else {
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = originalManagedExecutionHttpBase;
  }
});

describe("api-entry-node notebook task event routes", () => {
  it("replays buffered task events after last_event_id for notebook task SSE", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "";
    const { baseUrl, deps } = startServer();
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = `${baseUrl}/api/v1`;
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    configureManagedTaskRunnerRuntimeDeps(deps);
    try {
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
            type: "catalog",
            provider_family: "glm",
            upstream_protocol: "openai_chat_completions",
            status: "active",
            wire_api: "responses",
            base_url: "https://example.com",
            model: "placeholder-model",
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
      await seedNotebookTaskCreateReadiness(deps, endpoint.id);

      const agent = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner("ws_default", "proj_1", {
        name: "External notebook agent",
        runner_provider: "managed",
        is_default: true,
        status: "enabled",
        presence: "managed",
        runner_status: "ready",
        endpointId: endpoint.id,
        owner_id: "user_test",
        visibility: "private",
        capabilities: {
          task_execution: true,
          artifacts: true,
          streaming_completion: true,
          multimodal_completion: false,
        },
        execution_preferences_json: {
          task: {
            endpoint_id: endpoint.id,
            wire_api: "chat",
            model: "placeholder-model",
          },
        },
      });

      const agentKey = await deps.agentResourceService.createAgentKey("ws_default", "proj_1", agent.id);
      const connectionInfo = deps.agentResourceService.buildConnectionInfo(agent);

      const agentScopedRunner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: connectionInfo.ws_url,
        runnerKey: agentKey.key,
      });

      const createLibraryRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/file-libraries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Task SSE replay workspace" }),
        },
      );
      expect(createLibraryRes.status).toBe(201);
      const workspaceLibrary = (await createLibraryRes.json()) as {
        id: string;
      };

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Task SSE replay",
            workspace_mode: "use_existing",
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status, await createTaskRes.clone().text()).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      const taskScopedRunner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: connectionInfo.ws_url,
        runnerKey: agentKey.key,
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
                summary: "Starting",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.event",
              request_id: requestId,
              payload: {
                sequence: 2,
                at: new Date().toISOString(),
                category: "progress",
                phase: "update",
                status: "running",
                name: "codex.exec",
                summary: "Halfway",
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

      const postMessageRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "run" }),
        },
      );
      expect(postMessageRes.status).toBe(200);
      await expectRunnerDispatch(
        taskScopedRunner.firstDispatch,
        "notebook task-scoped runner",
      );
      await delay(NO_DISPATCH_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      const replayRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/events?last_event_id=1`,
      );
      expect(replayRes.status).toBe(200);
      expect(replayRes.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const replayText = await readSseBlocks(replayRes, 2, 4_000);
      const replayBlocks = parseDefaultSseBlocks(replayText).filter(
        (item) => item.payload && item.payload.type !== "ping",
      );
      expect(
        replayBlocks.some((item) => item.payload?.type === "trace_event"),
      ).toBe(true);
      expect(replayText).toContain("Running command");
      expect(
        replayBlocks.some((item) => item.payload?.type === "task_update"),
      ).toBe(true);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("falls back to persisted authoritative notebook task truth when SSE replay history is missing", async () => {
    const { baseUrl, deps } = startServer();
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = `${baseUrl}/api/v1`;
    configureManagedTaskRunnerRuntimeDeps(deps);
    const credential = await deps.endpointResourceService.createCredential("ws_default", "proj_1", {
      name: "persisted-fallback-key",
      value: "sk-placeholder-test",
    });
    const endpoint = await deps.endpointResourceService.createEndpoint("ws_default", "proj_1", {
      name: "persisted fallback endpoint",
      model: "placeholder-model",
      type: "custom",
      base_url: "https://example.com/v1",
      credential_ref: credential.id,
      status: "active",
      upstream_protocol: "openai_chat_completions",
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
    });
    await seedNotebookTaskCreateReadiness(deps, endpoint.id);
    await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner("ws_default", "proj_1", {
      name: "Persisted fallback notebook agent",
      runner_provider: "managed",
      status: "enabled",
      presence: "managed",
      is_default: true,
      endpointId: endpoint.id,
      owner_id: "user_test",
      visibility: "private",
      capabilities: {
        task_execution: true,
        artifacts: true,
        streaming_completion: true,
        multimodal_completion: false,
      },
      execution_preferences_json: {
        task: {
          endpoint_id: endpoint.id,
          wire_api: "chat",
          model: "placeholder-model",
        },
      },
    });

    const createLibraryRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/file-libraries",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Persisted fallback workspace" }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const workspaceLibrary = (await createLibraryRes.json()) as { id: string };

    const createTaskRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Persisted fallback task",
          workspace_mode: "use_existing",
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status, await createTaskRes.clone().text()).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const createdAt = new Date().toISOString();
    await deps.docStore.upsert(
      notebookTaskMessagesCollection("ws_default"),
      "msg_persisted_user",
      {
        id: "msg_persisted_user",
        task_id: task.id,
        role: "user",
        content: "persisted user turn",
        created_at: createdAt,
      },
    );
    await deps.docStore.upsert(
      notebookTaskMessagesCollection("ws_default"),
      "msg_persisted_agent",
      {
        id: "msg_persisted_agent",
        task_id: task.id,
        role: "agent",
        content: "persisted final answer",
        created_at: createdAt,
      },
    );
    await deps.docStore.upsert(
      notebookTaskArtifactsCollection("ws_default"),
      "artifact_persisted_1",
      {
        id: "artifact_persisted_1",
        task_id: task.id,
        type: "image",
        title: "persisted-chart.png",
        task_relative_path: ".artifacts/persisted-chart.png",
        mime_type: "image/png",
        created_at: createdAt,
      },
    );
    await storeTaskTraceEvent(
      deps,
      "ws_default",
      task.id,
      buildTaskTraceEvent({
        taskId: task.id,
        messageId: "msg_persisted_agent",
        runId: "run_persisted_fallback",
        payload: {
          sequence: 1,
          at: createdAt,
          category: "progress",
          phase: "update",
          status: "running",
          name: "codex.exec",
          summary: "Persisted trace event",
        },
      }),
    );

    clearNotebookTaskEventState(task.id);
    MESSAGES_BY_TASK.delete(task.id);
    ARTIFACTS_BY_TASK.delete(task.id);
    TASKS_BY_PROJECT.delete("ws_default:proj_1");
    removeTaskTraceEventsFromMemory(task.id);

    const replayRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/events?last_event_id=${task.id}:999`,
    );
    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    const replayText = await readSseBlocks(replayRes, 5, 4_000);
    const replayBlocks = parseDefaultSseBlocks(replayText).filter(
      (item) => item.payload && item.payload.type !== "ping",
    );

    expect(
      replayBlocks.some((item) => item.payload?.type === "task_update"),
    ).toBe(true);
    expect(
      replayBlocks.some(
        (item) =>
          item.payload?.type === "activity_item" &&
          item.payload?.data &&
          (item.payload.data as { id?: string }).id === "msg_persisted_agent",
      ),
    ).toBe(true);
    expect(
      replayBlocks.some(
        (item) =>
          item.payload?.type === "artifact" &&
          item.payload?.data &&
          (item.payload.data as { id?: string }).id === "artifact_persisted_1",
      ),
    ).toBe(true);
    expect(
      replayBlocks.some(
        (item) =>
          item.payload?.type === "trace_event" &&
          item.payload?.data &&
          (item.payload.data as { summary?: string }).summary ===
            "Running command",
      ),
    ).toBe(true);
  });
});
