import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { NOTEBOOK_RUNNER_SPEC } from "@mbos/agent-runner";
import { apiFetch, startServer } from "./test-support.js";

const sockets: WebSocket[] = [];
const RUNNER_DISPATCH_TIMEOUT_MS = 1_500;
const NO_DISPATCH_SETTLE_MS = 300;

afterEach(() => {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  sockets.length = 0;
});

async function createFileLibrary(
  baseUrl: string,
  name = "Artifact Workspace",
): Promise<{ id: string }> {
  const createLibraryRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/file-libraries",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: "artifact workspace library" }),
    },
  );
  expect(createLibraryRes.status).toBe(201);
  return (await createLibraryRes.json()) as { id: string };
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
  const resolved = new URL(
    wsUrl.replace("ws://localhost:20000", baseUrl.replace("http://", "ws://")),
  );
  if (sessionId) {
    resolved.searchParams.set("session_id", sessionId);
  }
  return resolved.toString();
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

async function createNotebookArtifactFixture(baseUrl: string, workspaceName: string): Promise<{
  workspaceLibrary: { id: string };
  agent: { id: string };
  runnerKey: string;
  runnerWsUrl: string;
}> {
  const workspaceLibrary = await createFileLibrary(baseUrl, workspaceName);

  const credentialRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/credentials",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "task-runner-key",
        type: "api_key",
        value: "sk-task",
      }),
    },
  );
  expect(credentialRes.status).toBe(201);
  const credential = (await credentialRes.json()) as { id: string };

  const endpointRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/endpoints",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "task-endpoint",
        model: "gpt-5-codex",
        type: "openai",
        mode: "openai",
        base_url: "https://example.com/v1",
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
  expect(endpointRes.status).toBe(201);
  const endpoint = (await endpointRes.json()) as { id: string };

  const agentRes = await apiFetch(
    baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/agents",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "NotebookAgent",
        mode: "external",
        interaction_kind: "notebook",
        execution_preferences: {
          notebook: {
            endpoint_id: endpoint.id,
            model: "gpt-5-codex",
            wire_api: "responses",
          },
        },
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
      }),
    },
  );
  expect(agentRes.status).toBe(201);
  const agent = (await agentRes.json()) as { id: string };

  const keyRes = await apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "runner" }),
    },
  );
  expect(keyRes.status).toBe(201);
  const keyResp = (await keyRes.json()) as { key: string };

  const connInfoRes = await apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
  );
  expect(connInfoRes.status).toBe(200);
  const connInfo = (await connInfoRes.json()) as { ws_url: string };

  return {
    workspaceLibrary,
    agent,
    runnerKey: keyResp.key,
    runnerWsUrl: connInfo.ws_url,
  };
}

async function createNotebookTask(input: {
  baseUrl: string;
  agentId: string;
  workspaceFileLibraryId: string;
  title: string;
}): Promise<{ id: string }> {
  const createTaskRes = await apiFetch(
    input.baseUrl,
    "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        agent_id: input.agentId,
        workspace_file_library_id: input.workspaceFileLibraryId,
      }),
    },
  );
  expect(createTaskRes.status).toBe(201);
  return (await createTaskRes.json()) as { id: string };
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

async function waitForExecutionOfflineTrace(
  baseUrl: string,
  taskId: string,
): Promise<{ summary?: string; details?: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tracesRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/traces`,
    );
    expect(tracesRes.status).toBe(200);
    const tracesBody = (await tracesRes.json()) as {
      items: Array<{
        status?: string;
        name?: string;
        summary?: string;
        details?: Record<string, unknown>;
      }>;
    };
    const terminalTrace = tracesBody.items.find(
      (item) => item.name === "execution.terminal" && item.status === "error",
    );
    if (terminalTrace) {
      return terminalTrace;
    }
    await delay(20);
  }
  throw new Error("execution.terminal offline trace did not materialize");
}

async function listNotebookTaskArtifacts(
  baseUrl: string,
  taskId: string,
): Promise<Array<{ id: string; title?: string; task_relative_path?: string }>> {
  const artifactsRes = await apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/artifacts`,
  );
  expect(artifactsRes.status).toBe(200);
  return (await artifactsRes.json()) as Array<{
    id: string;
    title?: string;
    task_relative_path?: string;
  }>;
}

async function waitForNotebookTaskArtifacts(
  baseUrl: string,
  taskId: string,
  predicate: (
    artifacts: Array<{ id: string; title?: string; task_relative_path?: string }>,
  ) => boolean,
): Promise<Array<{ id: string; title?: string; task_relative_path?: string }>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const artifacts = await listNotebookTaskArtifacts(baseUrl, taskId);
    if (predicate(artifacts)) {
      return artifacts;
    }
    await delay(20);
  }
  return listNotebookTaskArtifacts(baseUrl, taskId);
}

async function postNotebookTaskMessage(
  baseUrl: string,
  taskId: string,
  content: string,
): Promise<Response> {
  return apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content }),
    },
  );
}

describe("api-entry-node notebook task artifact routes", () => {
  it("deduplicates notebook task artifacts by task_relative_path across repeated execution artifact frames", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "";
    const { baseUrl } = startServer();
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    try {
      const fixture = await createNotebookArtifactFixture(
        baseUrl,
        "Artifact Dedupe Workspace",
      );
      const agentScopedRunner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        runnerKey: fixture.runnerKey,
      });
      const task = await createNotebookTask({
        baseUrl,
        agentId: fixture.agent.id,
        workspaceFileLibraryId: fixture.workspaceLibrary.id,
        title: "artifact-dedupe",
      });

      const runner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        runnerKey: fixture.runnerKey,
        sessionId: task.id,
        onRequestStart: (ws, requestId) => {
          ws.send(
            JSON.stringify({
              type: "agent.response.artifact",
              request_id: requestId,
              payload: {
                filename: "plot.png",
                task_relative_path: ".artifacts/plot.png",
                artifact_type: "image",
                mime_type: "image/png",
                file_size: 1234,
                title: "plot.png",
                content: "data:image/png;base64,AAAA",
                thumbnail_url: "data:image/png;base64,AAAA",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.artifact",
              request_id: requestId,
              payload: {
                filename: "plot.png",
                task_relative_path: ".artifacts/plot.png",
                artifact_type: "image",
                mime_type: "image/png",
                file_size: 1234,
                title: "plot.png",
                content: "data:image/png;base64,AAAA",
                thumbnail_url: "data:image/png;base64,AAAA",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: requestId,
              payload: { finish_reason: "stop" },
            }),
          );
        },
      });

      const postMessageRes = await postNotebookTaskMessage(baseUrl, task.id, "run");
      expect(postMessageRes.status).toBe(200);
      await expectRunnerDispatch(
        runner.firstDispatch,
        "artifact dedupe task-scoped runner",
      );
      await delay(NO_DISPATCH_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      const artifacts = await waitForNotebookTaskArtifacts(
        baseUrl,
        task.id,
        (items) => items.length === 1,
      );
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.title).toBe("plot.png");
      expect(artifacts[0]?.task_relative_path).toBe(".artifacts/plot.png");
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 30_000);

  it("downloads notebook task artifact content in local backend when inline content is available", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "";
    const { baseUrl } = startServer();
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    try {
      const fixture = await createNotebookArtifactFixture(
        baseUrl,
        "Artifact Download Workspace",
      );
      const agentScopedRunner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        runnerKey: fixture.runnerKey,
      });
      const task = await createNotebookTask({
        baseUrl,
        agentId: fixture.agent.id,
        workspaceFileLibraryId: fixture.workspaceLibrary.id,
        title: "artifact-download",
      });

      const runner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        runnerKey: fixture.runnerKey,
        sessionId: task.id,
        onRequestStart: (ws, requestId) => {
          ws.send(
            JSON.stringify({
              type: "agent.response.artifact",
              request_id: requestId,
              payload: {
                filename: "hello.txt",
                task_relative_path: ".artifacts/hello.txt",
                artifact_type: "text",
                mime_type: "text/plain",
                file_size: 6,
                title: "hello.txt",
                content: "hello\n",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: requestId,
              payload: { finish_reason: "stop" },
            }),
          );
        },
      });

      const postMessageRes = await postNotebookTaskMessage(baseUrl, task.id, "run");
      expect(postMessageRes.status).toBe(200);
      await expectRunnerDispatch(
        runner.firstDispatch,
        "artifact download task-scoped runner",
      );
      await delay(NO_DISPATCH_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      const artifacts = await waitForNotebookTaskArtifacts(
        baseUrl,
        task.id,
        (items) => items.length === 1,
      );
      expect(artifacts).toHaveLength(1);
      const artifactId = artifacts[0]!.id;

      const downloadRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts/${artifactId}/download`,
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-type")).toContain("text/plain");
      expect(downloadRes.headers.get("content-disposition")).toContain(
        "hello.txt",
      );
      await expect(downloadRes.text()).resolves.toBe("hello\n");
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 30_000);

  it("does not dispatch notebook execution to an agent-scoped runner without a task-scoped websocket and leaves no artifacts", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "";
    const { baseUrl } = startServer();
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    try {
      const fixture = await createNotebookArtifactFixture(
        baseUrl,
        "Artifact Offline Workspace",
      );
      const agentScopedRunner = await openReadyNotebookRunnerSocket({
        baseUrl,
        runnerWsUrl: fixture.runnerWsUrl,
        runnerKey: fixture.runnerKey,
      });
      const task = await createNotebookTask({
        baseUrl,
        agentId: fixture.agent.id,
        workspaceFileLibraryId: fixture.workspaceLibrary.id,
        title: "artifact-offline",
      });

      const postMessageRes = await postNotebookTaskMessage(
        baseUrl,
        task.id,
        "run without task-scoped runner",
      );
      expect(postMessageRes.status).toBe(200);

      await delay(NO_DISPATCH_SETTLE_MS);
      expect(agentScopedRunner.getDispatchCount()).toBe(0);

      const terminalTrace = await waitForExecutionOfflineTrace(baseUrl, task.id);
      expect(terminalTrace.summary).toContain("AGENT_OFFLINE");
      expect(
        (terminalTrace.details as { synthesized?: boolean } | undefined)
          ?.synthesized,
      ).toBe(true);

      const artifacts = await waitForNotebookTaskArtifacts(
        baseUrl,
        task.id,
        (items) => items.length === 0,
      );
      expect(artifacts).toEqual([]);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 30_000);
});
