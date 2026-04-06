import type { AgentRecord } from './resource-models.js';
import type { ExecResponse, PodStatusResponse, SandboxPodCreateBody } from './sandbox-manager-client.js';
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
  ): Promise<{ httpStatus: number; pod: PodStatusResponse }>;
  getPodStatus(workspaceId: string, projectId: string, workloadId: string): Promise<PodStatusResponse>;
  deletePod(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
  keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<string | null>;
  exec(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    cmd: string[],
    timeoutSeconds?: number,
  ): Promise<ExecResponse>;
  checkReady(): Promise<void>;
}

interface AgentExecutionLike {
  getAgentOnlineState(agentId: string): boolean;
  getAgentSessionOnlineState?: (agentId: string, sessionId?: string) => boolean;
}

export interface InternalAgentPodManager {
  ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    sessionId: string;
    agent: AgentRecord;
    workspaceMount?: InternalAgentWorkspaceMount;
  }): Promise<void>;
  keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
  releasePod(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
}

interface InternalAgentPodManagerOptions {
  startupTimeoutMs?: number;
  phasePollIntervalMs?: number;
  onlinePollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalPodPhase(phase: string | undefined): boolean {
  return phase === 'Failed' || phase === 'Succeeded' || phase === 'Completed';
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
  if (!image || !rawKey) {
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
    this.sleep = options?.sleep ?? defaultSleep;
  }

  async ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    agent: AgentRecord;
    workspaceMount?: InternalAgentWorkspaceMount;
  }): Promise<void> {
    const { workspaceId, projectId, workloadId, agent } = input;
    if (agent.mode !== 'internal') {
      throw Object.assign(new Error('agent_mode_not_internal'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
    }

    const lockKey = `${workspaceId}/${projectId}/${workloadId}`;
    for (;;) {
      const existing = this.locks.get(lockKey);
      if (!existing) break;
      await existing;
      if (this.getOnlineState(agent.id, input.sessionId)) return;
    }

    if (this.getOnlineState(agent.id, input.sessionId)) return;

    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(lockKey, lock);

    try {
      await this.doEnsure(workspaceId, projectId, workloadId, input.sessionId, agent, input.workspaceMount);
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

  private async waitForPhase(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    target: string,
    deadline: number,
  ): Promise<void> {
    while (Date.now() < deadline) {
      const status = await this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId);
      if (status.phase === target) return;
      if (status.phase === 'Failed') {
        throw Object.assign(new Error('sandbox_pod_failed'), { code: 'AGENT_SANDBOX_POD_FAILED' });
      }
      await this.sleep(this.phasePollIntervalMs);
    }
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async waitForAgentOnline(agentId: string, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      if (this.agentExecution.getAgentOnlineState(agentId)) return;
      await this.sleep(this.onlinePollIntervalMs);
    }
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async waitForAgentSessionOnline(agentId: string, sessionId: string, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      if (this.getOnlineState(agentId, sessionId)) return;
      await this.sleep(this.onlinePollIntervalMs);
    }
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private getOnlineState(agentId: string, sessionId: string): boolean {
    if (typeof this.agentExecution.getAgentSessionOnlineState === 'function') {
      return this.agentExecution.getAgentSessionOnlineState(agentId, sessionId);
    }
    return this.agentExecution.getAgentOnlineState(agentId);
  }

  private async doEnsure(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    sessionId: string,
    agent: AgentRecord,
    workspaceMount?: InternalAgentWorkspaceMount,
  ): Promise<void> {
    if (this.getOnlineState(agent.id, sessionId)) return;

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
      await this.sandboxClient.checkReady();
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
      throw Object.assign(new Error('sandbox_not_ready'), {
        code: typeof code === 'string' ? code : 'AGENT_SANDBOX_UNAVAILABLE',
      });
    }
    let status = await this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId);
    const wsUrl = `${this.wsBaseUrl.replace(/\/+$/, '')}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}&session_id=${encodeURIComponent(sessionId)}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (isTerminalPodPhase(status.phase)) {
        await this.sandboxClient.deletePod(workspaceId, projectId, workloadId).catch(() => undefined);
        status = { phase: 'offline' };
      }

      if (status.phase === 'offline') {
        await this.sandboxClient.createOrEnsurePod(workspaceId, projectId, workloadId, {
          image: config.image,
          env: {
            ...(workspaceMount?.mountPath ? { WORKSPACE_PATH: workspaceMount.mountPath } : {}),
            MBOS_AGENT_WS_URL: wsUrl,
            MBOS_AGENT_KEY: config.rawKey,
            MBOS_RUNNER_MODE: 'k8s_internal',
            MBOS_AGENT_CODEX_YOLO: '1',
            MBOS_AGENT_RUNNER_DEBUG: '1',
            MBOS_AGENT_TASK_TIMEOUT_SEC: '55',
            ...(config.env ?? {}),
          },
          cpu_request: config.cpuRequest ?? '500m',
          cpu_limit: config.cpuLimit ?? '2',
          memory_request: config.memoryRequest ?? '512Mi',
          memory_limit: config.memoryLimit ?? '4Gi',
          idle_timeout_sec: idleTimeoutSec,
          max_lifetime_sec: maxLifetimeSec,
          ...(workspaceMount?.bindingId ? { workspace_binding_id: workspaceMount.bindingId } : {}),
        });
        status = await this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId);
      }

      if (!isTerminalPodPhase(status.phase)) {
        break;
      }
    }

    this.checkDeadline(deadline);
    if (status.phase !== 'Running') {
      await this.waitForPhase(workspaceId, projectId, workloadId, 'Running', deadline);
    }

    this.checkDeadline(deadline);
    await this.waitForAgentSessionOnline(agent.id, sessionId, deadline);
  }
}
