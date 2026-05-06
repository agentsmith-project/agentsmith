import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { createHash } from "node:crypto";
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
export const BACKEND_REAL_ANTHROPIC_BASE_URL =
  process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ??
  "https://anthropic-compatible.provider.example/v1";
export const BACKEND_REAL_MODEL =
  process.env.BACKEND_REAL_MODEL ?? "placeholder-model";
export const BACKEND_REAL_OPENAI_BASE_URL =
  process.env.BACKEND_REAL_OPENAI_BASE_URL ??
  "https://openai-compatible.provider.example/v1";
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
const TASK_WORKSPACE_MOUNT_SESSIONS_FILE = "task-workspace-mount-sessions.json";
const DEFAULT_TERMINAL_SESSION_CREATE_TIMEOUT_MS = 300_000;
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

function sanitizeRunnerRuntimePathPart(
  input: string | null | undefined,
  fallback: string,
): string {
  const value = (input ?? "").trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || fallback;
}

export function normalizeVisibleWorkspaceRootForRunnerRuntime(
  visibleRoot: string,
): string {
  const root = visibleRoot.trim() || "task-workspace";
  const normalizedRoot = path.normalize(root).replace(/\\/g, "/");
  if (normalizedRoot === "/") return normalizedRoot;
  return normalizedRoot.replace(/\/+$/, "") || "task-workspace";
}

export function buildRunnerRuntimeRootPathPart(visibleRoot: string): string {
  const normalizedVisibleRoot =
    normalizeVisibleWorkspaceRootForRunnerRuntime(visibleRoot);
  const visibleRootName = sanitizeRunnerRuntimePathPart(
    path.basename(normalizedVisibleRoot),
    "task-workspace",
  );
  const visibleRootHash = createHash("sha256")
    .update(normalizedVisibleRoot)
    .digest("hex")
    .slice(0, 16);
  return `${visibleRootName}-${visibleRootHash}`;
}

function isPathInsideOrSame(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function buildRunnerRuntimeRootForVisibleWorkspace(input: {
  visibleRoot: string;
  runtimeStateBase: string;
  tmpRoot?: string;
}): string {
  const runtimeRootPathPart = buildRunnerRuntimeRootPathPart(input.visibleRoot);
  const preferredRoot = path.join(input.runtimeStateBase, runtimeRootPathPart);
  if (!isPathInsideOrSame(input.visibleRoot, preferredRoot)) {
    return preferredRoot;
  }
  const siblingRoot = path.join(
    path.dirname(input.visibleRoot),
    ".runner-runtime",
    runtimeRootPathPart,
  );
  if (!isPathInsideOrSame(input.visibleRoot, siblingRoot)) {
    return siblingRoot;
  }
  return path.join(
    input.tmpRoot ?? tmpdir(),
    "agentsmith-codex-runner",
    runtimeRootPathPart,
  );
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

export function resolveTerminalSessionCreateTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env,
    "INTEGRATION_TERMINAL_SESSION_CREATE_TIMEOUT_MS",
    DEFAULT_TERMINAL_SESSION_CREATE_TIMEOUT_MS,
  );
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

async function unmountWorkspaceTree(root: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const mountPath = path.join(root, entry);
    await new Promise<void>((resolve) => {
      const proc = spawn("juicefs", ["umount", mountPath], { stdio: "ignore" });
      proc.once("error", () => resolve());
      proc.once("exit", () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
  }
}

async function unmountSingleWorkspace(mountPath: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn("juicefs", ["umount", mountPath], { stdio: "ignore" });
    proc.once("error", () => resolve());
    proc.once("exit", () => resolve());
    setTimeout(() => resolve(), 5_000);
  });
}

export async function collectTrackedTaskWorkspaceMounts(
  workspaceRoot: string,
): Promise<string[]> {
  try {
    const registryPath = path.join(
      workspaceRoot,
      TASK_WORKSPACE_MOUNT_SESSIONS_FILE,
    );
    const content = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(content) as {
      sessions?: Array<{ mount_path?: unknown }>;
    };
    const seen = new Set<string>();
    const mounts: string[] = [];
    for (const session of Array.isArray(parsed.sessions)
      ? parsed.sessions
      : []) {
      const mountPath =
        typeof session?.mount_path === "string"
          ? session.mount_path.trim()
          : "";
      if (!mountPath || seen.has(mountPath)) continue;
      seen.add(mountPath);
      mounts.push(mountPath);
    }
    return mounts;
  } catch {
    return [];
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

async function cleanupTrackedTaskWorkspaceMounts(
  workspaceRoot: string,
): Promise<void> {
  const mountPaths = await collectTrackedTaskWorkspaceMounts(workspaceRoot);
  for (const mountPath of mountPaths) {
    await unmountSingleWorkspace(mountPath);
  }
}

async function spawnAndCapture(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
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
    proc.once("error", reject);
    proc.once("close", (code) => {
      resolve({
        code: code ?? 1,
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

export async function createAgentTaskRunnerBundleViaApi(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    runnerTitle: string;
    taskTitle: string;
    workspaceName?: string;
    initialInputs?: Array<Record<string, unknown>>;
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
    initialInputs: args.initialInputs,
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

function readSimpleEnvValue(raw: string, key: string): string | null {
  const entries = parseSimpleEnvFile(raw);
  const value = entries[key];
  if (!value) return null;
  const unquoted = unquoteSimpleEnvValue(value);
  return unquoted || null;
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

function pickFirstBackendRealStatePath(): string[] {
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

  const internalSandboxStateFile = firstNonEmptyScalarEnvValue(process.env, [
    "INTERNAL_SANDBOX_REAL_STATE_FILE",
  ]);
  if (internalSandboxStateFile) {
    const internalBase = path.resolve(internalSandboxStateFile);
    candidates.push(path.resolve(path.dirname(internalBase), '..', '..', 'state.json'));
  }

  candidates.push(
    path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'state.json'),
  );
  return dedupeStable(candidates);
}

function pickFirstBackendRealSummaryPath(): string[] {
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

  candidates.push(
    path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'summary.env'),
  );
  return dedupeStable(candidates);
}

function normalizeManagedRunnerResult(
  payload: ManagedAgentRunnerApiPayload,
  fallbackName: string,
  fallbackEndpointId: string | null,
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
    defaultEndpointId: payload.default_endpoint_id?.trim() || fallbackEndpointId,
    capabilities: payload.capabilities ?? {},
    diagnostics: payload.diagnostics ?? {},
  };
}

async function readBackendRealManagedRunnerIdFromState(): Promise<string | null> {
  const directRunnerId = firstNonEmptyScalarEnvValue(process.env, ["AGENT_RUNNER_ID"]);
  if (directRunnerId) return directRunnerId;

  const internalBackendRealRuntimeRoot = await pickBackendRealRuntimeRootFromInternalSandboxStateFile();
  const summaryPaths = dedupeStable([
    ...pickFirstBackendRealSummaryPath(),
    ...(internalBackendRealRuntimeRoot
      ? [path.resolve(internalBackendRealRuntimeRoot, "summary.env")]
      : []),
  ]);

  for (const summaryFile of summaryPaths) {
    const summaryRaw = await readFile(summaryFile, "utf8").catch(() => "");
    if (!summaryRaw) continue;
    const summaryRunnerId = readSimpleEnvValue(summaryRaw, "AGENT_RUNNER_ID")
      || readSimpleEnvValue(summaryRaw, "SYSTEM_SIDE_MANAGED_RUNNER_ID")
      || readSimpleEnvValue(summaryRaw, "DEPLOYMENT_MANAGED_RUNNER_ID")
      || readSimpleEnvValue(summaryRaw, "SYSTEM_DEFAULT_MANAGED_RUNNER_ID");
    if (summaryRunnerId) return summaryRunnerId;
  }

  const statePaths = dedupeStable([
    ...pickFirstBackendRealStatePath(),
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

    const stateRunnerId = readNestedString(state, ["agent_runner", "id"])
      || readNestedString(state, ["project", "agent_runner_id"])
      || readNestedString(state, ["agent_runner_id"])
      || readNestedString(state, ["system", "agent_runner", "id"])
      || readNestedString(state, ["system", "agent_runner_id"])
      || readNestedString(state, ["system", "deployment", "agent_runner", "id"])
      || readNestedString(state, ["system", "deployment", "agent_runner_id"])
      || readNestedString(state, ["deployment", "agent_runner", "id"])
      || readNestedString(state, ["deployment", "agent_runner_id"])
      || readNestedString(state, ["deployment", "system", "agent_runner", "id"])
      || readNestedString(state, ["deployment", "system", "agent_runner_id"])
      || readNestedString(state, ["system", "managed_runner", "id"])
      || readNestedString(state, ["deployment", "managed_runner", "id"])
      || readNestedString(state, ["system", "managed", "agent_runner_id"]);
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
  capabilities: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}> {
  const runnerName = args.title.trim();
  if (!runnerName) {
    throw new Error("managed_agent_runner_name_required");
  }

  const fallbackEndpointId = args.endpointId.trim() || null;
  const seededRunnerId = await readBackendRealManagedRunnerIdFromState();
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
    return {
      runnerId: resolved.runnerId,
      runnerName: resolved.runnerName,
      status: resolved.status,
      isDefault: resolved.isDefault,
      defaultEndpointId: resolved.defaultEndpointId,
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
    capabilities: args.capabilities,
    diagnostics: args.diagnostics,
  });

  return {
    runnerId: seededDefault.runnerId,
    runnerName: seededDefault.runnerName || runnerName,
    status: seededDefault.status || "ready",
    isDefault: seededDefault.isDefault,
    defaultEndpointId: seededDefault.defaultEndpointId || fallbackEndpointId,
    capabilities: seededDefault.capabilities,
    diagnostics: seededDefault.diagnostics,
  };
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
  });
  return {
    runnerId: runner.runnerId,
    runnerName: runner.runnerName,
  };
}

export function sanitizeWorkloadId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return normalized || "workload";
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

export async function createAgentTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  fileLibraryId?: string;
  workspaceMode?: "create_new";
  workspaceName?: string;
  initialInputs?: Array<Record<string, unknown>>;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const title = args.title.trim();
  if (!title) {
    throw new Error("agent_task_title_required");
  }
  const fileLibraryId = args.fileLibraryId?.trim();
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        title,
        ...(fileLibraryId
          ? { workspace_file_library_id: fileLibraryId }
          : { workspace_mode: args.workspaceMode ?? "create_new" }),
        ...(args.workspaceName?.trim()
          ? { workspace_name: args.workspaceName.trim() }
          : {}),
        ...(args.initialInputs ? { initial_inputs: args.initialInputs } : {}),
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`create_agent_task_failed:${response.status()}:${body}`);
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
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.delete(
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
  if (response.status() !== 204) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `delete_terminal_session_failed:${response.status()}:${body}`,
    );
  }
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
        view: "agent_task.task_terminal",
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
  timeoutMs?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  const timeoutMs = args.timeoutMs ?? 300_000;
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
    authToken,
  });
  throw new Error(`runner_output_token_timeout:${args.taskId}\n\n${context}`);
}

type IntegrationTaskActivitySnapshot = {
  id?: string;
  kind?: string;
  actor?: string;
  content?: string;
  run_id?: string;
};

type IntegrationTaskTraceSnapshot = {
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

type IntegrationTaskRealtimeSnapshot = {
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
  };
};

export type WorkloadPodSnapshot = {
  name?: string | null;
  uid?: string | null;
  phase?: string | null;
  ready?: boolean | null;
  readyReason?: string | null;
  containerReadyCount?: number | null;
  containerCount?: number | null;
  reason?: string | null;
  exitCode?: number | null;
};

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
  const query = [
    `page_size=${args.pageSize ?? 100}`,
    args.messageId?.trim()
      ? `message_id=${encodeURIComponent(args.messageId.trim())}`
      : null,
    args.runId?.trim()
      ? `run_id=${encodeURIComponent(args.runId.trim())}`
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
  const payload = JSON.parse(payloadText || "{}") as {
    items?: Array<{
      metadata?: { name?: string; uid?: string };
      status?: {
        phase?: string;
        reason?: string;
        conditions?: Array<{ type?: string; status?: string; reason?: string }>;
        containerStatuses?: Array<{
          ready?: boolean;
          state?: {
            waiting?: { reason?: string };
            terminated?: { exitCode?: number; reason?: string };
          };
        }>;
      };
    }>;
  };
  const item = payload.items?.[0];
  if (!item) return null;
  const containerStatuses = item.status?.containerStatuses ?? [];
  const readyCondition =
    item.status?.conditions?.find((condition) => condition.type === "Ready") ??
    null;
  const waiting =
    containerStatuses.find((status) => status.state?.waiting)?.state?.waiting ??
    null;
  const terminated =
    containerStatuses.find((status) => status.state?.terminated)?.state
      ?.terminated ?? null;
  const ready =
    readyCondition != null
      ? readyCondition.status === "True"
      : containerStatuses.length > 0
        ? containerStatuses.every((status) => status.ready === true)
        : null;

  return {
    name: item.metadata?.name ?? null,
    uid: item.metadata?.uid ?? null,
    phase: item.status?.phase ?? null,
    ready,
    readyReason: readyCondition?.reason ?? null,
    containerReadyCount: containerStatuses.filter(
      (status) => status.ready === true,
    ).length,
    containerCount: containerStatuses.length,
    reason:
      waiting?.reason ?? terminated?.reason ?? item.status?.reason ?? null,
    exitCode:
      typeof terminated?.exitCode === "number" ? terminated.exitCode : null,
  };
}

async function fetchWorkloadPodSnapshot(args: {
  namespace: string;
  workloadId: string;
}): Promise<WorkloadPodSnapshot | null> {
  const result = await spawnAndCapture(
    "kubectl",
    [
      "get",
      "pods",
      "-n",
      args.namespace,
      "-l",
      `workload_id=${args.workloadId}`,
      "-o",
      "json",
    ],
    { env: withoutProxyEnv(process.env) },
  );
  if (result.code !== 0) return null;
  return parseWorkloadPodSnapshot(result.stdout);
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
  workspace_binding_mode: string;
  workspace_dir_name: string;
  file_library_id: string;
  file_library_name: string;
  filesystem_name: string;
  metadata_url: string;
  storage_bucket_url?: string;
  container_workspace_path?: string | null;
  library_root_path: string;
  recommended_mount_path?: string;
  created_at?: string;
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
  return (await response.json()) as {
    task_id: string;
    workspace_binding_mode: string;
    workspace_dir_name: string;
    file_library_id: string;
    file_library_name: string;
    filesystem_name: string;
    metadata_url: string;
    storage_bucket_url?: string;
    container_workspace_path?: string | null;
    library_root_path: string;
    recommended_mount_path?: string;
    created_at?: string;
  };
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
  ].filter(Boolean);
  const sections = [
    `task=${args.taskId}`,
    `run_state=${task?.run_state ?? "<unknown>"}`,
    `active_run=${task?.active_run?.status ?? "<none>"}`,
    `activity:\n${activitySummary.length > 0 ? activitySummary.join("\n") : "<none>"}`,
    `traces:\n${traceSummary.length > 0 ? traceSummary.join("\n") : "<none>"}`,
    `pod=${podDetails.length > 0 ? `${podSummary} ${podDetails.join(" ")}` : podSummary}`,
  ];
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

async function readJuicefsCsiStatus(namespace: string): Promise<{
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
      },
    ),
  ]);

  if (daemonSet.code !== 0 || controller.code !== 0 || pods.code !== 0) {
    throw new Error("juicefs_csi_status_unavailable");
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

async function detectJuicefsCsiNamespace(): Promise<string> {
  const configuredNamespace =
    process.env.JUICEFS_CSI_NAMESPACE?.trim() ||
    process.env.INTERNAL_AGENT_JUICEFS_CSI_NAMESPACE?.trim();
  if (configuredNamespace) {
    return configuredNamespace;
  }

  const [controllerNamespace, nodeNamespace] = await Promise.all([
    spawnAndCapture("kubectl", ["get", "statefulset", "-A", "--no-headers"], {
      env: withoutProxyEnv(process.env),
    }),
    spawnAndCapture("kubectl", ["get", "daemonset", "-A", "--no-headers"], {
      env: withoutProxyEnv(process.env),
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

export async function waitForJuicefsCsiReady(args?: {
  namespace?: string;
  timeoutMs?: number;
  stableWindowMs?: number;
}): Promise<void> {
  const namespace =
    args?.namespace?.trim() || (await detectJuicefsCsiNamespace());
  const timeoutMs = args?.timeoutMs ?? 180_000;
  const stableWindowMs = args?.stableWindowMs ?? 15_000;
  const startedAt = Date.now();
  let lastRestartCount: number | null = null;
  let stableSince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await readJuicefsCsiStatus(namespace);
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

  const status = await readJuicefsCsiStatus(namespace).catch(() => null);
  throw new Error(
    `juicefs_csi_not_ready:${namespace}:${status ? `desired=${status.desired}:available=${status.available}:controller_ready=${status.controllerReady}:restarts=${status.restartCountSum}:node_pods_ready=${status.nodePodsReady}` : "status_unavailable"}`,
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
  timeoutMs?: number;
}): Promise<string> {
  let podName = "";
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          "kubectl",
          [
            "get",
            "pods",
            "-n",
            args.namespace,
            "-l",
            `workload_id=${args.workloadId}`,
            "-o",
            "jsonpath={.items[0].metadata.name}",
          ],
          { env: withoutProxyEnv(process.env) },
        );
        podName = result.stdout.trim();
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
  timeoutMs?: number;
}): Promise<{ name: string; uid: string }> {
  let pod = { name: "", uid: "" };
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          "kubectl",
          [
            "get",
            "pods",
            "-n",
            args.namespace,
            "-l",
            `workload_id=${args.workloadId}`,
            "-o",
            'jsonpath={.items[0].metadata.name}{"\\n"}{.items[0].metadata.uid}',
          ],
          { env: withoutProxyEnv(process.env) },
        );
        const [name, uid] = result.stdout
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean);
        pod = { name: name ?? "", uid: uid ?? "" };
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
  timeoutMs?: number;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          "kubectl",
          [
            "get",
            "pods",
            "-n",
            args.namespace,
            "-l",
            `workload_id=${args.workloadId}`,
            "-o",
            "jsonpath={.items[*].metadata.name}",
          ],
          { env: withoutProxyEnv(process.env) },
        );
        return result.stdout.trim();
      },
      { timeout: args.timeoutMs ?? 300_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe("");
}

export async function patchWorkloadPodExpiry(args: {
  namespace: string;
  workloadId: string;
  expiresAt: string;
}): Promise<void> {
  const podName = await waitForWorkloadPodPresent({
    namespace: args.namespace,
    workloadId: args.workloadId,
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
    { env: withoutProxyEnv(process.env) },
  );
  if (result.code !== 0) {
    throw new Error(
      `patch_workload_expiry_failed:${podName}:${result.stderr || result.stdout}`,
    );
  }
}

export async function expectInternalTaskRuntimeStateInPod(args: {
  namespace: string;
  podName: string;
  taskId: string;
  visibleWorkspaceRoot?: string;
  timeoutMs?: number;
}): Promise<void> {
  const visibleWorkspaceRoot =
    args.visibleWorkspaceRoot ?? `/workspace/${args.taskId}`;
  const runtimeRootPathPart =
    buildRunnerRuntimeRootPathPart(visibleWorkspaceRoot);
  await expect
    .poll(
      async () => {
        const script = [
          'runtime_root_path_part="$1"',
          'visible_root="$2"',
          'base="${MBOS_AGENT_CODEX_STATE_ROOT:-${HOME:-/tmp}/.mbos/agent-task-runner}"',
          '[ -n "$base" ] || base="/"',
          'runtime_root="${base%/}/$runtime_root_path_part"',
          'case "$runtime_root" in "$visible_root"|"$visible_root"/*) visible_parent="${visible_root%/*}"; [ "$visible_parent" = "$visible_root" ] && visible_parent="/"; runtime_root="${visible_parent%/}/.runner-runtime/$runtime_root_path_part";; esac',
          'case "$runtime_root" in "$visible_root"|"$visible_root"/*) tmp_root="${TMPDIR:-/tmp}"; runtime_root="${tmp_root%/}/agentsmith-codex-runner/$runtime_root_path_part";; esac',
          'config="$runtime_root/.codex/config.toml"',
          'catalog="$runtime_root/.codex/catalog.json"',
          'manifest="$runtime_root/.mbos/builtin-skills-manifest.json"',
          'skill="$runtime_root/.agents/skills/feishu-docs/SKILL.md"',
          'config_ready=0; [ -f "$config" ] && grep -q "model = " "$config" && config_ready=1',
          'catalog_ready=0; [ -f "$catalog" ] && grep -q "\\"models\\"" "$catalog" && catalog_ready=1',
          'manifest_ready=0; [ -f "$manifest" ] && grep -q "\\"feishu-docs\\"" "$manifest" && manifest_ready=1',
          'skill_ready=0; [ -f "$skill" ] && grep -qi "feishu" "$skill" && skill_ready=1',
          'printf "runtime_root_path_part=%s\\nruntime_root=%s\\nconfig_ready=%s\\ncatalog_ready=%s\\nmanifest_ready=%s\\nskill_ready=%s\\n" "$runtime_root_path_part" "$runtime_root" "$config_ready" "$catalog_ready" "$manifest_ready" "$skill_ready"',
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
            runtimeRootPathPart,
            visibleWorkspaceRoot,
          ],
          { env: withoutProxyEnv(process.env) },
        );
        const output = result.stdout;
        return {
          runtimeRootReady: /runtime_root=\/.+/.test(output),
          codexConfigReady: output.includes("config_ready=1"),
          modelCatalogReady: output.includes("catalog_ready=1"),
          skillsManifestReady: output.includes("manifest_ready=1"),
          feishuSkillReady: output.includes("skill_ready=1"),
        };
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toEqual({
      runtimeRootReady: true,
      codexConfigReady: true,
      modelCatalogReady: true,
      skillsManifestReady: true,
      feishuSkillReady: true,
    });
}

export async function deleteInternalWorkloadViaManager(args: {
  workspaceId: string;
  projectId: string;
  workloadId: string;
}): Promise<void> {
  const managerBase = process.env.SANDBOX_MANAGER_URL?.trim();
  const serviceKey = process.env.SANDBOX_SERVICE_KEY?.trim();
  if (!managerBase || !serviceKey) {
    throw new Error("sandbox_manager_env_missing");
  }
  const response = await fetch(
    `${managerBase.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(args.workspaceId)}/projects/${encodeURIComponent(args.projectId)}/workloads/${encodeURIComponent(args.workloadId)}`,
    {
      method: "DELETE",
      headers: {
        "X-Service-Key": serviceKey,
      },
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `delete_internal_workload_failed:${response.status}:${body}`,
    );
  }
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
  runtimeStateRoot: string;
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
    const runtimeStateRoot = path.join(workspaceRoot, "runtime-state");
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
        MBOS_AGENT_WORKSPACE_ROOT: workspaceRoot,
        MBOS_AGENT_CODEX_STATE_ROOT: runtimeStateRoot,
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
          runtimeStateRoot,
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
            await cleanupTrackedTaskWorkspaceMounts(workspaceRoot);
            await unmountWorkspaceTree(workspaceRoot);
            await rm(runtimeStateRoot, { recursive: true, force: true }).catch(
              () => undefined,
            );
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
  runtimeStateRoot: string;
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
  const runtimeStateRoot = path.join(workspaceRoot, "runtime-state");
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
    `MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS=${process.env.INTEGRATION_AGENT_TASK_RUNNER_MOUNT_READY_TIMEOUT_MS?.trim() || "120000"}`,
    "--env",
    "MBOS_AGENT_WORKSPACE_ROOT=/workspace",
    "--env",
    "MBOS_AGENT_CODEX_STATE_ROOT=/workspace/runtime-state",
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS_DIR=${builtinSkillsDir}`,
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS=${builtinSkillsList}`,
    "--env",
    `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=${builtinSkillsRequired}`,
    "--volume",
    `${workspaceRoot}:/workspace:rshared`,
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
        runtimeStateRoot,
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
              "/workspace",
              workspaceRoot,
            );
          await preserveRunnerLogs();
          const fromLog =
            await readPreparedTaskRuntimePathsFromRunnerLog(runnerLogPath);
          return fromLog
            ? rewritePreparedTaskRuntimePathsPrefix(
                fromLog,
                "/workspace",
                workspaceRoot,
              )
            : null;
        },
        stop: async () => {
          await preserveRunnerLogs();
          await spawnAndCapture("docker", ["rm", "-f", containerName]);
          await unmountWorkspaceTree(workspaceRoot);
          await rm(runtimeStateRoot, { recursive: true, force: true }).catch(
            () => undefined,
          );
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
      await unmountWorkspaceTree(workspaceRoot);
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

export async function mountFileLibraryLocally(
  metadataUrl: string,
  storageBucketUrl?: string,
  options?: {
    metadataHostOverride?: string;
    metadataPortOverride?: string;
    storageEndpointOverride?: string;
  },
): Promise<{
  mountPath: string;
  stop: () => Promise<void>;
}> {
  const resolvedMetadataUrl = rewriteLocalClientMetadataUrl(
    metadataUrl,
    options,
  );
  const resolvedStorageBucketUrl = rewriteLocalClientStorageBucketUrl(
    storageBucketUrl,
    options,
  );
  const mountPath = await mkdtemp(
    path.join(tmpdir(), "agentsmith-real-file-library-"),
  );
  const mountArgs = [
    "mount",
    resolvedMetadataUrl,
    mountPath,
    "-d",
    "--check-storage",
    "--attr-cache",
    "0",
    "--entry-cache",
    "0",
    "--dir-entry-cache",
    "0",
  ];
  if ((resolvedStorageBucketUrl ?? "").trim()) {
    mountArgs.push("--bucket", resolvedStorageBucketUrl!.trim());
  }
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const mountResult = await spawnAndCapture("juicefs", mountArgs, {
      env: withoutProxyEnv(),
    });
    if (mountResult.code === 0) {
      return {
        mountPath,
        stop: async () => {
          await unmountSingleWorkspace(mountPath);
          await rm(mountPath, { recursive: true, force: true }).catch(
            () => undefined,
          );
        },
      };
    }
    lastError = mountResult.stderr.slice(-800);
    await unmountSingleWorkspace(mountPath).catch(() => undefined);
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  await rm(mountPath, { recursive: true, force: true }).catch(() => undefined);
  throw new Error(`local_juicefs_mount_failed:${lastError}`);
}

function rewriteLocalClientMetadataUrl(
  metadataUrl: string,
  options?: {
    metadataHostOverride?: string;
    metadataPortOverride?: string;
  },
): string {
  const hostOverride = options?.metadataHostOverride?.trim();
  const portOverride = options?.metadataPortOverride?.trim();
  if (!hostOverride && !portOverride) {
    return metadataUrl;
  }
  const rewritten = new URL(metadataUrl);
  if (hostOverride) {
    rewritten.hostname = hostOverride;
  }
  if (portOverride) {
    rewritten.port = portOverride;
  }
  return rewritten.toString();
}

function rewriteLocalClientStorageBucketUrl(
  storageBucketUrl?: string,
  options?: {
    storageEndpointOverride?: string;
  },
): string | undefined {
  const rawUrl = storageBucketUrl?.trim();
  if (!rawUrl) {
    return storageBucketUrl;
  }
  const endpointOverride = options?.storageEndpointOverride?.trim();
  if (!endpointOverride) {
    return rawUrl;
  }
  const original = new URL(rawUrl);
  const override = new URL(endpointOverride);
  original.protocol = override.protocol;
  original.username = override.username;
  original.password = override.password;
  original.hostname = override.hostname;
  original.port = override.port;
  return original.toString();
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

export async function openMountAccessAndRevealMountDetails(
  page: Page,
  libraryName: string,
): Promise<{ metadataUrl: string; storageBucketUrl: string | null }> {
  const dismissOpenDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const visibleDialog = page
        .locator('[role="dialog"]:visible, [role="alertdialog"]:visible')
        .last();
      if (!(await visibleDialog.isVisible().catch(() => false))) {
        return;
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  };

  await dismissOpenDialog();
  const libraryItem = page
    .locator('[data-testid^="files__library-item--"]')
    .filter({ hasText: libraryName })
    .first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  const mountButton = libraryItem
    .locator('[data-testid^="files__library-desktop-access--"]')
    .first();
  await expect(mountButton).toBeVisible({ timeout: 15_000 });
  await mountButton.click();
  const dialog = page.getByTestId("files__dialog__desktop-mount-access");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /reveal|显示|show/i }).click();
  const metadataInput = dialog.getByTestId(
    "files__library-mount__metadata-url",
  );
  await expect(metadataInput).not.toHaveValue(/••••/);
  const bucketInput = dialog.getByTestId("files__library-mount__bucket-url");
  return {
    metadataUrl: (await metadataInput.inputValue()).trim(),
    storageBucketUrl: (await bucketInput.inputValue()).trim() || null,
  };
}

export async function createTempMountDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function mountJuiceFs(
  metadataUrl: string,
  mountPoint: string,
  storageBucketUrl?: string,
): Promise<() => Promise<void>> {
  await mkdir(mountPoint, { recursive: true });
  const mountArgs = [
    "mount",
    metadataUrl,
    mountPoint,
    "-d",
    "--attr-cache",
    "0",
    "--entry-cache",
    "0",
    "--dir-entry-cache",
    "0",
  ];
  if ((storageBucketUrl ?? "").trim()) {
    mountArgs.push("--bucket", storageBucketUrl!.trim());
  }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("juicefs", mountArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: withoutProxyEnv(),
    });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `juicefs_mount_failed_${String(code)}:${stderr.slice(-500)}`,
          ),
        );
        return;
      }
      resolve();
    });
    setTimeout(() => resolve(), 5_000);
  });

  return async () => {
    await new Promise<void>((resolve) => {
      const proc = spawn("juicefs", ["umount", mountPoint], {
        stdio: "ignore",
      });
      proc.once("error", () => resolve());
      proc.once("exit", () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
    await rm(mountPoint, { recursive: true, force: true });
  };
}

export async function writeMountedFile(
  mountPoint: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(mountPoint, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
}
