import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { CHAT_RUNNER_SPEC, NOTEBOOK_RUNNER_SPEC } from "@mbos/agent-runner";
import { createDefaultNodeApiDeps } from "./index.js";
import {
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from "./file-library-persistence.js";
import { sanitizeWorkloadId } from "./internal-agent-pod-manager.js";
import { UniversalProxyService } from "./universal-proxy-service.js";
import { startUniversalProxyChatServer } from "./__integration__/chat-test-support.js";
import {
  apiFetch,
  startServer,
  startServerWithDeps,
} from "./__integration__/test-support.js";

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

function buildChatExecutionPreferences(endpointId = "ep_chat_default") {
  return {
    chat: {
      endpoint_id: endpointId,
      wire_api: "chat",
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
  it("streams chat via external agent websocket execution channel", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    let ws: WebSocket | null = null;
    try {
      const { baseUrl } = startServer();
      process.env.PUBLIC_API_BASE_URL = baseUrl;

      const createAgentRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "echo-agent",
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
      expect(createAgentRes.status).toBe(201);
      const agent = (await createAgentRes.json()) as { id: string };
      await createFileLibrary(baseUrl, "Truncate Trace Workspace");

      const keyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(keyRes.status).toBe(201);
      const keyPayload = (await keyRes.json()) as { key: string };
      expect(keyPayload.key).toBeTruthy();

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

      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });
      let observedExecutionTicket = "";
      let observedLegacyBearer = "";
      let observedApiBase = "";
      let observedEndpointId = "";
      let observedWireApi = "";
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => {
          ws.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: CHAT_RUNNER_SPEC,
                capabilities: {
                  wire_api: "responses",
                  streaming_completion: true,
                },
              },
            }),
          );
          resolve();
        });
        ws.once("error", reject);
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf-8")) as {
          type?: string;
          request_id?: string;
          payload?: {
            messages?: unknown[];
            execution_context?: {
              api_base?: string;
              interaction_kind?: string;
              task_id?: string;
              endpoint_id?: string;
              wire_api?: string;
              execution_ticket?: string;
              user_bearer_token?: string;
            };
          };
        };
        if (msg.type !== "server.request.start" || !msg.request_id) return;
        observedApiBase = msg.payload?.execution_context?.api_base ?? "";
        expect(msg.payload?.execution_context?.interaction_kind).toBe("chat");
        expect(msg.payload?.execution_context?.task_id).toBeUndefined();
        observedEndpointId = msg.payload?.execution_context?.endpoint_id ?? "";
        observedWireApi = msg.payload?.execution_context?.wire_api ?? "";
        observedExecutionTicket =
          msg.payload?.execution_context?.execution_ticket ?? "";
        observedLegacyBearer =
          msg.payload?.execution_context?.user_bearer_token ?? "";
        ws.send(
          JSON.stringify({
            type: "agent.response.event",
            request_id: msg.request_id,
            payload: {
              sequence: 1,
              at: new Date().toISOString(),
              category: "warning",
              phase: "update",
              status: "running",
              name: "session.workspace_recreated",
              summary: "chat_session_workspace_recreated",
              details: {
                session_id: "external-chat-session",
              },
            },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "agent.response.delta",
            request_id: msg.request_id,
            payload: { delta: "echo:" },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "agent.response.delta",
            request_id: msg.request_id,
            payload: { delta: " hello" },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "agent.response.done",
            request_id: msg.request_id,
            payload: { finish_reason: "stop", usage_tokens: 6 },
          }),
        );
      });

      const createSessionRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_agent_id: agent.id,
            model: "external-echo",
          }),
        },
      );
      expect(createSessionRes.status).toBe(201);
      const session = (await createSessionRes.json()) as { id: string };

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
      expect(text).toContain("event: warning");
      expect(text).toContain('"code":"session.workspace_recreated"');
      expect(text).toContain("event: delta");
      expect(text).toContain("echo:");
      expect(text).toContain("event: done");
      expect(observedApiBase).toBe(`${baseUrl}/api/v1`);
      expect(observedEndpointId).toBe("ep_chat_default");
      expect(observedWireApi).toBe("chat");
      expect(observedExecutionTicket).toMatch(/^exec_/);
      expect(observedLegacyBearer).toBe("");
    } finally {
      ws?.close();
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("stops an external agent chat stream by propagating cancel to the runner", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    let ws: WebSocket | null = null;
    try {
      const { baseUrl } = startServer();
      process.env.PUBLIC_API_BASE_URL = baseUrl;

      const createAgentRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "cancel-agent",
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
      expect(createAgentRes.status).toBe(201);
      const agent = (await createAgentRes.json()) as { id: string };

      const keyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(keyRes.status).toBe(201);
      const keyPayload = (await keyRes.json()) as { key: string };

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

      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });
      let activeRequestId = "";
      let cancelObserved = false;
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => {
          ws?.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: CHAT_RUNNER_SPEC,
                capabilities: {
                  wire_api: "chat",
                  streaming_completion: true,
                },
              },
            }),
          );
          resolve();
        });
        ws.once("error", reject);
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf-8")) as {
          type?: string;
          request_id?: string;
        };
        if (msg.type === "server.request.start" && msg.request_id) {
          activeRequestId = msg.request_id;
          return;
        }
        if (msg.type === "server.request.cancel" && msg.request_id === activeRequestId) {
          cancelObserved = true;
          ws?.send(
            JSON.stringify({
              type: "agent.response.done",
              request_id: msg.request_id,
              payload: { finish_reason: "cancelled", usage_tokens: 0 },
            }),
          );
        }
      });

      const createSessionRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "cancel-session",
            endpoint_id: "",
            external_agent_id: agent.id,
            model: "external-cancel",
          }),
        },
      );
      expect(createSessionRes.status).toBe(201);
      const session = (await createSessionRes.json()) as { id: string };

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
      const streamText = await streamRes.text();
      expect(cancelObserved).toBe(true);
      expect(streamText).toContain('event: done');
      expect(streamText).toContain('"message_status":"stopped"');
      expect(streamText).toContain('"finish_reason":"cancelled"');
    } finally {
      ws?.close();
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("filters historical chat image data urls before dispatching external agent requests", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    let ws: WebSocket | null = null;
    try {
      const { baseUrl, deps } = startServer();
      process.env.PUBLIC_API_BASE_URL = baseUrl;

      const createAgentRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "history-filter-agent",
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
      expect(createAgentRes.status).toBe(201);
      const agent = (await createAgentRes.json()) as { id: string };

      const createKeyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(createKeyRes.status).toBe(201);
      const keyPayload = (await createKeyRes.json()) as { key: string };

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

      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });
      const ready = new Promise<void>((resolve, reject) => {
        ws?.once("open", () => {
          ws?.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: CHAT_RUNNER_SPEC,
                capabilities: {
                  wire_api: "responses",
                  streaming_completion: true,
                },
              },
            }),
          );
          resolve();
        });
        ws?.once("error", reject);
      });
      const observedMessages = new Promise<Array<Record<string, unknown>>>(
        (resolve, reject) => {
          ws?.on("message", (raw) => {
            const msg = JSON.parse(raw.toString("utf-8")) as {
              type?: string;
              request_id?: string;
              payload?: { messages?: Array<Record<string, unknown>> };
            };
            if (msg.type !== "server.request.start" || !msg.request_id) return;
            resolve(msg.payload?.messages ?? []);
            ws?.send(
              JSON.stringify({
                type: "agent.response.done",
                request_id: msg.request_id,
                payload: { finish_reason: "stop", usage_tokens: 1 },
              }),
            );
          });
        },
      );
      await ready;

      const session = await deps.chatResourceService.createSession({
        workspaceId: "ws_default",
        projectId: "proj_1",
        ownerUserId: "user_test",
        model: "external-echo",
        endpointId: "",
        externalAgentId: agent.id,
      });
      const historicalAttachment =
        await deps.chatResourceService.initAttachment({
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

      const messages = await observedMessages;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "history image" },
          {
            type: "text",
            text: "[attached_image] history.png (image/png, 4B)",
          },
        ],
      });
      expect(messages[1]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "current image" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,BBBB" },
          },
        ],
      });
    } finally {
      if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING)
      ) {
        ws.close();
      }
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("fails fast for external chat agent execution when public api base is not configured", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    let ws: WebSocket | null = null;
    delete process.env.PUBLIC_API_BASE_URL;
    try {
      const { baseUrl } = startServer();

      const createAgentRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "echo-agent",
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
      expect(createAgentRes.status).toBe(201);
      const agent = (await createAgentRes.json()) as { id: string };

      const keyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(keyRes.status).toBe(201);
      const keyPayload = (await keyRes.json()) as { key: string };

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

      await expect(
        new Promise<void>((resolve, reject) => {
          ws = new WebSocket(wsUrl, {
            headers: { Authorization: `Bearer ${keyPayload.key}` },
          });
          ws.once("open", () => reject(new Error("unexpected_websocket_open")));
          ws.once("error", reject);
        }),
      ).rejects.toThrow("Unexpected server response: 500");
    } finally {
      ws?.close();
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("enforces endpoint requests_per_minute policy for chat stream preflight", async () => {
    const upstream = startUniversalProxyChatServer();
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
  });

  it("returns AGENT_OFFLINE when external agent session streams without active execution socket", async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
      const { baseUrl } = startServer();
      process.env.PUBLIC_API_BASE_URL = baseUrl;

      const createAgentRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "offline-agent",
            mode: "external",
            interaction_kind: "chat",
            execution_preferences: buildChatExecutionPreferences(),
            capabilities: {
              streaming_completion: true,
              multimodal_completion: false,
            },
          }),
        },
      );
      expect(createAgentRes.status).toBe(201);
      const agent = (await createAgentRes.json()) as { id: string };

      const createSessionRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_agent_id: agent.id,
            model: "external-echo",
          }),
        },
      );
      expect(createSessionRes.status).toBe(201);
      const session = (await createSessionRes.json()) as { id: string };

      const streamRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { role: "user", content: "hello" },
          }),
        },
      );
      expect(streamRes.status).toBe(502);
      const body = (await streamRes.json()) as {
        error_code?: string;
        message?: string;
      };
      expect(body.error_code).toBe("AGENT_OFFLINE");
      expect(body.message).toBe("agent_offline");
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  });

  it("validates interaction kind and required execution preferences for agent create/update", async () => {
    const { baseUrl } = startServer();

    const createWithoutKindRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createWithoutKindRes.status).toBe(422);
    await expect(createWithoutKindRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_interaction_kind_required",
    });

    const createWithInvalidKindRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createWithInvalidKindRes.status).toBe(422);
    await expect(createWithInvalidKindRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_interaction_kind_required",
    });

    const createChatWithoutEndpointRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createChatWithoutEndpointRes.status).toBe(422);
    await expect(createChatWithoutEndpointRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_chat_endpoint_required",
    });

    const createWithoutEndpointRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createWithoutEndpointRes.status).toBe(422);
    await expect(createWithoutEndpointRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_notebook_endpoint_required",
    });

    const createChatAgentRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "nb-agent-patch",
          mode: "external",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences("ep_chat_patch"),
          capabilities: {
            streaming_completion: true,
            multimodal_completion: false,
          },
        }),
      },
    );
    expect(createChatAgentRes.status).toBe(201);
    const created = (await createChatAgentRes.json()) as {
      id: string;
      interaction_kind?: string;
      execution_preferences_json?: Record<string, unknown>;
    };
    expect(created.interaction_kind).toBe("chat");
    expect(created.execution_preferences_json).toEqual(
      buildChatExecutionPreferences("ep_chat_patch"),
    );

    const patchInvalidRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
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
    expect(patchInvalidRes.status).toBe(422);
    await expect(patchInvalidRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_interaction_kind_required",
    });

    const patchMissingNotebookPrefRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction_kind: "notebook",
        }),
      },
    );
    expect(patchMissingNotebookPrefRes.status).toBe(422);
    await expect(patchMissingNotebookPrefRes.json()).resolves.toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "agent_notebook_endpoint_required",
    });
  });

  it("returns interaction_kind and execution_preferences_json consistently from create/list/get", async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "shape-agent",
          mode: "external",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences("ep_shape_chat"),
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.interaction_kind).toBe("chat");
    expect(created.execution_preferences_json).toEqual(
      buildChatExecutionPreferences("ep_shape_chat"),
    );
    expect(created).not.toHaveProperty("interaction_mode");

    const listRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Record<string, unknown>[];
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed?.interaction_kind).toBe("chat");
    expect(listed?.execution_preferences_json).toEqual(
      buildChatExecutionPreferences("ep_shape_chat"),
    );
    expect(listed).not.toHaveProperty("interaction_mode");

    const itemRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as Record<string, unknown>;
    expect(itemBody.interaction_kind).toBe("chat");
    expect(itemBody.execution_preferences_json).toEqual(
      buildChatExecutionPreferences("ep_shape_chat"),
    );
    expect(itemBody).not.toHaveProperty("interaction_mode");
  });

  it("fails fast when creating internal agent without sandbox manager configured", async () => {
    const { baseUrl } = startServer();

    const createInternalRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createInternalRes.status).toBe(422);
    const body = (await createInternalRes.json()) as { error_code?: string };
    expect(body.error_code).toBe("AGENT_SANDBOX_NOT_CONFIGURED");
  });

  it("validates internal agent idle timeout floor on create", async () => {
    const { baseUrl, deps } = startServer();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };

    const createInternalRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
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
    expect(createInternalRes.status).toBe(422);
    const body = (await createInternalRes.json()) as { message?: string };
    expect(body.message).toBe("idle_timeout_sec_too_low");
  });

  it("validates internal agent max lifetime against idle timeout on patch", async () => {
    const { baseUrl, deps } = startServer();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };

    const createInternalRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "internal-patch-validate",
          mode: "internal",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          config: {
            image: "runner:v1",
            idle_timeout_sec: 300,
            max_lifetime_sec: 3600,
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(201);
    const created = (await createInternalRes.json()) as { id: string };

    const patchRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            idle_timeout_sec: 900,
            max_lifetime_sec: 700,
          },
        }),
      },
    );
    expect(patchRes.status).toBe(422);
    const body = (await patchRes.json()) as { message?: string };
    expect(body.message).toBe("max_lifetime_sec_lt_idle_timeout_sec");
  });

  it("returns AGENT_SANDBOX_NOT_CONFIGURED for internal agent chat stream without pod manager", async () => {
    const { baseUrl, deps } = startServer();
    const internalAgent = await deps.agentResourceService.createAgent(
      "ws_default",
      "proj_1",
      {
        name: "internal-chat",
        mode: "internal",
        interaction_kind: "chat",
        status: "enabled",
        config: {
          image: "runner:v1",
        } as never,
        execution_preferences_json: {
          chat: {
            endpoint_id: "ep_internal_chat_missing_pod",
          },
        },
        owner_id: "user_test",
        visibility: "private",
      },
    );

    const createSessionRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_agent_id: internalAgent.id,
          model: "gpt-5-codex",
        }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { role: "user", content: "hello internal" },
        }),
      },
    );
    expect(streamRes.status).toBe(422);
    const body = (await streamRes.json()) as { error_code?: string };
    expect(body.error_code).toBe("AGENT_SANDBOX_NOT_CONFIGURED");
  });

  it("starts and clears internal chat keepalive timer when streaming via internal agent", async () => {
    const deps = createDefaultNodeApiDeps();
    const ensureAgentReady = vi.fn(async () => undefined);
    const keepalive = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive,
      releasePod: vi.fn(async () => undefined),
    };
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: "req_internal_chat_keepalive",
      stream: (async function* streamEvents() {
        yield { type: "delta", delta: "hello" };
        yield { type: "done", finish_reason: "stop", usage_tokens: 5 };
      })(),
      cancel: vi.fn(),
    }));
    deps.agentExecutionService.dispatchStreamingRequest =
      dispatchStreamingRequest as typeof deps.agentExecutionService.dispatchStreamingRequest;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
      const { baseUrl } = startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;

      const internalAgent = await deps.agentResourceService.createAgent(
        "ws_default",
        "proj_1",
        {
          name: "internal-chat-keepalive",
          mode: "internal",
          interaction_kind: "chat",
          status: "enabled",
          config: {
            image: "runner:v1",
            _internal_raw_key: "ask_test",
          } as never,
          owner_id: "user_test",
          visibility: "private",
          execution_preferences_json: {
            chat: {
              endpoint_id: "ep_internal",
            },
          },
        },
      );

      const createSessionRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_agent_id: internalAgent.id,
            model: "gpt-5-codex",
          }),
        },
      );
      expect(createSessionRes.status).toBe(201);
      const session = (await createSessionRes.json()) as { id: string };

      const streamRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { role: "user", content: "hello internal keepalive" },
          }),
        },
      );
      expect(streamRes.status).toBe(200);
      expect(ensureAgentReady).toHaveBeenCalledTimes(1);
      expect(keepalive).toHaveBeenCalled();
      expect(ensureAgentReady).toHaveBeenCalledWith(
        expect.objectContaining({
          workloadId: sanitizeWorkloadId(internalAgent.id),
        }),
      );
      expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy.mock.calls.some((call) => call[1] === 60_000)).toBe(
        true,
      );
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
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
        name: "internal-notebook",
        mode: "internal",
        interaction_kind: "notebook",
        status: "enabled",
        config: {
          image: "runner:v1",
          _internal_raw_key: "ask_test",
        } as never,
        owner_id: "user_test",
        visibility: "private",
        execution_preferences_json: {
          notebook: {
            endpoint_id: "ep_internal",
          },
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
          agent_id: internalAgent.id,
          workspace_mode: "create_new",
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

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
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "internal-sanitized",
          mode: "internal",
          interaction_kind: "chat",
          execution_preferences: buildChatExecutionPreferences(),
          config: {
            image: "runner:v1",
          },
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

    const listRes = await apiFetch(
      baseUrl,
      "/api/v1/workspaces/ws_default/projects/proj_1/agents",
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{ id: string; config?: Record<string, unknown> }>;
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed?.config?._internal_raw_key).toBeUndefined();
    expect(listed?.config?._internal_key_id).toBeUndefined();

    const itemRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as {
      config?: Record<string, unknown>;
    };
    expect(itemBody.config?._internal_raw_key).toBeUndefined();
    expect(itemBody.config?._internal_key_id).toBeUndefined();

    const stored = await deps.agentResourceService.getAgent(
      "ws_default",
      "proj_1",
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

  it("releases internal workload pod when notebook task is deleted", async () => {
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
        name: "internal-notebook-delete",
        mode: "internal",
        interaction_kind: "notebook",
        status: "enabled",
        config: {
          image: "runner:v1",
          _internal_raw_key: "ask_test",
        } as never,
        owner_id: "user_test",
        visibility: "private",
        execution_preferences_json: {
          notebook: {
            endpoint_id: "ep_internal",
          },
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
          title: "Internal Task Delete",
          agent_id: internalAgent.id,
          workspace_mode: "create_new",
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith(
      "ws_default",
      "proj_1",
      sanitizeWorkloadId(task.id),
    );
  });

  it("normalizes endpoint base_url when full chat/completions path is provided", async () => {
    const upstream = startUniversalProxyChatServer();
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
    try {
      const { baseUrl } = startServer();
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;

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

      const createAgent = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "External notebook agent",
            mode: "external",
            interaction_kind: "notebook",
            execution_preferences: {
              notebook: {
                endpoint_id: endpoint.id,
                wire_api: "responses",
                model: "placeholder-model",
              },
            },
            capabilities: {
              streaming_completion: true,
              multimodal_completion: false,
            },
          }),
        },
      );
      expect(createAgent.status).toBe(201);
      const agent = (await createAgent.json()) as { id: string };
      const workspaceLibrary = await createFileLibrary(
        baseUrl,
        "Truncate Trace Workspace",
      );

      const createAgentKeyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(createAgentKeyRes.status).toBe(201);
      const agentKey = (await createAgentKeyRes.json()) as { key: string };

      const connectionInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
      );
      expect(connectionInfoRes.status).toBe(200);
      const connectionInfo = (await connectionInfoRes.json()) as {
        ws_url: string;
      };

      const executionSocket = new WebSocket(
        connectionInfo.ws_url.replace(
          "ws://localhost:20000",
          baseUrl.replace("http://", "ws://"),
        ),
        { headers: { Authorization: `Bearer ${agentKey.key}` } },
      );

      const huge = "x".repeat(40_000);
      executionSocket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf-8")) as {
          type: string;
          request_id?: string;
        };
        if (msg.type !== "server.request.start" || !msg.request_id) return;
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.event",
            request_id: msg.request_id,
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
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.done",
            request_id: msg.request_id,
            payload: { finish_reason: "stop", usage_tokens: 1 },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        executionSocket.on("open", () => {
          executionSocket.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: NOTEBOOK_RUNNER_SPEC,
                capabilities: { wire_api: "responses" },
              },
            }),
          );
          resolve();
        }),
      );

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Truncate trace details",
            agent_id: agent.id,
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      const postMessageRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: "run" }),
        },
      );
      expect(postMessageRes.status).toBe(200);

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

      executionSocket.close();
    } finally {
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
    try {
      const { baseUrl } = startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;

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

      const createAgent = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "External notebook agent",
            mode: "external",
            interaction_kind: "notebook",
            execution_preferences: {
              notebook: {
                endpoint_id: endpoint.id,
                wire_api: "responses",
                model: "placeholder-model",
              },
            },
            capabilities: {
              streaming_completion: true,
              multimodal_completion: false,
            },
          }),
        },
      );
      expect(createAgent.status).toBe(201);
      const agent = (await createAgent.json()) as { id: string };
      const workspaceLibrary = await createFileLibrary(
        baseUrl,
        "Persist Notebook Workspace",
      );

      const createAgentKeyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(createAgentKeyRes.status).toBe(201);
      const agentKey = (await createAgentKeyRes.json()) as { key: string };

      const connectionInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
      );
      expect(connectionInfoRes.status).toBe(200);
      const connectionInfo = (await connectionInfoRes.json()) as {
        ws_url: string;
      };

      const executionSocket = new WebSocket(
        connectionInfo.ws_url.replace(
          "ws://localhost:20000",
          baseUrl.replace("http://", "ws://"),
        ),
        { headers: { Authorization: `Bearer ${agentKey.key}` } },
      );
      executionSocket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf-8")) as {
          type: string;
          request_id?: string;
        };
        if (msg.type !== "server.request.start" || !msg.request_id) return;
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.event",
            request_id: msg.request_id,
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
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.delta",
            request_id: msg.request_id,
            payload: { delta: "persisted-output" },
          }),
        );
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.done",
            request_id: msg.request_id,
            payload: { finish_reason: "stop", usage_tokens: 3 },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        executionSocket.on("open", () => {
          executionSocket.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: NOTEBOOK_RUNNER_SPEC,
                capabilities: { wire_api: "responses" },
              },
            }),
          );
          resolve();
        }),
      );

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Persist notebook docs",
            agent_id: agent.id,
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      const postMessageRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: "run" }),
        },
      );
      expect(postMessageRes.status).toBe(200);

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const traces = await deps.docStore.list<{ task_id: string }>(
          "ws_default_notebook_task_trace_events",
          { task_id: task.id },
        );
        const msgs = await deps.docStore.list<{
          task_id: string;
          role: string;
          content: string;
        }>("ws_default_notebook_task_messages", { task_id: task.id });
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
        "notebook_tasks",
        {},
      );
      const baseMessages = await deps.docStore.list<{
        task_id: string;
        role: string;
        content: string;
      }>("notebook_task_messages", { task_id: task.id });
      const baseTraces = await deps.docStore.list<{
        task_id: string;
        category: string;
      }>("notebook_task_trace_events", { task_id: task.id });
      const storedTasks = await deps.docStore.list<{ id: string }>(
        "ws_default_notebook_tasks",
        {},
      );
      const storedMessages = await deps.docStore.list<{
        task_id: string;
        role: string;
        content: string;
      }>("ws_default_notebook_task_messages", { task_id: task.id });
      const storedTraces = await deps.docStore.list<{
        task_id: string;
        category: string;
      }>("ws_default_notebook_task_trace_events", { task_id: task.id });

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

      executionSocket.close();
    } finally {
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
    try {
      const { baseUrl } = startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;

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

      const createAgent = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/agents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "External notebook agent",
            mode: "external",
            interaction_kind: "notebook",
            execution_preferences: {
              notebook: {
                endpoint_id: endpoint.id,
                wire_api: "responses",
                model: "placeholder-model",
              },
            },
            capabilities: {
              streaming_completion: true,
              multimodal_completion: false,
            },
          }),
        },
      );
      expect(createAgent.status).toBe(201);
      const agent = (await createAgent.json()) as { id: string };
      const workspaceLibrary = await createFileLibrary(
        baseUrl,
        "Trace Retention Workspace",
      );

      const createAgentKeyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(createAgentKeyRes.status).toBe(201);
      const agentKey = (await createAgentKeyRes.json()) as { key: string };

      const connectionInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
      );
      expect(connectionInfoRes.status).toBe(200);
      const connectionInfo = (await connectionInfoRes.json()) as {
        ws_url: string;
      };

      const executionSocket = new WebSocket(
        connectionInfo.ws_url.replace(
          "ws://localhost:20000",
          baseUrl.replace("http://", "ws://"),
        ),
        { headers: { Authorization: `Bearer ${agentKey.key}` } },
      );
      executionSocket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString("utf-8")) as {
          type: string;
          request_id?: string;
        };
        if (msg.type !== "server.request.start" || !msg.request_id) return;
        for (let i = 0; i < 1010; i += 1) {
          executionSocket.send(
            JSON.stringify({
              type: "agent.response.event",
              request_id: msg.request_id,
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
        executionSocket.send(
          JSON.stringify({
            type: "agent.response.done",
            request_id: msg.request_id,
            payload: { finish_reason: "stop", usage_tokens: 1 },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        executionSocket.on("open", () => {
          executionSocket.send(
            JSON.stringify({
              type: "agent.ready",
              payload: {
                runner_spec: NOTEBOOK_RUNNER_SPEC,
                capabilities: { wire_api: "responses" },
              },
            }),
          );
          resolve();
        }),
      );

      const createTaskRes = await apiFetch(
        baseUrl,
        "/api/v1/workspaces/ws_default/projects/proj_1/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Trace retention bound",
            agent_id: agent.id,
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      const postMessageRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: "run" }),
        },
      );
      expect(postMessageRes.status).toBe(200);

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
        }>("ws_default_notebook_task_trace_events", { task_id: task.id });
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

      executionSocket.close();
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }
  }, 20_000);
});
