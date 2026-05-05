import type { AgentRecord } from './resource-models.js';
import { isManagedAgentRunner } from './agent-runner-profile.js';
import type { ExecResponse, PodStatusResponse, SandboxPodCreateBody } from './sandbox-manager-client.js';
import type { RunnerSessionDispatchAuthority } from './agent-execution-service.js';
import type { InternalAgentWorkspaceMount } from './internal-agent-workspace-provisioner.js';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS,
} from '@mbos/contracts';

interface SandboxManagerClientLike {
  createOrEnsurePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    body: SandboxPodCreateBody,
    signal?: AbortSignal,
  ): Promise<{ httpStatus: number; pod: PodStatusResponse }>;
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
const INTERNAL_AGENT_BUILTIN_SKILLS = process.env.INTERNAL_AGENT_BUILTIN_SKILLS?.trim() || 'mbos-context,feishu-docs,jira-ops';
const INTERNAL_AGENT_BUILTIN_SKILLS_REQUIRED = process.env.INTERNAL_AGENT_BUILTIN_SKILLS_REQUIRED?.trim() || '1';
const INTERNAL_AGENT_TASK_RUNNER_MODE = 'managed_platform';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return {
    ...workspaceMount,
    bindingId,
    mountPath,
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

function readInternalConfig(agent: AgentRecord): {
  image: string;
  env?: Record<string, string>;
  rawKey: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
  idleTimeoutSec?: number;
  maxLifetimeSec?: number;
} {
  const cfg = (agent.config ?? {}) as Record<string, unknown>;
  const image = typeof cfg.image === 'string' ? cfg.image.trim() : '';
  const rawKey = typeof cfg._internal_raw_key === 'string' ? cfg._internal_raw_key.trim() : '';
  if (!image) {
    throw Object.assign(new Error('agent_runner_image_unconfigured'), {
      code: 'AGENT_RUNNER_IMAGE_UNCONFIGURED',
    });
  }
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
    image,
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
    private readonly sandboxClient: SandboxManagerClientLike,
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
      if (await this.isReadyForSession(input.agent.id, input.sessionId)) return;
    }

    throwIfAborted(signal);
    if (await this.isReadyForSession(agent.id, input.sessionId)) return;

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
  ): Promise<void> {
    throwIfAborted(signal);
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const status = await this.runAbortableSandboxRpc(
        (rpcSignal) => this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId, rpcSignal),
        signal,
      );
      throwIfAborted(signal);
      if (status.phase === target) return;
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
    if (await this.isReadyForSession(agent.id, sessionId)) return;
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
      await this.runAbortableSandboxRpc((rpcSignal) => this.sandboxClient.checkReady(rpcSignal), signal);
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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      throwIfAborted(signal);
      this.checkDeadline(deadline);
      if (isTerminalPodPhase(status.phase)) {
        await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.deletePod(workspaceId, projectId, workloadId, rpcSignal).catch(() => undefined),
          signal,
        );
        throwIfAborted(signal);
        status = { phase: 'offline' };
      }

      if (status.phase === 'offline') {
        throwIfAborted(signal);
        await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.createOrEnsurePod(workspaceId, projectId, workloadId, {
            image: config.image,
            env: {
              WORKSPACE_PATH: workspaceMount.mountPath,
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
              MBOS_AGENT_TASK_RUNNER_MODE: INTERNAL_AGENT_TASK_RUNNER_MODE,
            },
            cpu_request: config.cpuRequest ?? '500m',
            cpu_limit: config.cpuLimit ?? '2',
            memory_request: config.memoryRequest ?? '512Mi',
            memory_limit: config.memoryLimit ?? '4Gi',
            idle_timeout_sec: idleTimeoutSec,
            max_lifetime_sec: maxLifetimeSec,
            workspace_binding_id: workspaceMount.bindingId,
          }, rpcSignal),
          signal,
        );
        throwIfAborted(signal);
        status = await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId, rpcSignal),
          signal,
        );
        throwIfAborted(signal);
      }

      if (status.phase !== 'Running') {
        await this.waitForPhase(workspaceId, projectId, workloadId, 'Running', deadline, signal);
        status = { phase: 'Running' };
      }

      throwIfAborted(signal);
      this.checkDeadline(deadline);
      if (!sessionId) {
        await this.waitForAgentOnline(agent.id, deadline, signal);
        return;
      }

      const sessionReadinessDeadline = this.buildSessionReadinessDeadline(deadline);
      try {
        await this.waitForAgentSessionOnline(agent.id, sessionId, sessionReadinessDeadline, signal);
        return;
      } catch (error) {
        throwIfAborted(signal);
        const code = error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
        if (code === 'AGENT_SANDBOX_REMOTE_OWNED') {
          throw error;
        }
        if (code !== 'AGENT_SANDBOX_STARTUP_TIMEOUT') {
          throw error;
        }
        if (sessionReadinessDeadline >= deadline || attempt >= 2) {
          throw error;
        }
        await this.runAbortableSandboxRpc(
          (rpcSignal) => this.sandboxClient.deletePod(workspaceId, projectId, workloadId, rpcSignal),
          signal,
        );
        throwIfAborted(signal);
        status = { phase: 'offline' };
      }
    }

    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
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
