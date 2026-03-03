import type { AgentRecord } from './resource-models.js';
import type { ExecResponse, PodStatusResponse, SandboxPodCreateBody } from './sandbox-manager-client.js';

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
}

interface AgentRuntimeLike {
  getAgentOnlineState(agentId: string): boolean;
}

export interface InternalAgentPodManager {
  ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    agent: AgentRecord;
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
    throw Object.assign(new Error('internal_agent_runtime_not_configured'), {
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

  return {
    image,
    rawKey,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    ...(typeof cfg.cpu_request === 'string' ? { cpuRequest: cfg.cpu_request } : {}),
    ...(typeof cfg.cpu_limit === 'string' ? { cpuLimit: cfg.cpu_limit } : {}),
    ...(typeof cfg.memory_request === 'string' ? { memoryRequest: cfg.memory_request } : {}),
    ...(typeof cfg.memory_limit === 'string' ? { memoryLimit: cfg.memory_limit } : {}),
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
    private readonly agentRuntime: AgentRuntimeLike,
    private readonly wsBaseUrl: string,
    options?: InternalAgentPodManagerOptions,
  ) {
    this.startupTimeoutMs = Math.max(10_000, options?.startupTimeoutMs ?? 120_000);
    this.phasePollIntervalMs = Math.max(200, options?.phasePollIntervalMs ?? 2_000);
    this.onlinePollIntervalMs = Math.max(100, options?.onlinePollIntervalMs ?? 500);
    this.sleep = options?.sleep ?? defaultSleep;
  }

  async ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    agent: AgentRecord;
  }): Promise<void> {
    const { workspaceId, projectId, workloadId, agent } = input;
    if (agent.mode !== 'internal') {
      throw Object.assign(new Error('agent_mode_not_internal'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
    }

    const lockKey = `${workspaceId}/${projectId}/${workloadId}`;
    while (this.locks.has(lockKey)) {
      await this.locks.get(lockKey);
    }

    if (this.agentRuntime.getAgentOnlineState(agent.id)) return;

    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(lockKey, lock);

    try {
      await this.doEnsure(workspaceId, projectId, workloadId, agent);
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
      if (this.agentRuntime.getAgentOnlineState(agentId)) return;
      await this.sleep(this.onlinePollIntervalMs);
    }
    throw Object.assign(new Error('sandbox_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async doEnsure(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    agent: AgentRecord,
  ): Promise<void> {
    if (this.agentRuntime.getAgentOnlineState(agent.id)) return;

    const config = readInternalConfig(agent);
    const deadline = Date.now() + this.startupTimeoutMs;
    let status = await this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId);

    if (status.phase === 'Failed') {
      await this.sandboxClient.deletePod(workspaceId, projectId, workloadId).catch(() => undefined);
      status = { phase: 'offline' };
    }

    if (status.phase === 'offline') {
      const wsUrl = `${this.wsBaseUrl.replace(/\/+$/, '')}/api/v1/agent-runtime/ws?agent_id=${encodeURIComponent(agent.id)}`;
      await this.sandboxClient.createOrEnsurePod(workspaceId, projectId, workloadId, {
        image: config.image,
        env: {
          MBOS_AGENT_WS_URL: wsUrl,
          MBOS_AGENT_KEY: config.rawKey,
          MBOS_AGENT_CODEX_YOLO: '1',
          MBOS_AGENT_TASK_TIMEOUT_SEC: '55',
          ...(config.env ?? {}),
        },
        cpu_request: config.cpuRequest ?? '500m',
        cpu_limit: config.cpuLimit ?? '2',
        memory_request: config.memoryRequest ?? '512Mi',
        memory_limit: config.memoryLimit ?? '4Gi',
        idle_timeout_sec: config.idleTimeoutSec ?? 1800,
        max_lifetime_sec: config.maxLifetimeSec ?? 86400,
      });
      status = await this.sandboxClient.getPodStatus(workspaceId, projectId, workloadId);
    }

    this.checkDeadline(deadline);
    if (status.phase !== 'Running') {
      await this.waitForPhase(workspaceId, projectId, workloadId, 'Running', deadline);
    }

    this.checkDeadline(deadline);
    const exec = await this.sandboxClient.exec(workspaceId, projectId, workloadId, [
      'bash', '-c',
      'pkill -f agent-runner 2>/dev/null; sleep 0.5; '
      + 'mkdir -p /workspace/.mbos; '
      + 'nohup agent-runner > /workspace/.mbos/agent.log 2>&1 & echo $!',
    ], 10);

    if (exec.exit_code !== 0) {
      throw Object.assign(new Error(`sandbox_exec_failed: ${exec.stderr || exec.stdout || 'unknown'}`), {
        code: 'AGENT_SANDBOX_EXEC_FAILED',
      });
    }

    this.checkDeadline(deadline);
    await this.waitForAgentOnline(agent.id, deadline);
  }
}
