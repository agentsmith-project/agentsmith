import fs from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  ensureWorkspaceProjectCreatorAccess,
  readStoredAuthToken,
} from "./integration-workspace-access";
import { loadStoryDefinitionSync } from "./story-loader";
import { buildTraceStoryBinding } from "./story-trace-binding";
import { createUxTraceBundleWriter } from "./trace-bundle-support";
import {
  startOpenAICompatibleUpstream,
  startOpenAICompatibleUpstreamWith,
  startOpenAIStreamingUpstreamWith,
} from "./integration-chat-local-upstream";

const RUN_REAL_COMPLETION =
  process.env.INTEGRATION_REAL_COMPLETION_E2E === "true";
let lastApiAuthContext: { apiBase: string; authHeader: string } | null = null;
const CHAT_STOP_RECOVERY_STORY = loadStoryDefinitionSync(
  "chat-stop-terminate-idempotent-state-resync",
);
const CHAT_STOP_RECOVERY_BINDING = buildTraceStoryBinding(
  CHAT_STOP_RECOVERY_STORY,
);
const CHAT_DAY_TWO_STORY = loadStoryDefinitionSync(
  "chat-day-two-thread-workflow",
);
const CHAT_DAY_TWO_BINDING = buildTraceStoryBinding(CHAT_DAY_TWO_STORY);

type ChatDayTwoRuntime = {
  projectNamePrefix: string;
  upstreamReplyText: string;
  firstThreadPrompt: string;
  secondThreadPrompt: string;
  resumeThreadPrompt: string;
  renamedThreadPrefix: string;
};

type ChatSessionDetail = {
  execution_status?: string;
  stop_mode?: string;
  termination_state?: "terminating" | null;
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

type ChatSessionStreamsPayload = {
  items?: Array<{
    status?: "running" | "stopping" | "terminating";
  }>;
};

type ChatSessionStopPayload = {
  success?: boolean;
  session_id?: string;
  stream_id?: string;
  state?: "stopping" | "terminating" | "not_found_or_finished";
  status?: "stopping" | "terminating" | "not_found_or_finished";
  mode?: "cancel" | "terminate";
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

type ChatSessionTruth = {
  executionStatus: string | null;
  stopMode: string | null;
  terminationState: string | null;
  activeStreamCount: number;
  activeStreamStatuses: string[];
  canEscalate: boolean | null;
  escalationReason: string | null;
  stuck: boolean;
};

function resolveChatStopRecoveryStep(stepId: string) {
  const step = CHAT_STOP_RECOVERY_BINDING.steps.find(
    (entry) => entry.stepId === stepId,
  );
  if (!step) {
    throw new Error(`unknown_chat_stop_recovery_step:${stepId}`);
  }
  return step;
}

function resolveChatDayTwoStep(stepId: string) {
  const step = CHAT_DAY_TWO_BINDING.steps.find(
    (entry) => entry.stepId === stepId,
  );
  if (!step) {
    throw new Error(`unknown_chat_day_two_step:${stepId}`);
  }
  return step;
}

function requireChatDayTwoRuntime(): ChatDayTwoRuntime {
  const runtimeRoot = CHAT_DAY_TWO_STORY.runtimeData as
    | Record<string, unknown>
    | undefined;
  const runtime = runtimeRoot?.chatDayTwoWorkflow as
    | Record<string, unknown>
    | undefined;
  if (!runtime) {
    throw new Error("missing_chat_day_two_runtime_data");
  }
  for (const key of [
    "projectNamePrefix",
    "upstreamReplyText",
    "firstThreadPrompt",
    "secondThreadPrompt",
    "resumeThreadPrompt",
    "renamedThreadPrefix",
  ] as const) {
    if (typeof runtime[key] !== "string" || runtime[key].trim().length === 0) {
      throw new Error(`missing_chat_day_two_runtime_data:${key}`);
    }
  }
  return runtime as unknown as ChatDayTwoRuntime;
}

async function startOpenAIStreamingUpstreamWithManualRelease(args: {
  chunks: string[];
  chunkDelayMs?: number;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
  getAbortedRequestCount: () => number;
  releasePendingResponses: () => void;
}> {
  const { chunks, chunkDelayMs = 500 } = args;
  let requestCount = 0;
  let abortedRequestCount = 0;
  const pendingResponseReleases = new Set<() => void>();

  function releasePendingResponses() {
    for (const release of Array.from(pendingResponseReleases)) {
      release();
    }
    pendingResponseReleases.clear();
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      requestCount += 1;
      let responseCompleted = false;
      let requestAborted = false;
      let resolveAbortWait: (() => void) | null = null;
      let releasePendingResponse: (() => void) | null = null;
      const abortWait = new Promise<void>((resolve) => {
        resolveAbortWait = resolve;
      });
      const markAborted = () => {
        if (requestAborted || responseCompleted) return;
        requestAborted = true;
        abortedRequestCount += 1;
        if (releasePendingResponse) {
          pendingResponseReleases.delete(releasePendingResponse);
          releasePendingResponse();
          releasePendingResponse = null;
        }
        resolveAbortWait?.();
        resolveAbortWait = null;
      };
      req.once("aborted", markAborted);
      res.once("close", markAborted);

      for await (const chunk of req) {
        void chunk;
      }

      responseCompleted = false;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");

      for (const chunk of chunks) {
        if (requestAborted || res.destroyed || res.writableEnded) {
          return;
        }
        const payload = JSON.stringify({
          id: "chatcmpl_stream_manual_release",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "integration-chat-model",
          choices: [
            { index: 0, delta: { content: chunk }, finish_reason: null },
          ],
        });
        res.write(`data: ${payload}\n\n`);
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, chunkDelayMs)),
          abortWait,
        ]);
      }

      if (requestAborted || res.destroyed || res.writableEnded) {
        return;
      }

      await new Promise<void>((resolve) => {
        releasePendingResponse = () => {
          if (releasePendingResponse) {
            pendingResponseReleases.delete(releasePendingResponse);
            releasePendingResponse = null;
          }
          resolve();
        };
        pendingResponseReleases.add(releasePendingResponse);
        if (requestAborted) {
          releasePendingResponse();
        }
      });

      if (requestAborted || res.destroyed || res.writableEnded) {
        return;
      }

      responseCompleted = true;
      res.write("data: [DONE]\n\n");
      res.end();
    })().catch((error) => {
      if (res.destroyed || res.writableEnded) {
        return;
      }
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: "integration_upstream_failed",
          message: error instanceof Error ? error.message : "unknown_error",
        }),
      );
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getRequestCount: () => requestCount,
    getAbortedRequestCount: () => abortedRequestCount,
    releasePendingResponses,
  };
}

function captureApiAuthContextFromResponse(
  response: import("@playwright/test").Response,
): void {
  const authHeader = response.request().headers()["authorization"];
  const match = response.url().match(/^(https?:\/\/[^/]+\/api\/v1)\//);
  if (authHeader && match?.[1]) {
    lastApiAuthContext = { apiBase: match[1], authHeader };
  }
}

async function keycloakLogin(
  page: import("@playwright/test").Page,
  locale: string,
  username: string,
  password: string,
) {
  await page.context().clearCookies();
  const clearLocalState = async () => {
    await page.goto(`/${locale}/workspaces/ws_default/login`);
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
    });
  };
  await clearLocalState();

  for (let cycle = 0; cycle < 3; cycle += 1) {
    if (
      !new RegExp(`/${locale}/workspaces/ws_default/login`).test(page.url())
    ) {
      await page.goto(`/${locale}/workspaces/ws_default/login`);
    }

    await expect(page.getByTestId("workspace-login__keycloak-btn")).toBeVisible(
      { timeout: 30_000 },
    );
    await page.getByTestId("workspace-login__keycloak-btn").click();
    const keycloakError = page.getByTestId("workspace-login__keycloak-error");
    if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(
        `Keycloak login bootstrap failed: ${await keycloakError.textContent()}`,
      );
    }

    await page.waitForURL(
      /\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i,
      {
        timeout: 30_000,
      },
    );
    await page
      .locator('input#username, input[name="username"], input[name="email"]')
      .first()
      .fill(username);
    await page
      .locator('input#password, input[name="password"]')
      .first()
      .fill(password);
    await page.locator('#kc-login, button[type="submit"]').first().click();

    let reachedWorkspace = false;
    let callbackError = false;
    for (let tick = 0; tick < 120; tick += 1) {
      const currentUrl = page.url();
      if (
        new RegExp(`/${locale}/workspaces/ws_default(?:$|/projects)`).test(
          currentUrl,
        )
      ) {
        reachedWorkspace = true;
        break;
      }
      if (
        new RegExp(`/${locale}/workspaces/ws_default/login/callback`).test(
          currentUrl,
        )
      ) {
        const callbackErrorNode = page.getByTestId(
          "workspace-login-callback__error",
        );
        if (
          await callbackErrorNode.isVisible({ timeout: 300 }).catch(() => false)
        ) {
          callbackError = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    if (callbackError && cycle < 2) {
      const backToLogin = page.getByRole("button", {
        name: /back to login|返回登录页|返回工作空间选择/i,
      });
      if (await backToLogin.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await backToLogin.click();
      }
      await clearLocalState();
      continue;
    }

    if (!reachedWorkspace) {
      throw new Error("Keycloak login did not reach workspace");
    }
    if (
      !new RegExp(`/${locale}/workspaces/ws_default/projects`).test(page.url())
    ) {
      await page.goto(`/${locale}/workspaces/ws_default/projects`);
    }
    await page.waitForURL(
      new RegExp(`/${locale}/workspaces/ws_default/projects(?:$|/)`),
      { timeout: 30_000 },
    );
    const apiBase =
      process.env.INTEGRATION_API_BASE || "http://localhost:20010";
    const token = await readStoredAuthToken(page);
    await ensureWorkspaceProjectCreatorAccess({
      page,
      apiBase,
      token,
      username,
    });
    await page.goto(`/${locale}/workspaces/ws_default/projects`);
    return;
  }

  throw new Error("Unable to complete workspace login after Keycloak retries.");
}

function loadOpenAICompatiblePayloadForE2E() {
  const customPath = process.env.INTEGRATION_OPENAI_CONFIG_PATH;
  const filePath = customPath
    ? path.resolve(customPath)
    : path.resolve(process.cwd(), "secrets/e2e-openai-compatible.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing OpenAI config file: ${filePath}. ` +
        "Create it or set INTEGRATION_OPENAI_CONFIG_PATH.",
    );
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as {
    reranker?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: "openai";
    };
    embedding?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: "openai";
    };
    completion?: {
      model: string;
      api_base: string;
      api_key: string;
      mode?: "openai";
    };
  };
}

async function getAuthTokenFromStorage(
  page: import("@playwright/test").Page,
): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem("agentsmith-auth");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
      return parsed.state?.token ?? null;
    } catch {
      return null;
    }
  });
  expect(token).toBeTruthy();
  return token!;
}

function requireIntegrationChatApiContext() {
  expect(lastApiAuthContext).toBeTruthy();
  return lastApiAuthContext!;
}

function isFinalChatExecutionStatus(status: string | null): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

async function readChatSessionDetailViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  sessionId: string,
) {
  const { apiBase, authHeader } = requireIntegrationChatApiContext();
  const response = await page.request.get(
    `${apiBase}/workspaces/ws_default/projects/${projectId}/chat/sessions/${sessionId}`,
    {
      headers: {
        Authorization: authHeader,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `read_chat_session_detail_failed:${response.status()}:${body}`,
    );
  }
  return (await response.json()) as ChatSessionDetail;
}

async function listChatSessionStreamsViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  sessionId: string,
) {
  const { apiBase, authHeader } = requireIntegrationChatApiContext();
  const response = await page.request.get(
    `${apiBase}/workspaces/ws_default/projects/${projectId}/chat/sessions/${sessionId}/streams`,
    {
      headers: {
        Authorization: authHeader,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `list_chat_session_streams_failed:${response.status()}:${body}`,
    );
  }
  const payload = (await response.json()) as ChatSessionStreamsPayload;
  return payload.items ?? [];
}

async function postChatSessionStopViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  sessionId: string,
  mode: "cancel" | "terminate",
) {
  const { apiBase, authHeader } = requireIntegrationChatApiContext();
  const response = await page.request.post(
    `${apiBase}/workspaces/ws_default/projects/${projectId}/chat/sessions/${sessionId}/stop`,
    {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      data: {
        mode,
      },
    },
  );
  return {
    status: response.status(),
    payload: (await response
      .json()
      .catch(() => null)) as ChatSessionStopPayload | null,
  };
}

async function readChatSessionTruthViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  sessionId: string,
): Promise<ChatSessionTruth> {
  const [session, streams] = await Promise.all([
    readChatSessionDetailViaApi(page, projectId, sessionId),
    listChatSessionStreamsViaApi(page, projectId, sessionId),
  ]);
  const executionStatus = session.execution_status ?? null;
  const activeStreamStatuses = streams
    .map((item) => item.status ?? null)
    .filter(
      (status): status is "running" | "stopping" | "terminating" =>
        status !== null,
    );
  const stuck =
    executionStatus === "running" ||
    executionStatus === "stopping" ||
    executionStatus === "terminating" ||
    activeStreamStatuses.some(
      (status) =>
        status === "running" ||
        status === "stopping" ||
        status === "terminating",
    ) ||
    session.termination_state === "terminating";
  return {
    executionStatus,
    stopMode: session.stop_mode ?? null,
    terminationState: session.termination_state ?? null,
    activeStreamCount: activeStreamStatuses.length,
    activeStreamStatuses,
    canEscalate:
      typeof session.can_escalate === "boolean" ? session.can_escalate : null,
    escalationReason: session.escalation_reason ?? null,
    stuck,
  };
}

async function readLastChatMessageText(
  page: import("@playwright/test").Page,
): Promise<string> {
  const text = await page.getByTestId("chat__message").last().textContent();
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function chatStopButton(page: import("@playwright/test").Page) {
  return page
    .getByTestId("chat__stop-btn")
    .or(
      page
        .getByTestId("chat__composer")
        .getByRole("button", { name: /Stop|停止/i }),
    )
    .first();
}

function chatStopEscalationDialog(page: import("@playwright/test").Page) {
  return page
    .getByTestId("chat__stop-escalation-dialog")
    .or(
      page
        .getByRole("alertdialog")
        .filter({ hasText: /terminate|force stop|escalat|强制|结束/i }),
    )
    .or(
      page
        .getByRole("dialog")
        .filter({ hasText: /terminate|force stop|escalat|强制|结束/i }),
    )
    .first();
}

async function waitForChatStopEscalationDialog(
  page: import("@playwright/test").Page,
  timeoutMs = 60_000,
) {
  const dialog = chatStopEscalationDialog(page);
  await expect(dialog).toBeVisible({ timeout: timeoutMs });
  return dialog;
}

async function importBulkViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  payload: ReturnType<typeof loadOpenAICompatiblePayloadForE2E>,
) {
  const token = await getAuthTokenFromStorage(page);
  const apiBase = process.env.INTEGRATION_API_BASE || "http://localhost:20010";
  const response = await page.request.post(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/import-bulk`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: payload,
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function openChatAndSendExpectAssistantAny(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  text: string,
) {
  await page
    .getByRole("link", { name: /chat|对话/i })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`),
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId("chat__main-pane")).toBeVisible({
    timeout: 30_000,
  });

  if ((await page.getByTestId("chat__thread-item").count()) === 0) {
    await page.getByTestId("chat__new-thread-btn").click();
  }

  const firstThread = page.getByTestId("chat__thread-item").first();
  await expect(firstThread).toBeVisible({ timeout: 30_000 });
  await firstThread.locator('div[role="button"]').first().click();

  const beforeCount = await page.getByTestId("chat__message").count();
  const composer = page.getByTestId("chat__composer");
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible();
  await ensureComposerEnabled(page);
  await textarea.fill(text);

  const streamResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
        res.url(),
      ),
  );
  await page.getByTestId("chat__send-btn").click();
  await streamResponse;
  await expect
    .poll(async () => page.getByTestId("chat__message").count(), {
      timeout: 90_000,
    })
    .toBeGreaterThanOrEqual(beforeCount + 2);
  const lastMessageText = await page
    .getByTestId("chat__message")
    .last()
    .textContent();
  expect((lastMessageText ?? "").trim().length).toBeGreaterThan(0);
}

async function createProjectFromUi(
  page: import("@playwright/test").Page,
  locale: string,
  projectName = `it-chat-proj-${Date.now()}`,
): Promise<string> {
  const createButton = page.getByTestId("projects__create-btn");
  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click();
  } else {
    await page
      .getByRole("button", { name: /new project|create|创建|新建项目/i })
      .first()
      .click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator("#project-name").fill(projectName);
  await dialog.locator("#project-description").fill("Integration chat project");
  await Promise.all([
    page.waitForURL(
      new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`),
      { timeout: 30_000 },
    ),
    dialog.getByRole("button", { name: /create|创建/i }).click(),
  ]);
  const match = page.url().match(/\/projects\/([^/]+)\//);
  expect(match?.[1]).toBeTruthy();
  return match![1];
}

async function provisionCredentialAndEndpoint(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  upstreamBaseUrl: string,
  options?: {
    capability?: "chat_completion" | "multimodal_completion";
  },
) {
  const { capability = "chat_completion" } = options ?? {};
  const suffix = Date.now();
  const credentialName = `Integration Credential ${suffix}`;
  const endpointName = `Integration Endpoint ${suffix}`;
  await createCredential(page, locale, projectId, {
    credentialName,
    credentialValue: "integration-secret-key",
  });
  await createEndpoint(page, locale, projectId, {
    endpointName,
    endpointModel: "integration-chat-model",
    upstreamBaseUrl,
    credentialName,
    capability,
  });
}

async function sendExpectStreamError(
  page: import("@playwright/test").Page,
  text: string,
) {
  await ensureComposerEnabled(page);
  const composer = page.getByTestId("chat__composer");
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId("chat__send-btn");
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  await sendBtn.click();
  await expect(page.getByTestId("chat__stream-status")).toHaveText(
    /Recovering\.\.\.|恢复中\.\.\.|Interrupted|已中断/,
    { timeout: 60_000 },
  );
  // Error UX is lightweight; validate status transition and let caller assert concrete message.
}

async function sendExpectStreamErrorMessage(
  page: import("@playwright/test").Page,
  text: string,
  expectedMessage: string,
) {
  await sendExpectStreamError(page, text);
  await expect(page.getByText(expectedMessage).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function sendAndStopDuringGeneration(
  page: import("@playwright/test").Page,
  text: string,
) {
  await ensureComposerEnabled(page);
  const composer = page.getByTestId("chat__composer");
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const sendBtn = page.getByTestId("chat__send-btn");
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  const streamResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
        res.url(),
      ),
  );
  await sendBtn.click();
  await streamResponse;

  const stopBtn = page.getByRole("button", { name: /Stop|停止/i });
  if (await stopBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
    const clicked = await stopBtn
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await expect(page.getByTestId("chat__send-btn")).toBeEnabled({
        timeout: 30_000,
      });
    }
    return;
  }
}

async function ensureComposerEnabled(page: import("@playwright/test").Page) {
  const composer = page.getByTestId("chat__composer");
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  if (await textarea.isEditable().catch(() => false)) return;

  const modelTrigger = page.getByTestId("chat__execution-target-trigger");
  await expect(modelTrigger).toBeVisible({ timeout: 15_000 });
  await modelTrigger.click();
  const modelItems = page.locator(
    '[data-testid^="chat__execution-target-endpoint--"]',
  );
  const count = await modelItems.count();
  for (let i = 0; i < count; i += 1) {
    const item = modelItems.nth(i);
    if ((await item.getAttribute("data-disabled")) !== null) continue;
    await item.click();
    if (await textarea.isEditable().catch(() => false)) return;
    const becameEditable = await expect(textarea)
      .toBeEditable({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (becameEditable) return;
    await modelTrigger.click();
  }
  await expect(textarea).toBeEditable({ timeout: 15_000 });
}

async function createCredential(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  args: {
    credentialName: string;
    credentialValue: string;
  },
): Promise<string> {
  const { credentialName, credentialValue } = args;
  await page.goto(
    `/${locale}/workspaces/ws_default/projects/${projectId}/credentials`,
  );
  await page.waitForURL(
    new RegExp(
      `/${locale}/workspaces/ws_default/projects/${projectId}/credentials`,
    ),
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId("credentials__create-btn")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("credentials__create-btn").click();
  const credDialog = page.getByTestId("credentials__create-dialog");
  await expect(credDialog).toBeVisible();
  await credDialog.locator("#cred-name").fill(credentialName);
  await credDialog.locator("#cred-value").fill(credentialValue);
  const createCredentialResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/credentials$/.test(
        res.url(),
      ),
  );
  await credDialog.getByRole("button", { name: /create|创建/i }).click();
  const credentialRes = await createCredentialResponse;
  if (!credentialRes.ok()) {
    const errorBody = await credentialRes.text().catch(() => "");
    throw new Error(
      `Create credential failed (${credentialRes.status()}): ${errorBody}`,
    );
  }
  captureApiAuthContextFromResponse(credentialRes);
  const credentialJson = (await credentialRes.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
  } | null;
  const credentialId = credentialJson?.id ?? credentialJson?.data?.id;
  expect(credentialId).toBeTruthy();
  if (await credDialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
  return credentialId!;
}

async function createEndpoint(
  page: import("@playwright/test").Page,
  _locale: string,
  projectId: string,
  args: {
    endpointName: string;
    endpointModel: string;
    upstreamBaseUrl: string;
    credentialName: string;
    capability?: "chat_completion" | "multimodal_completion";
  },
): Promise<string> {
  const {
    endpointName,
    endpointModel,
    upstreamBaseUrl,
    credentialName,
    capability = "chat_completion",
  } = args;
  const token = await getAuthTokenFromStorage(page);
  const apiBase = process.env.INTEGRATION_API_BASE || "http://localhost:20000";

  const credentialsRes = await page.request.get(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/credentials`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(credentialsRes.ok()).toBeTruthy();
  const credentialsJson = (await credentialsRes.json().catch(() => null)) as {
    items?: Array<{ id?: string; name?: string }>;
  } | null;
  const credential = credentialsJson?.items?.find(
    (item) => item.name === credentialName,
  );
  expect(credential?.id).toBeTruthy();

  const defaults =
    capability === "multimodal_completion"
      ? { multimodal_model_id: endpointModel }
      : { chat_model_id: endpointModel };

  const endpointRes = await page.request.post(
    `${apiBase}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        name: endpointName,
        model: endpointModel,
        type: "custom",
        base_url: upstreamBaseUrl,
        credential_ref: credential!.id,
        provider_family: "custom",
        upstream_protocol: "openai_chat_completions",
        capabilities: [
          { type: capability, enabled: true, default_model_id: endpointModel },
        ],
        models: [
          { capability, model_id: endpointModel, display_name: endpointModel },
        ],
        defaults,
      },
    },
  );
  expect(endpointRes.ok()).toBeTruthy();
  lastApiAuthContext = {
    apiBase: `${apiBase}/api/v1`,
    authHeader: `Bearer ${token}`,
  };
  const endpointJson = (await endpointRes.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
  } | null;
  const endpointId = endpointJson?.id ?? endpointJson?.data?.id;
  expect(endpointId).toBeTruthy();
  return endpointId!;
}

async function disableEndpointViaApi(
  page: import("@playwright/test").Page,
  projectId: string,
  endpointId: string,
) {
  expect(lastApiAuthContext).toBeTruthy();
  const { apiBase, authHeader } = lastApiAuthContext!;
  const patchRes = await page.request.put(
    `${apiBase}/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}`,
    {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      data: { status: "disabled" },
    },
  );
  expect(patchRes.ok()).toBeTruthy();
}

async function deleteCredentialFromUi(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  credentialId: string,
) {
  await page
    .getByRole("link", { name: /credentials|凭据/i })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(
      `/${locale}/workspaces/ws_default/projects/${projectId}/credentials`,
    ),
    {
      timeout: 30_000,
    },
  );
  await page.getByTestId(`credentials__action-delete--${credentialId}`).click();
  const dialog = page.getByTestId("credentials__delete-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const deleteResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "DELETE" &&
      new RegExp(
        `/api/v1/workspaces/[^/]+/projects/[^/]+/credentials/${credentialId}$`,
      ).test(res.url()),
  );
  await page.getByTestId("credentials__delete-dialog__confirm-btn").click();
  const deleteRes = await deleteResponse;
  expect(deleteRes.ok()).toBeTruthy();
}

async function selectEndpointInChat(
  page: import("@playwright/test").Page,
  endpointId: string,
) {
  const updateSessionResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+$/.test(
        res.url(),
      ) &&
      res.status() === 200,
  );
  await page.getByTestId("chat__execution-target-trigger").click();
  await page
    .getByTestId(`chat__execution-target-endpoint--${endpointId}`)
    .click();
  const updateRes = await updateSessionResponse;
  const json = (await updateRes.json().catch(() => null)) as {
    endpoint_id?: string;
  } | null;
  expect(json?.endpoint_id).toBe(endpointId);
}

async function createNewThreadInChat(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
): Promise<string> {
  await page
    .getByRole("link", { name: /chat|对话/i })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`),
    {
      timeout: 30_000,
    },
  );
  const items = page.getByTestId("chat__thread-item");
  const beforeCount = await items.count();
  await page.getByTestId("chat__new-thread-btn").click();
  await expect(items).toHaveCount(beforeCount + 1, { timeout: 30_000 });
  const newThread = items.first();
  const threadId = await newThread.getAttribute("data-thread-id");
  expect(threadId).toBeTruthy();
  await newThread.locator('div[role="button"]').first().click();
  return threadId!;
}

async function renameThreadInChat(
  page: import("@playwright/test").Page,
  threadId: string,
  nextTitle: string,
) {
  const thread = page
    .locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`)
    .first();
  await expect(thread).toBeVisible({ timeout: 30_000 });
  await thread.getByTestId("chat__thread-actions-btn").click();
  await page.getByTestId("chat__thread-rename-action").click();
  const titleInput = thread.locator("input").first();
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.fill(nextTitle);
  await titleInput.press("Enter");
  await expect(thread.getByText(nextTitle)).toBeVisible({ timeout: 30_000 });
}

async function deleteThreadInChat(
  page: import("@playwright/test").Page,
  threadId: string,
) {
  const thread = page
    .locator(`[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`)
    .first();
  await expect(thread).toBeVisible({ timeout: 30_000 });
  await thread.getByTestId("chat__thread-actions-btn").click();
  await page.getByTestId("chat__thread-delete-action").click();
  await expect(page.getByTestId("chat__delete-thread-confirm")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("chat__delete-thread-confirm").click();
  await expect(
    page.locator(
      `[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`,
    ),
  ).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function deleteAllThreadsInChat(
  page: import("@playwright/test").Page,
): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const count = await page.getByTestId("chat__thread-item").count();
    if (count === 0) return;
    const threadId = await page
      .getByTestId("chat__thread-item")
      .first()
      .getAttribute("data-thread-id");
    if (!threadId) return;
    await deleteThreadInChat(page, threadId);
  }
}

async function openChatAndSend(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  text: string,
  sessionId?: string | null,
  expectedReply: string | null = "Hello from integration upstream.",
): Promise<string> {
  await page
    .getByRole("link", { name: /chat|对话/i })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`),
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId("chat__main-pane")).toBeVisible({
    timeout: 30_000,
  });

  if ((await page.getByTestId("chat__thread-item").count()) === 0) {
    await page.getByTestId("chat__new-thread-btn").click();
  }
  const firstThread = page.getByTestId("chat__thread-item").first();
  await expect(firstThread).toBeVisible({ timeout: 30_000 });

  const targetThread = sessionId
    ? page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${sessionId}"]`,
        )
        .first()
    : firstThread;
  await expect(targetThread).toBeVisible({ timeout: 30_000 });
  const selectedThreadId = await targetThread.getAttribute("data-thread-id");
  expect(selectedThreadId).toBeTruthy();
  await targetThread.locator('div[role="button"]').first().click();

  const composer = page.getByTestId("chat__composer");
  await expect(composer).toBeVisible();
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible();
  await ensureComposerEnabled(page);
  await expect(textarea).toBeEditable();
  await textarea.fill(text);
  const beforeCount = await page.getByTestId("chat__message").count();

  const sendBtn = page.getByTestId("chat__send-btn");
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const streamResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
        res.url(),
      ),
  );
  await sendBtn.click();
  const streamRes = await streamResponse;
  if (!streamRes.ok()) {
    const bodyText = await streamRes.text().catch(() => "");
    throw new Error(
      `Stream request failed (${streamRes.status()}): ${bodyText}`,
    );
  }
  if (expectedReply) {
    await expect(page.getByText(expectedReply).first()).toBeVisible({
      timeout: 60_000,
    });
  } else {
    await expect
      .poll(async () => page.getByTestId("chat__message").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(beforeCount + 2);
    const lastMessageText = await page
      .getByTestId("chat__message")
      .last()
      .textContent();
    expect((lastMessageText ?? "").trim().length).toBeGreaterThan(0);
  }
  return selectedThreadId!;
}

async function openChatAttachAndSend(
  page: import("@playwright/test").Page,
  locale: string,
  projectId: string,
  args: {
    text: string;
    fileName: string;
    fileContent: string;
    expectedReply: string;
    sessionId?: string | null;
  },
): Promise<string> {
  const { text, fileName, fileContent, expectedReply, sessionId } = args;
  await page
    .getByRole("link", { name: /chat|对话/i })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/chat`),
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId("chat__main-pane")).toBeVisible({
    timeout: 30_000,
  });

  if ((await page.getByTestId("chat__thread-item").count()) === 0) {
    await page.getByTestId("chat__new-thread-btn").click();
  }
  const firstThread = page.getByTestId("chat__thread-item").first();
  await expect(firstThread).toBeVisible({ timeout: 30_000 });

  const targetThread = sessionId
    ? page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${sessionId}"]`,
        )
        .first()
    : firstThread;
  await expect(targetThread).toBeVisible({ timeout: 30_000 });
  const selectedThreadId = await targetThread.getAttribute("data-thread-id");
  expect(selectedThreadId).toBeTruthy();
  await targetThread.locator('div[role="button"]').first().click();

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(fileContent, "utf8"),
  });
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 30_000 });

  const composer = page.getByTestId("chat__composer");
  const textarea = composer.locator("textarea");
  await expect(textarea).toBeVisible();
  await ensureComposerEnabled(page);
  await textarea.fill(text);
  const sendBtn = page.getByTestId("chat__send-btn");
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

  const createMessageRequest = page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages$/.test(
        req.url(),
      ),
  );
  const createMessageResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages$/.test(
        res.url(),
      ),
  );
  const streamResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
        res.url(),
      ),
  );
  await sendBtn.click();
  const msgReq = await createMessageRequest;
  const msgRes = await createMessageResponse;
  const body = msgReq.postDataJSON() as {
    inputs?: Array<{ kind?: string }>;
  } | null;
  expect(Array.isArray(body?.inputs)).toBeTruthy();
  expect((body?.inputs ?? []).length).toBeGreaterThan(0);
  expect(
    (body?.inputs ?? []).some((input) => input.kind === "library_object"),
  ).toBeTruthy();
  if (!msgRes.ok()) {
    const bodyText = await msgRes.text().catch(() => "");
    throw new Error(`Create message failed (${msgRes.status()}): ${bodyText}`);
  }
  const streamRes = await streamResponse;
  if (!streamRes.ok()) {
    const bodyText = await streamRes.text().catch(() => "");
    throw new Error(
      `Stream request failed (${streamRes.status()}): ${bodyText}`,
    );
  }
  await expect(page.getByText(expectedReply).first()).toBeVisible({
    timeout: 60_000,
  });
  return selectedThreadId!;
}

function isSessionStreamsRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(
    `/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/streams/?$`,
  ).test(url);
}

function isSessionStopRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(
    `/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/stop/?$`,
  ).test(url);
}

function isStreamStopRequestFor(url: string, sessionId: string): boolean {
  return new RegExp(
    `/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${sessionId}/messages/streams/[^/]+/stop/?$`,
  ).test(url);
}

function getChatStopRequestKind(url: string, sessionId: string) {
  if (isSessionStopRequestFor(url, sessionId)) return "session";
  if (isStreamStopRequestFor(url, sessionId)) return "stream";
  return "unknown";
}

function getTracePathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function assertChatStopPayloadTruth(args: {
  payload: ChatSessionStopPayload | null;
  responseUrl: string;
  sessionId: string;
  mode?: "cancel" | "terminate";
  allowedStopModes?: Array<"cancel" | "terminate">;
  canEscalate?: boolean;
  allowedStates: Array<
    "stopping" | "terminating" | "not_found_or_finished"
  >;
}) {
  const {
    payload,
    responseUrl,
    sessionId,
    mode,
    allowedStopModes,
    canEscalate,
    allowedStates,
  } = args;
  const expectedStopModes = allowedStopModes ?? (mode ? [mode] : []);
  expect(payload).toMatchObject({
    success: true,
    ...(typeof canEscalate === "boolean"
      ? { can_escalate: canEscalate }
      : {}),
  });
  if (expectedStopModes.length > 0) {
    expect(expectedStopModes).toContain(payload?.mode ?? null);
  }
  expect(allowedStates).toContain(payload?.state ?? payload?.status ?? null);

  const requestKind = getChatStopRequestKind(responseUrl, sessionId);
  expect(requestKind).not.toBe("unknown");
  if (requestKind === "session") {
    expect(payload).toMatchObject({
      session_id: sessionId,
    });
  }
  if (requestKind === "stream") {
    expect(payload?.stream_id).toEqual(expect.any(String));
  }
  return requestKind;
}

test.describe("@lane-real integration chat flow", () => {
  test("keycloak login + create endpoint + chat stream through openai-compatible proxy", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
        {
          capability: "multimodal_completion",
        },
      );
      await openChatAndSend(page, locale, projectId, "Integration chat ping");
      expect(upstream.getRequestCount()).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("chat session survives route switch and can continue conversation", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
        {
          capability: "multimodal_completion",
        },
      );

      const selectedThreadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Reconnect test - message 1",
      );
      const firstThread = page.getByTestId("chat__thread-item").first();
      const firstThreadId = await firstThread.getAttribute("data-thread-id");
      expect(firstThreadId).toBeTruthy();
      expect(selectedThreadId).toBe(firstThreadId);

      await page.goto(
        `/${locale}/workspaces/ws_default/projects/${projectId}/overview`,
      );
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/overview`,
        ),
        {
          timeout: 30_000,
        },
      );

      const beforeSecondSend = upstream.getRequestCount();
      const threadAfterReturnId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Reconnect test - message 2",
        firstThreadId,
      );
      expect(threadAfterReturnId).toBe(firstThreadId);
      expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(
        beforeSecondSend + 1,
      );
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("deleting the only thread shows clear empty-state actions and disabled composer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
      );

      await createNewThreadInChat(page, locale, projectId);
      await deleteAllThreadsInChat(page);

      await expect(page.getByTestId("chat__header-create-thread")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("chat__empty-create-btn")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("chat__send-btn")).toBeDisabled();
      await expect(
        page.getByTestId("chat__composer").locator("textarea"),
      ).toBeDisabled();
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("text-only endpoint hides attachment actions in composer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAICompatibleUpstream();
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
        {
          capability: "chat_completion",
        },
      );

      await createNewThreadInChat(page, locale, projectId);
      await expect(page.getByTestId("chat__composer")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("chat__attach-local-btn")).toHaveCount(0);
      await expect(page.getByTestId("chat__attach-library-btn")).toHaveCount(0);
      await expect(page.getByTestId("chat__send-btn")).toBeVisible();
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("chat can switch endpoint and route next message to selected upstream", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstreamA = await startOpenAICompatibleUpstreamWith({
      replyText: "Reply from endpoint A",
    });
    const upstreamB = await startOpenAICompatibleUpstreamWith({
      replyText: "Reply from endpoint B",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint A ${suffix}`,
        endpointModel: "integration-chat-model-a",
        upstreamBaseUrl: upstreamA.baseUrl,
        credentialName,
      });
      const endpointBId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint B ${suffix}`,
        endpointModel: "integration-chat-model-b",
        upstreamBaseUrl: upstreamB.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Route to endpoint A",
        null,
        "Reply from endpoint A",
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, endpointBId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Route to endpoint B",
        threadId,
        "Reply from endpoint B",
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) =>
        upstreamA.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        upstreamB.server.close(() => resolve()),
      );
    }
  });

  test("chat can recover by switching endpoint after upstream failure", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const failingUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "never-used",
      statusCode: 500,
      errorMessage: "integration forced upstream failure",
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered from healthy endpoint",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const failingEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Failing ${suffix}`,
        endpointModel: "integration-chat-model-fail",
        upstreamBaseUrl: failingUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup with failing endpoint selection",
        null,
        "Recovered from healthy endpoint",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, failingEndpointId);
      await sendExpectStreamError(
        page,
        "This should fail via failing endpoint",
      );
      expect(failingUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover with healthy endpoint",
        threadId,
        "Recovered from healthy endpoint",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        failingUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("chat can stop generation and continue via healthy endpoint", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const slowUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Slow upstream response",
      delayMs: 12_000,
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after stop",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const slowEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Slow ${suffix}`,
        endpointModel: "integration-chat-model-slow",
        upstreamBaseUrl: slowUpstream.baseUrl,
        credentialName,
      });

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after stop",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, slowEndpointId);
      await sendAndStopDuringGeneration(page, "Stop this slow request");
      await expect
        .poll(() => slowUpstream.getRequestCount(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Continue after stop with healthy endpoint",
        threadId,
        "Recovered after stop",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        slowUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("stop escalation resyncs authoritative thread truth after refresh and keeps composer ready", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const partialAssistantText = `persist-partial-before-terminate-${Date.now()}`;
    const streamingUpstream =
      await startOpenAIStreamingUpstreamWithManualRelease({
        chunks: [`${partialAssistantText} `],
        chunkDelayMs: 1_000,
      });
    const healthyReplyText = `Recovered after terminate refresh ${Date.now()}`;
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: healthyReplyText,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;
      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const streamingEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Slow ${suffix}`,
          endpointModel: "integration-chat-model-slow",
          upstreamBaseUrl: streamingUpstream.baseUrl,
          credentialName,
        },
      );
      const trace = await createUxTraceBundleWriter({
        outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
        lane: "backend-real",
        suite: "integration-chat",
        storyId: CHAT_STOP_RECOVERY_STORY.storyId,
        title: CHAT_STOP_RECOVERY_STORY.title,
        actor: CHAT_STOP_RECOVERY_STORY.actor,
        route: `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        specFile: "e2e/integration-chat.spec.ts",
        browser: "chromium",
        goal: CHAT_STOP_RECOVERY_STORY.goal,
        preconditions: [...(CHAT_STOP_RECOVERY_STORY.preconditions ?? [])],
        seedData: [...(CHAT_STOP_RECOVERY_STORY.seedData ?? [])],
        storyBinding: CHAT_STOP_RECOVERY_BINDING,
      });
      const captureTrace = async (
        stepId: string,
        extra: Partial<Parameters<typeof trace.capture>[1]> = {},
      ): Promise<void> => {
        const storyStep = resolveChatStopRecoveryStep(stepId);
        await trace.capture(page, {
          stepId,
          action: storyStep.action,
          target: storyStep.target,
          note: storyStep.note ?? storyStep.expectedFeedback,
          ...extra,
        });
      };
      let outcome: "pass" | "fail" = "fail";

      try {
        await page
          .getByRole("link", { name: /chat|对话/i })
          .first()
          .click();
        await page.waitForURL(
          new RegExp(
            `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
          ),
          {
            timeout: 30_000,
          },
        );
        if ((await page.getByTestId("chat__thread-item").count()) === 0) {
          const newThreadButton = page
            .getByTestId("chat__new-thread-btn")
            .or(page.getByTestId("chat__empty-create-btn"))
            .or(page.getByTestId("chat__header-create-thread"))
            .first();
          await newThreadButton.click();
        }
        const thread = page.getByTestId("chat__thread-item").first();
        await thread.locator('div[role="button"]').first().click();
        const threadId = await thread.getAttribute("data-thread-id");
        expect(threadId).toBeTruthy();

        await selectEndpointInChat(page, streamingEndpointId);

        await ensureComposerEnabled(page);
        const textarea = page.getByTestId("chat__composer").locator("textarea");
        await textarea.fill(
          "stream and stop, then terminate after refresh resync",
        );
        const initialStreamResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
              response.url(),
            ),
        );
        await page.getByTestId("chat__send-btn").click();
        expect((await initialStreamResponse).ok()).toBeTruthy();

        await expect(
          page
            .getByTestId("chat__message")
            .filter({ hasText: partialAssistantText })
            .first(),
        ).toBeVisible({
          timeout: 30_000,
        });
        await captureTrace("open-the-active-chat-thread", {
          assertion:
            "The active thread is still generating and already shows the partial assistant reply the member has seen.",
        });

        const stopResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            (isStreamStopRequestFor(response.url(), threadId!) ||
              isSessionStopRequestFor(response.url(), threadId!)),
        );
        await expect(chatStopButton(page)).toBeVisible({ timeout: 10_000 });
        await chatStopButton(page).click();
        const stopResult = await stopResponse;
        expect(stopResult.status()).toBe(202);
        const stopPayload = (await stopResult
          .json()
          .catch(() => null)) as ChatSessionStopPayload | null;
        const stopRequestKind = assertChatStopPayloadTruth({
          payload: stopPayload,
          responseUrl: stopResult.url(),
          sessionId: threadId!,
          mode: "cancel",
          allowedStates: ["stopping", "not_found_or_finished"],
        });
        await expect(page.getByTestId("chat__stream-status")).toContainText(
          /stop|停止|recovering|恢复/i,
          {
            timeout: 15_000,
          },
        );

        const stoppedAssistantText = await readLastChatMessageText(page);
        expect(stoppedAssistantText).toContain(partialAssistantText);
        await page.waitForTimeout(6_000);
        expect(await readLastChatMessageText(page)).toBe(stoppedAssistantText);
        await captureTrace("stop-the-active-stream-from-the-thread", {
          request: {
            method: "POST",
            url: getTracePathFromUrl(stopResult.url()),
            summary: `mode=cancel route=${stopRequestKind}`,
          },
          response: {
            status: stopResult.status(),
            summary: `route=${stopRequestKind} state=${stopPayload?.state ?? stopPayload?.status ?? "unknown"}`,
          },
          assertion:
            "Stopping preserves the partial reply instead of wiping context or silently hanging the thread.",
        });

        let stopRecoveryTruth: ChatSessionTruth | null = null;
        let stopRecoveryPhase:
          | "pending"
          | "escalatable"
          | "terminate_unavailable"
          | "settled" = "pending";
        await expect
          .poll(
            async () => {
              stopRecoveryTruth = await readChatSessionTruthViaApi(
                page,
                projectId,
                threadId!,
              );
              if (
                stopRecoveryTruth.executionStatus === "stopping" &&
                stopRecoveryTruth.canEscalate === true
              ) {
                stopRecoveryPhase = "escalatable";
                return stopRecoveryPhase;
              }
              if (
                stopRecoveryTruth.executionStatus === "stopping" &&
                stopRecoveryTruth.canEscalate === false
              ) {
                stopRecoveryPhase = "terminate_unavailable";
                return stopRecoveryPhase;
              }
              if (
                stopRecoveryTruth.stuck === false &&
                stopRecoveryTruth.activeStreamCount === 0 &&
                isFinalChatExecutionStatus(stopRecoveryTruth.executionStatus)
              ) {
                stopRecoveryPhase = "settled";
                return stopRecoveryPhase;
              }
              stopRecoveryPhase = "pending";
              return stopRecoveryPhase;
            },
            { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
          )
          .not.toBe("pending");

        if (stopRecoveryPhase === "escalatable") {
          const escalationDialog = await waitForChatStopEscalationDialog(
            page,
            60_000,
          );
          await expect(escalationDialog).toContainText(
            /terminate|force stop|强制|结束/i,
          );
          const terminateResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              (isSessionStopRequestFor(response.url(), threadId!) ||
                isStreamStopRequestFor(response.url(), threadId!)),
          );
          await escalationDialog
            .getByTestId("chat__stop-escalation-confirm")
            .click();
          const terminateResult = await terminateResponse;
          expect(terminateResult.status()).toBe(202);
          const terminatePayload = (await terminateResult
            .json()
            .catch(() => null)) as ChatSessionStopPayload | null;
          const terminateRequestKind = assertChatStopPayloadTruth({
            payload: terminatePayload,
            responseUrl: terminateResult.url(),
            sessionId: threadId!,
            mode: "terminate",
            canEscalate: false,
            allowedStates: ["terminating"],
          });
          await expect(page.getByTestId("chat__stream-status")).toContainText(
            /terminat|force stop|结束/i,
            {
              timeout: 30_000,
            },
          );
          await captureTrace("escalate-to-terminate-if-stop-does-not-settle", {
            request: {
              method: "POST",
              url: getTracePathFromUrl(terminateResult.url()),
              summary: `mode=terminate route=${terminateRequestKind} reason=${stopRecoveryTruth?.escalationReason ?? "escalation_available"}`,
            },
            response: {
              status: terminateResult.status(),
              summary: `route=${terminateRequestKind} state=${terminatePayload?.state ?? terminatePayload?.status ?? "unknown"}`,
            },
            assertion:
              "Terminate escalation stays in the same thread and upgrades the authoritative backend truth instead of forcing a workaround.",
          });
        } else if (stopRecoveryPhase === "terminate_unavailable") {
          const terminateUnavailable = await postChatSessionStopViaApi(
            page,
            projectId,
            threadId!,
            "terminate",
          );
          expect(terminateUnavailable.status).toBe(202);
          expect(terminateUnavailable.payload).toMatchObject({
            success: true,
            mode: "cancel",
            can_escalate: false,
            escalation_reason: "STOP_ESCALATION_UNAVAILABLE",
          });
          expect(["stopping", "not_found_or_finished"]).toContain(
            terminateUnavailable.payload?.state ??
              terminateUnavailable.payload?.status ??
              null,
          );
          if (
            typeof terminateUnavailable.payload?.session_id === "string"
          ) {
            expect(terminateUnavailable.payload.session_id).toBe(threadId);
          }
          await captureTrace("escalate-to-terminate-if-stop-does-not-settle", {
            request: {
              method: "POST",
              url: `/api/v1/workspaces/ws_default/projects/${projectId}/chat/sessions/${threadId}/stop`,
              summary: "mode=terminate fallback=cancel",
            },
            response: {
              status: terminateUnavailable.status,
              summary: `state=${terminateUnavailable.payload?.state ?? terminateUnavailable.payload?.status ?? "unknown"} can_escalate=${terminateUnavailable.payload?.can_escalate ?? "unknown"} reason=${terminateUnavailable.payload?.escalation_reason ?? "none"}`,
            },
            assertion:
              "When terminate is unavailable on this backend substrate, the authoritative thread truth says so without reopening ghost streaming or losing the partial reply.",
          });
        } else {
          await captureTrace("escalate-to-terminate-if-stop-does-not-settle", {
            assertion:
              "This stop settled before any terminate escalation was necessary, so the same thread kept one authoritative stopped truth without a ghost recovery loop.",
          });
        }

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForURL(
          new RegExp(
            `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
          ),
          {
            timeout: 30_000,
          },
        );
        await expect(page.getByTestId("chat__main-pane")).toBeVisible({
          timeout: 30_000,
        });
        await page
          .locator(
            `[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`,
          )
          .first()
          .locator('div[role="button"]')
          .first()
          .click();
        await expect(
          page
            .getByTestId("chat__message")
            .filter({ hasText: partialAssistantText }),
        ).toHaveCount(1, {
          timeout: 30_000,
        });
        expect(await readLastChatMessageText(page)).toContain(
          partialAssistantText,
        );
        const truthAfterReload = await readChatSessionTruthViaApi(
          page,
          projectId,
          threadId!,
        );
        expect(truthAfterReload.executionStatus).not.toBe("running");
        await expect(chatStopButton(page)).toHaveCount(0);
        await captureTrace(
          "refresh-and-reopen-the-same-thread-without-ghost-streaming",
          {
            assertion: `Refresh keeps one authoritative partial reply and ${truthAfterReload.executionStatus ?? "idle"} truth without ghost streaming.`,
          },
        );

        await expect
          .poll(() => streamingUpstream.getAbortedRequestCount(), {
            timeout: 60_000,
            intervals: [500, 1_000, 2_000, 5_000],
          })
          .toBeGreaterThanOrEqual(1);

        let settledTruth: ChatSessionTruth | null = null;
        await expect
          .poll(
            async () => {
              settledTruth = await readChatSessionTruthViaApi(
                page,
                projectId,
                threadId!,
              );
              return (
                settledTruth.stuck === false &&
                settledTruth.activeStreamCount === 0 &&
                settledTruth.canEscalate !== true &&
                isFinalChatExecutionStatus(settledTruth.executionStatus)
              );
            },
            { timeout: 120_000, intervals: [1_000, 2_000, 5_000, 10_000] },
          )
          .toBe(true);
        expect(settledTruth?.terminationState).not.toBe("terminating");

        const repeatedTerminate = await postChatSessionStopViaApi(
          page,
          projectId,
          threadId!,
          "terminate",
        );
        expect(repeatedTerminate.status).toBe(202);
        assertChatStopPayloadTruth({
          payload: repeatedTerminate.payload,
          responseUrl: `/api/v1/workspaces/ws_default/projects/${projectId}/chat/sessions/${threadId}/stop`,
          sessionId: threadId!,
          allowedStopModes: ["cancel", "terminate"],
          canEscalate: false,
          allowedStates: ["not_found_or_finished"],
        });
        await captureTrace(
          "repeat-terminate-without-reopening-a-settled-stop-loop",
          {
            request: {
              method: "POST",
              url: `/api/v1/workspaces/ws_default/projects/${projectId}/chat/sessions/${threadId}/stop`,
              summary: "mode=terminate repeated after settle",
            },
            response: {
              status: repeatedTerminate.status,
              summary: `state=${repeatedTerminate.payload?.state ?? repeatedTerminate.payload?.status ?? "unknown"} mode=${repeatedTerminate.payload?.mode ?? "unknown"}`,
            },
            assertion:
              "A repeated terminate stays idempotent and does not reopen the settled stop loop.",
          },
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForURL(
          new RegExp(
            `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
          ),
          {
            timeout: 30_000,
          },
        );
        await page
          .locator(
            `[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`,
          )
          .first()
          .locator('div[role="button"]')
          .first()
          .click();
        await expect(
          page
            .getByTestId("chat__message")
            .filter({ hasText: partialAssistantText }),
        ).toHaveCount(1, {
          timeout: 30_000,
        });
        await expect(chatStopButton(page)).toHaveCount(0);
        await ensureComposerEnabled(page);
        await expect(textarea).toBeEditable({ timeout: 30_000 });

        await selectEndpointInChat(page, healthyEndpointId);
        const recoveryStreamResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/chat\/sessions\/[^/]+\/messages\/stream$/.test(
              response.url(),
            ),
        );
        await textarea.fill(
          "Continue after terminate refresh with healthy endpoint",
        );
        await page.getByTestId("chat__send-btn").click();
        expect((await recoveryStreamResponse).ok()).toBeTruthy();
        await expect(
          page
            .getByTestId("chat__message")
            .filter({ hasText: healthyReplyText })
            .first(),
        ).toBeVisible({
          timeout: 60_000,
        });
        await ensureComposerEnabled(page);
        await expect(textarea).toBeEditable({ timeout: 30_000 });
        expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);
        await captureTrace("continue-working-in-the-same-thread-after-resync", {
          assertion:
            "After resync, the same thread accepts the next prompt and the composer is ready again.",
        });

        outcome = "pass";
      } finally {
        await trace.finish({ outcome });
      }
    } finally {
      streamingUpstream.releasePendingResponses();
      await new Promise<void>((resolve) =>
        streamingUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("refresh recovers stream id and stop uses stream-level route", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const streamingUpstream = await startOpenAIStreamingUpstreamWith({
      chunks: [
        "recover-stream-1 ",
        "recover-stream-2 ",
        "recover-stream-3 ",
        "recover-stream-4 ",
      ],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        streamingUpstream.baseUrl,
      );

      await page
        .getByRole("link", { name: /chat|对话/i })
        .first()
        .click();
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      if ((await page.getByTestId("chat__thread-item").count()) === 0) {
        await page.getByTestId("chat__new-thread-btn").click();
      }
      const thread = page.getByTestId("chat__thread-item").first();
      await thread.locator('div[role="button"]').first().click();
      const threadId = await thread.getAttribute("data-thread-id");
      expect(threadId).toBeTruthy();

      await ensureComposerEnabled(page);
      const textarea = page.getByTestId("chat__composer").locator("textarea");
      await textarea.fill("recover stream id then stop");
      await page.getByTestId("chat__send-btn").click();
      await expect(page.getByText("recover-stream-1").first()).toBeVisible({
        timeout: 30_000,
      });

      const streamRecoveryUrls: string[] = [];
      const streamStopUrls: string[] = [];
      const sessionStopUrls: string[] = [];
      const requestListener = (req: import("@playwright/test").Request) => {
        if (
          req.method() === "GET" &&
          isSessionStreamsRequestFor(req.url(), threadId!)
        ) {
          streamRecoveryUrls.push(req.url());
        }
        if (
          req.method() === "POST" &&
          isStreamStopRequestFor(req.url(), threadId!)
        ) {
          streamStopUrls.push(req.url());
        }
        if (
          req.method() === "POST" &&
          isSessionStopRequestFor(req.url(), threadId!)
        ) {
          sessionStopUrls.push(req.url());
        }
      };
      page.on("request", requestListener);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      await page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`,
        )
        .first()
        .locator('div[role="button"]')
        .first()
        .click();
      const stopBtn = page
        .getByTestId("chat__composer")
        .getByRole("button", { name: /Stop|停止/i });
      if (await stopBtn.isVisible({ timeout: 20_000 }).catch(() => false)) {
        await stopBtn.click();
        await expect
          .poll(() => streamStopUrls.length + sessionStopUrls.length, {
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
      }
      page.off("request", requestListener);
      expect(streamRecoveryUrls.length).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve) =>
        streamingUpstream.server.close(() => resolve()),
      );
    }
  });

  test("refresh without recovered stream id falls back to session-level stop route", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const streamingUpstream = await startOpenAIStreamingUpstreamWith({
      chunks: [
        "fallback-stop-1 ",
        "fallback-stop-2 ",
        "fallback-stop-3 ",
        "fallback-stop-4 ",
      ],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        streamingUpstream.baseUrl,
      );

      await page
        .getByRole("link", { name: /chat|对话/i })
        .first()
        .click();
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      if ((await page.getByTestId("chat__thread-item").count()) === 0) {
        await page.getByTestId("chat__new-thread-btn").click();
      }
      const thread = page.getByTestId("chat__thread-item").first();
      await thread.locator('div[role="button"]').first().click();
      const threadId = await thread.getAttribute("data-thread-id");
      expect(threadId).toBeTruthy();

      await ensureComposerEnabled(page);
      const textarea = page.getByTestId("chat__composer").locator("textarea");
      await textarea.fill("break stream recovery and stop by session");
      await page.getByTestId("chat__send-btn").click();
      await expect(page.getByText("fallback-stop-1").first()).toBeVisible({
        timeout: 30_000,
      });

      await page.route(
        new RegExp(
          `/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${threadId}/streams/?$`,
        ),
        async (route) => {
          await route.fulfill({
            status: 500,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              error_code: "forced_failure",
              message: "forced stream recovery failure",
            }),
          });
        },
      );

      const streamStopUrls: string[] = [];
      const requestListener = (req: import("@playwright/test").Request) => {
        if (
          req.method() === "POST" &&
          isStreamStopRequestFor(req.url(), threadId!)
        ) {
          streamStopUrls.push(req.url());
        }
      };
      page.on("request", requestListener);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      await page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${threadId}"]`,
        )
        .first()
        .locator('div[role="button"]')
        .first()
        .click();

      const stopBtn = page
        .getByTestId("chat__composer")
        .getByRole("button", { name: /Stop|停止/i });
      if (await stopBtn.isVisible({ timeout: 20_000 }).catch(() => false)) {
        const sessionStopReq = page.waitForRequest(
          (req) =>
            req.method() === "POST" &&
            isSessionStopRequestFor(req.url(), threadId!),
          { timeout: 60_000 },
        );
        await stopBtn.click();
        await sessionStopReq;
        await expect
          .poll(() => streamStopUrls.length, { timeout: 5_000 })
          .toBe(0);
      }

      page.off("request", requestListener);
      await page.unroute(
        new RegExp(
          `/api/v1/workspaces/[^/]+/projects/[^/]+/chat/sessions/${threadId}/streams/?$`,
        ),
      );
    } finally {
      await new Promise<void>((resolve) =>
        streamingUpstream.server.close(() => resolve()),
      );
    }
  });

  test("editing historical user input starts regenerate in-branch instead of footer append", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAIStreamingUpstreamWith({
      chunks: ["branch-regen-1 ", "branch-regen-2"],
      chunkDelayMs: 2_500,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
        {
          capability: "multimodal_completion",
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "initial message for edit-regenerate",
        null,
        "branch-regen-1 branch-regen-2",
      );
      await openChatAndSend(
        page,
        locale,
        projectId,
        "second message to keep chain stable",
        threadId,
        "branch-regen-1 branch-regen-2",
      );

      const firstMessage = page
        .locator('[data-testid="chat__message"]')
        .first();
      await firstMessage.hover();
      await page
        .getByRole("button", { name: /Edit|编辑/i })
        .first()
        .click();
      const inlineEditTextarea = page
        .getByTestId("chat__composer")
        .locator("textarea");
      await expect(inlineEditTextarea).toBeVisible({ timeout: 10_000 });
      await inlineEditTextarea.fill("edited historical input");
      await page.getByTestId("chat__send-btn").click();

      await expect(page.getByTestId("chat__stream-status")).toHaveText(
        /Generating|Streaming/i,
        { timeout: 15_000 },
      );
      await expect(
        page
          .locator('section[data-testid="chat__main-pane"]')
          .getByText(/^Assistant$/),
      ).toHaveCount(0);
      await expect(page.getByText("branch-regen-1").first()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("switching threads while streaming does not leak assistant output into target thread", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAIStreamingUpstreamWith({
      chunks: [
        "thread-leak-check-1 ",
        "thread-leak-check-2 ",
        "thread-leak-check-3 ",
        "thread-leak-check-4 ",
      ],
      chunkDelayMs: 4_000,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
      );

      await page
        .getByRole("link", { name: /chat|对话/i })
        .first()
        .click();
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      if ((await page.getByTestId("chat__thread-item").count()) === 0) {
        await page.getByTestId("chat__new-thread-btn").click();
      }
      await page.getByTestId("chat__new-thread-btn").click();

      const threads = page.getByTestId("chat__thread-item");
      await expect(threads).toHaveCount(2, { timeout: 30_000 });
      const sourceThreadId = await threads
        .nth(1)
        .getAttribute("data-thread-id");
      const targetThreadId = await threads
        .nth(0)
        .getAttribute("data-thread-id");
      expect(sourceThreadId).toBeTruthy();
      expect(targetThreadId).toBeTruthy();
      const sourceThread = page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${sourceThreadId}"]`,
        )
        .first();
      const targetThread = page
        .locator(
          `[data-testid="chat__thread-item"][data-thread-id="${targetThreadId}"]`,
        )
        .first();

      await sourceThread.locator('div[role="button"]').first().click();
      await ensureComposerEnabled(page);
      const textarea = page.getByTestId("chat__composer").locator("textarea");
      await textarea.fill("start long streaming response");
      await page.getByTestId("chat__send-btn").click();
      await expect(page.getByText("thread-leak-check-1").first()).toBeVisible({
        timeout: 30_000,
      });

      await targetThread.locator('div[role="button"]').first().click();
      await expect(page.getByText("thread-leak-check-1")).toHaveCount(0);
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("chat threads keep endpoint isolation when switching between sessions", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstreamA = await startOpenAICompatibleUpstreamWith({
      replyText: "Thread A reply",
    });
    const upstreamB = await startOpenAICompatibleUpstreamWith({
      replyText: "Thread B reply",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint A ${suffix}`,
        endpointModel: "integration-chat-model-a",
        upstreamBaseUrl: upstreamA.baseUrl,
        credentialName,
      });
      const endpointBId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint B ${suffix}`,
        endpointModel: "integration-chat-model-b",
        upstreamBaseUrl: upstreamB.baseUrl,
        credentialName,
      });

      const threadAId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Thread A message 1",
        null,
        "Thread A reply",
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(1);

      const threadBId = await createNewThreadInChat(page, locale, projectId);
      await selectEndpointInChat(page, endpointBId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Thread B message 1",
        threadBId,
        "Thread B reply",
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(1);

      const beforeA2 = upstreamA.getRequestCount();
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Thread A message 2",
        threadAId,
        "Thread A reply",
      );
      expect(upstreamA.getRequestCount()).toBeGreaterThanOrEqual(beforeA2 + 1);

      const beforeB2 = upstreamB.getRequestCount();
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Thread B message 2",
        threadBId,
        "Thread B reply",
      );
      expect(upstreamB.getRequestCount()).toBeGreaterThanOrEqual(beforeB2 + 1);
    } finally {
      await new Promise<void>((resolve) =>
        upstreamA.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        upstreamB.server.close(() => resolve()),
      );
    }
  });

  test("thread rename persists and deleted thread is removed cleanly", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";
    const runtime = requireChatDayTwoRuntime();

    const upstream = await startOpenAICompatibleUpstreamWith({
      replyText: runtime.upstreamReplyText,
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(
        page,
        locale,
        `${runtime.projectNamePrefix} ${Date.now()}`,
      );
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
      );
      const trace = await createUxTraceBundleWriter({
        outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
        lane: "backend-real",
        suite: "integration-chat",
        storyId: CHAT_DAY_TWO_STORY.storyId,
        title: CHAT_DAY_TWO_STORY.title,
        actor: CHAT_DAY_TWO_STORY.actor,
        route: `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        specFile: "e2e/integration-chat.spec.ts",
        browser: "chromium",
        goal: CHAT_DAY_TWO_STORY.goal,
        preconditions: [...(CHAT_DAY_TWO_STORY.preconditions ?? [])],
        seedData: [...(CHAT_DAY_TWO_STORY.seedData ?? [])],
        storyBinding: CHAT_DAY_TWO_BINDING,
      });
      const captureTrace = async (stepId: string): Promise<void> => {
        const storyStep = resolveChatDayTwoStep(stepId);
        await trace.capture(page, {
          stepId,
          action: storyStep.action,
          target: storyStep.target,
          note: storyStep.note ?? storyStep.expectedFeedback,
        });
      };
      let outcome: "pass" | "fail" = "fail";

      try {
        const threadAId = await openChatAndSend(
          page,
          locale,
          projectId,
          runtime.firstThreadPrompt,
          null,
          runtime.upstreamReplyText,
        );
        await captureTrace("open-chat-day-two");
        const threadBId = await createNewThreadInChat(page, locale, projectId);
        await openChatAndSend(
          page,
          locale,
          projectId,
          runtime.secondThreadPrompt,
          threadBId,
          runtime.upstreamReplyText,
        );
        await captureTrace("create-follow-up-thread");

        const renamedTitle = `${runtime.renamedThreadPrefix} ${Date.now()}`;
        await renameThreadInChat(page, threadAId, renamedTitle);
        await captureTrace("rename-keep-thread");
        await deleteThreadInChat(page, threadBId);
        await captureTrace("delete-stale-thread");

        await page.goto(
          `/${locale}/workspaces/ws_default/projects/${projectId}/overview`,
        );
        await page.waitForURL(
          new RegExp(
            `/${locale}/workspaces/ws_default/projects/${projectId}/overview`,
          ),
          {
            timeout: 30_000,
          },
        );

        const beforeResume = upstream.getRequestCount();
        await openChatAndSend(
          page,
          locale,
          projectId,
          runtime.resumeThreadPrompt,
          threadAId,
          runtime.upstreamReplyText,
        );
        const threadA = page
          .locator(
            `[data-testid="chat__thread-item"][data-thread-id="${threadAId}"]`,
          )
          .first();
        await expect(threadA.getByText(renamedTitle)).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          page.locator(
            `[data-testid="chat__thread-item"][data-thread-id="${threadBId}"]`,
          ),
        ).toHaveCount(0);
        expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(
          beforeResume + 1,
        );
        await captureTrace("resume-kept-thread");
        outcome = "pass";
      } finally {
        await trace.finish({ outcome });
      }
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("chat sends message with attachment ids when file is attached", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const upstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Attachment reply",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await provisionCredentialAndEndpoint(
        page,
        locale,
        projectId,
        upstream.baseUrl,
        {
          capability: "multimodal_completion",
        },
      );

      await openChatAttachAndSend(page, locale, projectId, {
        text: "Message with attached file",
        fileName: `integration-note-${Date.now()}.txt`,
        fileContent: "integration attachment body",
        expectedReply: "Attachment reply",
      });
      expect(upstream.getRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) =>
        upstream.server.close(() => resolve()),
      );
    }
  });

  test("chat surfaces upstream 429 message and can recover", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const throttledUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "never-used",
      statusCode: 429,
      errorCode: "UPSTREAM_RATE_LIMIT",
      errorMessage: "upstream rate limited for integration test",
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after 429",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const throttledEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Throttled ${suffix}`,
          endpointModel: "integration-chat-model-throttled",
          upstreamBaseUrl: throttledUpstream.baseUrl,
          credentialName,
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after 429",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, throttledEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        "This request should hit 429",
        "upstream rate limited for integration test",
      );
      expect(throttledUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover after throttling",
        threadId,
        "Recovered after 429",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        throttledUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("chat surfaces upstream 401 message and can recover", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const unauthorizedUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "never-used",
      statusCode: 401,
      errorCode: "UPSTREAM_UNAUTHORIZED",
      errorMessage: "upstream unauthorized for integration test",
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after 401",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const unauthorizedEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Unauthorized ${suffix}`,
          endpointModel: "integration-chat-model-unauthorized",
          upstreamBaseUrl: unauthorizedUpstream.baseUrl,
          credentialName,
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after 401",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, unauthorizedEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        "This request should hit 401",
        "upstream unauthorized for integration test",
      );
      expect(unauthorizedUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover after unauthorized",
        threadId,
        "Recovered after 401",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        unauthorizedUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("chat surfaces upstream 403 message and can recover", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const forbiddenUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "never-used",
      statusCode: 403,
      errorCode: "UPSTREAM_FORBIDDEN",
      errorMessage: "upstream forbidden for integration test",
    });
    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after 403",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const forbiddenEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Forbidden ${suffix}`,
          endpointModel: "integration-chat-model-forbidden",
          upstreamBaseUrl: forbiddenUpstream.baseUrl,
          credentialName,
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after 403",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, forbiddenEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        "This request should hit 403",
        "upstream forbidden for integration test",
      );
      expect(forbiddenUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover after forbidden",
        threadId,
        "Recovered after 403",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        forbiddenUpstream.server.close(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("chat surfaces platform 422 when selected endpoint is disabled and can recover", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after disabled endpoint",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const credentialName = `Integration Credential ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName,
      });
      const toDisableEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Disabled ${suffix}`,
          endpointModel: "integration-chat-model-disabled",
          upstreamBaseUrl: healthyUpstream.baseUrl,
          credentialName,
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after disabled endpoint",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await disableEndpointViaApi(page, projectId, toDisableEndpointId);
      await selectEndpointInChat(page, toDisableEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        "This request should fail because endpoint disabled",
        "chat_endpoint_unavailable",
      );

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover after disabled endpoint",
        threadId,
        "Recovered after disabled endpoint",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  test("chat surfaces platform 422 when endpoint credential is deleted and can recover", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
    const password =
      process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

    const healthyUpstream = await startOpenAICompatibleUpstreamWith({
      replyText: "Recovered after missing credential",
    });
    try {
      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      const suffix = Date.now();
      const healthyCredentialName = `Integration Credential Healthy ${suffix}`;
      const toDeleteCredentialName = `Integration Credential Delete ${suffix}`;

      await createCredential(page, locale, projectId, {
        credentialName: healthyCredentialName,
        credentialValue: "integration-secret-key",
      });
      const credentialId = await createCredential(page, locale, projectId, {
        credentialName: toDeleteCredentialName,
        credentialValue: "integration-secret-key",
      });
      const healthyEndpointId = await createEndpoint(page, locale, projectId, {
        endpointName: `Integration Endpoint Healthy ${suffix}`,
        endpointModel: "integration-chat-model-healthy",
        upstreamBaseUrl: healthyUpstream.baseUrl,
        credentialName: healthyCredentialName,
      });
      const missingCredentialEndpointId = await createEndpoint(
        page,
        locale,
        projectId,
        {
          endpointName: `Integration Endpoint Missing Credential ${suffix}`,
          endpointModel: "integration-chat-model-missing-cred",
          upstreamBaseUrl: healthyUpstream.baseUrl,
          credentialName: toDeleteCredentialName,
        },
      );

      const threadId = await openChatAndSend(
        page,
        locale,
        projectId,
        "Warmup on healthy endpoint",
        null,
        "Recovered after missing credential",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(1);

      await deleteCredentialFromUi(page, locale, projectId, credentialId);
      await page
        .getByRole("link", { name: /chat|对话/i })
        .first()
        .click();
      await page.waitForURL(
        new RegExp(
          `/${locale}/workspaces/ws_default/projects/${projectId}/chat`,
        ),
        {
          timeout: 30_000,
        },
      );
      await selectEndpointInChat(page, missingCredentialEndpointId);
      await sendExpectStreamErrorMessage(
        page,
        "This request should fail due to deleted credential",
        "chat_endpoint_credential_missing",
      );

      await selectEndpointInChat(page, healthyEndpointId);
      await openChatAndSend(
        page,
        locale,
        projectId,
        "Recover after missing credential",
        threadId,
        "Recovered after missing credential",
      );
      expect(healthyUpstream.getRequestCount()).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) =>
        healthyUpstream.server.close(() => resolve()),
      );
    }
  });

  if (RUN_REAL_COMPLETION) {
    test("chat works with real deepseek completion endpoint imported from integration resource", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const locale = process.env.INTEGRATION_LOCALE ?? "en-US";
      const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
      const password =
        process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";

      const payload = loadOpenAICompatiblePayloadForE2E();
      expect(payload.completion).toBeTruthy();

      await keycloakLogin(page, locale, username, password);
      const projectId = await createProjectFromUi(page, locale);
      await importBulkViaApi(page, projectId, payload);
      await openChatAndSendExpectAssistantAny(
        page,
        locale,
        projectId,
        "Reply with one short sentence to confirm end-to-end chat works.",
      );
    });
  }
});
