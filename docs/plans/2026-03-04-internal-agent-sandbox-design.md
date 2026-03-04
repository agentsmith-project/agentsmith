# Internal Agent 沙箱化 — MVP 实施方案

> **日期:** 2026-03-04

## 目标

用户在项目内注册 Internal Agent（指定容器镜像 + CPU/Memory），在 Notebook 或 Chat 中使用该 Agent 时，系统自动创建 K8s Pod 运行 agent 进程。agent 进程通过 WebSocket 连接后端，完全复用 External Agent 协议。`/workspace` 由 JuiceFS PVC 提供天然持久化存储——Pod 销毁后文件不丢失，下次重建自动恢复。

**核心设计原则:**

- **零代码修改发布**: 用 external 模式开发/内测的 agent runner 直接打包为 Docker image 发布为 internal agent，**不需要任何代码变更**。所有行为差异由环境变量驱动。
- **统一 LLM 路由**: 所有 agent（无论 external 还是 internal）通过 AgentSmith 的 **endpoint proxy** 访问 LLM。proxy 地址在 WS 连接时由 `server.hello` 推送，用户凭据随每次请求下发。agent 自身不持有 LLM API key。
- **External ↔ Internal 行为差异**:
  - External（开发阶段）: 一个 runner 进程并发处理多个 workload，每个 workload 独立工作目录 (`/tmp/{user}/{task_id}`)
  - Internal（发布后）: 一个 Pod 专属一个 workload，工作目录为 `/workspace`（JuiceFS 持久化）
  - LLM 访问路径完全一致（endpoint proxy），runner 代码无任何分支差异

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                 AgentSmith (api-entry-node)                   │
│                                                              │
│  AgentRouteHandler         InternalAgentPodManager (新增)     │
│  ● internal agent 创建     ● ensureAgentReady()              │
│  ● 校验 image/资源参数     ● keepalive()                     │
│  ● 自动生成 service key    ● releasePod()                    │
│                            ● per-workload 并发锁             │
│                                  │                           │
│  SandboxManagerClient (新增)      │   AgentRuntimeService     │
│  ● 封装 Manager REST API  ◀─────┘   (改动: presence 逻辑)    │
│  ● X-Service-Key 认证                                        │
└──────────┬───────────────────────────────────────────────────┘
           │ HTTP REST
           ▼
┌──────────────────────────────────────────────────────────────┐
│            Sandbox Manager (manager-service)                  │
│                                                              │
│  PUT  /v1/workspaces/{ws}/projects/{proj}/workloads/{wl}     │
│  GET  /v1/...                                                │
│  DELETE /v1/...                                              │
│  POST /v1/.../keepalive                                      │
│  POST /v1/.../exec                                           │
│                                                              │
│  改动: 纯目录模式 (MkdirAll + PVC subPath, 不依赖外部库)      │
│  MkdirAll({basePath}/{ws}/{wl}) → PVC subPath 挂载           │
└──────────┬───────────────────────────────────────────────────┘
           │ K8s API
           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Workload Pod                               │
│                                                              │
│  image:      用户指定镜像 (agent-codex-runner 打包)            │
│  command:    ["tail", "-f", "/dev/null"]                     │
│  /workspace: JuiceFS PVC subPath → 天然持久化                 │
│  resources:  用户指定 CPU/Memory                              │
│  env:        WORKSPACE_PATH=/workspace                       │
│              MBOS_AGENT_WS_URL / MBOS_AGENT_KEY              │
│                                                              │
│  agent-runner 通过 /exec 启动, WS 连回 AgentSmith            │
│  server.hello 推送 resource_proxy.base_url → runner 配置 codex   │
│  每次请求 user_bearer_token 鉴权 → 通过 proxy 访问 LLM      │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 存储模型

### 原理

JuiceFS PVC 是一个共享的持久化文件系统（ReadWriteMany）。Pod 通过 PVC subPath 挂载一个子目录到 `/workspace`。Pod 删除时文件系统上的目录和文件**不受任何影响**。下次为同一 workload 创建 Pod，挂载同一 subPath，文件全部还在。

不需要快照、不需要备份恢复、不需要任何 workspace 生命周期管理。

### 目录结构

```
JuiceFS PVC (juicefs-workloads-pvc)
└── {workspaceId}/
    └── {workloadId}/           ← PVC subPath, 挂载为 Pod /workspace
        ├── .codex/             ← codex session 数据
        ├── .mbos/
        │   └── agent.log       ← agent 进程日志
        ├── src/                ← 任务工作文件
        └── ...
```

### Pod 创建时 Sandbox Manager 做什么

```go
subPath := filepath.Join(workspaceID, workloadID)
fullPath := filepath.Join(basePath, subPath)
os.MkdirAll(fullPath, 0755)    // 目录不存在就建，存在就跳过
// 将 subPath 用于 Pod VolumeMount
```

完毕。没有其他逻辑。

---

## 3. Sandbox Manager 改动

### 改动范围

共 2 个文件，约 20 行。目标：handler 直接创建目录并计算 subPath，无外部存储依赖。

### 3.1 `manager-service/internal/workload/handler.go`

Handler 使用纯目录模式：

```go
type Handler struct {
    k8sClient *k8s.Client
    executor  *k8s.Executor
    pvcName   string
    basePath  string   // JuiceFS 挂载根路径
}

func NewHandler(k8sClient *k8s.Client, executor *k8s.Executor,
    pvcName string, basePath string) *Handler {
    return &Handler{
        k8sClient: k8sClient,
        executor:  executor,
        pvcName:   pvcName,
        basePath:  basePath,
    }
}
```

`handleCreatePod` 中直接创建目录:

```go
subPath := filepath.Join(workspaceID, workloadID)
fullPath := filepath.Join(h.basePath, subPath)
if err := os.MkdirAll(fullPath, 0755); err != nil {
    log.Printf("workload/%s: mkdir failed: %v", workloadID, err)
    jsonError(w, http.StatusInternalServerError, "workspace dir creation failed: "+err.Error())
    return
}
log.Printf("workload/%s: workspace dir ready at %s", workloadID, fullPath)
```

### 3.2 `manager-service/internal/app/app.go`

```go
juicefsBasePath := getEnvOrDefault("JUICEFS_BASE_PATH", "/mnt/juicefs/workloads")
juicefsPVCName := getEnvOrDefault("JUICEFS_PVC_NAME", "juicefs-workloads-pvc")
workloadHandler := workload.NewHandler(k8sClient, k8sExecutor, juicefsPVCName, juicefsBasePath)
```

工作区使用纯目录模式：`MkdirAll` 创建 `{basePath}/{wsID}/{wlID}` 目录，通过 PVC subPath 挂载到 Pod。

---

## 4. AgentSmith: Internal Agent 注册

### 4.1 API

复用现有 `POST /api/v1/workspaces/{ws}/projects/{proj}/agents`，`mode` 设为 `"internal"`:

```json
{
  "name": "My Codex Agent",
  "mode": "internal",
  "interaction_mode": "both",
  "config": {
    "image": "registry.example.com/agent-codex:v1",
    "cpu_request": "500m",
    "cpu_limit": "2",
    "memory_request": "512Mi",
    "memory_limit": "4Gi",
    "idle_timeout_sec": 1800,
    "max_lifetime_sec": 86400,
    "env": {}
  },
  "runtime_preferences_json": {
    "notebook": {
      "endpoint_id": "ep_xxx",
      "model": "gpt-5-codex"
    }
  }
}
```

### 4.2 `resource-models.ts` — AgentRecord.config 扩展

```typescript
// packages/api-entry-node/src/resource-models.ts
// 在 AgentRecord.config 类型中新增字段:

config?: {
  image?: string;
  env?: Record<string, string>;
  max_concurrent_sessions_override?: number;
  // ↓ 新增
  cpu_request?: string;       // "500m"
  cpu_limit?: string;         // "2"
  memory_request?: string;    // "512Mi"
  memory_limit?: string;      // "4Gi"
  idle_timeout_sec?: number;  // 默认 1800
  max_lifetime_sec?: number;  // 默认 86400
  _internal_key_id?: string;  // 内部使用，不暴露给 API 响应
  _internal_raw_key?: string; // 内部使用，不暴露给 API 响应
};
```

### 4.3 `agent-route-handler.ts` — 创建逻辑

在现有 `route.kind === 'agents' && method === 'POST'` 分支中，创建成功后增加 internal agent 处理:

```typescript
// 在 const created = await deps.agentResourceService.createAgent(...) 之后:

if (created.mode === 'internal') {
  // 1. 校验 image 必填
  const config = created.config as Record<string, unknown> | undefined;
  if (!config?.image || typeof config.image !== 'string' || !config.image.trim()) {
    // 回滚: 删除刚创建的 agent
    await deps.agentResourceService.deleteAgent(route.workspaceId, route.projectId, created.id);
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'internal_agent_image_required' });
    return true;
  }

  // 2. 自动创建 service key
  // createAgentKey 返回 { record: AgentServiceKeyRecord, key: string }
  const { record: keyRecord, key: rawKey } = await deps.agentResourceService.createAgentKey(
    route.workspaceId, route.projectId, created.id,
  );

  // 3. 将 key 信息写入 config (raw_key 不暴露给前端)
  await deps.agentResourceService.updateAgent(route.workspaceId, route.projectId, created.id, {
    presence: 'managed',
    config: {
      ...(config as Record<string, unknown>),
      _internal_key_id: keyRecord.id,
      _internal_raw_key: rawKey,
    },
  });

  // 4. 重新获取更新后的 agent 返回给前端
  const updated = await deps.agentResourceService.getAgent(
    route.workspaceId, route.projectId, created.id,
  );
  // 过滤 _internal_* 字段后返回
  json(res, 201, stripInternalFields(updated));
  return true;
}
```

所有返回 agent 数据的 API 端点（list/get/patch）统一用 `stripInternalFields` 过滤 `_internal_*` 前缀字段，确保 raw key 不泄露。

### 4.4 `agent-route-handler.ts` — 删除逻辑

删除 internal agent 时，需释放可能运行中的 Pod（否则 Pod 继续运行到 idle timeout，浪费资源）:

```typescript
// 在现有 route.kind === 'agentItem' && method === 'DELETE' 分支中:
// 在 deps.agentResourceService.deleteAgent() 之前:

if (agent.mode === 'internal' && deps.internalAgentPodManager) {
  // 尝试释放所有可能的 Pod — 具体 workloadId 不确定（可能有多个 task/session）
  // MVP: 只做 best-effort 释放，依赖 idle timeout 兜底
  // 在 agent 删除后 WS key 失效，agent 进程会断开 → Pod 空闲 → cleaner 回收
}
await deps.agentResourceService.deleteAgent(route.workspaceId, route.projectId, agent.id);
```

> **注意**: 因为一个 agent 可能被多个 task/session 使用（各有不同 workloadId），精确释放所有 Pod 需要维护 agent→workload 映射。MVP 不做此映射，依赖 Sandbox Manager 的 idle timeout 自动回收。agent 删除后 WS key 立即失效，agent 进程会断开连接，Pod 进入空闲状态，cleaner 在 idle_timeout_sec 后自动删除。

### 4.5 `src/lib/api/types/index.ts` — 前端类型

```typescript
export interface AgentConfig {
  image?: string;
  env?: Record<string, string>;
  max_concurrent_sessions_override?: number;
  cpu_request?: string;
  cpu_limit?: string;
  memory_request?: string;
  memory_limit?: string;
  idle_timeout_sec?: number;
  max_lifetime_sec?: number;
}
```

---

## 5. AgentSmith: Sandbox Manager Client

新增 `packages/api-entry-node/src/sandbox-manager-client.ts`。

纯 HTTP 客户端，封装 Sandbox Manager 的 5 个 REST 端点。

```typescript
export interface PodStatusResponse {
  pod_name?: string;
  phase: string;         // "Running" | "Pending" | "Failed" | "offline"
  ip?: string;
  started_at?: string;
  expires_at?: string;
  message?: string;
}

export interface ExecResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export class SandboxManagerClient {
  constructor(
    private readonly baseUrl: string,    // "http://sandbox-manager:8080"
    private readonly serviceKey: string,  // X-Service-Key 值
  ) {}

  async createOrEnsurePod(
    workspaceId: string, projectId: string, workloadId: string,
    body: {
      image: string;
      env?: Record<string, string>;
      cpu_request?: string;
      cpu_limit?: string;
      memory_request?: string;
      memory_limit?: string;
      idle_timeout_sec?: number;
      max_lifetime_sec?: number;
    },
  ): Promise<{ httpStatus: number; pod: PodStatusResponse }> {
    const url = `${this.baseUrl}/v1/workspaces/${workspaceId}/projects/${projectId}/workloads/${workloadId}`;
    // Manager 的 handleCreatePod 内部 WaitForPodReady 最多阻塞 120s，给 150s 余量
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Service-Key': this.serviceKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
    if (!resp.ok && resp.status !== 200) {
      const text = await resp.text().catch(() => '');
      throw new Error(`sandbox_manager_error: ${resp.status} ${text}`);
    }
    return { httpStatus: resp.status, pod: await resp.json() as PodStatusResponse };
  }

  async getPodStatus(
    workspaceId: string, projectId: string, workloadId: string,
  ): Promise<PodStatusResponse> {
    const url = `${this.baseUrl}/v1/workspaces/${workspaceId}/projects/${projectId}/workloads/${workloadId}`;
    const resp = await fetch(url, { headers: { 'X-Service-Key': this.serviceKey } });
    return await resp.json() as PodStatusResponse;
  }

  async deletePod(
    workspaceId: string, projectId: string, workloadId: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/v1/workspaces/${workspaceId}/projects/${projectId}/workloads/${workloadId}`;
    await fetch(url, { method: 'DELETE', headers: { 'X-Service-Key': this.serviceKey } });
  }

  async keepalive(
    workspaceId: string, projectId: string, workloadId: string,
  ): Promise<string> {
    const url = `${this.baseUrl}/v1/workspaces/${workspaceId}/projects/${projectId}/workloads/${workloadId}/keepalive`;
    const resp = await fetch(url, { method: 'POST', headers: { 'X-Service-Key': this.serviceKey } });
    const data = await resp.json() as { expires_at: string };
    return data.expires_at;
  }

  async exec(
    workspaceId: string, projectId: string, workloadId: string,
    cmd: string[], timeoutSeconds?: number,
  ): Promise<ExecResponse> {
    const url = `${this.baseUrl}/v1/workspaces/${workspaceId}/projects/${projectId}/workloads/${workloadId}/exec`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Key': this.serviceKey },
      body: JSON.stringify({ cmd, timeout_seconds: timeoutSeconds ?? 30 }),
    });
    return await resp.json() as ExecResponse;
  }
}
```

---

## 6. AgentSmith: Internal Agent Pod Manager

新增 `packages/api-entry-node/src/internal-agent-pod-manager.ts`。

### 6.1 接口

```typescript
import type { AgentRecord } from './resource-models.js';

export interface InternalAgentPodManager {
  /** Pod 不存在则创建 + 启动 agent，已就绪则直接返回。 */
  ensureAgentReady(input: {
    workspaceId: string;
    projectId: string;
    workloadId: string;
    agent: AgentRecord;
  }): Promise<void>;

  /** 续期 Pod TTL。 */
  keepalive(workspaceId: string, projectId: string, workloadId: string): Promise<void>;

  /** 删除 Pod。PVC 目录中的数据不受影响。 */
  releasePod(workspaceId: string, projectId: string, workloadId: string): Promise<void>;
}
```

### 6.2 实现核心逻辑

```typescript
import type { SandboxManagerClient } from './sandbox-manager-client.js';
import type { AgentRuntimeService } from './agent-runtime-service.js';

export class InternalAgentPodManagerImpl implements InternalAgentPodManager {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly sandboxClient: SandboxManagerClient,
    private readonly agentRuntime: AgentRuntimeService,
    private readonly wsHost: string,           // "ws://agentsmith-api:20000"
    private readonly startupTimeoutMs: number, // 120000
  ) {}

  async ensureAgentReady(input: {
    workspaceId: string; projectId: string; workloadId: string; agent: AgentRecord;
  }): Promise<void> {
    const { workspaceId, projectId, workloadId, agent } = input;
    const lockKey = `${workspaceId}/${projectId}/${workloadId}`;

    // 等已有锁
    while (this.locks.has(lockKey)) {
      await this.locks.get(lockKey);
    }

    // 快速路径
    if (this.agentRuntime.getAgentOnlineState(agent.id)) return;

    // 加锁
    let releaseLock!: () => void;
    const lock = new Promise<void>(r => { releaseLock = r; });
    this.locks.set(lockKey, lock);
    try {
      await this.doEnsure(workspaceId, projectId, workloadId, agent);
    } finally {
      this.locks.delete(lockKey);
      releaseLock();
    }
  }

  private async doEnsure(
    wsId: string, projId: string, wlId: string, agent: AgentRecord,
  ): Promise<void> {
    // 再次检查（锁内）
    if (this.agentRuntime.getAgentOnlineState(agent.id)) return;

    const cfg = agent.config ?? {};
    const rawKey = (cfg as Record<string, unknown>)._internal_raw_key as string | undefined;
    if (!rawKey) throw Object.assign(new Error('internal_key_missing'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });

    // 全局 deadline — 所有阶段共享同一个超时预算
    const deadline = Date.now() + this.startupTimeoutMs;

    // 1. 查 Pod 状态
    const status = await this.sandboxClient.getPodStatus(wsId, projId, wlId);

    if (status.phase === 'Failed') {
      await this.sandboxClient.deletePod(wsId, projId, wlId).catch(() => {});
    }

    // 2. 创建 Pod（幂等）
    // 注意: Manager 的 handleCreatePod 内部 WaitForPodReady 最多阻塞 120s
    // createOrEnsurePod 的 fetch 已设 AbortSignal.timeout(150s)
    if (status.phase === 'offline' || status.phase === 'Failed') {
      const wsUrl = `${this.wsHost}/api/v1/agent-runtime/ws?agent_id=${agent.id}`;
      await this.sandboxClient.createOrEnsurePod(wsId, projId, wlId, {
        image: cfg.image!,
        env: {
          MBOS_AGENT_WS_URL: wsUrl,
          MBOS_AGENT_KEY: rawKey,
          MBOS_AGENT_CODEX_YOLO: '1',
          MBOS_AGENT_TASK_TIMEOUT_SEC: '55',
          // 不注入 OPENAI_API_KEY 等 — LLM 访问通过 endpoint proxy，
          // proxy 地址在 WS server.hello 中推送，用户凭据随请求下发
          ...(cfg.env ?? {}),   // 用户自定义 env（非 LLM 用途）
        },
        cpu_request: cfg.cpu_request ?? '500m',
        cpu_limit: cfg.cpu_limit ?? '2',
        memory_request: cfg.memory_request ?? '512Mi',
        memory_limit: cfg.memory_limit ?? '4Gi',
        idle_timeout_sec: cfg.idle_timeout_sec ?? 1800,
        max_lifetime_sec: cfg.max_lifetime_sec ?? 86400,
      });
    }

    // 3. 等 Pod Running（用剩余预算）
    this.checkDeadline(deadline);
    if (status.phase !== 'Running') {
      await this.waitForPhase(wsId, projId, wlId, 'Running', deadline);
    }

    // 4. 启动 agent runner 进程（强制 kill + restart，避免僵尸进程挡路）
    // agent-runner 是 Docker image 的入口二进制（即 agent-codex-runner 编译产物）
    this.checkDeadline(deadline);
    const exec = await this.sandboxClient.exec(wsId, projId, wlId, [
      'bash', '-c',
      'pkill -f agent-runner 2>/dev/null; sleep 0.5; '
      + 'mkdir -p /workspace/.mbos; '
      + 'nohup agent-runner > /workspace/.mbos/agent.log 2>&1 & echo $!',
    ], 10);
    if (exec.exit_code !== 0) {
      throw Object.assign(new Error('agent_exec_failed: ' + exec.stderr), { code: 'AGENT_SANDBOX_EXEC_FAILED' });
    }

    // 5. 等 agent WS 上线（用剩余预算）
    this.checkDeadline(deadline);
    await this.waitForAgentOnline(agent.id, deadline);
  }

  private checkDeadline(deadline: number): void {
    if (Date.now() >= deadline) {
      throw Object.assign(new Error('startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
    }
  }

  private async waitForPhase(
    wsId: string, projId: string, wlId: string, target: string, deadline: number,
  ): Promise<void> {
    while (Date.now() < deadline) {
      const s = await this.sandboxClient.getPodStatus(wsId, projId, wlId);
      if (s.phase === target) return;
      if (s.phase === 'Failed') {
        throw Object.assign(new Error('pod_failed'), { code: 'AGENT_SANDBOX_POD_FAILED' });
      }
      await sleep(2000);
    }
    throw Object.assign(new Error('pod_startup_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  private async waitForAgentOnline(agentId: string, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      if (this.agentRuntime.getAgentOnlineState(agentId)) return;
      await sleep(500);
    }
    throw Object.assign(new Error('agent_ws_timeout'), { code: 'AGENT_SANDBOX_STARTUP_TIMEOUT' });
  }

  async keepalive(wsId: string, projId: string, wlId: string): Promise<void> {
    await this.sandboxClient.keepalive(wsId, projId, wlId);
  }

  async releasePod(wsId: string, projId: string, wlId: string): Promise<void> {
    await this.sandboxClient.deletePod(wsId, projId, wlId).catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 7. AgentSmith: Notebook / Chat 集成

### 7.1 Notebook (`notebook-runtime-orchestrator.ts`)

在 `runNotebookTaskWithExternalAgent` 函数中，agent 加载之后增加 **两处改动**:

**改动 A: 跳过 endpoint 校验**

现有代码在 `getAgent()` 之后强制校验 `runtime_preferences_json.notebook.endpoint_id`，并加载 endpoint 实体做策略和限流检查。对 internal agent 来说没有 endpoint（LLM 由 agent 进程自己管理），必须跳过这段逻辑:

```typescript
const agent = await deps.agentResourceService.getAgent(task.workspace_id, task.project_id, agentId);
if (!agent || agent.status !== 'enabled') {
  throw Object.assign(new Error('agent_not_available'), { code: 'AGENT_OFFLINE' });
}

// ── 新增: internal agent 走独立分支 ──
// 跳过 endpoint 校验、endpoint 策略、agent 策略/限流
// - agent 可见性 (visibility) 已由 list/get API 控制访问权限
// - LLM 限流由 agent 自身的 API key 在 provider 侧完成
// - 组织级 agent 治理策略属于 Phase 2
let keepaliveTimer: NodeJS.Timeout | undefined;
if (agent.mode === 'internal') {
  const workloadId = sanitizeWorkloadId(task.id);

  emitTaskEvent(taskId, {
    type: 'trace_event',
    data: buildSandboxStartingEvent(),
  });

  await deps.internalAgentPodManager!.ensureAgentReady({
    workspaceId: task.workspace_id,
    projectId: task.project_id,
    workloadId,
    agent,
  });

  keepaliveTimer = setInterval(() => {
    deps.internalAgentPodManager!.keepalive(
      task.workspace_id, task.project_id, workloadId,
    ).catch(() => {});
  }, 60_000);

  // LLM 路由: endpoint proxy 地址已在 server.hello 推送，此处只传 per-request 凭据
  const runtimePreferences = agent.runtime_preferences_json as Record<string, unknown> ?? {};
  const notebookPrefs = runtimePreferences.notebook as Record<string, unknown> ?? {};
  const model = typeof notebookPrefs.model === 'string' ? notebookPrefs.model : 'default';
  const userHandle = buildProxyUsername(user);
  const taskInputs = await buildNotebookRuntimeTaskInputs({
    deps, workspaceId: task.workspace_id, projectId: task.project_id,
    taskId: task.id, attachedInputs: task.attached_inputs as NotebookTaskInputRefRecord[],
    debugLog,
  });

  try {
    const dispatched = await deps.agentRuntimeService.dispatchStreamingRequest({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      agentId: agent.id,
      model,
      messages: mapTaskMessagesForRuntime(taskId, assistantMessage.id),
      runtimeContext: {
        workspace_id: task.workspace_id,
        project_id: task.project_id,
        task_id: task.id,
        run_id: runId,
        username: userHandle,
        // 不传 endpoint_proxy_base — proxy 地址已在 WS 连接时由 server.hello 推送（resource_proxy.base_url）
        // 传 user_bearer_token — runner 用作 proxy auth + task input 文件下载
        api_base: publicBaseUrl.replace(/\/+$/, ''),
        user_bearer_token: rawBearerToken,
        model,
        notebook_mode: true,
        task_inputs: taskInputs,
      },
    });
    // ... 处理 stream 事件（复用现有逻辑）...
  } finally {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
  }
  return;
}

// ── 以下是现有 external agent 逻辑，完全不变 ──
// endpoint_id 校验 → endpoint 加载 → endpoint/agent 策略 → agent 限流 → dispatch
```

**要点:**
- internal agent 分支在 `getAgent()` 之后立即分叉，`return` 结束
- 跳过: endpoint_id 校验、endpoint 加载、endpoint/agent 策略、agent 限流 — 访问控制由 agent visibility 管理，LLM 限流由 proxy preflight 完成
- **不传 `endpoint_proxy_base`** — proxy 地址已在 WS 连接时通过 `server.hello` 推送给 runner（`resource_proxy.base_url`，见 Section 9.2）
- **传 `user_bearer_token`** — runner 用于两个用途: (1) proxy auth（codex 访问 LLM）, (2) task input 文件下载
- `model` 参数从 `runtime_preferences_json.notebook.model` 取
- 现有 external agent 逻辑完全不动（但 `runtime_context.endpoint_proxy_base` 的旧传递方式将在统一改造中移除——见 Section 8）

### 7.2 Task 关闭释放 Pod (`task-route-handler.ts`)

当 task 状态变为 `closed` / `archived` 时:

```typescript
if (agent?.mode === 'internal') {
  await deps.internalAgentPodManager.releasePod(
    workspaceId, projectId, sanitizeWorkloadId(taskId),
  ).catch(() => {});
}
```

### 7.3 Chat (`chat-stream-handler.ts`)

现有 Chat handler 通过 `session.external_agent_id` 判断是否走 agent 分支（字段名带 "external" 是历史命名，internal agent 也用这个字段）:

```typescript
// 现有代码（不改）:
const useExternalAgent = typeof session.external_agent_id === 'string'
  && session.external_agent_id.length > 0;
```

在 `if (useExternalAgent)` 分支内部，`dispatchStreamingRequest` 调用**之前**，插入 internal agent 处理:

```typescript
if (useExternalAgent) {
  const externalAgentId = session.external_agent_id ?? '';

  // ── 新增: 加载 agent, 判断是否 internal ──
  const agent = await deps.agentResourceService.getAgent(
    route.workspaceId, route.projectId, externalAgentId,
  );
  if (agent?.mode === 'internal') {
    const workloadId = sanitizeWorkloadId(route.sessionId);
    await deps.internalAgentPodManager!.ensureAgentReady({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      workloadId,
      agent,
    });
    await deps.internalAgentPodManager!.keepalive(
      route.workspaceId, route.projectId, workloadId,
    ).catch(() => {});
  }

  // ── 现有代码不变: dispatchStreamingRequest ──
  const dispatched = await deps.agentRuntimeService.dispatchStreamingRequest({
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    agentId: externalAgentId,
    model: raw.model ?? session.model,
    messages: upstreamMessages,
  });
  // ... 处理 stream ...
}
```

**要点:**
- `session.external_agent_id` 对 internal 和 external agent 通用，不需要新字段
- 创建 session 时前端传入 agent_id 即可，后端已存为 `external_agent_id`
- Chat 没有显式 "close session" 操作，Pod 通过 idle timeout 自动回收
- 如需主动回收，在 session delete handler 中调用 `releasePod`

### 7.4 Workload ID

| 场景 | workloadId | 含义 |
|------|-----------|------|
| Notebook | `task.id` sanitized | 同一 task 共享 `/workspace` |
| Chat | `session.id` sanitized | 同一 session 共享 `/workspace` |

```typescript
// K8s pod name 要求: [a-z0-9]([a-z0-9-]*[a-z0-9])?, 最长 63
// isValidK8sName (handler.go) 拒绝: 大写、点、特殊字符、首尾 hyphen
function sanitizeWorkloadId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // 非法字符全部替换为 -
    .replace(/-{2,}/g, '-')        // 连续 - 合并
    .replace(/^-+|-+$/g, '')       // 去掉首尾 -
    .slice(0, 63);
}
```

### 7.5 辅助函数

```typescript
function buildSandboxStartingEvent() {
  return {
    sequence: 0,
    at: new Date().toISOString(),
    category: 'lifecycle' as const,
    phase: 'start' as const,
    name: 'sandbox_starting',
    summary: 'Starting agent sandbox...',
  };
}
```

---

## 8. Agent Runner 适配（agent-codex-runner）

### 设计原则

> 用 external 模式开发的 agent runner，直接打包为 Docker image 发布为 internal agent，**零代码修改**。两种模式的 LLM 访问路径完全一致（endpoint proxy），runner 代码无任何分支差异。唯一的部署差异由 `WORKSPACE_PATH` 环境变量驱动。

| | External 模式（开发/内测） | Internal 模式（Pod 内） |
|---|---|---|
| 部署 | 本地进程或远程机器 | K8s Pod 内 |
| 并发 | 可同时处理多个 workload 请求 | 仅服务一个 workload |
| 工作目录 | `/tmp/{username}/{task_id}` 各自独立 | `/workspace`（JuiceFS PVC，持久化） |
| LLM 路由 | endpoint proxy（地址来自 `server.hello`） | **完全相同** |
| Session 恢复 | 进程内存 Set（进程重启丢失） | 检测 `/workspace/.codex/` 目录存在即恢复 |

### 8.1 `agent-codex-runner/src/index.ts` — `cwd` 推导

现有逻辑:

```typescript
const cwd = join('/tmp', username, taskId);
```

**改动**: 优先使用 `WORKSPACE_PATH` 环境变量（Sandbox Manager 在 Pod 创建时自动注入 `WORKSPACE_PATH=/workspace`）:

```typescript
const workspacePath = process.env.WORKSPACE_PATH;
const cwd = workspacePath
  ? workspacePath                               // internal: /workspace (PVC 持久化)
  : join('/tmp', username, taskId);             // external: /tmp/{user}/{task} (各请求隔离)
await mkdir(cwd, { recursive: true });
```

- External: 无 `WORKSPACE_PATH` → `/tmp/{username}/{task_id}`，每个 workload 独立目录
- Internal: `WORKSPACE_PATH=/workspace` → 直接用 `/workspace`，整个 Pod 专属此目录

### 8.2 `server.hello` → 存储 proxy 配置

现有 runner 从每次 `runtime_context.endpoint_proxy_base` 读取 proxy 地址。改为在 `server.hello` 中一次性接收 `resource_proxy.base_url`:

```typescript
// 模块级状态
let endpointProxyBase: string | undefined;

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString('utf-8'));

  if (msg.type === 'server.hello') {
    const proxy = msg.payload?.resource_proxy;
    if (proxy?.base_url) {
      endpointProxyBase = proxy.base_url;
    }
    return;
  }

  // ... server.ping, server.request.start, server.request.cancel ...
});
```

### 8.3 `codex-command-builder.ts` — 统一 proxy 配置

**移除条件分支**。proxy 地址来自 `server.hello`（模块状态），per-request 只传 `user_bearer_token`:

```typescript
// 现有逻辑不变：始终配置 proxy provider
// proxy base_url = endpointProxyBase (from server.hello)
// bearer_token = runtime_context.user_bearer_token (per request)
export function buildTaskCodexConfig(args: {
  model: string;
  endpointProxyBase: string;    // from server.hello (static)
  wireApi: 'responses' | 'chat';
  userBearerToken?: string;     // from runtime_context (per request)
}): string {
  const lines: string[] = [
    '# Generated by @mbos/agent-codex-runner',
    `model = ${tomlString(args.model)}`,
    'model_provider = "proxy"',
    '',
    '[model_providers.proxy]',
    `name = ${tomlString('Proxy')}`,
    `base_url = ${tomlString(args.endpointProxyBase)}`,
    `wire_api = ${tomlString(args.wireApi)}`,
  ];
  if (args.userBearerToken?.trim()) {
    lines.push(`experimental_bearer_token = ${tomlString(args.userBearerToken)}`);
  }
  lines.push('', 'web_search = "disabled"', 'hide_agent_reasoning = true');
  return `${lines.join('\n')}\n`;
}
```

`buildCodexExecArgs` 同理 — 始终注入 proxy 参数，无条件分支。

**关键变化**: `endpointProxyBase` 的来源从 `runtime_context` 改为模块级状态（`server.hello` 推送）。函数签名和逻辑不变，只是调用方传入的值来源变了。

### 8.4 `runCodexRequest` — 数据流

```typescript
async function runCodexRequest(requestId: string, payload: ServerStartPayload): Promise<void> {
  const runtimeContext = payload.runtime_context ?? {};

  // cwd: WORKSPACE_PATH (internal) 或 /tmp/{user}/{task} (external)
  const workspacePath = process.env.WORKSPACE_PATH;
  const cwd = workspacePath
    ? workspacePath
    : join('/tmp', sanitizePathPart(runtimeContext.username, 'unknown_user'),
                   sanitizePathPart(runtimeContext.task_id, `task_${requestId.slice(0, 8)}`));

  // proxy: 来自 server.hello，不再从 runtime_context 读取
  const proxyBase = endpointProxyBase ?? '';
  if (!proxyBase) {
    // server.hello 未推送 proxy 配置 → 无法调用 LLM
    sendError(requestId, 'PROXY_NOT_CONFIGURED', 'endpoint proxy not available');
    return;
  }

  // per-request 凭据
  const userBearerToken = runtimeContext.user_bearer_token;
  const model = runtimeContext.model ?? payload.model ?? 'gpt-5-codex';

  // 配置 codex（proxy 始终启用）
  await writeFile(join(cwd, '.codex', 'config.toml'),
    buildTaskCodexConfig({ model, endpointProxyBase: proxyBase, wireApi: 'responses', userBearerToken }),
  );

  // ... 其余逻辑不变 (spawn codex, stream output, etc.)
}
```

### 8.5 Session 恢复（Pod 重启后）

现有逻辑用进程内存 Set 判断是否 resume:

```typescript
const resumeLast = isNotebookMode && codexSessionReadyByCwd.has(cwd);
```

Pod 重启后内存 Set 清空 → `resumeLast = false` → codex 开新 session。但 `/workspace/.codex/` 仍然存在（JuiceFS 持久化）。

**改动**: 同时检测文件系统:

```typescript
import { existsSync } from 'node:fs';

const hasPersistedSession = existsSync(join(cwd, '.codex', 'sessions'));
const resumeLast = isNotebookMode && (codexSessionReadyByCwd.has(cwd) || hasPersistedSession);
```

- External: `/tmp` 在进程重启后被清理 → `hasPersistedSession = false` → 行为不变
- Internal: `/workspace/.codex/sessions` 在 JuiceFS 上持久 → `hasPersistedSession = true` → 自动恢复上下文

---

## 9. AgentRuntimeService 改动

### 9.1 WS 断开后 presence 恢复为 `managed`

现有代码在 WS 断开时无条件设 `presence='offline'`:

```typescript
// agent-runtime-service.ts handleSocketClose()
void this.agentResourceService.touchAgentPresence(
  socket.workspaceId, socket.projectId, agentId, 'offline',
);
```

对 internal agent，`offline` 与从未连接的 external agent 无法区分。需改为:

```typescript
private handleSocketClose(agentId: string): void {
  const socket = this.socketsByAgentId.get(agentId);
  if (!socket) return;
  for (const pending of socket.pendingByRequestId.values()) {
    clearTimeout(pending.timer);
    pending.push({ type: 'error', error_code: 'AGENT_DISCONNECTED', error_message: 'agent_disconnected' });
    pending.close();
  }
  this.socketsByAgentId.delete(agentId);
  this.agentResourceService.markAgentDisconnected(agentId);

  // internal agent → 恢复 managed; external agent → offline
  void this.agentResourceService.getAgent(socket.workspaceId, socket.projectId, agentId).then((agent) => {
    const targetPresence = agent?.mode === 'internal' ? 'managed' : 'offline';
    return this.agentResourceService.touchAgentPresence(
      socket.workspaceId, socket.projectId, agentId, targetPresence,
    );
  });
}
```

这样前端状态表才能正确显示:
- external + offline → 灰点 "Offline"
- internal + managed → 蓝点 "Managed"（可用，但 Pod 未运行）
- internal + online → 绿点 "Running"（Pod 活跃，WS 已连接）

### 9.2 `server.hello` 推送 endpoint proxy 配置

**现有** `server.hello` 只包含协议版本和心跳间隔:

```json
{
  "type": "server.hello",
  "payload": {
    "protocol_version": "1.0",
    "heartbeat_interval_seconds": 30
  }
}
```

**改动**: 在 agent WS 连接认证通过后，查找 agent 配置的 endpoint，构建 proxy URL 并推送:

```typescript
// agent-runtime-service.ts — handleConnection 中，认证通过后:

const agent = await this.agentResourceService.getAgent(socket.workspaceId, socket.projectId, agentId);
const runtimePrefs = agent?.runtime_preferences_json as Record<string, unknown> ?? {};
const notebookPrefs = runtimePrefs.notebook as Record<string, unknown> ?? {};
const endpointId = typeof notebookPrefs.endpoint_id === 'string' ? notebookPrefs.endpoint_id : '';

let resourceProxy: Record<string, string> | undefined;
if (endpointId) {
  const proxyBase = `${this.publicBaseUrl}/api/v1`
    + `/workspaces/${encodeURIComponent(socket.workspaceId)}`
    + `/projects/${encodeURIComponent(socket.projectId)}`
    + `/endpoints/${encodeURIComponent(endpointId)}/proxy`;
  resourceProxy = { base_url: proxyBase };
}

ws.send(JSON.stringify({
  type: 'server.hello',
  timestamp: new Date().toISOString(),
  payload: {
    protocol_version: '1.1',
    heartbeat_interval_seconds: 30,
    ...(resourceProxy ? { resource_proxy: resourceProxy } : {}),
  },
}));
```

**新的 `server.hello` 消息格式:**

```json
{
  "type": "server.hello",
  "payload": {
    "protocol_version": "1.1",
    "heartbeat_interval_seconds": 30,
    "resource_proxy": {
      "base_url": "https://agentsmith.example.com/api/v1/workspaces/ws_xxx/projects/proj_xxx/endpoints/ep_xxx/proxy"
    }
  }
}
```

**数据流:**

```
Agent WS connect → 认证 (Bearer ask_xxx)
  ↓
Backend: agent.runtime_preferences_json.notebook.endpoint_id → 构建 proxy URL
  ↓
server.hello { resource_proxy: { base_url } }
  ↓
Runner 存储 endpointProxyBase (模块级状态)
  ↓
每次 server.request.start:
  runtime_context.user_bearer_token (per-request 凭据)
  + endpointProxyBase (from hello, static)
  → codex config → 通过 proxy 访问 LLM
```

**优势:**
- 静态配置（proxy 地址）一次推送，不随请求重复
- 动态凭据（user bearer token）per-request 下发
- External 和 Internal agent 行为完全一致 — 无代码分支

### 9.3 `AgentRuntimeService` 新增依赖

`server.hello` 推送 proxy URL 需要 `publicBaseUrl`。在构造时注入:

```typescript
constructor(
  private readonly agentResourceService: AgentResourceService,
  private readonly publicBaseUrl: string,  // 新增: "https://agentsmith.example.com"
) {}
```

---

## 10. AgentSmith: 依赖注入

### 10.1 `node-api-deps.ts`

新增一行:

```typescript
export interface NodeApiDeps {
  // ... 现有字段 ...
  internalAgentPodManager?: InternalAgentPodManager;
}
```

### 10.2 `node-api-deps-factory.ts`

根据环境变量决定是否创建实例:

```typescript
const sandboxUrl = process.env.SANDBOX_MANAGER_URL;
const sandboxKey = process.env.SANDBOX_SERVICE_KEY;
let internalAgentPodManager: InternalAgentPodManager | undefined;

if (sandboxUrl && sandboxKey) {
  const client = new SandboxManagerClient(sandboxUrl, sandboxKey);
  const wsHost = process.env.INTERNAL_AGENT_WS_HOST ?? 'ws://localhost:20000';
  const timeout = Number(process.env.INTERNAL_AGENT_STARTUP_TIMEOUT_MS) || 120_000;
  internalAgentPodManager = new InternalAgentPodManagerImpl(client, agentRuntimeService, wsHost, timeout);
}
```

当 `internalAgentPodManager` 为 undefined 且用户尝试使用 internal agent 时，返回 `AGENT_SANDBOX_NOT_CONFIGURED` 错误。

---

## 11. 前端

### 11.1 创建 Agent 对话框 (`CreateAgentDialog.tsx`)

增加 `mode` 选择（External / Internal）。

`mode === 'internal'` 时:
- **Container Image** (必填) — text input
- **Endpoint** (必填) — 下拉选择项目内的 endpoint（LLM 通过 proxy 访问）
- **Model** — text input（默认使用 endpoint 的 model）
- **CPU Request / Limit** — 下拉 (250m / 500m / 1 / 2 / 4)
- **Memory Request / Limit** — 下拉 (256Mi / 512Mi / 1Gi / 2Gi / 4Gi / 8Gi)
- **Environment Variables** — key-value 编辑器（可选，非 LLM 用途）
- 隐藏 Connection Info 和 Service Key 管理区域

`mode === 'external'` 时保持现有 UI 不变。

### 11.2 Agent 列表状态

| mode | presence | 显示 |
|------|----------|------|
| external | online | 绿点 "Online" |
| external | offline | 灰点 "Offline" |
| internal | managed | 蓝点 "Managed" |
| internal | online | 绿点 "Running" |

### 11.3 冷启动体验

Notebook/Chat 等待 Pod 启动期间，前端通过 SSE `trace_event`（`name=sandbox_starting`）显示 "Starting agent sandbox..." 加载指示器。Pod 就绪后自动进入正常的流式响应。

---

## 12. 数据流完整示例

### Notebook: 首次请求（冷启动）

```
用户发送消息 → POST /tasks/{taskId}/messages
   │
   ├─ 加载 agent → mode=internal
   ├─ 发送 SSE trace_event: "Starting agent sandbox..."
   │
   ├─ ensureAgentReady:
   │   ├─ GET /workloads/{taskId} → phase="offline"
   │   ├─ PUT /workloads/{taskId} → 201 Created
   │   │   (Sandbox Manager: mkdir + PVC subPath 挂载 + Pod 创建)
   │   ├─ 等待 Pod Running...
   │   ├─ POST /exec → 启动 agent-runner 进程
   │   └─ 等待 agent WS 上线... ✓
   │       (WS 连接时 server.hello 推送 resource_proxy.base_url)
   │
   ├─ dispatchStreamingRequest → server.request.start
   │   runtime_context: { user_bearer_token, model, task_id, ... }
   │   agent: proxy(from hello) + bearer(from request) → codex → LLM
   │   SSE: delta / trace_event / artifact / done
   │
   └─ 启动 keepalive 循环 (60s)
```

### Notebook: 后续请求（热路径）

```
用户发送消息 → POST /tasks/{taskId}/messages
   │
   ├─ 加载 agent → mode=internal
   ├─ ensureAgentReady:
   │   └─ agent WS 已 online → 直接返回 (毫秒级)
   │
   ├─ dispatchStreamingRequest → agent 在同一 /workspace 继续工作
   │   codex 识别上次 session → resume --last
   │
   └─ keepalive 续期
```

### Notebook: Pod 被回收后的请求

```
用户发送消息 → POST /tasks/{taskId}/messages
   │
   ├─ ensureAgentReady:
   │   ├─ agent WS 离线
   │   ├─ GET /workloads/{taskId} → phase="offline" (Pod 已被 cleaner 回收)
   │   ├─ PUT /workloads/{taskId} → 201 Created
   │   │   (PVC subPath 目录中上次的文件全部还在)
   │   ├─ 等待 Pod Running → POST /exec → 启动 agent
   │   └─ 等待 WS ✓
   │
   └─ dispatchStreamingRequest → agent 发现 /workspace 中有之前的数据
       codex resume --last → 恢复上下文
```

---

## 13. 环境变量

### AgentSmith

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SANDBOX_MANAGER_URL` | *(空=不启用)* | Sandbox Manager 地址 |
| `SANDBOX_SERVICE_KEY` | *(空=不启用)* | X-Service-Key |
| `INTERNAL_AGENT_WS_HOST` | `ws://localhost:20000` | Pod 连回的 WS 地址 |
| `INTERNAL_AGENT_STARTUP_TIMEOUT_MS` | `120000` | 启动等待超时 |

### Sandbox Manager

### Pod 内 Agent Runner（由 Sandbox Manager 自动注入）

| 变量 | 说明 |
|------|------|
| `WORKSPACE_PATH` | `/workspace` — 触发 internal 模式 cwd 推导 |
| `MBOS_AGENT_WS_URL` | AgentSmith WS 端点 |
| `MBOS_AGENT_KEY` | 自动生成的 service key (`ask_xxx`) |
| *(用户 config.env)* | 用户自定义环境变量（非 LLM 用途） |

> **注意**: Pod 内不注入 `OPENAI_API_KEY` 等 LLM 凭据。LLM 访问通过 endpoint proxy 完成——proxy 地址在 WS `server.hello` 中推送，用户凭据随请求下发。

---

## 14. 错误码

| 错误码 | 场景 | 含义 |
|--------|------|------|
| `AGENT_SANDBOX_NOT_CONFIGURED` | `SANDBOX_MANAGER_URL` 未配置 | Internal agent 功能未启用 |
| `AGENT_SANDBOX_STARTUP_TIMEOUT` | Pod 启动或 WS 连接超时 | 重试或检查镜像/资源 |
| `AGENT_SANDBOX_POD_FAILED` | Pod 进入 Failed 状态 | 检查镜像是否可拉取 |
| `AGENT_SANDBOX_EXEC_FAILED` | agent 进程启动失败 | 检查镜像中是否有 agent-runner |

---

## 15. 安全

| 要点 | 措施 |
|------|------|
| LLM 访问 | 通过 endpoint proxy，不直连 LLM provider。proxy preflight 做鉴权和限流 |
| 用户 bearer token | 不进 Pod env，只在 WS `runtime_context` 中 per-request 内存传递 |
| endpoint proxy 地址 | `server.hello` 推送，不含凭据信息 |
| Agent service key | Pod env 注入，权限仅限 WS 连接 |
| raw key 存储 | 存 DB，API 响应中过滤 `_internal_*` 字段 |
| Pod 权限 | uid=1000, automountServiceAccountToken=false |
| 网络 | NetworkPolicy: egress 仅 AgentSmith (proxy + WS) |

---

## 16. 文件清单

### 新增

| 文件 | 仓库 |
|------|------|
| `packages/api-entry-node/src/sandbox-manager-client.ts` | agentsmith |
| `packages/api-entry-node/src/internal-agent-pod-manager.ts` | agentsmith |
| `packages/api-entry-node/src/__tests__/sandbox-manager-client.test.ts` | agentsmith |
| `packages/api-entry-node/src/__tests__/internal-agent-pod-manager.test.ts` | agentsmith |

### 修改

| 文件 | 仓库 | 改动 |
|------|------|------|
| `packages/api-entry-node/src/resource-models.ts` | agentsmith | AgentConfig 扩展 |
| `packages/api-entry-node/src/agent-route-handler.ts` | agentsmith | internal agent 创建校验 + 自动 key |
| `packages/agent-codex-runner/src/index.ts` | agentsmith | WORKSPACE_PATH cwd 推导 + server.hello proxy + session 恢复 |
| `packages/agent-codex-runner/src/codex-command-builder.ts` | agentsmith | proxy base_url 来源从 runtime_context 改为模块状态 |
| `packages/api-entry-node/src/agent-runtime-service.ts` | agentsmith | server.hello 推送 resource_proxy + handleSocketClose presence |
| `docs/contracts/agent-runtime-protocol.md` | agentsmith | server.hello 新增 resource_proxy 字段 |
| `packages/api-entry-node/src/notebook-runtime-orchestrator.ts` | agentsmith | internal agent 分支 + 跳过 endpoint 校验 |
| `packages/api-entry-node/src/chat-stream-handler.ts` | agentsmith | useExternalAgent 分支内 ensureAgentReady |
| `packages/api-entry-node/src/task-route-handler.ts` | agentsmith | task 关闭释放 Pod |
| `packages/api-entry-node/src/node-api-deps.ts` | agentsmith | 新增 internalAgentPodManager |
| `packages/api-entry-node/src/node-api-deps-factory.ts` | agentsmith | 实例创建 |
| `src/lib/api/types/index.ts` | agentsmith | 前端 AgentConfig 类型 |
| `src/components/agents/CreateAgentDialog.tsx` | agentsmith | internal agent UI |
| `src/components/agents/EditAgentDialog.tsx` | agentsmith | internal agent UI |
| `manager-service/internal/workload/handler.go` | mbos-sandbox-v1 | 纯目录模式 (MkdirAll + PVC subPath) |
| `manager-service/internal/app/app.go` | mbos-sandbox-v1 | Handler 初始化 |

---

## 17. 实施步骤

| # | 天数 | 内容 | 可并行 |
|---|------|------|--------|
| 1 | 0.5 | Sandbox Manager: 纯目录模式 (MkdirAll + subPath) | — |
| 2 | 1 | sandbox-manager-client.ts + 测试 | 与 1 并行 |
| 3 | 1 | server.hello 推送 resource_proxy + runner 适配 (cwd/hello/resume) + 测试 | 与 1,2 并行 |
| 4 | 2 | internal-agent-pod-manager.ts + 并发控制 + 测试 | 等 2 |
| 5 | 1 | agent-route-handler: internal agent 创建 + 自动 key | 与 4 并行 |
| 6 | 1 | notebook/chat 集成 + runtime_context 精简 + task 关闭释放 | 等 4+5 |
| 7 | 1.5 | 前端 UI (含 endpoint 选择) + 冷启动提示 | 与 6 并行 |
| 8 | 1 | 端到端联调 | 等全部 |
| **合计** | **~9** | | |

### 发布检查

- [ ] Internal Agent 创建成功（image + endpoint + cpu/memory）
- [ ] Agent WS 连接后 server.hello 包含 resource_proxy.base_url
- [ ] Notebook 首消息触发 Pod 创建 → agent WS 连接 → 执行完成
- [ ] Notebook 多轮对话在同一 Pod 内完成（热路径，毫秒级）
- [ ] Pod 被 idle timeout 回收后，重建 Pod → /workspace 数据还在 → codex resume
- [ ] Chat 以上流程同样工作
- [ ] 冷启动期间前端有加载状态
- [ ] agent service key 不出现在 API 响应中
- [ ] `SANDBOX_MANAGER_URL` 未配置时，创建 internal agent 或使用时有明确报错

---

## 18. 已知限制 (MVP)

### 18.1 多实例并发

`InternalAgentPodManager` 的 per-workload 锁是 **进程内** 的（`Map<string, Promise>`）。如果 AgentSmith 有多个实例（水平扩容），两个实例可能同时对同一 workload 执行 `ensureAgentReady`。

**影响**: 两个实例可能同时 exec 启动 agent 进程。第二个 WS 连接会替换第一个（`AgentRuntimeService` 现有逻辑 `agent_replaced`），最终状态正确但过程中有一次短暂断连。

**缓解**: Sandbox Manager 的 PUT 是幂等的（AlreadyExists → 200），exec 中用 `pkill` 清理旧进程再启动新的，WS 层面有替换逻辑。不影响数据一致性。

**Phase 2 方案**: 如果需要严格互斥，可引入 Redis 分布式锁 (`SETNX` on lockKey)。

### 18.2 `_internal_raw_key` 明文存储

MVP 将 agent service key 明文存储在 `AgentRecord.config._internal_raw_key`（DB 中）。现有的 key 体系只存 hash（`key_hash`），不保留明文。但 internal agent 需要在 Pod 创建时注入明文 key 到环境变量。

**风险**: DB 被泄露时攻击者可冒充任何 internal agent 建立 WS 连接。

**缓解**: `stripInternalFields` 确保 API 响应不包含此字段。

**Phase 2 方案**: 用 K8s Secret 存储 raw key（创建 Secret → Pod 通过 `secretKeyRef` 引用），AgentSmith 不保留明文。或用 Vault/KMS 加密存储。

### 18.3 一个 task/session 绑定一个 agent

一个 task（Notebook）或 session（Chat）在生命周期内只使用一个 agent。workloadId 由 task.id / session.id 生成，Pod 的容器镜像和环境变量在创建时固定。

如果用户在同一 task 中切换到不同的 internal agent，旧 Pod 仍在运行（镜像/key 不同），新 agent 会尝试创建同一 workloadId 的 Pod → AlreadyExists → 返回旧 Pod → agent key 不匹配 → WS 认证失败。

**缓解**: 前端在 task/session 绑定 agent 后禁止切换。如果需要切换，先 close task，再创建新 task 选新 agent。

### 18.4 External ↔ Internal 行为差异

| 行为 | External | Internal |
|------|----------|----------|
| 并发 | 一个 runner 进程同时处理多个 workload | 一个 Pod 仅服务一个 workload |
| 工作目录 | `/tmp/{user}/{task_id}` 互不干扰 | `/workspace`（JuiceFS 持久化） |
| LLM 路由 | endpoint proxy（`server.hello` 推送） | **完全相同** |
| Session 恢复 | 进程内存 (重启丢失) | JuiceFS `.codex/sessions/` (持久) |
| 镜像 | 开发本地运行 (tsx/node) | 打包为 Docker image |

**关键保证**: 同一份 agent-codex-runner 代码在两种模式下运行，**零代码修改**。runner 代码中无 external/internal 分支。唯一差异由 `WORKSPACE_PATH` 环境变量驱动（是否存在决定 cwd 推导方式）。LLM 访问路径完全一致。

---

## 附录: 容器镜像要求

Internal Agent 镜像 = External Agent 代码直接打包。无需修改代码。

| 组件 | 说明 |
|------|------|
| `agent-runner` | agent-codex-runner 编译产物（WS 客户端 + codex 调度） |
| `codex` CLI | 任务执行引擎 |
| `bash` | exec 启动脚本需要 |
| `pkill` | 进程清理需要 (procps) |

运行要求: uid=1000, WorkingDir=/workspace。

**Dockerfile 示例:**

```dockerfile
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y procps bash && rm -rf /var/lib/apt/lists/*

# 安装 codex CLI
COPY --from=codex-builder /usr/local/bin/codex /usr/local/bin/codex

# 安装 agent-runner (agent-codex-runner 编译产物)
COPY dist/agent-runner /usr/local/bin/agent-runner

USER 1000
WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
```

镜像无需包含任何 LLM API key 或 endpoint 配置 — LLM 访问通过 AgentSmith endpoint proxy 完成，proxy 地址在 WS 连接时自动推送。

---

## 19. 2026-03-04 复核结论与联调前任务清单（AgentSmith 侧）

本节用于记录当前代码复核后的真实状态，供开发/测试/项目管理统一对齐。

### 19.1 复核结论摘要

- AgentSmith 侧主干已完成约 75%~80%，内部 agent 核心路径已具备雏形。
- 进入 sandbox 联合开发前，仍有 4 个高优先级缺口（2 个 P0、2 个 P1）需要先收敛。
- 前端还有 4 个体验/可用性项可并行推进，不阻断后端联调。

### 19.2 已确认完成（代码已落地）

- `server.hello` 已下发 `resource_proxy.base_url`（非 per-request 传递）。
- runner 已从 `server.hello` 接收并使用 proxy 地址。
- internal pod manager、sandbox manager client、相关 backend 单测已存在并通过。
- internal agent 断开连接后 presence 回落 `managed`。
- notebook internal 分支已接入 `ensureAgentReady` 与 60s keepalive。

### 19.3 联调前必须完成（P0 / P1）

1. `agent-codex-runner` 支持 `WORKSPACE_PATH` 作为 cwd 优先来源（P0）。
2. `agent-codex-runner` 增加文件系统会话恢复判定（`.codex/sessions`）（P0）。
3. notebook orchestrator 对 internal agent 前置分支，移除对 endpoint 预检的硬依赖（P1）。
4. chat internal 路径增加 60s keepalive timer（P1）。

### 19.4 可并行完成（不阻断联调）

1. notebook 前端渲染 `sandbox_starting` 冷启动提示。
2. agents 列表增加 presence 可视化（online/offline/managed/running）。
3. Create/Edit Agent 的 `notebook_endpoint_id` 从自由输入改为 endpoint 下拉。
4. Edit Agent 补齐 internal `env` 编辑能力。

### 19.5 文档与协议一致性要求

- 统一字段命名为 `resource_proxy.base_url`。
- 旧称 `endpoint_proxy_base` 不再作为有效协议字段。
- 计划文档、合约文档、代码注释必须同步更新，避免联调误解。

### 19.6 发布检查修正

- [ ] Agent WS 连接后 `server.hello` 包含 `resource_proxy.base_url`

### 19.7 JuiceFS 挂载策略与权限模型（2026-03-04 复核改进）

**背景:** 参照 [JuiceFS K8s 部署文档](https://juicefs.com/docs/zh/community/how_to_use_on_kubernetes) 复核后，发现原设计存在三个结构性缺陷并已修复。

**JuiceFS 挂载方式选择:**

JuiceFS 在 K8s 中有三种使用方式:
1. **hostPath** — 节点预挂载 JuiceFS，Pod 通过 hostPath 使用。最简单，但缺少隔离性、所有节点需预配置、挂载进程不受 K8s 管控。
2. **CSI Driver (PVC)** — 通过 JuiceFS CSI 驱动以 PVC 形式挂载。K8s 原生、支持挂载点自动恢复、权限可控。
3. **容器内挂载** — 容器内运行 JuiceFS 客户端，需要 `privileged: true`。安全风险高。

**我们的选择: PVC + subPath（方式 2）**

理由:
- `ReadWriteMany` PVC 天然支持 Manager 和 workload Pod 共享同一文件系统
- CSI 驱动提供挂载点自动恢复（hostPath 下 JuiceFS 进程异常退出 → 所有 Pod 受影响）
- 不需要在每个 K8s 节点预安装 JuiceFS
- 不需要 privileged 模式，符合安全约束

**权限模型:**

JuiceFS 完整实现 POSIX 权限模型。核心规则:
- Manager Pod 以 `uid=1000, gid=1000` 运行（与 workload Pod 一致）
- Manager 创建目录后显式 `chown(1000, 1000)` 作为防御性编码
- Workload Pod SecurityContext 设置 `RunAsUser/RunAsGroup/FSGroup = 1000`
- `FSGroupChangePolicy: OnRootMismatch` — 仅在根目录 GID 不匹配时修正，避免大目录递归 chown 性能开销

**已修复的结构性问题:**

| # | 问题 | 修复 |
|---|------|------|
| 1 | Manager Deployment 未挂载 JuiceFS PVC | 增加 `juicefs-workloads-pvc` volumeMount |
| 2 | Manager uid 与 workload Pod uid 不一致 → 目录权限不匹配 | Manager Pod SecurityContext 设为 uid=1000; direct mode 增加 `os.Chown` |
| 3 | NetworkPolicy 未放行 AgentSmith WS 端口(20000) | egress 规则增加 TCP/20000 |
| 4 | Workload Pod 缺少 FSGroup → PVC 子路径 GID 不受控 | 增加 `RunAsGroup/FSGroup/FSGroupChangePolicy` |

### 19.8 Sandbox Manager Direct-Directory Mode（2026-03-04 实施）

AgentSmith 侧已完成 pre-sandbox 收口（见 `docs/release/internal-agent-pre-sandbox-readiness-2026-03-04.md`），Sandbox Manager 侧完成了以下适配:

**已完成:**
1. `handler.go`: 纯目录模式 — `MkdirAll` + `filepath.Join(wsID, wlID)` 作为 PVC subPath
2. `handler.go`: 业务指标接入 (RecordWorkloadCreate/Delete/Keepalive/Exec)
3. `handler.go`: K8s Delete/PatchActivity 操作增加重试 (retryutil.Retry)
4. K8s namespace 统一为 `sandbox-system` + `sandbox-workloads` 两个 namespace
5. 所有现有测试通过（unit + integration + build）

**subPath 格式:** `{workspaceID}/{workloadID}` — PVC 子目录即 workspace 目录

**联调准备:**
- `make sandbox-preflight` — 环境健康检查（Manager/Keycloak/API/Web）
- `make sandbox-api-dev` — 带 sandbox 环境变量启动 API
- `make sandbox-joint-smoke` — 自动化联调烟测（Phase 2 checklist）
- `secrets/sandbox-integration.demo.env` — 环境变量模板
- `docs/release/internal-agent-sandbox-joint-integration-report-template.md` — 联调报告模板
