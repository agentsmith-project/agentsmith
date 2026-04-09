import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { NOTEBOOK_RUNNER_SPEC } from "@mbos/agent-runner";
import { apiFetch, startServer } from "./test-support.js";

const sockets: WebSocket[] = [];

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

describe("api-entry-node notebook task artifact routes", () => {
  it("deduplicates notebook task artifacts by task_relative_path across repeated execution artifact frames", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "";
    const { baseUrl } = startServer();
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    try {
      const workspaceLibrary = await createFileLibrary(
        baseUrl,
        "Artifact Dedupe Workspace",
      );

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
      const keyResp = (await keyRes.json()) as { key: string };
      const connInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
      );
      expect(connInfoRes.status).toBe(200);
      const connInfo = (await connInfoRes.json()) as { ws_url: string };
      const wsUrl = connInfo.ws_url.replace(
        "ws://localhost:20000",
        baseUrl.replace("http://", "ws://"),
      );

      let markRunnerReady: (() => void) | null = null;
      const runnerReady = new Promise<void>((resolve) => {
        markRunnerReady = resolve;
      });
      const wsReady = new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${keyResp.key}` },
        });
        sockets.push(ws);
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
            markRunnerReady?.();
            markRunnerReady = null;
            return;
          }
          if (msg.type !== "server.request.start" || !msg.request_id) return;
          ws.send(
            JSON.stringify({
              type: "agent.response.artifact",
              request_id: msg.request_id,
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
              request_id: msg.request_id,
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
              request_id: msg.request_id,
              payload: { finish_reason: "stop" },
            }),
          );
          setTimeout(() => {
            ws.close();
            resolve();
          }, 10);
        });
      });
      await runnerReady;

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "artifact-dedupe",
            agent_id: agent.id,
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: "run" }),
        },
      );

      await wsReady;

      const artifactsRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`,
        {
          headers: {},
        },
      );
      expect(artifactsRes.status).toBe(200);
      const artifacts = (await artifactsRes.json()) as Array<{
        title?: string;
        task_relative_path?: string;
      }>;
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
      const workspaceLibrary = await createFileLibrary(
        baseUrl,
        "Artifact Download Workspace",
      );

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
      const keyResp = (await keyRes.json()) as { key: string };
      const connInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
      );
      expect(connInfoRes.status).toBe(200);
      const connInfo = (await connInfoRes.json()) as { ws_url: string };
      const wsUrl = connInfo.ws_url.replace(
        "ws://localhost:20000",
        baseUrl.replace("http://", "ws://"),
      );

      let markRunnerReady: (() => void) | null = null;
      const runnerReady = new Promise<void>((resolve) => {
        markRunnerReady = resolve;
      });
      const wsReady = new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${keyResp.key}` },
        });
        sockets.push(ws);
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
            markRunnerReady?.();
            markRunnerReady = null;
            return;
          }
          if (msg.type !== "server.request.start" || !msg.request_id) return;
          ws.send(
            JSON.stringify({
              type: "agent.response.artifact",
              request_id: msg.request_id,
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
              request_id: msg.request_id,
              payload: { finish_reason: "stop" },
            }),
          );
          setTimeout(() => {
            ws.close();
            resolve();
          }, 10);
        });
      });
      await runnerReady;

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "artifact-download",
            agent_id: agent.id,
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: "run" }),
        },
      );
      await wsReady;

      const artifactsRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`,
      );
      expect(artifactsRes.status).toBe(200);
      const artifacts = (await artifactsRes.json()) as Array<{
        id: string;
        title?: string;
      }>;
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
});
