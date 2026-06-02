import type { AgentRecord } from './resource-models.js';
import { isAbsolute, join, normalize } from 'node:path';
import { isManagedAgentRunner } from './agent-runner-profile.js';
import {
  redactAsbcpLogText,
  type ExecResponse,
  type PodStatusResponse,
  type SandboxPodCreateBody,
  type SandboxPodEnsureResponse,
} from './asbcp-client.js';
import {
  DEFAULT_ASBCP_READINESS_RETRY_BUDGET_MS,
  retryAsbcpReadinessNotReady,
} from './asbcp-readiness-retry.js';
import type { RunnerSessionDispatchAuthority } from './agent-execution-service.js';
import type { InternalAgentWorkspaceMount } from './internal-agent-workspace-provisioner.js';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS,
} from '@mbos/contracts';
import { extractImageDigest, resolveManagedRunnerImageRef } from './managed-runner-image.js';

interface AsbcpClientLike {
  createOrEnsurePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    body: SandboxPodCreateBody,
    signal?: AbortSignal,
  ): Promise<SandboxPodEnsureResponse>;
  getPodStatus(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    signal?: AbortSignal,
  ): Promise<PodStatusResponse>;
  deletePod(workspaceId: string, projectId: string, workloadId: string, signal?: AbortSignal): Promise<void>;
  keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<string | null>;
  exec(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    cmd: string[],
    timeoutSeconds?: number,
    signal?: AbortSignal,
  ): Promise<ExecResponse>;
  checkReady(signal?: AbortSignal): Promise<void>;
}

interface AgentExecutionLike {
  getAgentOnlineState(agentId: string): boolean;
  getAgentSessionOnlineState?: (agentId: string, sessionId?: string) => boolean;
  getAgentSessionDispatchAuthority?: (
    agentId: string,
    sessionId: string,
  ) => Promise<RunnerSessionDispatchAuthority>;
}

export interface InternalAgentPodManager {
  checkReady(signal?: AbortSignal): Promise<void>;
  ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    sessionId?: string;
    agent: AgentRecord;
    workspaceMount: InternalAgentWorkspaceMount;
    signal?: AbortSignal;
  }): Promise<void>;
  keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
  releasePod(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
}

interface InternalAgentPodManagerOptions {
  startupTimeoutMs?: number;
  phasePollIntervalMs?: number;
  onlinePollIntervalMs?: number;
  sessionReadinessTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const INTERNAL_AGENT_BUILTIN_SKILLS_DIR = process.env.INTERNAL_AGENT_BUILTIN_SKILLS_DIR?.trim() || '/etc/codex/skills';
const INTERNAL_AGENT_BUILTIN_SKILLS = process.env.INTERNAL_AGENT_BUILTIN_SKILLS?.trim() || 'mbos-context';
const INTERNAL_AGENT_BUILTIN_SKILLS_REQUIRED = process.env.INTERNAL_AGENT_BUILTIN_SKILLS_REQUIRED?.trim() || '1';
const INTERNAL_AGENT_TASK_RUNNER_MODE = 'managed_platform';
const INTERNAL_AGENT_RUNNER_HEALTH_OUTPUT_MAX_CHARS = 8_000;
const RUNNER_HEALTH_REDACTED_VALUE = '[redacted]';
const STANDALONE_SK_TOKEN_RE = /(^|[^A-Za-z0-9_-])(sk-[A-Za-z0-9_-]{8,})(?=$|[^A-Za-z0-9_-])/g;
const DEFAULT_INTERNAL_AGENT_RUNNER_HEALTH_COMMAND = [
  'set +e',
  "runner_patterns='([a]gentsmith-runner|[a]gentsmith-agent-task-runner)'",
  'echo "runner_health_probe=agentsmith_runner"',
  'printf "runner_instance_id=%s\\n" "${MBOS_AGENT_RUNNER_INSTANCE_ID:-}"',
  'if command -v pgrep >/dev/null 2>&1; then',
  '  pgrep_output="$(pgrep -af "$runner_patterns" 2>/dev/null | awk -v self="$$" \'$1 != self\' || true)"',
  '  if [ -n "$pgrep_output" ]; then printf "%s\\n" "$pgrep_output"; exit 0; fi',
  'fi',
  'if command -v ps >/dev/null 2>&1; then',
  '  ps_output="$(ps -eo pid,ppid,stat,comm,args 2>/dev/null || ps aux 2>/dev/null || ps 2>/dev/null || true)"',
  '  filtered_ps_output="$(printf "%s\\n" "$ps_output" | awk -v self="$$" \'$1 != self\')"',
  '  printf "%s\\n" "$filtered_ps_output" | grep -E "$runner_patterns"',
  '  if [ "$?" -eq 0 ]; then exit 0; fi',
  '  echo "--- ps snapshot ---"',
  '  printf "%s\\n" "$ps_output" | head -80',
  'else',
  '  echo "ps_unavailable"',
  'fi',
  'echo "--- task workspace snapshot ---"',
  'ls -ld "${TASK_HOME:-/home}" "${WORKSPACE_PATH:-${TASK_HOME:-/home}/workspace}" 2>&1 || true',
  'echo "--- mount snapshot ---"',
  '(mount 2>/dev/null || cat /proc/mounts 2>/dev/null || true) | head -80',
  'exit 1',
].join('\n');

type RunnerHealthStatus = 'runner_process_found' | 'runner_process_missing' | 'exec_failed';

interface DiagnosticError {
  message: string;
  name?: string;
  code?: string;
  asbcpCode?: string;
  operation?: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
}

interface RunnerHealthDiagnostic {
  status: RunnerHealthStatus;
  command: string[];
  timeoutSeconds: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: DiagnosticError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readRunnerHealthExecTimeoutSeconds(): number {
  return readPositiveIntegerEnv('INTERNAL_AGENT_RUNNER_HEALTH_EXEC_TIMEOUT_SECONDS', 5);
}

function readRunnerHealthCommand(): string {
  return process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND?.trim() || DEFAULT_INTERNAL_AGENT_RUNNER_HEALTH_COMMAND;
}

function sanitizeRunnerInstanceComponent(value: string | undefined): string {
  const sanitized = value?.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') ?? '';
  return sanitized || 'unknown';
}

function buildRunnerInstanceId(input: {
  agentId: string;
  workloadId: string;
  sessionId?: string;
}): string {
  return [
    sanitizeRunnerInstanceComponent(input.agentId),
    sanitizeRunnerInstanceComponent(input.workloadId),
    sanitizeRunnerInstanceComponent(input.sessionId ?? input.workloadId),
  ].join(':');
}

function truncateDiagnosticText(value: string): string {
  if (value.length <= INTERNAL_AGENT_RUNNER_HEALTH_OUTPUT_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, INTERNAL_AGENT_RUNNER_HEALTH_OUTPUT_MAX_CHARS)}\n[truncated]`;
}

function redactStandaloneSkTokens(value: string): string {
  return value.replace(STANDALONE_SK_TOKEN_RE, `$1${RUNNER_HEALTH_REDACTED_VALUE}`);
}

function redactRunnerHealthDiagnosticText(value: string): string {
  return truncateDiagnosticText(redactAsbcpLogText(redactStandaloneSkTokens(value)));
}

function redactRunnerHealthCommand(command: string[]): string[] {
  return command.map((part) => redactRunnerHealthDiagnosticText(part));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function readAsbcpCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const asbcpCode = error.asbcpCode ?? error.asbcp_code;
  return typeof asbcpCode === 'string' ? asbcpCode : undefined;
}

function readErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.name;
  }
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.name === 'string' ? error.name : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}

function readErrorOperation(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.operation === 'string' ? error.operation : undefined;
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.status === 'number' && Number.isFinite(error.status) ? error.status : undefined;
}

function isCreateOrEnsureTimeoutError(error: unknown): boolean {
  const name = readErrorName(error);
  if (name === 'AbortError' || name === 'TimeoutError') {
    return true;
  }
  const message = readErrorMessage(error);
  const operation = readErrorOperation(error);
  const status = readErrorStatus(error);
  if (
    status === 504
    && (operation === 'create_or_ensure_pod' || /\bcreate_or_ensure_pod\b/i.test(message))
  ) {
    return true;
  }
  return readErrorCode(error) === 'AGENT_SANDBOX_UNAVAILABLE'
    && /\b(create_or_ensure_pod|ensure)\b/i.test(message)
    && /(aborted|abort|timeout|timed out)/i.test(message);
}

function normalizeDiagnosticError(error: unknown): DiagnosticError {
  const record = isRecord(error) ? error : {};
  const name = error instanceof Error
    ? error.name
    : (typeof record.name === 'string' ? record.name : undefined);
  const message = error instanceof Error
    ? error.message
    : (typeof error === 'string' && error.trim() ? error : 'unknown_error');
  const code = typeof record.code === 'string' ? record.code : undefined;
  const asbcpCode = typeof record.asbcpCode === 'string'
    ? record.asbcpCode
    : (typeof record.asbcp_code === 'string' ? record.asbcp_code : undefined);
  const operation = typeof record.operation === 'string' ? record.operation : undefined;
  const status = typeof record.status === 'number' && Number.isFinite(record.status)
    ? record.status
    : undefined;
  const requestId = typeof record.requestId === 'string' && record.requestId.trim().length > 0
    ? record.requestId.trim()
    : undefined;
  const retryable = typeof record.retryable === 'boolean' ? record.retryable : undefined;
  return {
    message,
    ...(name ? { name } : {}),
    ...(code ? { code } : {}),
    ...(asbcpCode ? { asbcpCode } : {}),
    ...(operation ? { operation } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  };
}

function normalizeRunnerHealthDiagnosticError(error: unknown): DiagnosticError {
  const diagnostic = normalizeDiagnosticError(error);
  return {
    ...diagnostic,
    message: redactRunnerHealthDiagnosticText(diagnostic.message),
  };
}

function isTerminalWorkloadReleaseIncomplete(error: unknown): boolean {
  const code = readAsbcpCode(error) ?? readErrorCode(error);
  return code === 'workload_release_incomplete';
}

function buildTerminalWorkloadReleaseIncompleteError(error: unknown): Error {
  const releaseError = Object.assign(new Error('sandbox_release_incomplete'), {
    code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
    status: 409,
    operation: 'delete_terminal_workload',
    retryable: true,
    releaseDiagnostic: normalizeDiagnosticError(error),
  });
  (releaseError as Error & { cause?: unknown }).cause = error;
  return releaseError;
}

function normalizeAgentWebSocketBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function buildAgentCancelledError(reason?: unknown): Error {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : 'user_cancel_requested',
  ) as Error & { code: string; cause?: unknown };
  error.name = 'AbortError';
  error.code = 'AGENT_CANCELLED';
  if (reason instanceof Error) {
    error.cause = reason;
  }
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw buildAgentCancelledError(signal.reason);
  }
}

function isTerminalPodPhase(phase: string | undefined): boolean {
  return phase === 'Failed' || phase === 'Succeeded' || phase === 'Completed';
}

function requireWorkspaceMount(workspaceMount: InternalAgentWorkspaceMount | undefined): InternalAgentWorkspaceMount {
  const bindingId = typeof workspaceMount?.bindingId === 'string' ? workspaceMount.bindingId.trim() : '';
  if (!bindingId) {
    throw Object.assign(new Error('workspace_binding_id_required'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  const mountPath = typeof workspaceMount?.mountPath === 'string' ? workspaceMount.mountPath.trim() : '';
  if (!mountPath) {
    throw Object.assign(new Error('workspace_mount_path_required'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  const taskHomePath = typeof workspaceMount?.taskHomePath === 'string' && workspaceMount.taskHomePath.trim()
    ? workspaceMount.taskHomePath.trim()
    : mountPath;
  const workspacePath = typeof workspaceMount?.workspacePath === 'string' && workspaceMount.workspacePath.trim()
    ? workspaceMount.workspacePath.trim()
    : `${taskHomePath.replace(/\/+$/, '')}/workspace`;
  const artifactsPath = typeof workspaceMount?.artifactsPath === 'string' && workspaceMount.artifactsPath.trim()
    ? workspaceMount.artifactsPath.trim()
    : `${workspacePath.replace(/\/+$/, '')}/.artifacts`;
  const libraryRootPath = typeof workspaceMount?.libraryRootPath === 'string' ? workspaceMount.libraryRootPath.trim() : '';
  if (!libraryRootPath) {
    throw Object.assign(new Error('workspace_library_root_path_required'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  if (libraryRootPath !== '.') {
    throw Object.assign(new Error('workspace_library_root_path_invalid'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  const normalizeAbsoluteWorkspacePath = (value: string, field: string): string => {
    if (!value || !isAbsolute(value) || value.includes('\0') || value.split(/[\\/]+/).some((part) => part === '..')) {
      throw Object.assign(new Error(`${field}_invalid`), {
        code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      });
    }
    const normalized = normalize(value).replace(/\/+$/, '');
    if (!normalized || normalized === '/' || !isAbsolute(normalized)) {
      throw Object.assign(new Error(`${field}_invalid`), {
        code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      });
    }
    return normalized;
  };
  const normalizedMountPath = normalizeAbsoluteWorkspacePath(mountPath, 'workspace_mount_path');
  const normalizedTaskHomePath = normalizeAbsoluteWorkspacePath(taskHomePath, 'workspace_task_home_path');
  const normalizedWorkspacePath = normalizeAbsoluteWorkspacePath(workspacePath, 'workspace_path');
  const normalizedArtifactsPath = normalizeAbsoluteWorkspacePath(artifactsPath, 'workspace_artifacts_path');
  if (normalizedMountPath !== normalizedTaskHomePath) {
    throw Object.assign(new Error('workspace_mount_path_invalid'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  if (normalizedWorkspacePath !== join(normalizedTaskHomePath, 'workspace')) {
    throw Object.assign(new Error('workspace_path_invalid'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  if (normalizedArtifactsPath !== join(normalizedWorkspacePath, '.artifacts')) {
    throw Object.assign(new Error('workspace_artifacts_path_invalid'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }
  return {
    ...workspaceMount,
    bindingId,
    mountPath: normalizedMountPath,
    taskHomePath: normalizedTaskHomePath,
    workspacePath: normalizedWorkspacePath,
    artifactsPath: normalizedArtifactsPath,
    libraryRootPath: '.',
  };
}

export function mapRunnerSessionAuthorityToSandboxError(
  authority: RunnerSessionDispatchAuthority,
): string | null {
  return authority === 'remote_owned_not_local_dispatchable' ? 'sandbox_remote_owned' : null;
}

export function sanitizeWorkloadId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || 'workload';
}

export function buildSandboxStartingEvent(): {
  sequence: number;
  at: string;
  category: 'lifecycle';
  phase: 'start';
  name: 'sandbox_starting';
  summary: 'Starting agent sandbox...';
} {
  return {
    sequence: 0,
    at: new Date().toISOString(),
    category: 'lifecycle',
    phase: 'start',
    name: 'sandbox_starting',
    summary: 'Starting agent sandbox...',
  };
}

interface InternalAgentConfig {
  image: string;
  imageDigest?: string;
  env?: Record<string, string>;
  rawKey: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
  idleTimeoutSec?: number;
  maxLifetimeSec?: number;
}

function readInternalConfig(agent: AgentRecord): InternalAgentConfig {
  const cfg = (agent.config ?? {}) as Record<string, unknown>;
  const rawImage = typeof cfg.image === 'string' ? cfg.image.trim() : '';
  const rawKey = typeof cfg._internal_raw_key === 'string' ? cfg._internal_raw_key.trim() : '';
  if (!rawImage) {
    throw Object.assign(new Error('agent_runner_image_unconfigured'), {
      code: 'AGENT_RUNNER_IMAGE_UNCONFIGURED',
    });
  }
  const resolvedImage = resolveManagedRunnerImageRef(rawImage, 'agent.config.image');
  if (!rawKey) {
    throw Object.assign(new Error('internal_agent_execution_not_configured'), {
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
    });
  }

  const env = typeof cfg.env === 'object' && cfg.env !== null
    ? Object.entries(cfg.env as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
      if (typeof k === 'string' && typeof v === 'string') {
        acc[k] = v;
      }
      return acc;
    }, {})
    : undefined;

  const readNum = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.floor(value);
  };

  const envString = (key: string): string | undefined => {
    const value = process.env[key]?.trim();
    return value ? value : undefined;
  };

  return {
    image: resolvedImage.image,
    imageDigest: resolvedImage.digest,
    rawKey,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    ...(typeof cfg.cpu_request === 'string' ? { cpuRequest: cfg.cpu_request } : (envString('INTERNAL_AGENT_DEFAULT_CPU_REQUEST') ? { cpuRequest: envString('INTERNAL_AGENT_DEFAULT_CPU_REQUEST') } : {})),
    ...(typeof cfg.cpu_limit === 'string' ? { cpuLimit: cfg.cpu_limit } : (envString('INTERNAL_AGENT_DEFAULT_CPU_LIMIT') ? { cpuLimit: envString('INTERNAL_AGENT_DEFAULT_CPU_LIMIT') } : {})),
    ...(typeof cfg.memory_request === 'string' ? { memoryRequest: cfg.memory_request } : (envString('INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST') ? { memoryRequest: envString('INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST') } : {})),
    ...(typeof cfg.memory_limit === 'string' ? { memoryLimit: cfg.memory_limit } : (envString('INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT') ? { memoryLimit: envString('INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT') } : {})),
    ...(readNum(cfg.idle_timeout_sec) ? { idleTimeoutSec: readNum(cfg.idle_timeout_sec) } : {}),
    ...(readNum(cfg.max_lifetime_sec) ? { maxLifetimeSec: readNum(cfg.max_lifetime_sec) } : {}),
  };
}

export class InternalAgentPodManagerImpl implements InternalAgentPodManager {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly startupTimeoutMs: number;
  private readonly phasePollIntervalMs: number;
  private readonly onlinePollIntervalMs: number;
  private readonly sessionReadinessTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly sandboxClient: AsbcpClientLike,
    private readonly agentExecution: AgentExecutionLike,
    private readonly wsBaseUrl: string,
    options?: InternalAgentPodManagerOptions,
  ) {
    this.startupTimeoutMs = Math.max(10_000, options?.startupTimeoutMs ?? 300_000);
    this.phasePollIntervalMs = Math.max(200, options?.phasePollIntervalMs ?? 2_000);
    this.onlinePollIntervalMs = Math.max(100, options?.onlinePollIntervalMs ?? 500);
    this.sessionReadinessTimeoutMs = Math.max(1, options?.sessionReadinessTimeoutMs ?? 75_000);
    this.sleep = options?.sleep ?? defaultSleep;
  }

  async checkReady(signal?: AbortSignal): Promise<void> {
    await this.checkSandboxReadyWithReadinessRetry({
      deadline: Date.now() + DEFAULT_ASBCP_READINESS_RETRY_BUDGET_MS,
      signal,
    });
  }

  async ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    sessionId?: string;
    agent: AgentRecord;
    workspaceMount: InternalAgentWorkspaceMount;
    signal?: AbortSignal;
  }): Promise<void> {
    const { workspaceId, projectId, workloadId, agent, signal } = input;
    if (!isManagedAgentRunner(agent)) {
      throw Object.assign(new Error('agent_runner_provider_not_managed'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
    }
    throwIfAborted(signal);
    const workspaceMount = requireWorkspaceMount(input.workspaceMount);

    const lockKey = `${workspaceId}/${projectId}/${workloadId}`;
    for (;;) {
      throwIfAborted(signal);
      const existing = this.locks.get(lockKey);
      if (!existing) break;
      await this.waitForExistingLock(existing, signal);
      throwIfAborted(signal);
      if (await this.isReadyForSession(input.agent.id, input.sessionId)) {
        await this.assertReadySessionRunnerHealth(workspaceId, projectId, workloadId, input.agent, input.sessionId, undefined, signal);
        return;
      }
    }

    throwIfAborted(signal);
    if (await this.isReadyForSession(agent.id, input.sessionId)) {
      await this.assertReadySessionRunnerHealth(workspaceId, projectId, workloadId, agent, input.sessionId, undefined, signal);
      return;
    }

    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(lockKey, lock);

    try {
      await this.doEnsure(workspaceId, projectId, workloadId, input.sessionId, agent, workspaceMount, signal);
    } finally {
      this.locks.delete(lockKey);
      releaseLock();
    }
  }

  async keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<void> {
    await this.sandboxClient.keepalive(workspaceId, projectId, workloadId);
  }

  async releasePod(workspaceId: string, projectId: string, workloadId: string): Promise<void> {
    await this.sandboxClient.deletePod(workspaceId, projectId, workloadId);
  }

  private checkDeadline(deadline: number): void {
    if (Date.now() >= deadline) {
      throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
    }
  }

  private async waitForExistingLock(existing: Promise<void>, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!signal) {
      await existing;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const handleAbort = () => {
        cleanup();
        reject(buildAgentCancelledError(signal.reason));
      };
      const cleanup = () => signal.removeEventListener('abort', handleAbort);
      signal.addEventListener('abort', handleAbort, { once: true });
      void existing.then(
        () => {
          cleanup();
          resolve();
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private async sleepWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!signal) {
      await this.sleep(delayMs);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const handleAbort = () => {
        cleanup();
        reject(buildAgentCancelledError(signal.reason));
      };
      const cleanup = () => signal.removeEventListener('abort', handleAbort);
      signal.addEventListener('abort', handleAbort, { once: true });
      void this.sleep(delayMs).then(
        () => {
          cleanup();
          resolve();
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private async runAbortableSandboxRpc<T>(
    invoke: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    try {
      const result = await invoke(signal);
      throwIfAborted(signal);
      return result;
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  }

  private async waitForPhase(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    target: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<PodStatusResponse> {
    throwIfAborted(signal);
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const status = await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId, rpcSignal),
        signal,
      );
      throwIfAborted(signal);
      if (status.phase === target) return status;
      if (status.phase === 'Failed') {
        throw Object.assign(new Error('sandbox_pod_failed'), { code: 'AGENT_SANDBOX_POD_FAILED' });
      }
      await this.sleepWithAbort(this.phasePollIntervalMs, signal);
    }
    throwIfAborted(signal);
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async waitForAgentOnline(agentId: string, deadline: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      if (this.agentExecution.getAgentOnlineState(agentId)) return;
      await this.sleepWithAbort(this.onlinePollIntervalMs, signal);
    }
    throwIfAborted(signal);
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async waitForAgentSessionOnline(
    agentId: string,
    sessionId: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      if (await this.isReadyForSession(agentId, sessionId)) return;
      throwIfAborted(signal);
      await this.sleepWithAbort(this.onlinePollIntervalMs, signal);
    }
    throwIfAborted(signal);
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private buildSessionReadinessDeadline(deadline: number): number {
    return Math.min(deadline, Date.now() + this.sessionReadinessTimeoutMs);
  }

  private async collectRunnerHealth(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    signal?: AbortSignal,
  ): Promise<RunnerHealthDiagnostic> {
    const command = ['sh', '-lc', readRunnerHealthCommand()];
    const diagnosticCommand = redactRunnerHealthCommand(command);
    const timeoutSeconds = readRunnerHealthExecTimeoutSeconds();
    try {
      const result = await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.exec(workspaceId, projectId, workloadId, command, timeoutSeconds, rpcSignal),
        signal,
      );
      const exitCode = Number.isFinite(result.exit_code) ? Math.floor(result.exit_code) : 1;
      const durationMs = Number.isFinite(result.duration_ms) ? Math.floor(result.duration_ms) : undefined;
      return {
        status: exitCode === 0 ? 'runner_process_found' : 'runner_process_missing',
        command: diagnosticCommand,
        timeoutSeconds,
        exitCode,
        stdout: redactRunnerHealthDiagnosticText(result.stdout),
        stderr: redactRunnerHealthDiagnosticText(result.stderr),
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    } catch (error) {
      throwIfAborted(signal);
      return {
        status: 'exec_failed',
        command: diagnosticCommand,
        timeoutSeconds,
        error: normalizeRunnerHealthDiagnosticError(error),
      };
    }
  }

  private async deleteStaleWorkloadPod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    signal?: AbortSignal,
  ): Promise<{ stalePodDeleted: boolean; stalePodDeleteError?: DiagnosticError }> {
    try {
      await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.deletePod(workspaceId, projectId, workloadId, rpcSignal),
        signal,
      );
      return { stalePodDeleted: true };
    } catch (error) {
      throwIfAborted(signal);
      return {
        stalePodDeleted: false,
        stalePodDeleteError: normalizeDiagnosticError(error),
      };
    }
  }

  private buildSessionReadinessTimeoutError(input: {
    workloadId: string;
    sessionId: string;
    podPhase: string | undefined;
    runnerHealth: RunnerHealthDiagnostic;
    cause: unknown;
    stalePodDeleted?: boolean;
    stalePodDeleteError?: DiagnosticError;
  }): Error {
    const message = input.runnerHealth.status === 'runner_process_missing'
      ? 'sandbox_runner_bootstrap_unhealthy'
      : 'sandbox_startup_timeout';
    const error = Object.assign(new Error(message), {
      code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      workloadId: input.workloadId,
      sessionId: input.sessionId,
      sandboxOperation: 'wait_for_agent_session_online',
      podPhase: input.podPhase,
      runnerHealth: input.runnerHealth,
      sessionReadinessError: normalizeDiagnosticError(input.cause),
      ...(input.stalePodDeleted !== undefined ? { stalePodDeleted: input.stalePodDeleted } : {}),
      ...(input.stalePodDeleteError ? { stalePodDeleteError: input.stalePodDeleteError } : {}),
    });
    (error as Error & { cause?: unknown }).cause = input.cause;
    return error;
  }

  private buildReadySessionRunnerHealthError(input: {
    workloadId: string;
    sessionId: string;
    runnerHealth: RunnerHealthDiagnostic;
  }): Error {
    const message = input.runnerHealth.status === 'runner_process_missing'
      ? 'sandbox_runner_bootstrap_unhealthy'
      : 'sandbox_startup_timeout';
    return Object.assign(new Error(message), {
      code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      workloadId: input.workloadId,
      sessionId: input.sessionId,
      sandboxOperation: 'verify_ready_session_runner_health',
      runnerHealth: input.runnerHealth,
    });
  }

  private buildRunnerImageMismatchError(input: {
    expectedImage: string;
    expectedDigest: string;
    actualImageRef?: string;
    actualImageId?: string;
    actualDigest?: string;
    message?: 'agent_runner_image_mismatch' | 'agent_runner_image_identity_unavailable';
  }): Error {
    return Object.assign(new Error(input.message ?? 'agent_runner_image_mismatch'), {
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      expectedImage: input.expectedImage,
      expectedDigest: input.expectedDigest,
      ...(input.actualImageRef ? { actualImageRef: input.actualImageRef } : {}),
      ...(input.actualImageId ? { actualImageId: input.actualImageId } : {}),
      ...(input.actualDigest ? { actualDigest: input.actualDigest } : {}),
    });
  }

  private readLiveImageRefForDiagnostics(status: PodStatusResponse): {
    imageRef?: string;
    digest?: string;
  } {
    const imageRef = status.image_ref?.trim() || status.image?.trim();
    if (!imageRef) {
      return {};
    }
    if (!imageRef.includes('@sha256:')) {
      return { imageRef };
    }
    const digest = extractImageDigest(imageRef) ?? undefined;
    return { imageRef, ...(digest ? { digest } : {}) };
  }

  private async assertLiveRunnerImageMatchesExpected(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    config: InternalAgentConfig;
    status?: PodStatusResponse;
    signal?: AbortSignal;
  }): Promise<void> {
    if (!input.config.imageDigest) {
      return;
    }
    let status = input.status;
    let fetchedStatus = false;
    if (!status) {
      status = await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.getPodStatus(
          input.workspaceId,
          input.projectId,
          input.workloadId,
          rpcSignal,
        ),
        input.signal,
      );
      fetchedStatus = true;
    }
    throwIfAborted(input.signal);
    if (status.phase !== 'Running') {
      return;
    }

    if (!status.image_id && !fetchedStatus) {
      status = await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.getPodStatus(
          input.workspaceId,
          input.projectId,
          input.workloadId,
          rpcSignal,
        ),
        input.signal,
      );
      throwIfAborted(input.signal);
      if (status.phase !== 'Running') {
        return;
      }
    }

    const liveImageRef = this.readLiveImageRefForDiagnostics(status);
    const actualImageId = status.image_id?.trim();
    const actualDigest = actualImageId ? extractImageDigest(actualImageId) : null;
    if (!actualImageId || !actualDigest) {
      throw this.buildRunnerImageMismatchError({
        expectedImage: input.config.image,
        expectedDigest: input.config.imageDigest,
        ...(liveImageRef.imageRef ? { actualImageRef: liveImageRef.imageRef } : {}),
        ...(actualImageId ? { actualImageId } : {}),
        message: 'agent_runner_image_identity_unavailable',
      });
    }
    if (actualDigest !== input.config.imageDigest) {
      throw this.buildRunnerImageMismatchError({
        expectedImage: input.config.image,
        expectedDigest: input.config.imageDigest,
        ...(liveImageRef.imageRef ? { actualImageRef: liveImageRef.imageRef } : {}),
        actualImageId,
        actualDigest,
      });
    }
  }

  private async assertReadySessionRunnerHealth(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    agent: AgentRecord,
    sessionId: string | undefined,
    verified?: {
      config: InternalAgentConfig;
      status: PodStatusResponse;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const config = verified?.config ?? readInternalConfig(agent);
    await this.assertLiveRunnerImageMatchesExpected({
      workspaceId,
      projectId,
      workloadId,
      config,
      status: verified?.status,
      signal,
    });
    throwIfAborted(signal);
    if (!sessionId) {
      return;
    }
    const runnerHealth = await this.collectRunnerHealth(workspaceId, projectId, workloadId, signal);
    throwIfAborted(signal);
    if (runnerHealth.status !== 'runner_process_found') {
      throw this.buildReadySessionRunnerHealthError({
        workloadId,
        sessionId,
        runnerHealth,
      });
    }
  }

  private getOnlineState(agentId: string, sessionId?: string): boolean {
    if (sessionId && typeof this.agentExecution.getAgentSessionOnlineState === 'function') {
      return this.agentExecution.getAgentSessionOnlineState(agentId, sessionId);
    }
    return this.agentExecution.getAgentOnlineState(agentId);
  }

  private async doEnsure(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    sessionId: string | undefined,
    agent: AgentRecord,
    workspaceMount: InternalAgentWorkspaceMount,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    if (await this.isReadyForSession(agent.id, sessionId)) {
      await this.assertReadySessionRunnerHealth(workspaceId, projectId, workloadId, agent, sessionId, undefined, signal);
      return;
    }
    throwIfAborted(signal);

    const config = readInternalConfig(agent);
    const idleTimeoutSec = Math.max(
      config.idleTimeoutSec ?? INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
      INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS,
    );
    const maxLifetimeSec = Math.max(
      config.maxLifetimeSec ?? INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
      INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS,
      idleTimeoutSec,
    );
    const deadline = Date.now() + this.startupTimeoutMs;
    try {
      throwIfAborted(signal);
      await this.checkSandboxReadyWithReadinessRetry({
        deadline,
        signal,
      });
      throwIfAborted(signal);
    } catch (error) {
      throwIfAborted(signal);
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
      throw Object.assign(new Error('sandbox_not_ready'), {
        code: typeof code === 'string' ? code : 'AGENT_SANDBOX_UNAVAILABLE',
      });
    }
    throwIfAborted(signal);
    let status = await this.runAbortableSandboxRpc(
      (rpcSignal) => this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId, rpcSignal),
      signal,
    );
    throwIfAborted(signal);
    const wsBaseUrl = normalizeAgentWebSocketBaseUrl(this.wsBaseUrl);
    const wsUrl = `${wsBaseUrl}/api/v1/agent-execution/ws?agent_runner_id=${encodeURIComponent(agent.id)}${
      sessionId ? `&runner_session_id=${encodeURIComponent(sessionId)}` : ''
    }`;

    throwIfAborted(signal);
    this.checkDeadline(deadline);
    if (isTerminalPodPhase(status.phase)) {
      try {
        await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.deletePod(workspaceId, projectId, workloadId, rpcSignal),
          signal,
        );
      } catch (error) {
        throwIfAborted(signal);
        if (isTerminalWorkloadReleaseIncomplete(error)) {
          throw buildTerminalWorkloadReleaseIncompleteError(error);
        }
        throw error;
      }
      throwIfAborted(signal);
      status = { phase: 'offline' };
    }

    if (status.phase === 'offline') {
      throwIfAborted(signal);
      let ensureResponse: SandboxPodEnsureResponse | undefined;
      const createBody: SandboxPodCreateBody = {
        image: config.image,
        env: {
          MBOS_AGENT_WS_URL: wsUrl,
          MBOS_AGENT_KEY: config.rawKey,
          MBOS_RUNNER_MODE: 'k8s_internal',
          MBOS_AGENT_CODEX_YOLO: '1',
          MBOS_AGENT_RUNNER_DEBUG: '1',
          MBOS_AGENT_TASK_TIMEOUT_SEC: '55',
          MBOS_AGENT_BUILTIN_SKILLS_DIR: INTERNAL_AGENT_BUILTIN_SKILLS_DIR,
          MBOS_AGENT_BUILTIN_SKILLS: INTERNAL_AGENT_BUILTIN_SKILLS,
          MBOS_AGENT_BUILTIN_SKILLS_REQUIRED: INTERNAL_AGENT_BUILTIN_SKILLS_REQUIRED,
          ...(config.env ?? {}),
          MBOS_AGENT_RUNNER_INSTANCE_ID: buildRunnerInstanceId({
            agentId: agent.id,
            workloadId,
            sessionId,
          }),
          TASK_HOME: workspaceMount.taskHomePath,
          HOME: workspaceMount.taskHomePath,
          WORKSPACE_PATH: workspaceMount.workspacePath,
          ARTIFACTS_PATH: workspaceMount.artifactsPath,
          MBOS_AGENT_TASK_RUNNER_MODE: INTERNAL_AGENT_TASK_RUNNER_MODE,
        },
        cpu_request: config.cpuRequest ?? '500m',
        cpu_limit: config.cpuLimit ?? '2',
        memory_request: config.memoryRequest ?? '512Mi',
        memory_limit: config.memoryLimit ?? '4Gi',
        idle_timeout_sec: idleTimeoutSec,
        max_lifetime_sec: maxLifetimeSec,
        workspace_binding_id: workspaceMount.bindingId,
      };
      try {
        ensureResponse = await this.createOrEnsurePodWithReadinessRetry({
          workspaceId,
          projectId,
          workloadId,
          body: createBody,
          deadline,
          signal,
        });
      } catch (error) {
        throwIfAborted(signal);
        if (!isCreateOrEnsureTimeoutError(error)) {
          throw error;
        }
      }
      throwIfAborted(signal);
      status = ensureResponse?.pod
        ? ensureResponse.pod
        : await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId, rpcSignal),
          signal,
        );
      throwIfAborted(signal);
    }

    if (status.phase === 'Failed') {
      throw Object.assign(new Error('sandbox_pod_failed'), { code: 'AGENT_SANDBOX_POD_FAILED' });
    }

    if (status.phase !== 'Running') {
      status = await this.waitForPhase(workspaceId, projectId, workloadId, 'Running', deadline, signal);
    }

    await this.assertLiveRunnerImageMatchesExpected({
      workspaceId,
      projectId,
      workloadId,
      config,
      status,
      signal,
    });
    throwIfAborted(signal);

    throwIfAborted(signal);
    this.checkDeadline(deadline);
    if (!sessionId) {
      await this.waitForAgentOnline(agent.id, deadline, signal);
      return;
    }

    const sessionReadinessDeadline = this.buildSessionReadinessDeadline(deadline);
    try {
      await this.waitForAgentSessionOnline(agent.id, sessionId, sessionReadinessDeadline, signal);
    } catch (error) {
      throwIfAborted(signal);
      const code = readErrorCode(error);
      if (code !== 'AGENT_SANDBOX_STARTUP_TIMEOUT') {
        throw error;
      }
      const runnerHealth = await this.collectRunnerHealth(workspaceId, projectId, workloadId, signal);
      throwIfAborted(signal);
      const staleCleanup = runnerHealth.status === 'runner_process_missing'
        ? await this.deleteStaleWorkloadPod(workspaceId, projectId, workloadId, signal)
        : {};
      throwIfAborted(signal);
      throw this.buildSessionReadinessTimeoutError({
        workloadId,
        sessionId,
        podPhase: status.phase,
        runnerHealth,
        cause: error,
        ...staleCleanup,
      });
    }
    await this.assertReadySessionRunnerHealth(workspaceId, projectId, workloadId, agent, sessionId, { config, status }, signal);
  }

  private async checkSandboxReadyWithReadinessRetry(input: {
    deadline: number;
    signal?: AbortSignal;
  }): Promise<void> {
    try {
      await retryAsbcpReadinessNotReady({
        operation: 'readyz',
        deadline: input.deadline,
        signal: input.signal,
        sleep: this.sleep,
        invoke: () => this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.checkReady(rpcSignal),
          input.signal,
        ),
      });
    } catch (error) {
      throwIfAborted(input.signal);
      throw error;
    }
  }

  private async createOrEnsurePodWithReadinessRetry(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    body: SandboxPodCreateBody;
    deadline: number;
    signal?: AbortSignal;
  }): Promise<SandboxPodEnsureResponse> {
    return await retryAsbcpReadinessNotReady({
      operation: 'create_or_ensure_pod',
      deadline: input.deadline,
      signal: input.signal,
      sleep: this.sleep,
      invoke: () => this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.createOrEnsurePod(
          input.workspaceId,
          input.projectId,
          input.workloadId,
          input.body,
          rpcSignal,
        ),
        input.signal,
      ),
    });
  }

  private async isReadyForSession(agentId: string, sessionId?: string): Promise<boolean> {
    if (!sessionId) {
      return this.getOnlineState(agentId);
    }
    if (typeof this.agentExecution.getAgentSessionDispatchAuthority === 'function') {
      const authority = await this.agentExecution.getAgentSessionDispatchAuthority(agentId, sessionId);
      const authorityError = mapRunnerSessionAuthorityToSandboxError(authority);
      if (authorityError) {
        throw Object.assign(new Error(authorityError), { code: 'AGENT_SANDBOX_REMOTE_OWNED' });
      }
      if (authority === 'local_dispatchable') {
        return true;
      }
    }
    return this.getOnlineState(agentId, sessionId);
  }
}
