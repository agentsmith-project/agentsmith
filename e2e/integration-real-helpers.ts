import {
  access,
  appendFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { WebSocket } from "ws";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  evaluateAgentTaskExecutionSnapshot,
  summarizeAgentTaskActivity,
  summarizeAgentTaskPod,
  summarizeAgentTaskTraces,
} from "./agent-task-execution-outcome";
import * as managedRunnerSeedModule from "../scripts/agent-runner-seed-managed-runner-core";
import type {
  DefaultManagedRunnerSeedInput,
  DefaultManagedRunnerSeedResult,
} from "../scripts/agent-runner-seed-managed-runner-core";
import {
  ensureWorkspaceProjectCreatorAccess,
  readStoredAuthToken,
} from "./integration-workspace-access";
import { buildWorkspaceLoginLandingHref } from "@mbos/contracts/src/auth-handoff-paths";

type WorkloadPodSelectorInput = {
  taskId?: string;
  workspaceId?: string;
  projectId?: string;
  payload?: unknown;
};
type WorkloadPodSelectorResult = {
  podName: string;
  workloadId: string;
} | null;
type WorkloadPodSelectorModule = {
  sanitizeWorkloadId: (id: string) => string;
  selectManagedWorkloadPodForTask: (
    input: WorkloadPodSelectorInput,
  ) => WorkloadPodSelectorResult;
};
const workloadPodSelector = require(
  "../scripts/lib/agent-task-workload-pod-selector.cjs",
) as WorkloadPodSelectorModule;
const sanitizeAgentTaskWorkloadId = workloadPodSelector.sanitizeWorkloadId;
const selectManagedWorkloadPodForTask =
  workloadPodSelector.selectManagedWorkloadPodForTask;

type ManagedRunnerSeedFn = (
  input: DefaultManagedRunnerSeedInput,
) => Promise<DefaultManagedRunnerSeedResult>;

type ManagedRunnerSeedModuleShape = {
  upsertDeploymentDefaultManagedRunner?: ManagedRunnerSeedFn;
  default?: {
    upsertDeploymentDefaultManagedRunner?: ManagedRunnerSeedFn;
  };
};

const resolvedManagedRunnerSeedModule =
  managedRunnerSeedModule as unknown as ManagedRunnerSeedModuleShape;
const upsertDeploymentDefaultManagedRunner =
  resolvedManagedRunnerSeedModule.upsertDeploymentDefaultManagedRunner
  ?? resolvedManagedRunnerSeedModule.default?.upsertDeploymentDefaultManagedRunner;
function getUpsertDeploymentDefaultManagedRunner(): ManagedRunnerSeedFn {
  if (!upsertDeploymentDefaultManagedRunner) {
    throw new Error("managed_runner_seed_module_unavailable");
  }
  return upsertDeploymentDefaultManagedRunner;
}

export const LOCALE = process.env.INTEGRATION_LOCALE ?? "en-US";
export const API_BASE =
  process.env.INTEGRATION_API_BASE ?? "http://localhost:20000";
const DEFAULT_DEEPSEEK_OPENAI_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
export const BACKEND_REAL_MODEL =
  process.env.BACKEND_REAL_MODEL ?? "deepseek-v4-flash";
export const BACKEND_REAL_OPENAI_BASE_URL =
  process.env.BACKEND_REAL_OPENAI_BASE_URL ??
  DEFAULT_DEEPSEEK_OPENAI_BASE_URL;
export const BACKEND_REAL_ANTHROPIC_BASE_URL =
  process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ??
  DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL;
export const BACKEND_REAL_OPENAI_MODEL =
  process.env.BACKEND_REAL_OPENAI_MODEL ?? BACKEND_REAL_MODEL;
const DEFAULT_REAL_MODEL_PROFILE = {
  max_context_tokens: 204800,
  max_output_tokens: 8192,
  supports_file: false,
  supports_tool_call: true,
  supports_reasoning: false,
  price_input_per_1m: 0,
  price_output_per_1m: 0,
  cache_read_discount_ratio: 0,
  cache_write_discount_ratio: 0,
} as const;
export const DOCKER_BUILD_PROXY =
  process.env.INTEGRATION_DOCKER_BUILD_PROXY ?? "";
export const INTERNAL_AGENT_IMAGE =
  process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim() ||
  "agentsmith-agent-task-runner:local";
export const KEYCLOAK_DEV_ADMIN_USERNAME =
  process.env.INTEGRATION_KEYCLOAK_USERNAME ?? "dev-admin";
export const KEYCLOAK_DEV_ADMIN_PASSWORD =
  process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? "dev-admin-123";
export const KEYCLOAK_DEV_ADMIN_EMAIL =
  process.env.INTEGRATION_KEYCLOAK_EMAIL ?? "dev-admin@example.com";
export const KEYCLOAK_INTEGRATION_USER_USERNAME =
  process.env.INTEGRATION_USER_USERNAME ?? "integration-user";
export const KEYCLOAK_INTEGRATION_USER_PASSWORD =
  process.env.INTEGRATION_USER_PASSWORD ?? "integration-user-123";
export const KEYCLOAK_INTEGRATION_USER_EMAIL =
  process.env.INTEGRATION_USER_EMAIL ?? "integration-user@example.com";
export const KEYCLOAK_INTEGRATION_MEMBER_USERNAME =
  process.env.INTEGRATION_MEMBER_USERNAME ?? "integration-member";
export const KEYCLOAK_INTEGRATION_MEMBER_PASSWORD =
  process.env.INTEGRATION_MEMBER_PASSWORD ?? "integration-member-123";
export const KEYCLOAK_INTEGRATION_MEMBER_EMAIL =
  process.env.INTEGRATION_MEMBER_EMAIL ?? "integration-member@example.com";
export const KEYCLOAK_INTEGRATION_GUEST_USERNAME =
  process.env.INTEGRATION_GUEST_USERNAME ?? "integration-guest";
export const KEYCLOAK_INTEGRATION_GUEST_PASSWORD =
  process.env.INTEGRATION_GUEST_PASSWORD ?? "integration-guest-123";
export const KEYCLOAK_INTEGRATION_GUEST_EMAIL =
  process.env.INTEGRATION_GUEST_EMAIL ?? "integration-guest@example.com";
export const KEYCLOAK_INTEGRATION_INVITEE_USERNAME =
  process.env.INTEGRATION_INVITEE_USERNAME ?? "integration-invitee";
export const KEYCLOAK_INTEGRATION_INVITEE_PASSWORD =
  process.env.INTEGRATION_INVITEE_PASSWORD ?? "integration-invitee-123";
export const KEYCLOAK_INTEGRATION_INVITEE_EMAIL =
  process.env.INTEGRATION_INVITEE_EMAIL ?? "integration-invitee@example.com";
export const KEYCLOAK_DIRECTORY_CLIENT_ID =
  process.env.KEYCLOAK_DIRECTORY_CLIENT_ID ?? "agentsmith-directory";
export const KEYCLOAK_DIRECTORY_CLIENT_SECRET =
  process.env.KEYCLOAK_DIRECTORY_CLIENT_SECRET ?? "agentsmith-directory-secret";
export const EXTERNAL_KEYCLOAK_BASE_URL =
  process.env.EXTERNAL_KEYCLOAK_BASE_URL ?? "http://localhost:18180";
export const SYSTEM_ADMIN_USERNAME =
  process.env.SYSTEM_ADMIN_USERNAME ?? "mbos-admin";
export const SYSTEM_ADMIN_PASSWORD =
  process.env.SYSTEM_ADMIN_PASSWORD ?? "mbos-admin";
const DEFAULT_TERMINAL_SESSION_CREATE_TIMEOUT_MS = 300_000;
const DEFAULT_AGENT_TASK_CREATE_TIMEOUT_MS = 90_000;
const DEFAULT_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES = 0;
const DEFAULT_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS = 2_000;
type ChildProcessWithIgnoredStdin = ChildProcessByStdio<
  null,
  Readable,
  Readable
>;
export type SupportedChatEndpointUpstreamProtocol =
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages";

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstNonEmptyEnvValue(
  env: NodeJS.ProcessEnv,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return trimTrailingSlash(value);
    }
  }
  return null;
}

function firstNonEmptyScalarEnvValue(
  env: NodeJS.ProcessEnv,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function readNonNegativeIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function resolveTerminalSessionCreateTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env,
    "INTEGRATION_TERMINAL_SESSION_CREATE_TIMEOUT_MS",
    DEFAULT_TERMINAL_SESSION_CREATE_TIMEOUT_MS,
  );
}

export function resolveAgentTaskCreateTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env,
    "INTEGRATION_AGENT_TASK_CREATE_TIMEOUT_MS",
    DEFAULT_AGENT_TASK_CREATE_TIMEOUT_MS,
  );
}

export function resolveAgentTaskCreateStoragePendingRetries(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readNonNegativeIntegerEnv(
    env,
    "INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES",
    DEFAULT_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES,
  );
}

export function resolveAgentTaskCreateStoragePendingRetryDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env,
    "INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS",
    DEFAULT_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS,
  );
}

function isProjectStoragePendingTaskCreateResponse(
  status: number,
  bodyText: string,
): boolean {
  if (status !== 409) return false;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (typeof parsed !== "object" || parsed === null) return false;
    const record = parsed as Record<string, unknown>;
    return record.error_code === "PROJECT_STORAGE_PENDING"
      || record.message === "project_storage_pending";
  } catch {
    return false;
  }
}

type MockTaskContextServerAddress = {
  listenHost: string;
  taskContextHost: string;
};

function normalizeUrlHost(value: string): string {
  return value.trim().replace(/^\[(.*)]$/, "$1");
}

function formatHostForUrl(host: string): string {
  const normalized = normalizeUrlHost(host);
  return normalized.includes(":") && !normalized.startsWith("[")
    ? `[${normalized}]`
    : normalized;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeUrlHost(host).toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

function resolveHostValue(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
      return normalizeUrlHost(new URL(raw).hostname);
    }
  } catch {
    return null;
  }
  return normalizeUrlHost(raw);
}

function resolveMockTaskContextServerAddress(
  env: NodeJS.ProcessEnv = process.env,
): MockTaskContextServerAddress {
  const overrideHost = resolveHostValue(env.INTEGRATION_POD_HOST_GATEWAY);
  if (overrideHost) {
    return {
      listenHost: isLoopbackHost(overrideHost) ? "127.0.0.1" : "0.0.0.0",
      taskContextHost: overrideHost,
    };
  }

  const agentExecutionHost = resolveHostValue(env.AGENT_EXECUTION_WS_BASE_URL);
  if (
    agentExecutionHost &&
    !isLoopbackHost(agentExecutionHost) &&
    agentExecutionHost !== "0.0.0.0"
  ) {
    return {
      listenHost: agentExecutionHost.includes(":") ? "::" : "0.0.0.0",
      taskContextHost: agentExecutionHost,
    };
  }

  return {
    listenHost: "127.0.0.1",
    taskContextHost: "127.0.0.1",
  };
}

type ResolveIntegrationKeycloakBaseUrlOptions = {
  target?: "host" | "browser";
};

function integrationKeycloakBaseUrlKeys(
  target: ResolveIntegrationKeycloakBaseUrlOptions["target"],
): string[] {
  if (target === "browser") {
    return [
      "KEYCLOAK_BASE_URL",
      "RUNTIME_BROWSER_KEYCLOAK_BASE_URL",
      "PUBLIC_KEYCLOAK_BASE_URL",
      "RUNTIME_HOST_KEYCLOAK_BASE_URL",
      "INTERNAL_KEYCLOAK_BASE_URL",
    ];
  }

  return [
    "KEYCLOAK_BASE_URL",
    "RUNTIME_HOST_KEYCLOAK_BASE_URL",
    "RUNTIME_BROWSER_KEYCLOAK_BASE_URL",
    "PUBLIC_KEYCLOAK_BASE_URL",
    "INTERNAL_KEYCLOAK_BASE_URL",
  ];
}

export function resolveIntegrationKeycloakBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveIntegrationKeycloakBaseUrlOptions = {},
): string {
  const explicitBaseUrl = firstNonEmptyEnvValue(
    env,
    integrationKeycloakBaseUrlKeys(options.target ?? "host"),
  );
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const keycloakPort = firstNonEmptyScalarEnvValue(env, [
    "KEYCLOAK_PORT",
    "INTEGRATION_KEYCLOAK_PORT",
  ]);
  if (keycloakPort) {
    return `http://127.0.0.1:${keycloakPort}`;
  }

  throw new Error("integration_keycloak_base_url_missing");
}

async function collectChildPids(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn("pgrep", ["-P", String(pid)], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.once("error", () => resolve([]));
    child.once("close", () => {
      const pids = stdout
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
      resolve(pids);
    });
  });
}

async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  const children = await collectChildPids(pid);
  for (const childPid of children) {
    await killProcessTree(childPid, signal);
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

const PREPARED_TASK_WORKSPACE_LOG_PREFIX =
  "[agent-task-runner][debug] prepared task workspace ";

export type PreparedTaskRuntimePaths = {
  cwd: string;
  runtimeRoot: string;
  homeDir: string;
  codexDir: string;
  codexConfigPath: string;
  modelCatalogPath: string;
  mbosDir: string;
  skillsDir: string;
  artifactsDir: string;
};

function readNonEmptyString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function resolvePreparedTaskRuntimePaths(
  payload: Record<string, unknown>,
): PreparedTaskRuntimePaths | null {
  const cwd = readNonEmptyString(payload, "cwd");
  const codexConfigPath = readNonEmptyString(payload, "codex_config");
  const modelCatalogPath = readNonEmptyString(payload, "model_catalog_path");
  const skillsDirFromLog = readNonEmptyString(
    payload,
    "builtin_skills_runtime_dir",
  );
  const artifactsDir = readNonEmptyString(payload, "artifacts_dir");
  const codexDir = codexConfigPath
    ? path.dirname(codexConfigPath)
    : modelCatalogPath
      ? path.dirname(modelCatalogPath)
      : null;
  const runtimeRootFromCodex = codexDir ? path.dirname(codexDir) : null;
  const runtimeRootFromSkills = skillsDirFromLog
    ? path.dirname(path.dirname(skillsDirFromLog))
    : null;
  const runtimeRoot = runtimeRootFromCodex ?? runtimeRootFromSkills;
  if (!cwd || !runtimeRoot || !codexDir || !artifactsDir) {
    return null;
  }
  return {
    cwd,
    runtimeRoot,
    homeDir: runtimeRoot,
    codexDir,
    codexConfigPath: codexConfigPath ?? path.join(codexDir, "config.toml"),
    modelCatalogPath: modelCatalogPath ?? path.join(codexDir, "catalog.json"),
    mbosDir: path.join(runtimeRoot, ".mbos"),
    skillsDir: skillsDirFromLog ?? path.join(runtimeRoot, ".agents", "skills"),
    artifactsDir,
  };
}

export function findPreparedTaskRuntimePathsInRunnerLog(
  logText: string,
): PreparedTaskRuntimePaths | null {
  const lines = logText.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line || !line.startsWith(PREPARED_TASK_WORKSPACE_LOG_PREFIX)) {
      continue;
    }
    const payload = line.slice(PREPARED_TASK_WORKSPACE_LOG_PREFIX.length);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const runtimePaths = resolvePreparedTaskRuntimePaths(parsed);
      if (runtimePaths) {
        return runtimePaths;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function findPreparedTaskWorkspaceRootInRunnerLog(
  logText: string,
): string | null {
  const runtimePaths = findPreparedTaskRuntimePathsInRunnerLog(logText);
  if (runtimePaths) {
    return runtimePaths.cwd;
  }
  const lines = logText.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line || !line.startsWith(PREPARED_TASK_WORKSPACE_LOG_PREFIX)) {
      continue;
    }
    const payload = line.slice(PREPARED_TASK_WORKSPACE_LOG_PREFIX.length);
    try {
      const parsed = JSON.parse(payload) as { cwd?: unknown };
      if (typeof parsed.cwd === "string" && parsed.cwd.trim().length > 0) {
        return parsed.cwd;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function readPreparedTaskWorkspaceRootFromRunnerLog(
  logPath: string,
): Promise<string | null> {
  try {
    const logText = await readFile(logPath, "utf8");
    return findPreparedTaskWorkspaceRootInRunnerLog(logText);
  } catch {
    return null;
  }
}

export async function readPreparedTaskRuntimePathsFromRunnerLog(
  logPath: string,
): Promise<PreparedTaskRuntimePaths | null> {
  try {
    const logText = await readFile(logPath, "utf8");
    return findPreparedTaskRuntimePathsInRunnerLog(logText);
  } catch {
    return null;
  }
}

function rewritePathPrefix(
  value: string,
  fromPrefix: string,
  toPrefix: string,
): string {
  const normalizedFrom = fromPrefix.replace(/\/+$/, "");
  if (value === normalizedFrom) return toPrefix;
  if (!value.startsWith(`${normalizedFrom}/`)) return value;
  return path.join(toPrefix, value.slice(normalizedFrom.length + 1));
}

function rewritePreparedTaskRuntimePathsPrefix(
  paths: PreparedTaskRuntimePaths,
  fromPrefix: string,
  toPrefix: string,
): PreparedTaskRuntimePaths {
  return {
    cwd: rewritePathPrefix(paths.cwd, fromPrefix, toPrefix),
    runtimeRoot: rewritePathPrefix(paths.runtimeRoot, fromPrefix, toPrefix),
    homeDir: rewritePathPrefix(paths.homeDir, fromPrefix, toPrefix),
    codexDir: rewritePathPrefix(paths.codexDir, fromPrefix, toPrefix),
    codexConfigPath: rewritePathPrefix(
      paths.codexConfigPath,
      fromPrefix,
      toPrefix,
    ),
    modelCatalogPath: rewritePathPrefix(
      paths.modelCatalogPath,
      fromPrefix,
      toPrefix,
    ),
    mbosDir: rewritePathPrefix(paths.mbosDir, fromPrefix, toPrefix),
    skillsDir: rewritePathPrefix(paths.skillsDir, fromPrefix, toPrefix),
    artifactsDir: rewritePathPrefix(paths.artifactsDir, fromPrefix, toPrefix),
  };
}

export type SpawnAndCaptureOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  timeoutLabel?: string;
  killGraceMs?: number;
};

export async function spawnAndCapture(
  command: string,
  args: string[],
  options?: SpawnAndCaptureOptions,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const finish = (result: {
      code: number;
      stdout: string;
      stderr: string;
    }) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        const label = options.timeoutLabel?.trim() || command;
        const separator = stderr.length > 0 && !stderr.endsWith("\n") ? "\n" : "";
        stderr += `${separator}spawn_timeout:${label}:timeout_ms=${options.timeoutMs}\n`;
        proc.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          proc.kill("SIGKILL");
          finish({
            code: 124,
            stdout,
            stderr,
          });
        }, options.killGraceMs ?? 1_000);
      }, options.timeoutMs);
    }
    proc.once("error", fail);
    proc.once("close", (code) => {
      finish({
        code: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function ensureIntegrationKeycloakUsers(): Promise<void> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await spawnAndCapture(
      "node_modules/.bin/tsx",
      ["scripts/integration-keycloak-init.ts"],
      { env: process.env },
    );
    if (result.code === 0) {
      return;
    }
    lastError = result.stderr || result.stdout;
    if (!lastError.includes("keycloak_update_realm_failed") || attempt === 2) {
      throw new Error(`integration_keycloak_init_failed:${lastError}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`integration_keycloak_init_failed:${lastError}`);
}

function withoutProxyEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...(baseEnv ?? process.env) };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
  delete env.NO_PROXY;
  delete env.no_proxy;
  return env;
}

async function clearAppState(page: Page, workspaceId: string): Promise<void> {
  await page.context().clearCookies();
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () =>
          document.readyState === "interactive" ||
          document.readyState === "complete",
      );
      if (page.url() === "about:blank") {
        throw new Error("blank_navigation");
      }
      const bodyText = await page
        .locator("body")
        .textContent()
        .catch(() => "");
      if ((bodyText ?? "").trim().length === 0) {
        throw new Error("empty_document");
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        message.includes("ERR_ABORTED") ||
        message.includes("ERR_CONNECTION_REFUSED") ||
        message.includes("ERR_CONNECTION_RESET") ||
        message.includes("ERR_FAILED") ||
        message.includes("blank_navigation") ||
        message.includes("empty_document");
      if (!retryable || attempt === 4) {
        throw error;
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
}

export async function keycloakLoginToWorkspace(
  page: Page,
  workspaceId: string,
  username = KEYCLOAK_DEV_ADMIN_USERNAME,
  password = KEYCLOAK_DEV_ADMIN_PASSWORD,
  options?: {
    ensureProjectCreatorAccess?: boolean;
    projectId?: string;
    preserveCurrentWorkspaceLoginPage?: boolean;
  },
): Promise<void> {
  const landingHref = buildWorkspaceLoginLandingHref(
    LOCALE,
    workspaceId,
    options?.projectId || null,
  );
  if (!options?.preserveCurrentWorkspaceLoginPage) {
    await clearAppState(page, workspaceId);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!options?.preserveCurrentWorkspaceLoginPage) {
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
    } else {
      await page.waitForURL(
        (url) => {
          const parsed = new URL(url.toString());
          return (
            parsed.pathname === `/${LOCALE}/workspaces/${workspaceId}/login`
          );
        },
        { timeout: 30_000 },
      );
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

    let enteredKeycloakForm = false;
    for (let tick = 0; tick < 60; tick += 1) {
      const currentUrl = page.url();
      if (
        /\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i.test(
          currentUrl,
        )
      ) {
        enteredKeycloakForm = true;
        break;
      }
      if (
        currentUrl.includes(landingHref) ||
        new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login/callback`).test(
          currentUrl,
        )
      ) {
        break;
      }
      if (
        new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/settings)`).test(
          currentUrl,
        )
      ) {
        break;
      }
      await page.waitForTimeout(500);
    }

    if (enteredKeycloakForm) {
      await page
        .locator('input#username, input[name="username"], input[name="email"]')
        .first()
        .fill(username);
      await page
        .locator('input#password, input[name="password"]')
        .first()
        .fill(password);
      await page.locator('#kc-login, button[type="submit"]').first().click();
    }

    let reachedWorkspace = false;
    let callbackError = false;
    for (let tick = 0; tick < 120; tick += 1) {
      const currentUrl = page.url();
      if (currentUrl.includes(landingHref)) {
        reachedWorkspace = true;
        break;
      }
      if (
        new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login/callback`).test(
          currentUrl,
        )
      ) {
        const errorNode = page.getByTestId("workspace-login-callback__error");
        if (await errorNode.isVisible({ timeout: 300 }).catch(() => false)) {
          callbackError = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    if (reachedWorkspace) {
      const token = await readStoredAuthToken(page);
      if (options?.ensureProjectCreatorAccess !== false) {
        await ensureWorkspaceProjectCreatorAccess({
          page,
          apiBase: API_BASE,
          token: String(token),
          username,
        });
      }
      await gotoWithRetry(page, landingHref);
      await page.waitForURL(
        (url) => {
          const currentHref = `${url.pathname}${url.search}`;
          return (
            currentHref === landingHref ||
            currentHref.startsWith(`${landingHref}?`)
          );
        },
        { timeout: 30_000 },
      );
      return;
    }

    if (callbackError && attempt < 2) {
      await clearAppState(page, workspaceId);
      continue;
    }

    throw new Error(`workspace_login_failed:${workspaceId}:${username}`);
  }

  throw new Error(`workspace_login_retry_exhausted:${workspaceId}:${username}`);
}

export async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.context().clearCookies();
  await gotoWithRetry(page, `/${LOCALE}/system/login`);
  await expect(page.getByTestId("system-login__heading")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("system-login__username").fill(SYSTEM_ADMIN_USERNAME);
  await page.getByTestId("system-login__password").fill(SYSTEM_ADMIN_PASSWORD);

  let loginResponseOk = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes("/api/system/session") &&
          response.request().method() === "POST",
        { timeout: 5_000 },
      )
      .catch(() => null);
    await page.getByTestId("system-login__submit").click();
    const response = await responsePromise;
    if (response) {
      loginResponseOk = response.ok();
      break;
    }
    await page.waitForTimeout(1_000);
  }

  expect(loginResponseOk).toBe(true);
  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
  await expect(
    page.getByTestId("system-workspaces__new-workspace"),
  ).toBeVisible({ timeout: 30_000 });
}

async function resolveWorkspaceIdByName(
  page: Page,
  workspaceName: string,
): Promise<string> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (name) => {
          const response = await fetch("/api/system/workspaces", {
            cache: "no-store",
          });
          const payload = (await response.json()) as {
            items?: Array<{ id: string; name: string }>;
          };
          return payload.items?.find((item) => item.name === name)?.id ?? null;
        }, workspaceName),
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const resolved = await page.evaluate(async (name) => {
    const response = await fetch("/api/system/workspaces", {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      items?: Array<{ id: string; name: string }>;
    };
    return payload.items?.find((item) => item.name === name)?.id ?? null;
  }, workspaceName);

  if (!resolved) {
    throw new Error("workspace_id_not_found");
  }
  return resolved;
}

export async function createAndPublishWorkspaceWithDirectoryAdmin(args: {
  page: Page;
  workspaceName: string;
  keycloakBaseUrl?: string;
  keycloakRealm?: string;
  loginClientId?: string;
  directoryClientId?: string;
  directoryClientSecret?: string;
  adminEmail?: string;
}): Promise<string> {
  const keycloakBaseUrl =
    args.keycloakBaseUrl ??
    resolveIntegrationKeycloakBaseUrl(process.env, { target: "browser" });
  const keycloakRealm =
    args.keycloakRealm ?? process.env.KEYCLOAK_REALM ?? "mbos";
  const loginClientId =
    args.loginClientId ?? process.env.KEYCLOAK_CLIENT_ID ?? "agentsmith";
  const directoryClientId =
    args.directoryClientId ?? KEYCLOAK_DIRECTORY_CLIENT_ID;
  const directoryClientSecret =
    args.directoryClientSecret ?? KEYCLOAK_DIRECTORY_CLIENT_SECRET;
  const adminEmail = args.adminEmail ?? "dev-admin@example.com";

  await args.page.getByTestId("system-workspaces__new-workspace").click();
  await args.page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), {
    timeout: 30_000,
  });
  await expect(
    args.page.getByTestId("system-workspace-create__shell"),
  ).toBeVisible({ timeout: 30_000 });
  await args.page
    .getByTestId("system-workspaces__draft-name")
    .fill(args.workspaceName);
  await args.page.getByTestId("system-workspace-create__next").click();

  await args.page
    .getByTestId("system-workspaces__draft-idp-url")
    .fill(keycloakBaseUrl);
  await args.page
    .getByTestId("system-workspaces__draft-idp-realm")
    .fill(keycloakRealm);
  await args.page
    .getByTestId("system-workspaces__draft-idp-client-id")
    .fill(loginClientId);
  await args.page
    .getByTestId("system-workspaces__draft-directory-client-id")
    .fill(directoryClientId);
  await args.page
    .getByTestId("system-workspaces__draft-idp-client-secret")
    .fill(directoryClientSecret);

  const verifyResponse = args.page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/system/workspaces/idp/verify") &&
      candidate.request().method() === "POST",
    { timeout: 20_000 },
  );
  await args.page.getByTestId("system-workspace-create__next").click();
  expect((await verifyResponse).ok()).toBeTruthy();
  await expect(
    args.page.getByTestId("system-workspaces__draft-admin"),
  ).toBeVisible({ timeout: 20_000 });

  await args.page
    .getByTestId("system-workspaces__admin-mode--directory")
    .click();
  await selectWorkspaceAdminFromDirectory(args.page, adminEmail);

  await args.page.getByTestId("system-workspace-create__next").click();
  await args.page.getByTestId("system-workspace-create__create").click();

  const workspaceId = await resolveWorkspaceIdByName(
    args.page,
    args.workspaceName,
  );
  await args.page
    .getByTestId(`system-workspaces__configure--${workspaceId}`)
    .click();
  await args.page.getByTestId("system-workspaces__publish").click();
  await expect
    .poll(
      async () =>
        args.page.evaluate(async (id) => {
          const response = await fetch("/api/system/workspaces", {
            cache: "no-store",
          });
          const payload = (await response.json()) as {
            items?: Array<{
              id: string;
              provisioning_status: string;
              last_init_error?: string | null;
            }>;
          };
          const item = payload.items?.find((candidate) => candidate.id === id);
          return item
            ? `${item.provisioning_status}:${item.last_init_error ?? ""}`
            : "missing";
        }, workspaceId),
      { timeout: 40_000 },
    )
    .toMatch(/^ready:/);

  return workspaceId;
}

export async function selectWorkspaceAdminFromDirectory(
  page: Page,
  email: string,
): Promise<void> {
  const adminInput = page.getByTestId("system-workspaces__draft-admin");
  await expect(adminInput).toBeVisible({ timeout: 15_000 });
  let lastFailure = "directory_request_not_observed";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (candidate) =>
          candidate.url().includes("/api/system/workspaces/directory/users") &&
          candidate.request().method() === "POST",
        { timeout: 15_000 },
      )
      .catch(() => null);
    await adminInput.fill("");
    await adminInput.fill(email);
    const response = await responsePromise;
    if (!response) {
      lastFailure = "directory_request_timeout";
      continue;
    }

    const payload = (await response.json().catch(() => null)) as
      | { items?: Array<{ user_id?: string; email?: string }> }
      | { error_message?: string }
      | null;
    if (!response.ok()) {
      lastFailure = `directory_response_${response.status()}`;
      continue;
    }

    const items =
      payload && "items" in payload && Array.isArray(payload.items)
        ? payload.items
        : [];
    const matchedUser = items.find((item) => item.email === email) ?? null;
    const userId =
      typeof matchedUser?.user_id === "string" ? matchedUser.user_id : "";
    if (!userId) {
      lastFailure = "directory_user_missing";
      continue;
    }

    const adminOption = page.getByTestId(
      `system-workspaces__admin-option--${userId}`,
    );
    await expect(adminOption).toBeVisible({ timeout: 15_000 });
    await adminOption.click();
    await expect(
      page.getByTestId("system-workspaces__selected-admin"),
    ).toContainText(email);
    return;
  }

  throw new Error(
    `workspace_admin_directory_user_missing:${email}:${lastFailure}`,
  );
}

export async function ensureWorkspaceProjectCreatorViaUi(args: {
  page: Page;
  workspaceId: string;
  creatorEmail: string;
}): Promise<void> {
  await gotoWithRetry(
    args.page,
    `/${LOCALE}/workspaces/${args.workspaceId}/settings`,
  );
  await expect(
    args.page.getByTestId("ws-settings__project-creators"),
  ).toBeVisible({ timeout: 30_000 });
  const input = args.page.getByTestId("ws-settings__project-creators-input");
  await input.fill(args.creatorEmail);
  const option = args.page
    .getByTestId("ws-settings__project-creators-results")
    .getByRole("button", {
      name: new RegExp(args.creatorEmail.replace(".", "\\.")),
    });
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  await args.page.getByTestId("ws-settings__project-creators-save").click();
  await expect(
    args.page.getByTestId("ws-settings__project-creators-selected"),
  ).toContainText(args.creatorEmail, { timeout: 20_000 });
}

export async function ensureExternalTestKeycloak(): Promise<void> {
  const result = await spawnAndCapture(
    "bash",
    ["scripts/external-keycloak-test.sh", "up"],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `external_keycloak_up_failed:${result.stderr || result.stdout}`,
    );
  }
}

export async function teardownExternalTestKeycloak(): Promise<void> {
  await spawnAndCapture("bash", ["scripts/external-keycloak-test.sh", "down"], {
    cwd: process.cwd(),
    env: process.env,
  });
}

export type CreateProjectInWorkspaceOptions = {
  visibility?: "public" | "private";
  joinPolicy?: "approval_required" | "open";
};

export function buildCreateProjectRequestBody(
  projectName: string,
  options?: CreateProjectInWorkspaceOptions,
): {
  name: string;
  visibility: "public" | "private";
  join_policy: "approval_required" | "open";
} {
  return {
    name: projectName,
    visibility: options?.visibility ?? "private",
    join_policy: options?.joinPolicy ?? "approval_required",
  };
}

export async function createProjectInWorkspace(
  page: Page,
  workspaceId: string,
  prefix = "Real Integration Project",
  options?: CreateProjectInWorkspaceOptions,
): Promise<{ projectId: string; projectName: string }> {
  const projectName = `${prefix} ${Date.now()}`;
  const token = await readStoredAuthToken(page);
  let response: Awaited<ReturnType<Page["request"]["post"]>> | null = null;
  let lastErrorText = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        data: buildCreateProjectRequestBody(projectName, options),
      },
    );
    if (response.ok()) {
      break;
    }
    lastErrorText = await response.text();
    const retryablePermissionMiss = response.status() === 403;
    const retryableConnectionReset =
      response.status() === 400 && lastErrorText.includes("read ECONNRESET");
    if (
      (!retryablePermissionMiss && !retryableConnectionReset) ||
      attempt === 2
    ) {
      throw new Error(
        `create_project_failed:${response.status()}:${lastErrorText}`,
      );
    }
    await page.waitForTimeout(1_000 * (attempt + 1));
  }
  expect(response?.ok()).toBeTruthy();
  const created = (await response!.json()) as { id?: string };
  const projectId = created.id?.trim();
  if (!projectId) {
    throw new Error("project_id_not_found_after_create");
  }
  await gotoWithRetry(
    page,
    `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`,
  );
  await expect(page).toHaveURL(
    new RegExp(
      `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview(?:$|\\?)`,
    ),
    {
      timeout: 30_000,
    },
  );
  return { projectId, projectName };
}

export async function putContextEntryViaApi(args: {
  page: Page;
  scope: "member" | "task" | "project" | "workspace";
  key: string;
  content: string;
  contentType?: "text" | "json" | "markdown" | "yaml";
  workspaceId: string;
  projectId?: string;
  taskId?: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.put(`${API_BASE}/api/v1/context`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      scope: args.scope,
      key: args.key,
      content: args.content,
      content_type: args.contentType ?? "text",
      workspace_id: args.workspaceId,
      project_id: args.projectId,
      task_id: args.taskId,
    },
  });
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`put_context_failed:${response.status()}:${body}`);
  }
}

export async function getContextEntryViaApi(args: {
  page: Page;
  scope: "member" | "task" | "project" | "workspace";
  key: string;
  workspaceId: string;
  projectId?: string;
  taskId?: string;
  expectedStatus?: number;
}): Promise<{ status: number; body: unknown }> {
  const token = await readStoredAuthToken(args.page);
  const params = new URLSearchParams({
    scope: args.scope,
    key: args.key,
    workspace_id: args.workspaceId,
  });
  if (args.projectId) params.set("project_id", args.projectId);
  if (args.taskId) params.set("task_id", args.taskId);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/context?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const status = response.status();
  const body = await response
    .json()
    .catch(async () => response.text().catch(() => null));
  if (args.expectedStatus !== undefined) {
    expect(status).toBe(args.expectedStatus);
  } else {
    expect(response.ok()).toBeTruthy();
  }
  return { status, body };
}

export async function createCredentialViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  credentialName: string,
  credentialValue: string,
): Promise<string> {
  await page.goto(
    `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/credentials`,
  );
  await expect(page.getByTestId("credentials__create-btn")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("credentials__create-btn").click();
  const dialog = page.getByTestId("credentials__create-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#cred-name").fill(credentialName);
  await dialog.locator("#cred-value").fill(credentialValue);
  const createResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      new RegExp(
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials$`,
      ).test(res.url()),
  );
  await dialog.getByRole("button", { name: /create|创建/i }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
  } | null;
  const credentialId = payload?.id ?? payload?.data?.id;
  expect(credentialId).toBeTruthy();
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
  return credentialId!;
}

export async function createExternalConnectionViaApi(args: {
  request: APIRequestContext;
  token: string;
  provider: "jira" | "feishu" | "github" | "gitee" | "custom";
  kind: "oauth_account" | "secret_bundle" | "ssh_keypair";
  displayName: string;
  fields: Array<{
    key: string;
    value: string;
    secret?: boolean;
    description?: string | null;
  }>;
  note?: string;
  status?: "active" | "expired" | "reauth_required" | "error";
  scopes?: string[];
}): Promise<string> {
  const token = args.token.trim();
  if (!token) {
    throw new Error("auth_token_not_found_for_external_connection_seed");
  }
  const response = await args.request.post(
    `${API_BASE}/api/v1/me/external-connections`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        provider: args.provider,
        kind: args.kind,
        display_name: args.displayName,
        note: args.note ?? null,
        status: args.status ?? "active",
        fields: args.fields.map((field) => ({
          key: field.key,
          value: field.value,
          secret: field.secret !== false,
          description: field.description ?? null,
        })),
        scopes: args.scopes ?? null,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `create_external_connection_failed:${response.status()}:${body}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  const connectionId = payload?.id?.trim();
  if (!connectionId) {
    throw new Error("external_connection_id_not_found");
  }
  return connectionId;
}

export async function startMockJiraServer(args: {
  displayName: string;
  expectedToken: string;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${args.expectedToken}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.method === "GET" && req.url === "/rest/api/2/myself") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          self: "mock",
          displayName: args.displayName,
          emailAddress: `${args.displayName.replace(/\s+/g, ".").toLowerCase()}@example.com`,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: "not_found",
        method: req.method,
        path: req.url ?? "",
      }),
    );
  });

  const addressPlan = resolveMockTaskContextServerAddress();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, addressPlan.listenHost, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock_jira_server_address_unavailable");
  }

  return {
    baseUrl: `http://${formatHostForUrl(addressPlan.taskContextHost)}:${address.port}`,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

export async function startMockFeishuMcpServer(args: {
  expectedToken: string;
  toolName: string;
}): Promise<{
  endpoint: string;
  stop: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const auth = req.headers["x-lark-mcp-uat"];
      if (auth !== args.expectedToken) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      const payload = raw
        ? (JSON.parse(raw) as { id?: number | string | null; method?: string })
        : {};
      const id = payload.id ?? 1;
      if (payload.method === "initialize") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              serverInfo: { name: "mock-feishu-mcp", version: "1.0.0" },
            },
          }),
        );
        return;
      }
      if (payload.method === "tools/list") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              tools: [
                {
                  name: args.toolName,
                  description: "Mock Feishu MCP tool",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "method not found" },
        }),
      );
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: String(error) }));
    });
  });

  const addressPlan = resolveMockTaskContextServerAddress();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, addressPlan.listenHost, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock_feishu_server_address_unavailable");
  }

  return {
    endpoint: `http://${formatHostForUrl(addressPlan.taskContextHost)}:${address.port}/mcp`,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

export async function createEndpointViaApi(
  page: Page,
  workspaceId: string,
  projectId: string,
  args: {
    endpointName: string;
    endpointModel: string;
    upstreamBaseUrl: string;
    credentialName: string;
    capability?: "chat_completion" | "multimodal_completion";
    endpointType?: "catalog" | "custom";
    providerFamily?:
      | "openai"
      | "anthropic"
      | "deepseek"
      | "minimax"
      | "kimi"
      | "google"
      | "glm"
      | "alibaba"
      | "custom";
    upstreamProtocol?: SupportedChatEndpointUpstreamProtocol;
    modelProfile?: {
      max_context_tokens: number;
      max_output_tokens?: number;
      supports_file?: boolean;
      supports_tool_call?: boolean;
      supports_reasoning?: boolean;
      price_input_per_1m?: number;
      price_output_per_1m?: number;
      cache_read_discount_ratio?: number;
      cache_write_discount_ratio?: number;
    };
  },
): Promise<string> {
  const token = await readStoredAuthToken(page);
  const capability = args.capability ?? "chat_completion";
  const modelProfile = {
    ...DEFAULT_REAL_MODEL_PROFILE,
    ...(args.modelProfile ?? {}),
  };
  const normalizedBaseUrl = args.upstreamBaseUrl.trim().toLowerCase();
  const upstreamProtocol =
    args.upstreamProtocol ??
    (normalizedBaseUrl.includes("/anthropic") ||
    normalizedBaseUrl.includes("api.anthropic.com")
      ? "anthropic_messages"
      : "openai_chat_completions");
  const endpointType = args.endpointType ?? "custom";
  const providerFamily =
    args.providerFamily ??
    (endpointType === "custom"
      ? "custom"
      : upstreamProtocol === "anthropic_messages"
        ? "anthropic"
        : "openai");
  const credentialsRes = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(credentialsRes.ok()).toBeTruthy();
  const credentialsJson = (await credentialsRes.json().catch(() => null)) as {
    items?: Array<{ id?: string; name?: string }>;
  } | null;
  const credential = credentialsJson?.items?.find(
    (item) => item.name === args.credentialName,
  );
  expect(credential?.id).toBeTruthy();

  const defaults =
    capability === "multimodal_completion"
      ? { multimodal_model_id: args.endpointModel }
      : { chat_model_id: args.endpointModel };

  const endpointRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        name: args.endpointName,
        model: args.endpointModel,
        type: endpointType,
        base_url: args.upstreamBaseUrl,
        credential_ref: credential!.id,
        provider_family: providerFamily,
        upstream_protocol: upstreamProtocol,
        capabilities: [
          {
            type: capability,
            enabled: true,
            default_model_id: args.endpointModel,
          },
        ],
        models: [
          {
            capability,
            model_id: args.endpointModel,
            display_name: args.endpointModel,
          },
        ],
        defaults,
        model_profile: {
          max_context_tokens: modelProfile.max_context_tokens,
          max_output_tokens: modelProfile.max_output_tokens,
          supports_file: modelProfile.supports_file,
          supports_tool_call: modelProfile.supports_tool_call,
          supports_reasoning: modelProfile.supports_reasoning,
          price_input_per_1m: modelProfile.price_input_per_1m,
          price_output_per_1m: modelProfile.price_output_per_1m,
          cache_read_discount_ratio: modelProfile.cache_read_discount_ratio,
          cache_write_discount_ratio: modelProfile.cache_write_discount_ratio,
        },
      },
    },
  );
  expect(endpointRes.ok()).toBeTruthy();
  const endpointJson = (await endpointRes.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
  } | null;
  const endpointId = endpointJson?.id ?? endpointJson?.data?.id;
  expect(endpointId).toBeTruthy();
  return endpointId!;
}

type AgentTaskModelSettingApiPayload = {
  readiness?: {
    state?: string;
  };
  setting?: {
    endpoint_id?: string;
    default_model?: string;
    default_model_id?: string;
    setting_revision?: string;
  };
};

export async function ensureAgentTaskModelSettingViaApi(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
  },
): Promise<{
  endpointId: string;
  defaultModel: string | null;
  settingRevision: string;
  updated: boolean;
}> {
  const endpointId = args.endpointId.trim();
  if (!endpointId) {
    throw new Error("agent_task_model_setting_endpoint_id_required");
  }
  const token = await readStoredAuthToken(page);
  const url = `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agent-task-model-setting`;
  const currentResponse = await page.request.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!currentResponse.ok()) {
    const body = await currentResponse.text().catch(() => "");
    throw new Error(`read_agent_task_model_setting_failed:${currentResponse.status()}:${body}`);
  }

  const current = (await currentResponse.json().catch(() => null)) as AgentTaskModelSettingApiPayload | null;
  const currentSetting = current?.setting;
  const currentEndpointId = currentSetting?.endpoint_id?.trim() || "";
  const currentRevision = currentSetting?.setting_revision?.trim() || null;
  if (currentEndpointId === endpointId && current?.readiness?.state === "ready" && currentRevision) {
    return {
      endpointId,
      defaultModel: currentSetting?.default_model?.trim()
        || currentSetting?.default_model_id?.trim()
        || null,
      settingRevision: currentRevision,
      updated: false,
    };
  }

  const patchResponse = await page.request.patch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      endpoint_id: endpointId,
      expected_setting_revision: currentRevision,
    },
  });
  if (!patchResponse.ok()) {
    const body = await patchResponse.text().catch(() => "");
    throw new Error(`patch_agent_task_model_setting_failed:${patchResponse.status()}:${body}`);
  }
  const patched = (await patchResponse.json().catch(() => null)) as AgentTaskModelSettingApiPayload | null;
  const patchedSetting = patched?.setting;
  const patchedRevision = patchedSetting?.setting_revision?.trim();
  if (!patchedRevision) {
    throw new Error("patch_agent_task_model_setting_missing_revision");
  }
  return {
    endpointId: patchedSetting?.endpoint_id?.trim() || endpointId,
    defaultModel: patchedSetting?.default_model?.trim()
      || patchedSetting?.default_model_id?.trim()
      || null,
    settingRevision: patchedRevision,
    updated: true,
  };
}

export async function createAgentTaskRunnerBundleViaApi(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    runnerTitle: string;
    taskTitle: string;
    workspaceName?: string;
    inputRefs?: Array<Record<string, unknown>>;
  },
): Promise<{ runnerId: string; runnerName: string; taskId: string }> {
  const runner = await createManagedAgentRunnerViaApi(page, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    endpointId: args.endpointId,
    title: args.runnerTitle,
  });
  const taskId = await createAgentTaskViaApi({
    page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    title: args.taskTitle,
    workspaceName: args.workspaceName,
    inputRefs: args.inputRefs,
  });
  return {
    runnerId: runner.runnerId,
    runnerName: runner.runnerName,
    taskId,
  };
}

type AgentRunnerCapabilitiesInput = Record<string, unknown> & {
  streaming_completion?: boolean;
  multimodal_completion?: boolean;
  terminal?: boolean;
  artifacts?: boolean;
  file_inputs?: boolean;
  url_inputs?: boolean;
  task_execution?: boolean;
  accepted_mime_types?: string[];
  max_file_count?: number;
  max_total_bytes?: number;
};

type ManagedAgentRunnerApiPayload = {
  id?: string;
  name?: string;
  kind?: string;
  runner_provider?: string;
  provider?: string;
  managed?: boolean | string;
  status?: string;
  runner_status?: string;
  is_default?: boolean;
  default_endpoint_id?: string;
  project_id?: string;
  capabilities?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

type RunnerIdSource = {
  runnerId: string;
  runnerName: string;
  status: string;
  isDefault: boolean;
  defaultEndpointId: string | null;
  configuredImage: string | null;
  capabilities: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

function parseSimpleEnvFile(raw: string): Record<string, string> {
  return raw
    .split(/\r?\n/)
    .reduce<Record<string, string>>((result, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return result;
      const equalsAt = trimmed.indexOf("=");
      if (equalsAt < 0) return result;
      const key = trimmed.slice(0, equalsAt).trim();
      const value = trimmed.slice(equalsAt + 1).trim();
      if (key) result[key] = value;
      return result;
    }, {});
}

function unquoteSimpleEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner
        .replaceAll('\\"', '"')
        .replaceAll("\\\\", "\\")
      : inner.replaceAll("\\'", "'").replaceAll("\\\\", "\\");
  }
  return trimmed;
}

function readNestedString(state: unknown, path: readonly string[]): string | undefined {
  let value: unknown = state;
  for (const segment of path) {
    if (!segment || typeof value !== 'object' || value === null) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : undefined;
}

function readNestedBooleanOrString(
  state: unknown,
  path: readonly string[],
): boolean | string | undefined {
  let value: unknown = state;
  for (const segment of path) {
    if (!segment || typeof value !== 'object' || value === null) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'boolean' || typeof value === 'string'
    ? value
    : undefined;
}

function readSimpleEnvValue(raw: string, key: string): string | null {
  const entries = parseSimpleEnvFile(raw);
  const value = entries[key];
  if (!value) return null;
  const unquoted = unquoteSimpleEnvValue(value);
  return unquoted || null;
}

function normalizeRunnerProvider(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function isExplicitNonManagedRunnerProvider(value: string | null | undefined): boolean {
  const provider = normalizeRunnerProvider(value);
  return provider === "developer" || provider === "developer_runner" || provider === "external";
}

function isExplicitManagedRunnerProvider(value: string | null | undefined): boolean {
  const provider = normalizeRunnerProvider(value);
  return provider === "managed" || provider === "managed_agent_task" || provider === "internal";
}

function isExplicitFalse(value: boolean | string | undefined): boolean {
  if (value === false) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "false";
}

function isExplicitTrue(value: boolean | string | undefined): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function dedupeStable(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function hasExplicitBackendRealRuntimeSource(): boolean {
  return Boolean(firstNonEmptyScalarEnvValue(process.env, [
    "BACKEND_REAL_STATE_FILE",
    "BACKEND_REAL_STATE",
    "BACKEND_REAL_SUMMARY_FILE",
    "BACKEND_REAL_STATE_DIR",
  ]));
}

async function pickBackendRealRuntimeRootFromInternalSandboxStateFile(): Promise<string | null> {
  const internalSandboxStateFile = firstNonEmptyScalarEnvValue(process.env, [
    "INTERNAL_SANDBOX_REAL_STATE_FILE",
  ]);
  if (!internalSandboxStateFile) return null;

  const raw = await readFile(internalSandboxStateFile, "utf8").catch(() => null);
  if (!raw) return null;

  const rootDir = readSimpleEnvValue(raw, "ROOT_DIR");
  if (!rootDir) return null;
  return path.resolve(rootDir, "artifacts", "backend-real", "current");
}

function pickFirstBackendRealStatePath(options: {
  includeAmbientDefault: boolean;
  includeInternalSandboxStateFile: boolean;
}): string[] {
  const candidates: string[] = [];
  const backendRealStateFile = firstNonEmptyScalarEnvValue(process.env, [
    "BACKEND_REAL_STATE_FILE",
    "BACKEND_REAL_STATE",
  ]);
  if (backendRealStateFile) {
    candidates.push(backendRealStateFile);
  }
  const backendRealStateDir = firstNonEmptyScalarEnvValue(process.env, [
    "BACKEND_REAL_STATE_DIR",
  ]);
  if (backendRealStateDir) {
    candidates.push(path.resolve(backendRealStateDir, 'state.json'));
  }

  if (options.includeInternalSandboxStateFile) {
    const internalSandboxStateFile = firstNonEmptyScalarEnvValue(process.env, [
      "INTERNAL_SANDBOX_REAL_STATE_FILE",
    ]);
    if (internalSandboxStateFile) {
      const internalBase = path.resolve(internalSandboxStateFile);
      candidates.push(path.resolve(path.dirname(internalBase), '..', '..', 'state.json'));
    }
  }

  if (options.includeAmbientDefault) {
    candidates.push(
      path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'state.json'),
    );
  }
  return dedupeStable(candidates);
}

function pickFirstBackendRealSummaryPath(options: {
  includeAmbientDefault: boolean;
}): string[] {
  const candidates: string[] = [];
  const backendRealSummaryFile = firstNonEmptyScalarEnvValue(process.env, [
    "BACKEND_REAL_SUMMARY_FILE",
  ]);
  if (backendRealSummaryFile) {
    candidates.push(backendRealSummaryFile);
  }
  const backendRealStateDir = firstNonEmptyScalarEnvValue(process.env, [
    "BACKEND_REAL_STATE_DIR",
  ]);
  if (backendRealStateDir) {
    candidates.push(path.resolve(backendRealStateDir, 'summary.env'));
  }

  if (options.includeAmbientDefault) {
    candidates.push(
      path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'summary.env'),
    );
  }
  return dedupeStable(candidates);
}

function normalizeManagedRunnerResult(
  payload: ManagedAgentRunnerApiPayload,
  fallbackName: string,
  _fallbackEndpointId: string | null,
  fallbackStatus?: string,
): RunnerIdSource {
  return {
    runnerId: payload.id ?? "",
    runnerName: payload.name?.trim() || fallbackName || "Managed Runner",
    status: payload.runner_status?.trim()
      || payload.status?.trim()
      || fallbackStatus
      || "ready",
    isDefault: payload.is_default === true || payload.kind === "system_managed",
    defaultEndpointId: payload.default_endpoint_id?.trim() || null,
    configuredImage: null,
    capabilities: payload.capabilities ?? {},
    diagnostics: payload.diagnostics ?? {},
  };
}

function readProviderAwareSummaryManagedRunnerId(summaryRaw: string): string | null {
  const summaryRunnerProvider = readSimpleEnvValue(summaryRaw, "AGENT_RUNNER_PROVIDER");
  const genericRunnerId = readSimpleEnvValue(summaryRaw, "AGENT_RUNNER_ID");
  if (genericRunnerId && !isExplicitNonManagedRunnerProvider(summaryRunnerProvider)) {
    return genericRunnerId;
  }
  return readSimpleEnvValue(summaryRaw, "SYSTEM_SIDE_MANAGED_RUNNER_ID")
    || readSimpleEnvValue(summaryRaw, "DEPLOYMENT_MANAGED_RUNNER_ID")
    || readSimpleEnvValue(summaryRaw, "SYSTEM_DEFAULT_MANAGED_RUNNER_ID");
}

function readProviderAwareStateManagedRunnerId(state: unknown): string | null {
  const agentRunnerProvider =
    readNestedString(state, ["agent_runner", "runner_provider"])
    || readNestedString(state, ["agent_runner", "provider"]);
  const agentRunnerManaged = readNestedBooleanOrString(state, ["agent_runner", "managed"]);
  const genericRunnerId =
    readNestedString(state, ["agent_runner", "id"])
    || readNestedString(state, ["project", "agent_runner_id"])
    || readNestedString(state, ["agent_runner_id"])
    || readNestedString(state, ["system", "agent_runner", "id"])
    || readNestedString(state, ["system", "agent_runner_id"])
    || readNestedString(state, ["system", "deployment", "agent_runner", "id"])
    || readNestedString(state, ["system", "deployment", "agent_runner_id"])
    || readNestedString(state, ["deployment", "agent_runner", "id"])
    || readNestedString(state, ["deployment", "agent_runner_id"])
    || readNestedString(state, ["deployment", "system", "agent_runner", "id"])
    || readNestedString(state, ["deployment", "system", "agent_runner_id"]);
  if (genericRunnerId) {
    if (isExplicitManagedRunnerProvider(agentRunnerProvider)) return genericRunnerId;
    if (
      !isExplicitNonManagedRunnerProvider(agentRunnerProvider)
      && !isExplicitFalse(agentRunnerManaged)
    ) {
      return genericRunnerId;
    }
  }
  return readNestedString(state, ["system", "managed_runner", "id"])
    || readNestedString(state, ["deployment", "managed_runner", "id"])
    || readNestedString(state, ["system", "managed", "agent_runner_id"])
    || null;
}

function isReusableManagedAgentRunnerPayload(payload: ManagedAgentRunnerApiPayload): boolean {
  const provider = payload.runner_provider ?? payload.provider ?? null;
  if (isExplicitNonManagedRunnerProvider(provider)) return false;
  if (isExplicitManagedRunnerProvider(provider)) return true;
  if (isExplicitFalse(payload.managed)) return false;
  if (isExplicitTrue(payload.managed)) return true;
  const kind = normalizeRunnerProvider(payload.kind);
  if (kind === "developer" || kind === "developer_runner") return false;
  if (kind === "system_managed" || kind === "managed_agent_task") return true;
  return true;
}

async function readBackendRealManagedRunnerIdFromState(): Promise<string | null> {
  const directRunnerId = firstNonEmptyScalarEnvValue(process.env, ["AGENT_RUNNER_ID"]);
  const directRunnerProvider = firstNonEmptyScalarEnvValue(process.env, ["AGENT_RUNNER_PROVIDER"]);
  if (directRunnerId && !isExplicitNonManagedRunnerProvider(directRunnerProvider)) {
    return directRunnerId;
  }

  const hasExplicitRuntimeSource = hasExplicitBackendRealRuntimeSource();
  const internalBackendRealRuntimeRoot = hasExplicitRuntimeSource
    ? null
    : await pickBackendRealRuntimeRootFromInternalSandboxStateFile();
  const includeAmbientDefault = !hasExplicitRuntimeSource && !internalBackendRealRuntimeRoot;
  const summaryPaths = dedupeStable([
    ...pickFirstBackendRealSummaryPath({ includeAmbientDefault }),
    ...(internalBackendRealRuntimeRoot
      ? [path.resolve(internalBackendRealRuntimeRoot, "summary.env")]
      : []),
  ]);

  for (const summaryFile of summaryPaths) {
    const summaryRaw = await readFile(summaryFile, "utf8").catch(() => "");
    if (!summaryRaw) continue;
    const summaryRunnerId = readProviderAwareSummaryManagedRunnerId(summaryRaw);
    if (summaryRunnerId) return summaryRunnerId;
  }

  const statePaths = dedupeStable([
    ...pickFirstBackendRealStatePath({
      includeAmbientDefault,
      includeInternalSandboxStateFile: !hasExplicitRuntimeSource,
    }),
    ...(internalBackendRealRuntimeRoot
      ? [path.resolve(internalBackendRealRuntimeRoot, "state.json")]
      : []),
  ]);

  for (const stateFile of statePaths) {
    const stateRaw = await readFile(stateFile, "utf8").catch(() => "");
    if (!stateRaw) continue;

    let state: unknown;
    try {
      state = JSON.parse(stateRaw);
    } catch {
      continue;
    }

    const stateRunnerId = readProviderAwareStateManagedRunnerId(state);
    if (stateRunnerId) {
      const trimmedRunnerId = stateRunnerId.trim();
      if (trimmedRunnerId) return trimmedRunnerId;
    }
  }
  return null;
}

async function readManagedAgentRunnerById(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  runnerId: string;
}): Promise<ManagedAgentRunnerApiPayload | null> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agent-runners/${args.runnerId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok()) {
    return null;
  }
  const payload = (await response
    .json()
    .catch(() => null)) as ManagedAgentRunnerApiPayload | null;
  if (!payload?.id) return null;
  if (!isReusableManagedAgentRunnerPayload(payload)) {
    return null;
  }
  if (
    payload.project_id
    && payload.project_id.trim() !== args.projectId
  ) {
    return null;
  }
  return payload;
}

function readMongoConfigurationFromEnv(): {
  mongoUrl: string;
  mongoDbName: string;
} {
  const mongoUrl = firstNonEmptyScalarEnvValue(process.env, ["MONGO_URL"])?.trim() ?? "";
  if (!mongoUrl) {
    throw new Error("backend_real_mongo_url_missing");
  }

  const mongoDbName = firstNonEmptyScalarEnvValue(process.env, ["MONGO_DB_NAME"])?.trim()
    || "mbos";

  return { mongoUrl, mongoDbName };
}

export async function createManagedAgentRunnerViaApi(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    image?: string;
    idleTimeoutSec?: number;
    maxLifetimeSec?: number;
    forceManagedRunnerUpsert?: boolean;
    isDefault?: boolean;
    status?: "draft" | "connected" | "ready" | "degraded" | "offline";
    capabilities?: AgentRunnerCapabilitiesInput;
    diagnostics?: Record<string, unknown>;
  },
): Promise<{
  runnerId: string;
  runnerName: string;
  status: string;
  isDefault: boolean;
  defaultEndpointId: string | null;
  configuredImage: string | null;
  capabilities: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}> {
  const runnerName = args.title.trim();
  if (!runnerName) {
    throw new Error("managed_agent_runner_name_required");
  }

  const fallbackEndpointId = args.endpointId.trim() || null;
  if (!fallbackEndpointId) {
    throw new Error("managed_agent_runner_endpoint_id_required_for_model_setting");
  }
  const requestedImage = args.image?.trim();
  if (process.env.INTEGRATION_RUNNER_PROJECTION_SMOKE === "1" && !requestedImage) {
    throw new Error("managed_runner_projection_smoke_image_required");
  }
  const requiresPrivateConfigUpsert =
    args.forceManagedRunnerUpsert === true ||
    process.env.INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE === "1" ||
    Boolean(requestedImage) ||
    typeof args.idleTimeoutSec === "number" ||
    typeof args.maxLifetimeSec === "number";
  const seededRunnerId = requiresPrivateConfigUpsert
    ? null
    : await readBackendRealManagedRunnerIdFromState();
  const seededRunner = seededRunnerId
    ? await readManagedAgentRunnerById({
      page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      runnerId: seededRunnerId,
    })
    : null;
  if (seededRunner) {
    const resolved = normalizeManagedRunnerResult(
      seededRunner,
      runnerName,
      fallbackEndpointId,
      args.status,
    );
    await ensureAgentTaskModelSettingViaApi(page, {
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      endpointId: fallbackEndpointId,
    });
    return {
      runnerId: resolved.runnerId,
      runnerName: resolved.runnerName,
      status: resolved.status,
      isDefault: resolved.isDefault,
      defaultEndpointId: resolved.defaultEndpointId,
      configuredImage: resolved.configuredImage,
      capabilities: resolved.capabilities,
      diagnostics: resolved.diagnostics,
    };
  }

  const { mongoUrl, mongoDbName } = readMongoConfigurationFromEnv();
  const seededDefault = await getUpsertDeploymentDefaultManagedRunner()({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    endpointId: fallbackEndpointId || "",
    runnerName,
    mongoUrl,
    mongoDbName,
    status: "enabled",
    runnerStatus: args.status || "ready",
    isDefault: args.isDefault ?? true,
    image: requestedImage,
    idleTimeoutSec: args.idleTimeoutSec,
    maxLifetimeSec: args.maxLifetimeSec,
    capabilities: args.capabilities,
    diagnostics: args.diagnostics,
  });
  await ensureAgentTaskModelSettingViaApi(page, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    endpointId: fallbackEndpointId,
  });

  return {
    runnerId: seededDefault.runnerId,
    runnerName: seededDefault.runnerName || runnerName,
    status: seededDefault.status || "ready",
    isDefault: seededDefault.isDefault,
    defaultEndpointId: seededDefault.defaultEndpointId,
    configuredImage: seededDefault.configuredImage,
    capabilities: seededDefault.capabilities,
    diagnostics: seededDefault.diagnostics,
  };
}

function readRecordString(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function expectManagedAgentRunnerImageEvidenceViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  expectedImage: string;
  expectedImageId?: string | null;
}): Promise<ManagedAgentRunnerApiPayload> {
  const payload = await readManagedAgentRunnerById({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    runnerId: args.runnerId,
  });
  if (!payload) {
    throw new Error(`managed_runner_image_evidence_missing:${args.runnerId}`);
  }
  expect(payload.id).toBe(args.runnerId);
  expect(payload.kind).toBe("system_managed");
  expect(readRecordString(payload.diagnostics, "runner_projection_smoke_expected_image"))
    .toBe(args.expectedImage);
  const expectedImageId = args.expectedImageId?.trim();
  if (expectedImageId) {
    expect(readRecordString(payload.diagnostics, "runner_projection_smoke_image_id"))
      .toBe(expectedImageId);
  }
  return payload;
}

export async function createChatSessionViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title?: string;
  model?: string;
  endpointId?: string;
}): Promise<{ id: string; title: string }> {
  const token = await readStoredAuthToken(args.page);
  const title = args.title?.trim() || `chat-session-${Date.now()}`;
  const endpointId = args.endpointId?.trim();
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        title,
        model: args.model ?? BACKEND_REAL_MODEL,
        ...(endpointId ? { endpoint_id: endpointId } : {}),
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`create_chat_session_failed:${response.status()}:${body}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  const id = payload?.id?.trim();
  if (!id) {
    throw new Error("create_chat_session_missing_id");
  }
  return { id, title };
}

export async function createInternalAgentTaskRunnerViaApi(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    image?: string;
    idleTimeoutSec?: number;
    maxLifetimeSec?: number;
  },
): Promise<{ runnerId: string; runnerName: string }> {
  const runner = await createManagedAgentRunnerViaApi(page, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    endpointId: args.endpointId,
    title: args.title,
    image: args.image,
    idleTimeoutSec: args.idleTimeoutSec,
    maxLifetimeSec: args.maxLifetimeSec,
  });
  return {
    runnerId: runner.runnerId,
    runnerName: runner.runnerName,
  };
}

export function sanitizeWorkloadId(id: string): string {
  return sanitizeAgentTaskWorkloadId(id);
}

export type AgentTaskApiRecord = {
  id?: string;
  title?: string;
  workspace_file_library_id?: string;
  active_run?: {
    id?: string;
    runner_id?: string;
    status?: string;
    started_at?: string;
  };
  [key: string]: unknown;
};

type CreateAgentTaskViaApiBaseArgs = {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  workspaceName?: string;
  inputRefs?: Array<Record<string, unknown>>;
};

type CreateAgentTaskViaApiArgs =
  | (CreateAgentTaskViaApiBaseArgs & {
      fileLibraryId: string;
      workspaceMode?: "use_existing";
    })
  | (CreateAgentTaskViaApiBaseArgs & {
      fileLibraryId?: undefined;
      workspaceMode?: "create_new";
    });

export async function createAgentTaskViaApi(args: CreateAgentTaskViaApiArgs): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const timeoutMs = resolveAgentTaskCreateTimeoutMs();
  const storagePendingRetries = resolveAgentTaskCreateStoragePendingRetries();
  const storagePendingRetryDelayMs = resolveAgentTaskCreateStoragePendingRetryDelayMs();
  const startedAt = Date.now();
  const title = args.title.trim();
  if (!title) {
    throw new Error("agent_task_title_required");
  }
  const fileLibraryId = args.fileLibraryId?.trim();
  if (args.fileLibraryId !== undefined && !fileLibraryId) {
    throw new Error("agent_task_workspace_file_library_id_required");
  }
  let response: Awaited<ReturnType<Page["request"]["post"]>> | null = null;
  let body = "";
  const requestBody = {
    title,
    ...(fileLibraryId
      ? {
          workspace_mode: "use_existing" as const,
          workspace_file_library_id: fileLibraryId,
        }
      : { workspace_mode: args.workspaceMode ?? "create_new" }),
    ...(args.workspaceName?.trim()
      ? { workspace_name: args.workspaceName.trim() }
      : {}),
    ...(args.inputRefs ? { input_refs: args.inputRefs } : {}),
  };

  for (let attempt = 0; attempt <= storagePendingRetries; attempt += 1) {
    try {
      response = await args.page.request.post(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: timeoutMs,
          data: requestBody,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `create_agent_task_request_failed:timeout_ms=${timeoutMs}:elapsed_ms=${Date.now() - startedAt}:${message}`,
      );
    }

    if (response.ok()) break;

    body = await response.text().catch(() => "");
    const isStoragePending = isProjectStoragePendingTaskCreateResponse(
      response.status(),
      body,
    );
    if (attempt < storagePendingRetries && isStoragePending) {
      await setTimeoutPromise(storagePendingRetryDelayMs);
      continue;
    }
    if (isStoragePending) {
      throw new Error(
        `create_agent_task_failed:${response.status()}:PROJECT_STORAGE_PENDING:storage_pending_retries=${storagePendingRetries}:storage_pending_attempts=${attempt + 1}:storage_pending_retry_delay_ms=${storagePendingRetryDelayMs}:${body}`,
      );
    }
    throw new Error(`create_agent_task_failed:${response.status()}:${body}`);
  }
  if (!response || !response.ok()) {
    throw new Error(`create_agent_task_failed:${response?.status() ?? 0}:${body}`);
  }
  const payload = (await response.json().catch(() => null)) as
    | AgentTaskApiRecord
    | { data?: AgentTaskApiRecord }
    | null;
  const directTaskId = (payload as AgentTaskApiRecord | null)?.id;
  const nestedTaskId = (payload as { data?: AgentTaskApiRecord } | null)?.data
    ?.id;
  const taskId = nestedTaskId?.trim() || directTaskId?.trim();
  if (!taskId) {
    throw new Error("agent_task_id_not_found_after_create");
  }
  return taskId;
}

export async function readAgentTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<AgentTaskApiRecord> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`read_agent_task_failed:${response.status()}:${body}`);
  }
  return (await response.json()) as AgentTaskApiRecord;
}

export async function expectAgentTaskRunnerEvidenceViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runnerId: string;
  timeoutMs?: number;
}): Promise<AgentTaskApiRecord> {
  let latestTask: AgentTaskApiRecord | null = null;
  await expect
    .poll(
      async () => {
        latestTask = await readAgentTaskViaApi(args);
        return latestTask.active_run?.runner_id ?? null;
      },
      { timeout: args.timeoutMs ?? 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(args.runnerId);
  if (!latestTask) {
    throw new Error("agent_task_runner_evidence_not_observed");
  }
  return latestTask;
}

export type TerminalSessionApiRecord = {
  terminal_session_id: string;
  runner_id?: string;
  runner_session_id?: string;
  status: string;
  ws_url: string | null;
  close_reason: string | null;
  close_state?: string | null;
  close_deadline_at?: string | null;
  close_attempt_id?: string | null;
  close_request_id?: string | null;
  close_ack_status?: string | null;
  close_diagnostic_code?: string | null;
  close_diagnostic?: unknown;
  diagnostic_code?: string | null;
  diagnostics?: unknown;
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  exit_code: number | null;
  cols: number;
  rows: number;
};

export function bindAgentTaskExecutionSocketToTask(args: {
  wsUrl: string;
  taskId: string;
}): string {
  const httpUrl = args.wsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:");
  const boundUrl = new URL(httpUrl);
  if (boundUrl.searchParams.has("session_id")) {
    throw new Error("legacy_session_id_not_supported_for_agent_task_runner_socket");
  }
  boundUrl.searchParams.set("runner_session_id", args.taskId);
  return boundUrl
    .toString()
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");
}

export function resolveAgentTaskRunnerSocketUrl(
  args:
    | {
        wsUrl: string;
        scope: "runner_presence";
      }
    | {
        wsUrl: string;
        scope: "task_execution";
        taskId?: string | null;
      },
): string {
  if (args.scope === "runner_presence") {
    return args.wsUrl;
  }
  const taskId = args.taskId?.trim();
  if (!taskId) {
    throw new Error("task_id_required_for_task_bound_agent_task_runner");
  }
  return bindAgentTaskExecutionSocketToTask({
    wsUrl: args.wsUrl,
    taskId,
  });
}

export async function startAgentTaskRunViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  intent: string;
  inputRefs?: Array<Record<string, unknown>>;
}): Promise<{ runnerOutputActivityId: string; runId?: string }> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/runs`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        intent: args.intent,
        ...(args.inputRefs ? { input_refs: args.inputRefs } : {}),
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    run_id?: string;
    kind?: string;
    actor?: string;
  } | null;
  const runnerOutputActivityId = payload?.id?.trim();
  expect(runnerOutputActivityId).toBeTruthy();
  expect(payload?.kind).toBe("runner_output");
  expect(payload?.actor).toBe("runner");
  return {
    runnerOutputActivityId: runnerOutputActivityId!,
    ...(payload?.run_id?.trim() ? { runId: payload.run_id.trim() } : {}),
  };
}

export async function createTerminalSessionViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  cols?: number;
  rows?: number;
  shell?: string;
}): Promise<{
  sessionId: string;
  wsUrl: string;
  runnerId?: string;
  runnerSessionId?: string;
}> {
  const token = await readStoredAuthToken(args.page);
  const timeoutMs = resolveTerminalSessionCreateTimeoutMs();
  const startedAt = Date.now();
  let response: Awaited<ReturnType<Page["request"]["post"]>>;
  try {
    response = await args.page.request.post(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/terminal/sessions`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: timeoutMs,
        data: {
          cols: args.cols ?? 120,
          rows: args.rows ?? 40,
          ...(args.shell?.trim() ? { shell: args.shell.trim() } : {}),
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `create_terminal_session_request_failed:${args.taskId}:timeout_ms=${timeoutMs}:elapsed_ms=${Date.now() - startedAt}:${message}`,
    );
  }
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `create_terminal_session_failed:${response.status()}:${body}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    terminal_session_id?: string;
    runner_id?: string;
    runner_session_id?: string;
    ws_url?: string;
  } | null;
  const sessionId = payload?.terminal_session_id?.trim();
  if (!sessionId) {
    throw new Error("terminal_session_payload_incomplete");
  }
  let wsUrl = payload?.ws_url?.trim() || null;
  if (!wsUrl) {
    wsUrl = await getTerminalSessionWsUrlViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      taskId: args.taskId,
      sessionId,
      authToken: token,
    });
  }

  if (!wsUrl) {
    throw new Error("terminal_session_ws_url_unavailable");
  }
  return {
    sessionId,
    wsUrl,
    ...(payload?.runner_id?.trim()
      ? { runnerId: payload.runner_id.trim() }
      : {}),
    ...(payload?.runner_session_id?.trim()
      ? { runnerSessionId: payload.runner_session_id.trim() }
      : {}),
  };
}

export async function listTerminalSessionsViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<{
  total: number;
  items: TerminalSessionApiRecord[];
}> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/terminal/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `list_terminal_sessions_failed:${response.status()}:${body}`,
    );
  }
  return (await response.json()) as {
    total: number;
    items: TerminalSessionApiRecord[];
  };
}

export async function readTerminalSessionViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
}): Promise<TerminalSessionApiRecord> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}` +
      `/projects/${args.projectId}` +
      `/tasks/${args.taskId}` +
      `/terminal/sessions/${args.sessionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `read_terminal_session_failed:${response.status()}:${body}`,
    );
  }
  return (await response.json()) as TerminalSessionApiRecord;
}

export type TerminalSessionFinalTruthOutcome = "closed" | "failed";

export type TerminalSessionCloseTruth = {
  sessionId: string;
  outcome: TerminalSessionFinalTruthOutcome | null;
  session: TerminalSessionApiRecord | null;
  listedSession: TerminalSessionApiRecord | null;
  listTotal: number | null;
  getStatus: number | null;
  closeState: string | null;
  closeDeadlineAt: string | null;
  closeAttemptId: string | null;
  closeRequestId: string | null;
  closeAckStatus: string | null;
  closeDiagnosticCode: string | null;
  closeDiagnostic: unknown;
  diagnosticCode: string | null;
  diagnostics: unknown;
  lastError: string | null;
};

type TerminalSessionJsonResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
  text: string;
  error: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalStringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNestedOptionalStringField(
  record: Record<string, unknown> | null,
  key: string,
  nestedKey: string,
): string | null {
  return readOptionalStringField(asRecord(record?.[key]), nestedKey);
}

function readFirstPresentField(
  record: Record<string, unknown> | null,
  keys: string[],
): unknown {
  if (!record) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return null;
}

function readCanonicalListedTerminalSessionId(value: unknown): string | null {
  return readOptionalStringField(asRecord(value), "terminal_session_id");
}

async function readTerminalSessionJsonResponse(
  response: Awaited<ReturnType<Page["request"]["get"]>>,
): Promise<TerminalSessionJsonResponse> {
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  let error: string | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch (parseError) {
      error = parseError instanceof Error ? parseError.message : String(parseError);
    }
  }
  return {
    ok: response.ok(),
    status: response.status(),
    payload,
    text,
    error,
  };
}

function resolveTerminalSessionCloseOutcome(
  truth: Pick<
    TerminalSessionCloseTruth,
    "session" | "listedSession" | "getStatus" | "listTotal"
  >,
): TerminalSessionFinalTruthOutcome | null {
  const records = [truth.session, truth.listedSession]
    .map((record) => asRecord(record))
    .filter((record): record is Record<string, unknown> => record !== null);
  const statuses = records
    .map((record) => readOptionalStringField(record, "status")?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const closeStates = records
    .map((record) =>
      readOptionalStringField(record, "close_state")?.toLowerCase(),
    )
    .filter((value): value is string => Boolean(value));

  if (statuses.includes("closed") || closeStates.includes("closed")) {
    return "closed";
  }
  if (
    statuses.includes("failed") ||
    closeStates.includes("failed") ||
    closeStates.includes("expired") ||
    closeStates.includes("deadline_expired")
  ) {
    return "failed";
  }
  if (
    truth.getStatus === 404 &&
    truth.listTotal !== null &&
    truth.listedSession === null
  ) {
    return "closed";
  }
  return null;
}

function buildTerminalSessionCloseTruth(args: {
  sessionId: string;
  session: TerminalSessionApiRecord | null;
  listedSession: TerminalSessionApiRecord | null;
  listTotal: number | null;
  getStatus: number | null;
  lastError: string | null;
}): TerminalSessionCloseTruth {
  const source =
    asRecord(args.session) ?? asRecord(args.listedSession);
  const closeAckStatus =
    readOptionalStringField(source, "close_ack_status") ??
    readNestedOptionalStringField(source, "close_ack", "status") ??
    readNestedOptionalStringField(source, "ack", "status");
  const closeDiagnosticCode =
    readOptionalStringField(source, "close_diagnostic_code") ??
    readOptionalStringField(source, "diagnostic_code") ??
    readNestedOptionalStringField(source, "close_ack", "diagnostic_code") ??
    readNestedOptionalStringField(source, "ack", "diagnostic_code");
  const closeDiagnostic = readFirstPresentField(source, [
    "close_diagnostic",
    "close_ack_diagnostic",
    "diagnostic",
  ]);
  const truth: TerminalSessionCloseTruth = {
    sessionId: args.sessionId,
    outcome: null,
    session: args.session,
    listedSession: args.listedSession,
    listTotal: args.listTotal,
    getStatus: args.getStatus,
    closeState: readOptionalStringField(source, "close_state"),
    closeDeadlineAt: readOptionalStringField(source, "close_deadline_at"),
    closeAttemptId: readOptionalStringField(source, "close_attempt_id"),
    closeRequestId: readOptionalStringField(source, "close_request_id"),
    closeAckStatus,
    closeDiagnosticCode,
    closeDiagnostic,
    diagnosticCode: readOptionalStringField(source, "diagnostic_code"),
    diagnostics: readFirstPresentField(source, ["diagnostics"]),
    lastError: args.lastError,
  };
  truth.outcome = resolveTerminalSessionCloseOutcome(truth);
  return truth;
}

function summarizeTerminalSessionCloseTruth(
  truth: TerminalSessionCloseTruth | null,
): Record<string, unknown> {
  if (!truth) {
    return { last_session_truth: null };
  }
  return {
    session_id: truth.sessionId,
    outcome: truth.outcome,
    list_total: truth.listTotal,
    get_status: truth.getStatus,
    close_state: truth.closeState,
    close_deadline_at: truth.closeDeadlineAt,
    close_attempt_id: truth.closeAttemptId,
    close_request_id: truth.closeRequestId,
    close_ack_status: truth.closeAckStatus,
    close_diagnostic_code: truth.closeDiagnosticCode,
    close_diagnostic: truth.closeDiagnostic,
    diagnostic_code: truth.diagnosticCode,
    diagnostics: truth.diagnostics,
    last_error: truth.lastError,
    listed_session: truth.listedSession,
    session: truth.session,
  };
}

export async function readTerminalSessionCloseTruthViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
}): Promise<TerminalSessionCloseTruth> {
  const token = await readStoredAuthToken(args.page);
  const sessionBaseUrl =
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}` +
    `/projects/${args.projectId}` +
    `/tasks/${args.taskId}` +
    "/terminal/sessions";
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const [listResult, getResult] = await Promise.allSettled([
    args.page.request
      .get(sessionBaseUrl, { headers })
      .then(readTerminalSessionJsonResponse),
    args.page.request
      .get(`${sessionBaseUrl}/${args.sessionId}`, { headers })
      .then(readTerminalSessionJsonResponse),
  ]);

  const listSnapshot =
    listResult.status === "fulfilled" ? listResult.value : null;
  const getSnapshot =
    getResult.status === "fulfilled" ? getResult.value : null;
  const listPayload = asRecord(listSnapshot?.payload);
  const listItems = Array.isArray(listPayload?.items)
    ? listPayload.items
    : [];
  const listedSession = listItems.find(
    (item) => readCanonicalListedTerminalSessionId(item) === args.sessionId,
  ) as TerminalSessionApiRecord | undefined;
  const sessionRecord =
    getSnapshot?.ok && asRecord(getSnapshot.payload)
      ? (getSnapshot.payload as TerminalSessionApiRecord)
      : null;
  const listTotalValue = listPayload?.total;
  const listTotal =
    typeof listTotalValue === "number" && Number.isFinite(listTotalValue)
      ? listTotalValue
      : listSnapshot?.ok
        ? listItems.length
        : null;
  const lastError = [
    listResult.status === "rejected" ? `list:${String(listResult.reason)}` : null,
    getResult.status === "rejected" ? `get:${String(getResult.reason)}` : null,
    listSnapshot?.error ? `list_parse:${listSnapshot.error}` : null,
    getSnapshot?.error ? `get_parse:${getSnapshot.error}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(";") || null;

  return buildTerminalSessionCloseTruth({
    sessionId: args.sessionId,
    session: sessionRecord,
    listedSession: listedSession ?? null,
    listTotal,
    getStatus: getSnapshot?.status ?? null,
    lastError,
  });
}

export async function waitForTerminalSessionFinalTruthViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<TerminalSessionCloseTruth & { outcome: TerminalSessionFinalTruthOutcome }> {
  const timeoutMs = Math.max(0, args.timeoutMs ?? 60_000);
  const pollIntervalMs = Math.max(1, args.pollIntervalMs ?? 500);
  const deadline = Date.now() + timeoutMs;
  let latestTruth: TerminalSessionCloseTruth | null = null;

  while (true) {
    latestTruth = await readTerminalSessionCloseTruthViaApi(args);
    if (latestTruth.outcome) {
      return latestTruth as TerminalSessionCloseTruth & {
        outcome: TerminalSessionFinalTruthOutcome;
      };
    }
    if (Date.now() >= deadline) {
      break;
    }
    await args.page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(
    `terminal_session_close_truth_timeout:${args.sessionId}:` +
      JSON.stringify({
        last_session_truth: summarizeTerminalSessionCloseTruth(latestTruth),
      }),
  );
}

export async function expectTerminalSessionRunnerEvidenceViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  runnerId: string;
  createdSession?: { runnerId?: string; runnerSessionId?: string };
  timeoutMs?: number;
}): Promise<TerminalSessionApiRecord> {
  if (args.createdSession) {
    expect(args.createdSession.runnerId).toBe(args.runnerId);
    expect(args.createdSession.runnerSessionId).toBe(args.taskId);
  }

  let latestSession: TerminalSessionApiRecord | null = null;
  await expect
    .poll(
      async () => {
        const [session, listed] = await Promise.all([
          readTerminalSessionViaApi(args),
          listTerminalSessionsViaApi(args),
        ]);
        const listedSession =
          listed.items.find(
            (item) => item.terminal_session_id === args.sessionId,
          ) ?? null;
        latestSession = session;
        return Boolean(
          session.terminal_session_id === args.sessionId &&
          session.runner_id === args.runnerId &&
          session.runner_session_id === args.taskId &&
          listedSession?.runner_id === args.runnerId &&
          listedSession.runner_session_id === args.taskId,
        );
      },
      { timeout: args.timeoutMs ?? 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  if (!latestSession) {
    throw new Error("terminal_session_runner_evidence_not_observed");
  }
  return latestSession;
}

export async function getTerminalSessionWsUrlViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  authToken?: string | null;
}): Promise<string> {
  const token = args.authToken ?? (await readStoredAuthToken(args.page));
  const sessionUrl =
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}` +
    `/projects/${args.projectId}` +
    `/tasks/${args.taskId}` +
    `/terminal/sessions/${args.sessionId}`;

  let wsUrl: string | null = null;
  await expect
    .poll(
      async () => {
        const sessionResponse = await args.page.request.get(sessionUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!sessionResponse.ok()) {
          return false;
        }
        const sessionPayload = (await sessionResponse
          .json()
          .catch(() => null)) as { ws_url?: string | null } | null;
        const currentWsUrl = sessionPayload?.ws_url?.trim();
        if (currentWsUrl) {
          wsUrl = currentWsUrl;
          return true;
        }
        return false;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  if (!wsUrl) {
    throw new Error("terminal_session_ws_url_unavailable");
  }
  return wsUrl;
}

export async function deleteTerminalSessionViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  timeoutMs?: number;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.delete(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}` +
      `/projects/${args.projectId}` +
      `/tasks/${args.taskId}` +
      `/terminal/sessions/${args.sessionId}`,
    {
      timeout: args.timeoutMs ?? 60_000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (response.status() !== 204) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `delete_terminal_session_failed:${response.status()}:${body}`,
    );
  }
  await waitForTerminalSessionFinalTruthViaApi({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    sessionId: args.sessionId,
  });
}

export async function runTerminalCommandViaWs(args: {
  wsUrl: string;
  terminalSessionId: string;
  command: string;
  waitFor: string[];
  timeoutMs?: number;
  cols?: number;
  rows?: number;
  afterSeq?: number | null;
}): Promise<string> {
  const timeoutMs = args.timeoutMs ?? 120_000;
  const cols = args.cols ?? 120;
  const rows = args.rows ?? 40;

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(args.wsUrl);
    let output = "";
    let done = false;
    let commandSent = false;
    let inputEnabled = false;
    const timeout = setTimeout(
      () => {
        if (done) return;
        done = true;
        closeTerminalCommandSocket(ws);
        if (!commandSent) {
          reject(
            new Error(
              `terminal_ws_not_ready:timeout_before_input_enabled:${args.waitFor.join(",")}`,
            ),
          );
          return;
        }
        reject(
          new Error(
            `terminal_ws_timeout:${args.waitFor.join(",")}:${output.slice(-2000)}`,
          ),
        );
      },
      Math.max(1_000, timeoutMs),
    );

    const waitMatched = () =>
      args.waitFor.every((needle) => output.includes(needle));

    const finish = (value: string) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      closeTerminalCommandSocket(ws);
      resolve(value);
    };

    const fail = (error: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      closeTerminalCommandSocket(ws);
      reject(error);
    };

    const sendCommandIfReady = () => {
      if (
        done ||
        commandSent ||
        !inputEnabled ||
        ws.readyState !== WebSocket.OPEN
      )
        return;
      try {
        ws.send(JSON.stringify({ type: "terminal.resize", cols, rows }));
        ws.send(
          JSON.stringify({ type: "terminal.stdin", data: `${args.command}\n` }),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(
          new Error(
            `terminal_ws_client_error:${detail}:${output.slice(-2000)}`,
          ),
        );
        return;
      }
      commandSent = true;
      if (waitMatched()) {
        finish(output);
      }
    };

    ws.on("open", () => {
      const reconnectPayload: Record<string, unknown> = {
        type: "terminal.reconnect",
        terminal_session_id: args.terminalSessionId,
        cols,
        rows,
      };
      if (args.afterSeq !== undefined) {
        reconnectPayload.after_seq = args.afterSeq;
      }
      try {
        ws.send(JSON.stringify(reconnectPayload));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(
          new Error(
            `terminal_ws_client_error:${detail}:${output.slice(-2000)}`,
          ),
        );
      }
    });

    ws.on("message", (raw) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!payload) return;
      try {
        if (!terminalWsFrameBelongsToSession(payload, args.terminalSessionId)) {
          return;
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const type = readTerminalWsStringField(payload, "type");
      if (type === "error") {
        fail(new Error("legacy_terminal_ws_error_frame_not_supported"));
        return;
      }
      if (type === "terminal.error") {
        const code =
          readTerminalWsStringField(payload, "error_code") ??
          "unknown";
        const message =
          readTerminalWsStringField(payload, "error_message") ??
          "unknown";
        fail(new Error(`terminal_ws_error:${code}:${message}`));
        return;
      }

      if (
        (type === "terminal.output" || type === "output") &&
        typeof payload.chunk === "string"
      ) {
        output += payload.chunk;
        if (commandSent && waitMatched()) {
          finish(output);
        }
        return;
      }

      if (type === "terminal.replay_end") {
        if (payload.input_enabled === true) {
          inputEnabled = true;
          sendCommandIfReady();
        }
        return;
      }

      if (type === "terminal.state") {
        const state = readTerminalWsStringField(payload, "state");
        if (
          payload.input_enabled === true &&
          (state === "ready" || state === "active" || state === "connected")
        ) {
          inputEnabled = true;
          sendCommandIfReady();
          return;
        }
        if (payload.input_enabled === false) {
          inputEnabled = false;
        }
      }
    });

    ws.on("error", (error) => {
      if (done) return;
      if (commandSent && waitMatched()) {
        finish(output);
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (isTerminalWsAuthFailureDetail(detail)) {
        fail(new Error(`terminal_ws_auth_failed:${detail}`));
        return;
      }
      if (!commandSent) {
        fail(new Error(`terminal_ws_not_ready:${detail}`));
        return;
      }
      fail(
        new Error(`terminal_ws_client_error:${detail}:${output.slice(-2000)}`),
      );
    });

    ws.on("close", (code, reason) => {
      if (done) return;
      if (commandSent && waitMatched()) {
        finish(output);
        return;
      }
      const reasonText = reason.toString("utf-8");
      const closeDetail = reasonText
        ? `closed:${code}:${reasonText}`
        : `closed:${code}`;
      if (isTerminalWsAuthFailureDetail(closeDetail)) {
        fail(new Error(`terminal_ws_auth_failed:${closeDetail}`));
        return;
      }
      if (!commandSent) {
        fail(new Error(`terminal_ws_not_ready:${closeDetail}`));
        return;
      }
      fail(
        new Error(
          `terminal_ws_closed_before_match:${args.waitFor.join(",")}:${closeDetail}:${output.slice(-2000)}`,
        ),
      );
    });
  });
}

function closeTerminalCommandSocket(ws: WebSocket): void {
  try {
    if (
      ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN
    ) {
      ws.close();
    }
  } catch {
    // ignore close races
  }
}

function readTerminalWsStringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function terminalWsFrameBelongsToSession(
  payload: Record<string, unknown>,
  terminalSessionId: string,
): boolean {
  if (Object.prototype.hasOwnProperty.call(payload, "session_id")) {
    throw new Error("legacy_terminal_ws_session_id_not_supported");
  }
  const frameSessionId = readTerminalWsStringField(
    payload,
    "terminal_session_id",
  );
  return frameSessionId === null || frameSessionId === terminalSessionId;
}

function isTerminalWsAuthFailureDetail(detail: string): boolean {
  return (
    /Unexpected server response:\s*(401|403)\b/.test(detail) ||
    (/\b(401|403)\b/.test(detail) &&
      /\bauth|forbidden|unauthori[sz]ed\b/i.test(detail))
  );
}

export async function runTerminalCommandInSession(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  command: string;
  waitFor: string[];
  timeoutMs?: number;
}): Promise<string> {
  const deadline = Date.now() + (args.timeoutMs ?? 120_000);
  let attempt = 0;
  let lastError: string | null = null;
  let authRetryUsed = false;

  while (Date.now() < deadline) {
    const wsUrl = await getTerminalSessionWsUrlViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      taskId: args.taskId,
      sessionId: args.sessionId,
    });
    try {
      return await runTerminalCommandViaWs({
        wsUrl,
        terminalSessionId: args.sessionId,
        command: args.command,
        waitFor: args.waitFor,
        timeoutMs: Math.max(1_000, deadline - Date.now()),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith("terminal_ws_auth_failed:")) {
        lastError = detail;
        if (authRetryUsed) {
          throw new Error(detail);
        }
        authRetryUsed = true;
        attempt += 1;
        await setTimeoutPromise(Math.min(2_000, 250 * attempt));
        continue;
      }
      if (!detail.startsWith("terminal_ws_not_ready:")) {
        throw error;
      }
      lastError = detail;
      attempt += 1;
      await setTimeoutPromise(Math.min(2_000, 250 * attempt));
    }
  }

  throw new Error(
    `terminal_session_command_retry_exhausted:${lastError ?? "unknown"}`,
  );
}

export async function waitForRunnerOutputToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  runnerOutputActivityId?: string;
  runId?: string;
  minRunnerOutputs?: number;
  namespace?: string;
  workloadId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  const timeoutMs = args.timeoutMs ?? 300_000;
  const failureContextTarget = {
    namespace:
      args.namespace?.trim() ||
      process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim() ||
      undefined,
    workloadId: args.workloadId?.trim() || sanitizeWorkloadId(args.taskId),
  };
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const [activity, traces, task] = await Promise.all([
      fetchTaskActivitySnapshot({ ...args, authToken }),
      fetchTaskTracesSnapshot({
        ...args,
        authToken,
        messageId: args.runnerOutputActivityId,
        runId: args.runId,
      }),
      fetchTaskRealtimeSnapshot({ ...args, authToken }),
    ]);
    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: args.token,
      runnerOutputActivityId: args.runnerOutputActivityId,
      runId: args.runId,
      minRunnerOutputs: args.minRunnerOutputs,
      activity,
      traces,
      task,
    });

    if (outcome.success) return;

    const runnerOutputError = findTerminalRunnerOutputError(activity);
    if (outcome.failure || runnerOutputError) {
      const context = await collectInternalTaskFailureContext({
        page: args.page,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        taskId: args.taskId,
        runnerOutputActivityId: args.runnerOutputActivityId,
        runId: args.runId,
        namespace: failureContextTarget.namespace,
        workloadId: failureContextTarget.workloadId,
        authToken,
      });
      throw new Error(
        `runner_output_token_failed:${outcome.reason ?? "runner_output_error"}` +
          `${runnerOutputError ? `:${runnerOutputError}` : ""}\n\n${context}`,
      );
    }

    const intervals = [1_000, 2_000, 5_000];
    const delay = intervals[Math.min(attempt, intervals.length - 1)] ?? 5_000;
    attempt += 1;
    await args.page.waitForTimeout(delay);
  }

  const context = await collectInternalTaskFailureContext({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    runnerOutputActivityId: args.runnerOutputActivityId,
    runId: args.runId,
    namespace: failureContextTarget.namespace,
    workloadId: failureContextTarget.workloadId,
    authToken,
  });
  throw new Error(`runner_output_token_timeout:${args.taskId}\n\n${context}`);
}

export type IntegrationTaskActivitySnapshot = {
  id?: string;
  kind?: string;
  actor?: string;
  content?: string;
  run_id?: string;
};

export type IntegrationTaskTraceSnapshot = {
  id?: string;
  message_id?: string;
  run_id?: string;
  category?: string;
  phase?: string;
  status?: string;
  name?: string;
  summary?: string;
  at?: string;
};

type IntegrationTaskTraceScope = {
  pageSize: number;
  messageId?: string;
  runId?: string;
};

function normalizeTaskTraceScope(args: {
  pageSize?: number;
  messageId?: string;
  runId?: string;
}): IntegrationTaskTraceScope {
  const runId = args.runId?.trim();
  const messageId = args.messageId?.trim();
  // run_id is the durable execution scope. The run-start runner_output id can
  // differ from the later activity projection id, so avoid ANDing both fields.
  return {
    pageSize: args.pageSize ?? 100,
    ...(runId ? { runId } : messageId ? { messageId } : {}),
  };
}

export type IntegrationTaskRealtimeSnapshot = {
  id?: string;
  status?: string;
  run_state?: string;
  run_status?: string;
  active_run?: {
    id?: string;
    runner_id?: string;
    status?: string;
    started_at?: string;
    finished_at?: string;
  } | null;
};

export type AgentTaskRunFinalState = {
  runState: string | null;
  runStatus: string | null;
  activeRunId: string | null;
  activeRunStatus: string | null;
  terminalTraceSummary: string | null;
};

function normalizeIntegrationStatus(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isTerminalSuccessStatus(value: string | null | undefined): boolean {
  return ["completed", "complete", "succeeded", "success"].includes(
    normalizeIntegrationStatus(value),
  );
}

function isTerminalFailureStatus(value: string | null | undefined): boolean {
  return ["error", "failed", "cancelled", "canceled"].includes(
    normalizeIntegrationStatus(value),
  );
}

function isTerminalTracePhase(value: string | null | undefined): boolean {
  return ["end", "complete", "completed"].includes(
    normalizeIntegrationStatus(value),
  );
}

function findTerminalSuccessTrace(
  traces: IntegrationTaskTraceSnapshot[],
): IntegrationTaskTraceSnapshot | null {
  return traces.find((trace) => {
    if (!isTerminalSuccessStatus(trace.status)) return false;
    if (isTerminalTracePhase(trace.phase)) return true;
    const name = normalizeIntegrationStatus(trace.name);
    return [
      "run.completed",
      "run.complete",
      "run.lifecycle",
      "run.summary",
      "execution.terminal",
      "codex.exec",
    ].includes(name);
  }) ?? null;
}

function integrationSnapshotText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function integrationTraceMatchesScope(args: {
  trace: IntegrationTaskTraceSnapshot;
  runId: string;
  runnerOutputActivityId: string;
}): boolean {
  if (!args.runId && !args.runnerOutputActivityId) return true;
  const traceRunId = integrationSnapshotText(args.trace.run_id);
  if (args.runId) {
    if (traceRunId) return traceRunId === args.runId;
    return Boolean(
      args.runnerOutputActivityId
      && integrationSnapshotText(args.trace.message_id) === args.runnerOutputActivityId,
    );
  }
  return integrationSnapshotText(args.trace.message_id) === args.runnerOutputActivityId;
}

function findScopedTerminalSuccessTrace(args: {
  traces: IntegrationTaskTraceSnapshot[];
  runId: string;
  runnerOutputActivityId: string;
}): IntegrationTaskTraceSnapshot | null {
  return findTerminalSuccessTrace(
    args.traces.filter((trace) => integrationTraceMatchesScope({ ...args, trace })),
  );
}

function integrationActivityMatchesScope(args: {
  activity: IntegrationTaskActivitySnapshot;
  runId: string;
  runnerOutputActivityId: string;
}): boolean {
  if (!args.runId && !args.runnerOutputActivityId) return true;
  const activityRunId = integrationSnapshotText(args.activity.run_id);
  if (args.runId) {
    if (activityRunId) return activityRunId === args.runId;
    return Boolean(
      args.runnerOutputActivityId
      && integrationSnapshotText(args.activity.id) === args.runnerOutputActivityId,
    );
  }
  return integrationSnapshotText(args.activity.id) === args.runnerOutputActivityId;
}

function findScopedRunnerOutputActivity(args: {
  activity: IntegrationTaskActivitySnapshot[];
  runId: string;
  runnerOutputActivityId: string;
}): IntegrationTaskActivitySnapshot | null {
  return [...args.activity].reverse().find((item) => {
    return item.kind === "runner_output"
      && item.actor === "runner"
      && integrationActivityMatchesScope({ ...args, activity: item });
  }) ?? null;
}

function buildAgentTaskRunFinalState(
  task: IntegrationTaskRealtimeSnapshot | null,
  terminalTrace: IntegrationTaskTraceSnapshot | null,
): AgentTaskRunFinalState {
  return {
    runState: task?.run_state ?? null,
    runStatus: task?.run_status ?? null,
    activeRunId: task?.active_run?.id ?? null,
    activeRunStatus: task?.active_run?.status ?? null,
    terminalTraceSummary: terminalTrace?.summary ?? null,
  };
}

export function resolveAgentTaskRunFinalState(args: {
  activity?: IntegrationTaskActivitySnapshot[];
  task: IntegrationTaskRealtimeSnapshot | null;
  traces: IntegrationTaskTraceSnapshot[];
  runId?: string;
  runnerOutputActivityId?: string;
}): AgentTaskRunFinalState | null {
  const task = args.task;
  const runState = normalizeIntegrationStatus(task?.run_state);
  const runStatus = normalizeIntegrationStatus(task?.run_status);
  const activeRunId = task?.active_run?.id?.trim() ?? "";
  const activeRunStatus = normalizeIntegrationStatus(task?.active_run?.status);
  const scopedRunId = args.runId?.trim() ?? "";
  const scopedRunnerOutputActivityId = args.runnerOutputActivityId?.trim() ?? "";
  const hasExplicitScope = scopedRunId.length > 0 || scopedRunnerOutputActivityId.length > 0;
  const taskIsIdle = runState === "idle";
  const terminalTrace = hasExplicitScope
    ? findScopedTerminalSuccessTrace({
        traces: args.traces,
        runId: scopedRunId,
        runnerOutputActivityId: scopedRunnerOutputActivityId,
      })
    : findTerminalSuccessTrace(args.traces);
  const scopedRunnerOutputActivity = hasExplicitScope
    ? findScopedRunnerOutputActivity({
        activity: args.activity ?? [],
        runId: scopedRunId,
        runnerOutputActivityId: scopedRunnerOutputActivityId,
      })
    : null;
  const scopedActivityHasVisibleOutput =
    integrationSnapshotText(scopedRunnerOutputActivity?.content).length > 0;

  if (
    taskIsIdle
    && scopedRunId
    && activeRunId === scopedRunId
    && isTerminalSuccessStatus(activeRunStatus)
  ) {
    return buildAgentTaskRunFinalState(task, terminalTrace);
  }

  if (hasExplicitScope) {
    const scopedTraceOrActivityShowsCurrentRunFinished =
      terminalTrace !== null
      || (isTerminalSuccessStatus(runStatus) && scopedActivityHasVisibleOutput);
    if (taskIsIdle && scopedTraceOrActivityShowsCurrentRunFinished) {
      return buildAgentTaskRunFinalState(task, terminalTrace);
    }
    return null;
  }

  const activeRunIsCurrent =
    scopedRunId.length > 0
      ? activeRunId === scopedRunId
      : activeRunId.length > 0;
  if (activeRunIsCurrent && !isTerminalSuccessStatus(activeRunStatus)) {
    return null;
  }

  const taskHasTerminalSuccess = isTerminalSuccessStatus(runStatus);
  const traceOrTaskShowsCurrentRunFinished =
    terminalTrace !== null || taskHasTerminalSuccess;

  if (
    !hasExplicitScope
    && taskIsIdle
    && activeRunIsCurrent
    && isTerminalSuccessStatus(activeRunStatus)
    && traceOrTaskShowsCurrentRunFinished
  ) {
    return buildAgentTaskRunFinalState(task, terminalTrace);
  }

  if (taskIsIdle && !activeRunIsCurrent && traceOrTaskShowsCurrentRunFinished) {
    return buildAgentTaskRunFinalState(task, terminalTrace);
  }

  return null;
}

export async function waitForAgentTaskRunFinalStateViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runnerOutputActivityId?: string;
  runId?: string;
  timeoutMs?: number;
}): Promise<AgentTaskRunFinalState> {
  const authToken = await readStoredAuthToken(args.page);
  const timeoutMs = args.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const [activity, task, traces] = await Promise.all([
      fetchTaskActivitySnapshot({ ...args, authToken }),
      fetchTaskRealtimeSnapshot({ ...args, authToken }),
      fetchTaskTracesSnapshot({
        ...args,
        authToken,
        messageId: args.runnerOutputActivityId,
        runId: args.runId,
      }),
    ]);
    const failureOutcome = evaluateAgentTaskExecutionSnapshot({
      token: "__agent_task_final_state_wait_never_matches__",
      runnerOutputActivityId: args.runnerOutputActivityId,
      runId: args.runId,
      activity,
      traces,
      task,
    });
    const runnerOutputError = findTerminalRunnerOutputError(activity);
    const activeRunStatus = task?.active_run?.status;
    if (failureOutcome.failure || runnerOutputError || isTerminalFailureStatus(activeRunStatus)) {
      const context = await collectInternalTaskFailureContext({
        page: args.page,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        taskId: args.taskId,
        runnerOutputActivityId: args.runnerOutputActivityId,
        runId: args.runId,
        authToken,
      });
      throw new Error(
        `agent_task_run_final_state_failed:${failureOutcome.reason ?? runnerOutputError ?? activeRunStatus ?? "unknown"}\n\n${context}`,
      );
    }

    const finalState = resolveAgentTaskRunFinalState({
      activity,
      task,
      traces,
      runnerOutputActivityId: args.runnerOutputActivityId,
      runId: args.runId,
    });
    if (finalState) return finalState;

    const intervals = [1_000, 2_000, 5_000];
    const delay = intervals[Math.min(attempt, intervals.length - 1)] ?? 5_000;
    attempt += 1;
    await args.page.waitForTimeout(delay);
  }

  const context = await collectInternalTaskFailureContext({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    runnerOutputActivityId: args.runnerOutputActivityId,
    runId: args.runId,
    authToken,
  });
  throw new Error(`agent_task_run_final_state_timeout:${args.taskId}\n\n${context}`);
}

export type WorkloadPodSnapshot = {
  name?: string | null;
  uid?: string | null;
  image?: string | null;
  imageID?: string | null;
  phase?: string | null;
  ready?: boolean | null;
  readyReason?: string | null;
  containerReadyCount?: number | null;
  containerCount?: number | null;
  initContainerReadyCount?: number | null;
  initContainerCount?: number | null;
  initReason?: string | null;
  initExitCode?: number | null;
  reason?: string | null;
  exitCode?: number | null;
};

type KubernetesContainerStatusSnapshot = {
  image?: string;
  imageID?: string;
  ready?: boolean;
  state?: {
    waiting?: { reason?: string };
    terminated?: { exitCode?: number; reason?: string };
  };
};

type KubernetesPodItem = {
  metadata?: {
    name?: string;
    uid?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    deletionTimestamp?: string;
    finalizers?: unknown[];
  };
  status?: {
    phase?: string;
    reason?: string;
    conditions?: Array<{ type?: string; status?: string; reason?: string }>;
    containerStatuses?: KubernetesContainerStatusSnapshot[];
    initContainerStatuses?: KubernetesContainerStatusSnapshot[];
  };
  spec?: {
    containers?: Array<{
      image?: string;
    }>;
  };
};

type KubernetesPodListPayload = {
  items?: KubernetesPodItem[];
};

type KubernetesEventItem = {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: {
    creationTimestamp?: string;
  };
};

type KubernetesEventListPayload = {
  items?: KubernetesEventItem[];
};

type ManagedWorkloadPodSelection = {
  podName: string;
  workloadId: string;
};

export type ExpiredWorkloadReleaseTarget = {
  podName: string;
  workspaceId: string;
  projectId: string;
  workloadId: string;
  expiresAt: string;
  deletionTimestamp?: string;
  finalizers: string[];
};

function parseWorkloadPodListPayload(payloadText: string): KubernetesPodListPayload {
  return JSON.parse(payloadText || "{}") as KubernetesPodListPayload;
}

function parseWorkloadPodListPayloadSafely(payloadText: string): KubernetesPodListPayload {
  try {
    return parseWorkloadPodListPayload(payloadText);
  } catch {
    return {};
  }
}

function readPodName(item: KubernetesPodItem): string {
  return item.metadata?.name?.trim() ?? "";
}

function readPodAnnotation(item: KubernetesPodItem, key: string): string {
  return item.metadata?.annotations?.[key]?.trim() ?? "";
}

function selectManagedWorkloadPodItem(args: {
  payloadText: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
}): { item: KubernetesPodItem } & ManagedWorkloadPodSelection | null {
  const payload = parseWorkloadPodListPayload(args.payloadText);
  const selected = selectManagedWorkloadPodForTask({
    taskId: args.workloadId,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    payload,
  }) as ManagedWorkloadPodSelection | null;
  if (!selected?.podName) return null;

  const item = (payload.items ?? []).find(
    (candidate) =>
      readPodName(candidate) === selected.podName &&
      readPodAnnotation(candidate, "mbos.io/workload-id") === selected.workloadId,
  );
  return item ? { ...selected, item } : null;
}

export function selectExpiredWorkloadReleaseTargets(args: {
  payload: string;
  now?: Date;
  workloadId?: string;
  workspaceId?: string;
  projectId?: string;
}): ExpiredWorkloadReleaseTarget[] {
  const now = args.now ?? new Date();
  const workloadFilter = args.workloadId?.trim();
  const workspaceFilter = args.workspaceId?.trim();
  const projectFilter = args.projectId?.trim();
  const payload = parseWorkloadPodListPayloadSafely(args.payload);

  return (payload.items ?? []).flatMap((item) => {
    const metadata = item.metadata ?? {};
    const labels = metadata.labels ?? {};
    const annotations = metadata.annotations ?? {};
    const podName = metadata.name?.trim();
    const app = labels.app?.trim();
    const workspaceId = annotations["mbos.io/workspace-id"]?.trim();
    const projectId = annotations["mbos.io/project-id"]?.trim();
    const workloadId = annotations["mbos.io/workload-id"]?.trim();
    const expiresAt = annotations.expires_at?.trim();
    if (!podName || !workspaceId || !projectId || !workloadId || !expiresAt) {
      return [];
    }
    if (app !== "managed-workload") {
      return [];
    }
    if (workspaceFilter && workspaceId !== workspaceFilter) {
      return [];
    }
    if (projectFilter && projectId !== projectFilter) {
      return [];
    }
    if (workloadFilter && workloadId !== workloadFilter) {
      return [];
    }
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs >= now.getTime()) {
      return [];
    }
    const deletionTimestamp = metadata.deletionTimestamp?.trim();
    return [{
      podName,
      workspaceId,
      projectId,
      workloadId,
      expiresAt,
      ...(deletionTimestamp ? { deletionTimestamp } : {}),
      finalizers: (metadata.finalizers ?? []).filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    }];
  });
}

async function fetchTaskActivitySnapshot(args: {
  page: Page;
  authToken: string | null;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<IntegrationTaskActivitySnapshot[]> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/activity`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return [];
  return (await response
    .json()
    .catch(() => [])) as IntegrationTaskActivitySnapshot[];
}

async function fetchTaskTracesSnapshot(args: {
  page: Page;
  authToken: string | null;
  workspaceId: string;
  projectId: string;
  taskId: string;
  pageSize?: number;
  messageId?: string;
  runId?: string;
}): Promise<IntegrationTaskTraceSnapshot[]> {
  const scope = normalizeTaskTraceScope(args);
  const query = [
    `page_size=${scope.pageSize}`,
    scope.messageId
      ? `message_id=${encodeURIComponent(scope.messageId)}`
      : null,
    scope.runId
      ? `run_id=${encodeURIComponent(scope.runId)}`
      : null,
  ]
    .filter(Boolean)
    .join("&");
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/traces?${query}`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return [];
  const payload = (await response.json().catch(() => null)) as {
    items?: IntegrationTaskTraceSnapshot[];
  } | null;
  return payload?.items ?? [];
}

async function fetchTaskRealtimeSnapshot(args: {
  page: Page;
  authToken: string | null;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<IntegrationTaskRealtimeSnapshot | null> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return null;
  return (await response
    .json()
    .catch(() => null)) as IntegrationTaskRealtimeSnapshot | null;
}

export function parseWorkloadPodSnapshot(
  payloadText: string,
): WorkloadPodSnapshot | null {
  const payload = parseWorkloadPodListPayload(payloadText);
  const item = payload.items?.[0];
  return item ? parseWorkloadPodItemSnapshot(item) : null;
}

function readContainerStatusReason(
  status: KubernetesContainerStatusSnapshot,
): string | null {
  return status.state?.waiting?.reason ?? status.state?.terminated?.reason ?? null;
}

function readTerminatedExitCode(
  status: KubernetesContainerStatusSnapshot,
): number | null {
  const exitCode = status.state?.terminated?.exitCode;
  return typeof exitCode === "number" ? exitCode : null;
}

function containerStatusCompleted(
  status: KubernetesContainerStatusSnapshot,
): boolean {
  return status.ready === true || status.state?.terminated?.exitCode === 0;
}

function parseWorkloadPodItemSnapshot(
  item: KubernetesPodItem,
): WorkloadPodSnapshot | null {
  if (!item) return null;
  const containerStatuses = item.status?.containerStatuses ?? [];
  const initContainerStatuses = item.status?.initContainerStatuses ?? [];
  const readyCondition =
    item.status?.conditions?.find((condition) => condition.type === "Ready") ??
    null;
  const waiting =
    containerStatuses.find((status) => status.state?.waiting)?.state?.waiting ??
    null;
  const terminated =
    containerStatuses.find((status) => status.state?.terminated)?.state
      ?.terminated ?? null;
  const pendingInitStatus =
    initContainerStatuses.find((status) => !containerStatusCompleted(status)) ??
    null;
  const firstInitStatus = initContainerStatuses[0] ?? null;
  const initExitCodeStatus =
    initContainerStatuses.find((status) => {
      const exitCode = readTerminatedExitCode(status);
      return typeof exitCode === "number" && exitCode !== 0;
    }) ??
    initContainerStatuses.find(
      (status) => readTerminatedExitCode(status) !== null,
    ) ??
    null;
  const ready =
    readyCondition != null
      ? readyCondition.status === "True"
      : containerStatuses.length > 0
        ? containerStatuses.every((status) => status.ready === true)
        : null;

  return {
    name: item.metadata?.name ?? null,
    uid: item.metadata?.uid ?? null,
    image: item.spec?.containers?.[0]?.image ?? containerStatuses[0]?.image ?? null,
    imageID: containerStatuses[0]?.imageID ?? null,
    phase: item.status?.phase ?? null,
    ready,
    readyReason: readyCondition?.reason ?? null,
    containerReadyCount: containerStatuses.filter(
      (status) => status.ready === true,
    ).length,
    containerCount: containerStatuses.length,
    initContainerReadyCount: initContainerStatuses.filter(containerStatusCompleted)
      .length,
    initContainerCount: initContainerStatuses.length,
    initReason:
      (pendingInitStatus ? readContainerStatusReason(pendingInitStatus) : null) ??
      (firstInitStatus ? readContainerStatusReason(firstInitStatus) : null),
    initExitCode: initExitCodeStatus
      ? readTerminatedExitCode(initExitCodeStatus)
      : null,
    reason:
      waiting?.reason ?? terminated?.reason ?? item.status?.reason ?? null,
    exitCode:
      typeof terminated?.exitCode === "number" ? terminated.exitCode : null,
  };
}

function parseKubernetesEventListPayload(
  payloadText: string,
): KubernetesEventListPayload {
  return JSON.parse(payloadText || "{}") as KubernetesEventListPayload;
}

function eventTimestamp(item: KubernetesEventItem): string {
  return item.lastTimestamp ?? item.eventTime ?? item.metadata?.creationTimestamp ?? "";
}

function eventTimestampMs(item: KubernetesEventItem): number {
  const timestamp = eventTimestamp(item);
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEventText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function truncateEventMessage(value: string, maxLength = 240): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export function redactKubernetesEventMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}/g, "sk-<redacted>")
    .replace(
      /\b(ASBCP_SERVICE_KEY|MBOS_AGENT_KEY|AGENT_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN|SERVICE_TOKEN|TOKEN|API_KEY|PASSWORD|SECRET|api_key|token|password|secret)\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}<redacted>`,
    );
}

export function summarizeWorkloadPodEvents(
  payloadText: string,
  limit = 8,
): string[] {
  let payload: KubernetesEventListPayload;
  try {
    payload = parseKubernetesEventListPayload(payloadText);
  } catch {
    return ["<unavailable:invalid_events_json>"];
  }

  return (payload.items ?? [])
    .slice()
    .sort((left, right) => eventTimestampMs(left) - eventTimestampMs(right))
    .slice(-limit)
    .map((item) => {
      const type = normalizeEventText(item.type) || "Event";
      const reason = normalizeEventText(item.reason) || "Unknown";
      const count =
        typeof item.count === "number" ? ` count=${item.count}` : "";
      const timestamp = eventTimestamp(item);
      const last = timestamp ? ` last=${timestamp}` : "";
      const message = truncateEventMessage(
        redactKubernetesEventMessage(normalizeEventText(item.message)),
      );
      return `${type}/${reason}${count}${last}: ${message || "<empty>"}`;
    });
}

async function fetchManagedWorkloadPods(namespace: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return spawnAndCapture(
    "kubectl",
    [
      "get",
      "pods",
      "-n",
      namespace,
      "-l",
      "app=managed-workload",
      "-o",
      "json",
    ],
    {
      env: withoutProxyEnv(process.env),
      timeoutMs: 10_000,
      timeoutLabel: "kubectl_get_managed_workload_pods",
    },
  );
}

async function fetchWorkloadPodSnapshot(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
}): Promise<WorkloadPodSnapshot | null> {
  const result = await fetchManagedWorkloadPods(args.namespace);
  if (result.code !== 0) return null;
  const selection = selectManagedWorkloadPodItem({
    payloadText: result.stdout,
    workloadId: args.workloadId,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
  });
  return selection ? parseWorkloadPodItemSnapshot(selection.item) : null;
}

async function fetchWorkloadPodEventSummary(args: {
  namespace: string;
  podName: string;
}): Promise<string[]> {
  try {
    const result = await spawnAndCapture(
      "kubectl",
      [
        "get",
        "events",
        "-n",
        args.namespace,
        "--field-selector",
        `involvedObject.name=${args.podName}`,
        "-o",
        "json",
      ],
      {
        env: withoutProxyEnv(process.env),
        timeoutMs: 10_000,
        timeoutLabel: "kubectl_get_workload_pod_events",
      },
    );
    if (result.code !== 0) {
      return [`<unavailable:kubectl_exit_${result.code}>`];
    }
    const summary = summarizeWorkloadPodEvents(result.stdout);
    return summary.length > 0 ? summary : ["<none>"];
  } catch (error) {
    const message = redactKubernetesEventMessage(
      error instanceof Error ? error.message : String(error),
    )
      .replace(/\s+/g, "_")
      .slice(0, 80);
    return [`<unavailable:kubectl_error:${message || "unknown"}>`];
  }
}

export async function expectManagedWorkloadPodImage(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  expectedImage: string;
  timeoutMs?: number;
}): Promise<WorkloadPodSnapshot> {
  let latestPod: WorkloadPodSnapshot | null = null;
  await expect
    .poll(
      async () => {
        latestPod = await fetchWorkloadPodSnapshot({
          namespace: args.namespace,
          workloadId: args.workloadId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        });
        return latestPod?.image ?? null;
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(args.expectedImage);
  if (!latestPod) {
    throw new Error(`managed_workload_pod_image_not_observed:${args.workloadId}`);
  }
  return latestPod;
}

async function readArtifactText(artifactPath?: string): Promise<string | null> {
  if (!artifactPath) return null;
  try {
    return await (
      await import("node:fs/promises")
    ).readFile(artifactPath, "utf-8");
  } catch {
    return null;
  }
}

function scopeTaskActivityToRunnerOutputBoundary(
  activity: IntegrationTaskActivitySnapshot[],
  runnerOutputActivityId?: string,
): IntegrationTaskActivitySnapshot[] {
  const scopedRunnerOutputActivityId = runnerOutputActivityId?.trim();
  if (!scopedRunnerOutputActivityId) {
    return activity;
  }
  const runnerOutputIndex = activity.findIndex(
    (item) => item.id?.trim() === scopedRunnerOutputActivityId,
  );
  if (runnerOutputIndex < 0) {
    return activity;
  }
  let startIndex = runnerOutputIndex;
  for (let index = runnerOutputIndex - 1; index >= 0; index -= 1) {
    const item = activity[index];
    if (item?.kind === "user_intent" && item.actor === "user") {
      startIndex = index;
      break;
    }
  }
  return activity.slice(startIndex, runnerOutputIndex + 1);
}

function findTerminalRunnerOutputError(
  activity: IntegrationTaskActivitySnapshot[],
): string | null {
  const terminalErrorPrefix =
    "Execution failed before any visible output was produced.";
  for (const item of [...activity].reverse()) {
    if (item.kind !== "runner_output" || item.actor !== "runner") continue;
    const content = (item.content ?? "").trim();
    if (!content) continue;
    if (content.includes("agent_task_runner_mode_invalid:")) return content;
    if (
      content.startsWith(terminalErrorPrefix) &&
      content.includes("Error code:")
    )
      return content;
  }
  return null;
}

export async function requestTaskWorkspaceAccess(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<{
  task_id: string;
  file_library_id: string;
  file_library_name: string;
  runtime_profile: "managed" | "developer";
  task_home_binding: {
    binding_id: string;
    provider: "afscp";
    mode: "pre_mounted";
    task_id: string;
    file_library_id: string;
    task_home_segment: string;
    generation: string;
    holder: {
      holder_id: string;
      holder_kind: "runner_workspace" | "terminal_session" | "notebook_run";
      binding_generation: string;
      lease_epoch: string;
      issued_at: string;
      expires_at: string;
    };
    paths: {
      task_home_path: string;
      workspace_path: string;
      artifacts_path: string;
      library_root_path: ".";
    };
  };
}> {
  const authToken = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/workspace-access`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `task_workspace_access_failed:${response.status()}:${body}`,
    );
  }
  const payload = await response.json();
  const serialized = JSON.stringify(payload);
  if (/metadata_url|storage_bucket_url|recommended_mount|filesystem_name|juicefs\s+mount/i.test(serialized)) {
    throw new Error("task_workspace_access_raw_storage_material");
  }
  return payload as Awaited<ReturnType<typeof requestTaskWorkspaceAccess>>;
}

export function resolveWorkspaceLibraryRootPath(input: {
  libraryRootPath?: string | null;
}): string {
  const value = input.libraryRootPath ?? ".";
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : ".";
}

export function resolveMountedTaskRoot(
  mountPath: string,
  input?: {
    libraryRootPath?: string | null;
  },
): string {
  const libraryRootPath = resolveWorkspaceLibraryRootPath({
    libraryRootPath: input?.libraryRootPath,
  });
  if (libraryRootPath === ".") return mountPath;
  return path.join(mountPath, libraryRootPath);
}

export function resolveLibraryObjectPath(
  relativePath: string,
  input?: {
    libraryRootPath?: string | null;
  },
): string {
  const libraryRootPath = resolveWorkspaceLibraryRootPath({
    libraryRootPath: input?.libraryRootPath,
  });
  if (libraryRootPath === ".") return relativePath;
  return `${libraryRootPath.replace(/^\/+|\/+$/g, "")}/${relativePath}`;
}

export async function collectInternalTaskFailureContext(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runnerOutputActivityId?: string;
  runId?: string;
  namespace?: string;
  workloadId?: string;
  authToken?: string | null;
}): Promise<string> {
  const authToken = args.authToken ?? (await readStoredAuthToken(args.page));
  const [activity, traces, task, pod] = await Promise.all([
    fetchTaskActivitySnapshot({ ...args, authToken }),
    fetchTaskTracesSnapshot({
      ...args,
      authToken,
      messageId: args.runnerOutputActivityId,
      runId: args.runId,
    }),
    fetchTaskRealtimeSnapshot({ ...args, authToken }),
    args.namespace && args.workloadId
      ? fetchWorkloadPodSnapshot({
          namespace: args.namespace,
          workloadId: args.workloadId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        })
      : Promise.resolve(null),
  ]);
  const activitySummary = summarizeAgentTaskActivity(
    scopeTaskActivityToRunnerOutputBoundary(
      activity,
      args.runnerOutputActivityId,
    ),
  );
  const traceSummary = summarizeAgentTaskTraces(traces);
  const podSummary = summarizeAgentTaskPod(pod);
  const podEventSummary =
    args.namespace && pod?.name
      ? await fetchWorkloadPodEventSummary({
          namespace: args.namespace,
          podName: pod.name,
        })
      : [];
  const podDetails = [
    args.runnerOutputActivityId
      ? `runner_output_activity_id=${args.runnerOutputActivityId}`
      : null,
    args.runId ? `run_id=${args.runId}` : null,
    pod?.uid ? `uid=${pod.uid}` : null,
    typeof pod?.ready === "boolean" ? `ready=${pod.ready}` : null,
    pod?.readyReason ? `ready_reason=${pod.readyReason}` : null,
    typeof pod?.containerReadyCount === "number" &&
    typeof pod?.containerCount === "number"
      ? `containers_ready=${pod.containerReadyCount}/${pod.containerCount}`
      : null,
    typeof pod?.initContainerReadyCount === "number" &&
    typeof pod?.initContainerCount === "number" &&
    pod.initContainerCount > 0
      ? `init_containers_ready=${pod.initContainerReadyCount}/${pod.initContainerCount}`
      : null,
    pod?.initReason ? `init_reason=${pod.initReason}` : null,
    typeof pod?.initExitCode === "number"
      ? `init_exit_code=${pod.initExitCode}`
      : null,
  ].filter(Boolean);
  const sections = [
    `task=${args.taskId}`,
    `run_state=${task?.run_state ?? "<unknown>"}`,
    `active_run=${task?.active_run?.status ?? "<none>"}`,
    `activity:\n${activitySummary.length > 0 ? activitySummary.join("\n") : "<none>"}`,
    `traces:\n${traceSummary.length > 0 ? traceSummary.join("\n") : "<none>"}`,
    `pod=${podDetails.length > 0 ? `${podSummary} ${podDetails.join(" ")}` : podSummary}`,
    podEventSummary.length > 0
      ? `pod_events:\n${podEventSummary.join("\n")}`
      : null,
  ].filter(Boolean);
  return sections.join("\n\n");
}

export async function waitForAgentTaskExecutionOutcome(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  runnerOutputActivityId?: string;
  runId?: string;
  artifactPath?: string;
  minRunnerOutputs?: number;
  namespace?: string;
  workloadId?: string;
  timeoutMs?: number;
  startEvidenceTimeoutMs?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  const timeoutMs = args.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  let attempt = 0;
  let podSeenBefore = false;

  while (Date.now() - startedAt < timeoutMs) {
    const [activity, traces, task, artifactText, pod] = await Promise.all([
      fetchTaskActivitySnapshot({ ...args, authToken }),
      fetchTaskTracesSnapshot({
        ...args,
        authToken,
        messageId: args.runnerOutputActivityId,
        runId: args.runId,
      }),
      fetchTaskRealtimeSnapshot({ ...args, authToken }),
      readArtifactText(args.artifactPath),
      args.namespace && args.workloadId
        ? fetchWorkloadPodSnapshot({
            namespace: args.namespace,
            workloadId: args.workloadId,
            workspaceId: args.workspaceId,
            projectId: args.projectId,
          })
        : Promise.resolve(null),
    ]);

    if (pod?.name) podSeenBefore = true;

    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: args.token,
      runnerOutputActivityId: args.runnerOutputActivityId,
      runId: args.runId,
      minRunnerOutputs: args.minRunnerOutputs,
      activity,
      traces,
      task,
      artifactContent: artifactText,
      pod,
      podSeenBefore,
    });

    if (outcome.success) return;

    if (outcome.failure) {
      const context = await collectInternalTaskFailureContext({
        page: args.page,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        taskId: args.taskId,
        runnerOutputActivityId: args.runnerOutputActivityId,
        runId: args.runId,
        namespace: args.namespace,
        workloadId: args.workloadId,
        authToken,
      });
      throw new Error(
        `agent_task_execution_failed:${outcome.reason ?? "unknown"}\n\n${context}`,
      );
    }

    const executionTraceCount = traces.filter(
      (trace) => trace.category !== "debug",
    ).length;
    const noExecutionSignals =
      !outcome.activityHasToken &&
      !(artifactText?.includes(args.token) === true) &&
      executionTraceCount === 0;
    const startEvidenceTimeoutMs = args.startEvidenceTimeoutMs ?? null;
    if (
      startEvidenceTimeoutMs != null &&
      Date.now() - startedAt >= startEvidenceTimeoutMs &&
      noExecutionSignals
    ) {
      const context = await collectInternalTaskFailureContext({
        page: args.page,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        taskId: args.taskId,
        runnerOutputActivityId: args.runnerOutputActivityId,
        runId: args.runId,
        namespace: args.namespace,
        workloadId: args.workloadId,
        authToken,
      });
      const stallReason =
        pod?.name == null
          ? "workload_pod_missing_without_execution_signal"
          : pod.ready === false
            ? "workload_pod_not_ready_without_execution_signal"
            : pod.ready === true
              ? "workload_pod_ready_without_execution_signal"
              : "workload_pod_present_without_execution_signal";
      throw new Error(
        `agent_task_execution_stalled:${stallReason}:${startEvidenceTimeoutMs}ms\n\n${context}`,
      );
    }

    const intervals = [1_000, 2_000, 5_000];
    const delay = intervals[Math.min(attempt, intervals.length - 1)] ?? 5_000;
    attempt += 1;
    await args.page.waitForTimeout(delay);
  }

  const timeoutContext = await collectInternalTaskFailureContext({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    runnerOutputActivityId: args.runnerOutputActivityId,
    runId: args.runId,
    namespace: args.namespace,
    workloadId: args.workloadId,
    authToken,
  });
  throw new Error(
    `agent_task_execution_timeout:${args.taskId}\n\n${timeoutContext}`,
  );
}

async function readAfscpStorageCsiStatus(namespace: string): Promise<{
  desired: number;
  available: number;
  controllerReady: number;
  restartCountSum: number;
  nodePodsReady: boolean;
}> {
  const [daemonSet, controller, pods] = await Promise.all([
    spawnAndCapture(
      "kubectl",
      ["get", "daemonset", "juicefs-csi-node", "-n", namespace, "-o", "json"],
      {
        env: withoutProxyEnv(process.env),
        timeoutMs: 10_000,
        timeoutLabel: "kubectl_get_juicefs_csi_daemonset",
      },
    ),
    spawnAndCapture(
      "kubectl",
      [
        "get",
        "statefulset",
        "juicefs-csi-controller",
        "-n",
        namespace,
        "-o",
        "json",
      ],
      {
        env: withoutProxyEnv(process.env),
        timeoutMs: 10_000,
        timeoutLabel: "kubectl_get_juicefs_csi_controller",
      },
    ),
    spawnAndCapture(
      "kubectl",
      [
        "get",
        "pods",
        "-n",
        namespace,
        "-l",
        "app=juicefs-csi-node",
        "-o",
        "json",
      ],
      {
        env: withoutProxyEnv(process.env),
        timeoutMs: 10_000,
        timeoutLabel: "kubectl_get_juicefs_csi_node_pods",
      },
    ),
  ]);

  if (daemonSet.code !== 0 || controller.code !== 0 || pods.code !== 0) {
    throw new Error("afscp_storage_csi_status_unavailable");
  }

  const daemonSetJson = JSON.parse(daemonSet.stdout || "{}") as {
    status?: { desiredNumberScheduled?: number; numberAvailable?: number };
  };
  const controllerJson = JSON.parse(controller.stdout || "{}") as {
    status?: { readyReplicas?: number };
  };
  const podsJson = JSON.parse(pods.stdout || "{}") as {
    items?: Array<{
      status?: {
        containerStatuses?: Array<{ ready?: boolean; restartCount?: number }>;
      };
    }>;
  };

  const nodePods = podsJson.items ?? [];
  const restartCountSum = nodePods.reduce((sum, pod) => {
    return (
      sum +
      (pod.status?.containerStatuses ?? []).reduce(
        (podSum, status) => podSum + (status.restartCount ?? 0),
        0,
      )
    );
  }, 0);
  const nodePodsReady =
    nodePods.length > 0 &&
    nodePods.every((pod) => {
      const statuses = pod.status?.containerStatuses ?? [];
      return (
        statuses.length > 0 && statuses.every((status) => status.ready === true)
      );
    });

  return {
    desired: daemonSetJson.status?.desiredNumberScheduled ?? 0,
    available: daemonSetJson.status?.numberAvailable ?? 0,
    controllerReady: controllerJson.status?.readyReplicas ?? 0,
    restartCountSum,
    nodePodsReady,
  };
}

async function detectAfscpStorageCsiNamespace(): Promise<string> {
  const configuredNamespace =
    process.env.AFSCP_STORAGE_CSI_NAMESPACE?.trim();
  if (configuredNamespace) {
    return configuredNamespace;
  }

  const [controllerNamespace, nodeNamespace] = await Promise.all([
    spawnAndCapture("kubectl", ["get", "statefulset", "-A", "--no-headers"], {
      env: withoutProxyEnv(process.env),
      timeoutMs: 10_000,
      timeoutLabel: "kubectl_list_statefulsets_for_csi_namespace",
    }),
    spawnAndCapture("kubectl", ["get", "daemonset", "-A", "--no-headers"], {
      env: withoutProxyEnv(process.env),
      timeoutMs: 10_000,
      timeoutLabel: "kubectl_list_daemonsets_for_csi_namespace",
    }),
  ]);

  const preferredNamespace = "kube-system";
  const hasController = (controllerNamespace.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .some((line) => {
      const [namespace, name] = line.split(/\s+/);
      return (
        namespace === preferredNamespace && name === "juicefs-csi-controller"
      );
    });
  if (hasController) {
    return preferredNamespace;
  }

  const hasNode = (nodeNamespace.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .some((line) => {
      const [namespace, name] = line.split(/\s+/);
      return namespace === preferredNamespace && name === "juicefs-csi-node";
    });
  if (hasNode) {
    return preferredNamespace;
  }

  return preferredNamespace;
}

export async function waitForAfscpStorageCsiReady(args?: {
  namespace?: string;
  timeoutMs?: number;
  stableWindowMs?: number;
}): Promise<void> {
  const namespace =
    args?.namespace?.trim() || (await detectAfscpStorageCsiNamespace());
  const timeoutMs = args?.timeoutMs ?? 180_000;
  const stableWindowMs = args?.stableWindowMs ?? 15_000;
  const startedAt = Date.now();
  let lastRestartCount: number | null = null;
  let stableSince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await readAfscpStorageCsiStatus(namespace);
      const ready =
        status.desired > 0 &&
        status.available >= status.desired &&
        status.controllerReady >= 1 &&
        status.nodePodsReady;

      if (ready) {
        if (lastRestartCount === status.restartCountSum) {
          if (stableSince === 0) stableSince = Date.now();
          if (Date.now() - stableSince >= stableWindowMs) {
            return;
          }
        } else {
          lastRestartCount = status.restartCountSum;
          stableSince = Date.now();
        }
      } else {
        lastRestartCount = status.restartCountSum;
        stableSince = 0;
      }
    } catch {
      stableSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const status = await readAfscpStorageCsiStatus(namespace).catch(() => null);
  throw new Error(
    `afscp_storage_csi_not_ready:${namespace}:${status ? `desired=${status.desired}:available=${status.available}:controller_ready=${status.controllerReady}:restarts=${status.restartCountSum}:node_pods_ready=${status.nodePodsReady}` : "status_unavailable"}`,
  );
}

export async function runInternalSandboxControl(
  command: string,
): Promise<void> {
  const stateFile = process.env.INTERNAL_SANDBOX_REAL_STATE_FILE?.trim();
  if (!stateFile) {
    throw new Error("missing_INTERNAL_SANDBOX_REAL_STATE_FILE");
  }
  const result = await spawnAndCapture(
    "bash",
    ["scripts/lib/internal-sandbox-real-control.sh", command],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...withoutProxyEnv(process.env),
        INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      },
      timeoutMs: 90_000,
      timeoutLabel: `internal_sandbox_control_${command}`,
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `internal_sandbox_control_failed:${command}:${result.stderr || result.stdout}`,
    );
  }
}

export async function waitForWorkloadPodPresent(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<string> {
  let podName = "";
  await expect
    .poll(
      async () => {
        const result = await fetchManagedWorkloadPods(args.namespace);
        if (result.code !== 0) return null;
        const selection = selectManagedWorkloadPodItem({
          payloadText: result.stdout,
          workloadId: args.workloadId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        });
        podName = selection?.podName ?? "";
        return podName.length > 0 ? podName : null;
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .not.toBeNull();
  return podName;
}

export async function waitForWorkloadPodIdentity(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<{ name: string; uid: string }> {
  let pod = { name: "", uid: "" };
  await expect
    .poll(
      async () => {
        const result = await fetchManagedWorkloadPods(args.namespace);
        if (result.code !== 0) return null;
        const selection = selectManagedWorkloadPodItem({
          payloadText: result.stdout,
          workloadId: args.workloadId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        });
        pod = {
          name: selection?.podName ?? "",
          uid: selection?.item.metadata?.uid?.trim() ?? "",
        };
        return pod.name && pod.uid ? pod : null;
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .not.toBeNull();
  return pod;
}

export async function waitForWorkloadPodReady(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<WorkloadPodSnapshot & { name: string; uid: string; ready: true }> {
  const timeoutMs = args.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  let attempt = 0;
  let latestPod: WorkloadPodSnapshot | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    latestPod = await fetchWorkloadPodSnapshot({
      namespace: args.namespace,
      workloadId: args.workloadId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    if (
      latestPod?.name &&
      latestPod.uid &&
      latestPod.phase === "Running" &&
      latestPod.ready === true
    ) {
      return {
        ...latestPod,
        name: latestPod.name,
        uid: latestPod.uid,
        ready: true,
      };
    }

    const intervals = [1_000, 2_000, 5_000];
    const delay = intervals[Math.min(attempt, intervals.length - 1)] ?? 5_000;
    attempt += 1;
    await setTimeoutPromise(delay);
  }

  const podSummary = summarizeAgentTaskPod(latestPod);
  const readinessSummary = [
    latestPod?.uid ? `uid=${latestPod.uid}` : null,
    typeof latestPod?.ready === "boolean" ? `ready=${latestPod.ready}` : null,
    latestPod?.readyReason ? `ready_reason=${latestPod.readyReason}` : null,
    typeof latestPod?.containerReadyCount === "number" &&
    typeof latestPod?.containerCount === "number"
      ? `containers_ready=${latestPod.containerReadyCount}/${latestPod.containerCount}`
      : null,
  ].filter(Boolean);
  const summary =
    readinessSummary.length > 0
      ? `${podSummary} ${readinessSummary.join(" ")}`
      : podSummary;
  throw new Error(`workload_pod_ready_timeout:${args.workloadId}:${summary}`);
}

export async function waitForWorkloadPodDeleted(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await fetchManagedWorkloadPods(args.namespace);
        if (result.code !== 0) {
          throw new Error(
            `workload_pod_list_failed:${args.workloadId}:${result.stderr || result.stdout}`,
          );
        }
        const selection = selectManagedWorkloadPodItem({
          payloadText: result.stdout,
          workloadId: args.workloadId,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
        });
        return selection?.podName ?? "";
      },
      { timeout: args.timeoutMs ?? 300_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe("");
}

export async function patchWorkloadPodExpiry(args: {
  namespace: string;
  workloadId: string;
  workspaceId?: string;
  projectId?: string;
  expiresAt: string;
}): Promise<void> {
  const podName = await waitForWorkloadPodPresent({
    namespace: args.namespace,
    workloadId: args.workloadId,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    timeoutMs: 30_000,
  });
  const result = await spawnAndCapture(
    "kubectl",
    [
      "annotate",
      "pod",
      podName,
      "-n",
      args.namespace,
      `expires_at=${args.expiresAt}`,
      "--overwrite",
    ],
    {
      env: withoutProxyEnv(process.env),
      timeoutMs: 15_000,
      timeoutLabel: "kubectl_patch_workload_expiry",
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `patch_workload_expiry_failed:${podName}:${result.stderr || result.stdout}`,
    );
  }
}

export type InternalWorkloadDeleteResult = {
  status: number;
  released: boolean;
  notFound: boolean;
};

export async function releaseExpiredWorkloadsViaAsbcp(args: {
  namespace: string;
  workspaceId: string;
  projectId: string;
  workloadId: string;
  now?: Date;
}): Promise<{
  released: number;
  targets: ExpiredWorkloadReleaseTarget[];
}> {
  const result = await fetchManagedWorkloadPods(args.namespace);
  if (result.code !== 0) {
    throw new Error(
      `release_expired_workloads_list_failed:${args.workloadId}:${result.stderr || result.stdout}`,
    );
  }
  const targets = selectExpiredWorkloadReleaseTargets({
    payload: result.stdout,
    now: args.now,
    workloadId: args.workloadId,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
  });
  let released = 0;
  for (const target of targets) {
    const deleteResult = await deleteInternalWorkloadViaAsbcp({
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      workloadId: target.workloadId,
    });
    if (deleteResult.released) {
      released += 1;
      continue;
    }
  }
  return { released, targets };
}

export async function waitForExpiredWorkloadReleasedViaAsbcp(args: {
  namespace: string;
  workspaceId: string;
  projectId: string;
  workloadId: string;
  timeoutMs?: number;
}): Promise<void> {
  let observedExpiredTarget = false;
  await expect
    .poll(
      async () => {
        const result = await releaseExpiredWorkloadsViaAsbcp({
          namespace: args.namespace,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          workloadId: args.workloadId,
        });
        observedExpiredTarget = observedExpiredTarget || result.targets.length > 0;
        if (result.released > 0) return "released";
        return observedExpiredTarget
          ? "awaiting_asbcp_release_terminal_fact"
          : "waiting_for_expired_workload_target";
      },
      { timeout: args.timeoutMs ?? 60_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe("released");
}

export async function expectInternalTaskRuntimeStateInPod(args: {
  namespace: string;
  podName: string;
  taskId: string;
  taskHomePath?: string;
  timeoutMs?: number;
}): Promise<void> {
  const taskHomePath = args.taskHomePath ?? `/home/${args.taskId}`;
  await expect
    .poll(
      async () => {
        const script = [
          'task_home="$1"',
          'workspace="$task_home/workspace"',
          'config="$task_home/.codex/config.toml"',
          'catalog="$task_home/.codex/catalog.json"',
          'manifest="$task_home/.mbos/builtin-skills-manifest.json"',
          'skill="$task_home/.agents/skills/feishu-docs/SKILL.md"',
          'task_home_ready=0; [ -d "$task_home" ] && task_home_ready=1',
          'workspace_ready=0; [ -d "$workspace" ] && workspace_ready=1',
          'config_ready=0; [ -f "$config" ] && grep -q "model = " "$config" && config_ready=1',
          'catalog_ready=0; [ -f "$catalog" ] && grep -q "\\"models\\"" "$catalog" && catalog_ready=1',
          'manifest_ready=0; [ -f "$manifest" ] && grep -q "\\"feishu-docs\\"" "$manifest" && manifest_ready=1',
          'skill_ready=0; [ -f "$skill" ] && grep -qi "feishu" "$skill" && skill_ready=1',
          'printf "task_home=%s\\ntask_home_ready=%s\\nworkspace_ready=%s\\nconfig_ready=%s\\ncatalog_ready=%s\\nmanifest_ready=%s\\nskill_ready=%s\\n" "$task_home" "$task_home_ready" "$workspace_ready" "$config_ready" "$catalog_ready" "$manifest_ready" "$skill_ready"',
        ].join("\n");
        const result = await spawnAndCapture(
          "kubectl",
          [
            "exec",
            "-n",
            args.namespace,
            args.podName,
            "--",
            "sh",
            "-lc",
            script,
            "sh",
            taskHomePath,
          ],
          {
            env: withoutProxyEnv(process.env),
            timeoutMs: 20_000,
            timeoutLabel: "kubectl_exec_internal_task_runtime_state",
          },
        );
        const output = result.stdout;
        return {
          taskHomeReady: output.includes("task_home_ready=1"),
          workspaceReady: output.includes("workspace_ready=1"),
          codexConfigReady: output.includes("config_ready=1"),
          modelCatalogReady: output.includes("catalog_ready=1"),
          skillsManifestReady: output.includes("manifest_ready=1"),
          feishuSkillReady: output.includes("skill_ready=1"),
        };
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toEqual({
      taskHomeReady: true,
      workspaceReady: true,
      codexConfigReady: true,
      modelCatalogReady: true,
      skillsManifestReady: true,
      feishuSkillReady: true,
    });
}

export async function deleteInternalWorkloadViaAsbcp(args: {
  workspaceId: string;
  projectId: string;
  workloadId: string;
}): Promise<InternalWorkloadDeleteResult> {
  const asbcpBase = process.env.ASBCP_INTERNAL_BASE_URL?.trim();
  const serviceKey = process.env.ASBCP_SERVICE_KEY?.trim();
  if (!asbcpBase || !serviceKey) {
    throw new Error("asbcp_env_missing");
  }
  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(
      `${asbcpBase.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(args.workspaceId)}/projects/${encodeURIComponent(args.projectId)}/workloads/${encodeURIComponent(args.workloadId)}`,
      {
        method: "DELETE",
        headers: {
          "X-Service-Key": serviceKey,
        },
        signal: controller.signal,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `delete_internal_workload_request_failed:${args.workloadId}:timeout_ms=${timeoutMs}:${message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok) {
    return { status: response.status, released: true, notFound: false };
  }
  if (response.status === 404) {
    return { status: response.status, released: false, notFound: true };
  }
  const body = await response.text().catch(() => "");
  throw new Error(
    `delete_internal_workload_failed:${response.status}:${body}`,
  );
}

export async function waitForAgentPresenceOnline(
  page: Page,
  workspaceId: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  const token = await readStoredAuthToken(page);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agent-runners/${agentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { presence?: string };
        return body.presence ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe("online");
}

export async function expectAgentTaskConversationSurface(args: {
  page: Page;
  openTerminalAction?: "enabled" | "disabled" | "hidden";
  terminalModeEnabled?: boolean;
  blocked?: boolean;
  statusStrip?: "visible" | "hidden";
}): Promise<void> {
  const {
    page,
    openTerminalAction = "enabled",
    terminalModeEnabled = false,
    blocked = false,
    statusStrip = "hidden",
  } = args;

  await expect(page.getByTestId("agent-task__task-header")).toBeVisible({
    timeout: 30_000,
  });
  const conversationModeButton = page.getByTestId(
    "agent-task__task-header-mode-conversation",
  );
  const terminalModeButton = page.getByTestId(
    "agent-task__task-header-mode-terminal",
  );

  if (terminalModeEnabled) {
    await expect(conversationModeButton).toBeVisible({ timeout: 30_000 });
    await expect(terminalModeButton).toBeVisible({ timeout: 30_000 });
    await expect(terminalModeButton).toBeEnabled();
  } else {
    await expect(conversationModeButton).toHaveCount(0);
    await expect(terminalModeButton).toHaveCount(0);
  }

  const openTerminalActionButton = page.getByTestId(
    "agent-task__task-header-terminal-create",
  );
  if (openTerminalAction === "hidden") {
    await expect(openTerminalActionButton).toHaveCount(0);
  } else if (openTerminalAction === "disabled") {
    await expect(openTerminalActionButton).toBeVisible({ timeout: 30_000 });
    await expect(openTerminalActionButton).toBeDisabled();
  } else {
    await expect(openTerminalActionButton).toBeVisible({ timeout: 30_000 });
    await expect(openTerminalActionButton).toBeEnabled();
  }

  const statusStripLocator = page.getByTestId(
    "agent-tasks__task-terminal-status-strip",
  );
  if (statusStrip === "visible") {
    await expect(statusStripLocator).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(statusStripLocator).toHaveCount(0);
  }

  const blockedStateLocator = page.getByTestId(
    "agent-tasks__conversation-blocked-state",
  );
  if (blocked) {
    await expect(blockedStateLocator).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(blockedStateLocator).toHaveCount(0);
    const conversationInput = page.getByTestId(
      "agent-tasks__conversation-input",
    );
    await expect(conversationInput).toBeVisible({ timeout: 30_000 });
    await expect(conversationInput.locator("textarea").first()).toBeEnabled({
      timeout: 30_000,
    });
  }
}

export async function openChatSession(
  page: Page,
  workspaceId: string,
  projectId: string,
  expectedTitle: string,
): Promise<void> {
  await page.goto(
    `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/chat`,
  );
  await expect(page.getByTestId("chat__main-pane")).toBeVisible({
    timeout: 30_000,
  });
  const target = page
    .getByTestId("chat__thread-item")
    .filter({ hasText: expectedTitle })
    .first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  const composer = page.getByTestId("chat__composer").locator("textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
}

export type CodexRunnerProcessHandle = {
  proc: ChildProcessWithIgnoredStdin;
  logPath: string;
  workspaceRoot: string;
  resolveTaskWorkspaceRoot: () => Promise<string | null>;
  resolveTaskRuntimePaths: () => Promise<PreparedTaskRuntimePaths | null>;
  stop: () => Promise<void>;
};

type AgentTaskRunnerProcessStartArgs = {
  wsUrl: string;
  agentKey: string;
  scope: "runner_presence" | "task_execution";
  taskId?: string | null;
  codeBin?: string;
};

async function startAgentTaskRunnerProcessInternal(
  args: AgentTaskRunnerProcessStartArgs,
): Promise<CodexRunnerProcessHandle> {
  return new Promise((resolve, reject) => {
    const runnerWsUrl = resolveAgentTaskRunnerSocketUrl(
      args.scope === "task_execution"
        ? { wsUrl: args.wsUrl, scope: "task_execution", taskId: args.taskId }
        : { wsUrl: args.wsUrl, scope: "runner_presence" },
    );
    const logPath = path.join(
      tmpdir(),
      `agentsmith-agent-task-runner-${Date.now()}.log`,
    );
    const workspaceRoot = path.join(
      tmpdir(),
      `agentsmith-agent-task-workspaces-${Date.now()}`,
    );
    const builtinSkillsDir = path.resolve(
      __dirname,
      "../packages/agent-task-runner/builtin-skills",
    );
    const proc = spawn("npm", ["run", "agent:task-runner"], {
      env: {
        ...process.env,
        MBOS_RUNNER_MODE: "agent_task",
        MBOS_AGENT_WS_URL: runnerWsUrl,
        MBOS_AGENT_KEY: args.agentKey,
        MBOS_AGENT_CODEX_YOLO: "1",
        MBOS_AGENT_RUNNER_DEBUG: "1",
        MBOS_AGENT_TASK_RUNNER_MODE: "managed_local",
        MBOS_AGENT_WORKSPACE_ROOT: workspaceRoot,
        MBOS_AGENT_BUILTIN_SKILLS_DIR: builtinSkillsDir,
        MBOS_AGENT_BUILTIN_SKILLS: "mbos-context,feishu-docs,jira-ops",
        MBOS_AGENT_BUILTIN_SKILLS_REQUIRED: "1",
        ...(args.codeBin ? { CODEX_BIN: args.codeBin } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let resolved = false;
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(
        new Error(
          `codex_runner_start_timeout:${stderr.slice(-500)}:log=${logPath}`,
        ),
      );
    }, 30_000);

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      void appendFile(logPath, text, "utf-8");
      if (
        !resolved &&
        (text.includes("[agent-task-runner] connected") ||
          text.includes("websocket open"))
      ) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          proc,
          logPath,
          workspaceRoot,
          resolveTaskWorkspaceRoot: async () =>
            readPreparedTaskWorkspaceRootFromRunnerLog(logPath),
          resolveTaskRuntimePaths: async () =>
            readPreparedTaskRuntimePathsFromRunnerLog(logPath),
          stop: async () => {
            if (!proc.killed && proc.exitCode === null) {
              const pid = proc.pid;
              if (typeof pid === "number") {
                await killProcessTree(pid, "SIGTERM");
              } else {
                proc.kill("SIGTERM");
              }
              await new Promise<void>((done) => {
                const killTimeout = setTimeout(() => {
                  if (!proc.killed && proc.exitCode === null) {
                    if (typeof pid === "number") {
                      void killProcessTree(pid, "SIGKILL");
                    } else {
                      proc.kill("SIGKILL");
                    }
                  }
                  done();
                }, 5_000);
                proc.once("exit", () => {
                  clearTimeout(killTimeout);
                  done();
                });
              });
            }
            await rm(workspaceRoot, { recursive: true, force: true }).catch(
              () => undefined,
            );
          },
        });
      }
    };

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      void appendFile(logPath, text, "utf-8");
    });

    proc.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once("exit", (code) => {
      clearTimeout(timeout);
      if (!resolved && code !== 0) {
        reject(
          new Error(
            `codex_runner_exit_${String(code)}:${stderr.slice(-500)}:log=${logPath}`,
          ),
        );
      }
    });

    proc.stdout.on("data", onStdout);
  });
}

export async function startCodexRunnerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<CodexRunnerProcessHandle> {
  return startAgentTaskRunnerProcessInternal({
    ...args,
    scope: "runner_presence",
  });
}

export async function startTaskBoundCodexRunnerProcess(args: {
  wsUrl: string;
  agentKey: string;
  taskId: string;
  codeBin?: string;
}): Promise<CodexRunnerProcessHandle> {
  return startAgentTaskRunnerProcessInternal({
    ...args,
    scope: "task_execution",
  });
}

export async function reconnectCodexRunnerProcessToTask(args: {
  presenceRunner: CodexRunnerProcessHandle | null;
  wsUrl: string;
  agentKey: string;
  taskId: string;
  codeBin?: string;
}): Promise<CodexRunnerProcessHandle> {
  if (args.presenceRunner) {
    await args.presenceRunner.stop();
  }
  return startTaskBoundCodexRunnerProcess({
    wsUrl: args.wsUrl,
    agentKey: args.agentKey,
    taskId: args.taskId,
    codeBin: args.codeBin,
  });
}

export type CodexRunnerDockerHandle = {
  containerName: string;
  workspaceRoot: string;
  imageTag: string;
  logPath: string;
  resolveTaskRuntimePaths: () => Promise<PreparedTaskRuntimePaths | null>;
  stop: () => Promise<void>;
};

type AgentTaskRunnerDockerStartArgs = {
  wsUrl: string;
  agentKey: string;
  scope: "runner_presence" | "task_execution";
  taskId?: string | null;
  codeBin?: string;
};

async function startAgentTaskRunnerDockerProcessInternal(
  args: AgentTaskRunnerDockerStartArgs,
): Promise<CodexRunnerDockerHandle> {
  const baseImageTag =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE?.trim() ||
    "agentsmith-agent-task-runner-base:local";
  const imageTag =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE?.trim() ||
    "agentsmith-agent-task-runner:local";
  const embeddedRunner =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED?.trim() === "1";
  const rebuildBaseImage =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE?.trim() ===
    "1";
  const rebuildRunnerImage =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE?.trim() !== "0";
  const runnerWsUrl = resolveAgentTaskRunnerSocketUrl(
    args.scope === "task_execution"
      ? { wsUrl: args.wsUrl, scope: "task_execution", taskId: args.taskId }
      : { wsUrl: args.wsUrl, scope: "runner_presence" },
  );
  const builtinSkillsList =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS?.trim() ??
    "mbos-context,feishu-docs,jira-ops";
  const builtinSkillsRequired =
    process.env.INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED?.trim() ??
    "1";
  const builtinSkillsDir = embeddedRunner
    ? process.env.INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR?.trim() ||
      "/etc/codex/skills"
    : "/etc/codex/skills";
  const buildContext = path.resolve(__dirname, "..");
  const inspectResult = await spawnAndCapture("docker", [
    "image",
    "inspect",
    imageTag,
  ]);
  if (inspectResult.code !== 0 || (!embeddedRunner && rebuildRunnerImage)) {
    if (embeddedRunner) {
      throw new Error(`docker_runner_image_missing:${imageTag}`);
    }
    const buildResult = await spawnAndCapture(
      "bash",
      [
        path.join(buildContext, "scripts/build-runner-image.sh"),
        "agent-task",
        baseImageTag,
        imageTag,
        buildContext,
      ],
      {
        cwd: buildContext,
        env: {
          ...process.env,
          RUNNER_IMAGE_DOCKER_BUILD_PROXY: DOCKER_BUILD_PROXY.trim(),
          RUNNER_IMAGE_BUILD_BASE: rebuildBaseImage ? "1" : "0",
          RUNNER_IMAGE_REBUILD: rebuildRunnerImage ? "1" : "0",
        },
      },
    );
    if (buildResult.code !== 0) {
      throw new Error(
        `docker_runner_image_build_failed:${(buildResult.stderr || buildResult.stdout).slice(-800)}`,
      );
    }
  }

  const workspaceRoot = path.join(
    tmpdir(),
    `agentsmith-agent-task-docker-workspaces-${Date.now()}`,
  );
  await mkdir(workspaceRoot, { recursive: true });
  const containerName = `agentsmith-agent-task-runner-${Date.now()}`;
  const requestedRunnerLogDir =
    process.env.INTEGRATION_RUNNER_LOG_DIR?.trim() ||
    path.join(process.cwd(), "test-results", "runner-logs");
  let runnerLogDir = requestedRunnerLogDir;
  try {
    await mkdir(runnerLogDir, { recursive: true });
  } catch {
    runnerLogDir = path.join(tmpdir(), "agentsmith-runner-logs");
    await mkdir(runnerLogDir, { recursive: true });
  }
  const requestedRunnerLogPath = path.join(
    runnerLogDir,
    `${containerName}.log`,
  );
  let runnerLogPath = requestedRunnerLogPath;
  const writeRunnerLog = async (body: string): Promise<void> => {
    try {
      await writeFile(requestedRunnerLogPath, body, "utf-8");
      runnerLogPath = requestedRunnerLogPath;
      return;
    } catch {
      const fallbackDir = path.join(tmpdir(), "agentsmith-runner-logs");
      await mkdir(fallbackDir, { recursive: true });
      const fallbackPath = path.join(fallbackDir, `${containerName}.log`);
      await writeFile(fallbackPath, body, "utf-8");
      runnerLogPath = fallbackPath;
      console.warn(
        `[integration-real-helpers] runner log fallback: ${requestedRunnerLogPath} -> ${fallbackPath}`,
      );
    }
  };
  const preserveRunnerLogs = async (): Promise<void> => {
    const logs = await spawnAndCapture("docker", ["logs", containerName]).catch(
      () => ({
        code: 1,
        stdout: "",
        stderr: "",
      }),
    );
    const logBody =
      `${logs.stdout}${logs.stdout && logs.stderr ? "\n" : ""}${logs.stderr}`.trim();
    if (logBody.length > 0) {
      await writeRunnerLog(`${logBody}\n`);
    } else {
      await writeRunnerLog("[runner log unavailable]\n");
    }
  };
  const runArgs = [
    "run",
    "--detach",
    "--name",
    containerName,
    "--network",
    "host",
    "--add-host",
    "host.docker.internal:host-gateway",
    "--privileged",
    "--device",
    "/dev/fuse",
    "--security-opt",
    "apparmor:unconfined",
    "--env",
    "MBOS_RUNNER_MODE=agent_task",
    "--env",
    `MBOS_AGENT_WS_URL=${runnerWsUrl}`,
    "--env",
    `MBOS_AGENT_KEY=${args.agentKey}`,
    "--env",
    "MBOS_AGENT_CODEX_YOLO=1",
    "--env",
    "MBOS_AGENT_RUNNER_DEBUG=1",
    "--env",
    "MBOS_AGENT_TASK_RUNNER_MODE=managed_local",
    "--env",
    `MBOS_AGENT_WORKSPACE_READY_TIMEOUT_MS=${process.env.INTEGRATION_AGENT_TASK_RUNNER_WORKSPACE_READY_TIMEOUT_MS?.trim() || "120000"}`,
    "--env",
    "MBOS_AGENT_WORKSPACE_ROOT=/home",
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS_DIR=${builtinSkillsDir}`,
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS=${builtinSkillsList}`,
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=${builtinSkillsRequired}`,
    "--volume",
    `${workspaceRoot}:/home:rshared`,
  ];
  if (args.codeBin) {
    runArgs.push("--env", `CODEX_BIN=${args.codeBin}`);
  }
  if (!embeddedRunner) {
    runArgs.push("--volume", `${buildContext}:/app`);
  }
  runArgs.push(imageTag);

  const runResult = await spawnAndCapture("docker", runArgs);
  if (runResult.code !== 0) {
    throw new Error(
      `docker_runner_start_failed:${runResult.stderr.slice(-800)}`,
    );
  }

  const started = (runResult.stdout || "").trim();
  if (!started) {
    throw new Error("docker_runner_start_missing_container_id");
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = await spawnAndCapture("docker", ["logs", containerName]);
    if (
      `${logs.stdout}\n${logs.stderr}`.includes("[agent-task-runner] connected")
    ) {
      await preserveRunnerLogs();
      return {
        containerName,
        workspaceRoot,
        imageTag,
        logPath: runnerLogPath,
        resolveTaskRuntimePaths: async () => {
          const currentLogs = await spawnAndCapture("docker", [
            "logs",
            containerName,
          ]).catch(() => ({
            code: 1,
            stdout: "",
            stderr: "",
          }));
          const parsed = findPreparedTaskRuntimePathsInRunnerLog(
            `${currentLogs.stdout}\n${currentLogs.stderr}`,
          );
          if (parsed)
            return rewritePreparedTaskRuntimePathsPrefix(
              parsed,
              "/home",
              workspaceRoot,
            );
          await preserveRunnerLogs();
          const fromLog =
            await readPreparedTaskRuntimePathsFromRunnerLog(runnerLogPath);
          return fromLog
            ? rewritePreparedTaskRuntimePathsPrefix(
                fromLog,
                "/home",
                workspaceRoot,
              )
            : null;
        },
        stop: async () => {
          await preserveRunnerLogs();
          await spawnAndCapture("docker", ["rm", "-f", containerName]);
          await rm(workspaceRoot, { recursive: true, force: true }).catch(
            () => undefined,
          );
        },
      };
    }
    const inspectRunning = await spawnAndCapture("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerName,
    ]);
    if (inspectRunning.code !== 0 || !inspectRunning.stdout.includes("true")) {
      await preserveRunnerLogs();
      const inspectDetails = await spawnAndCapture("docker", [
        "inspect",
        "-f",
        "running={{.State.Running}} exit={{.State.ExitCode}} error={{.State.Error}} oom={{.State.OOMKilled}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}",
        containerName,
      ]);
      await spawnAndCapture("docker", ["rm", "-f", containerName]);
      await rm(workspaceRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw new Error(
        `docker_runner_exit:${`${logs.stdout}\n${logs.stderr}`.slice(-1200)}:inspect=${inspectDetails.stdout.trim()}:log=${runnerLogPath}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await preserveRunnerLogs();
  const logs = await spawnAndCapture("docker", ["logs", containerName]);
  await spawnAndCapture("docker", ["rm", "-f", containerName]);
  throw new Error(
    `docker_runner_connect_timeout:${`${logs.stdout}\n${logs.stderr}`.slice(-1200)}:log=${runnerLogPath}`,
  );
}

export async function startCodexRunnerDockerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<CodexRunnerDockerHandle> {
  return startAgentTaskRunnerDockerProcessInternal({
    ...args,
    scope: "runner_presence",
  });
}

export async function startTaskBoundCodexRunnerDockerProcess(args: {
  wsUrl: string;
  agentKey: string;
  taskId: string;
  codeBin?: string;
}): Promise<CodexRunnerDockerHandle> {
  return startAgentTaskRunnerDockerProcessInternal({
    ...args,
    scope: "task_execution",
  });
}

export async function reconnectCodexRunnerDockerProcessToTask(args: {
  presenceRunner: CodexRunnerDockerHandle | null;
  wsUrl: string;
  agentKey: string;
  taskId: string;
  codeBin?: string;
}): Promise<CodexRunnerDockerHandle> {
  if (args.presenceRunner) {
    await args.presenceRunner.stop();
  }
  return startTaskBoundCodexRunnerDockerProcess({
    wsUrl: args.wsUrl,
    agentKey: args.agentKey,
    taskId: args.taskId,
    codeBin: args.codeBin,
  });
}

export async function mountFileLibraryLocally(): Promise<never> {
  throw new Error("file_library_local_mount_unavailable");
}

export async function waitForMountedWorkspacePath(
  mountPath: string,
  relativePath: string,
  timeoutMs = 90_000,
): Promise<string> {
  const absolutePath = path.join(mountPath, relativePath);
  const parentPath = path.dirname(absolutePath);
  const startedAt = Date.now();
  for (;;) {
    try {
      await access(parentPath);
      await access(absolutePath);
      return absolutePath;
    } catch {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`mounted_workspace_path_timeout:${relativePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function waitForAnyMountedWorkspacePath(
  mountPath: string,
  relativePaths: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const candidates = relativePaths.map((relativePath) => ({
    relativePath,
    absolutePath: path.join(mountPath, relativePath),
  }));
  const startedAt = Date.now();
  for (;;) {
    for (const candidate of candidates) {
      try {
        await access(candidate.absolutePath);
        return candidate.absolutePath;
      } catch {
        // keep polling until one candidate becomes visible
      }
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `mounted_workspace_path_timeout_any:${relativePaths.join(",")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function createFileLibraryViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<string> {
  await page.goto(
    `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/files`,
  );
  await expect(page.getByTestId("files__library-create")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("files__library-create").click();
  const dialog = page.getByTestId("files__dialog__library-create");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("files__library-create__name").fill(name);
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .includes(
          `/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
        ),
  );
  await dialog.getByTestId("files__library-create__submit").click();
  const createResponse = await createResponsePromise;
  if (!createResponse.ok()) {
    throw new Error(
      `create_file_library_failed:${createResponse.status()}:${await createResponse.text()}`,
    );
  }
  const libraryItem = page
    .locator('[data-testid^="files__library-item--"]')
    .filter({ hasText: name })
    .first();
  await expect(libraryItem).toBeVisible({
    timeout: 30_000,
  });
  const libraryId = (await libraryItem.getAttribute("data-testid"))?.replace(
    "files__library-item--",
    "",
  );
  if (!libraryId) {
    throw new Error(`file_library_id_not_found:${name}`);
  }
  return libraryId;
}
