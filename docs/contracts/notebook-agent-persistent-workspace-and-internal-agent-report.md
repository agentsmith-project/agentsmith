# Notebook 持久化工作空间与 Internal Agent 技术报告

Last updated: 2026-03-17
Owner: Frontend + API entry + Agent runner
Audience: 产品、前端、后端、sandbox 平台

## 1. 目标

本报告收敛下面这条新主线的技术判断：

- notebook task 创建时必须同时选择：
  - `agent`
  - `file library`
- 被选中的 `file library` 作为任务工作空间，为 agent CLI 提供持久化工作目录
- `external runner` 与 `internal runner` 尽量复用同一套业务执行逻辑
- `internal agent` 使用 `/home/percy/works/mbos-v1/mbos-sandbox-v1`

本报告只说明：

- 当前代码现状
- 可行性判断
- 推荐技术方案
- sandbox 满足度与缺口
- 风险和边界

本报告**不**展开详细实施排期。

## 2. 需求收敛

### 2.1 业务要求

1. 创建 notebook task 时，用户除了选择 `agent`，还必须选择 `file library`。
2. 该 `file library` 作为 task 的持久化工作环境。
3. `external runner` 在收到后端元信息后，就地把 JuiceFS 挂载到 task 工作目录并作为 agent CLI 的工作目录。
4. `internal runner` 使用 sandbox，但业务逻辑尽量与 external 一致。

### 2.2 模式差异

#### External

- 一个 runner 服务多个 task
- 每个 task 需要独立准备 workspace
- 不考虑资源回收
- runner 未连接时，用户不能选择对应 agent 开始 task

#### Internal

- 一个 runner 只服务一个 task
- 允许 lazy loading
- 首条消息时才拉 pod
- pod 空闲会被回收
- 后续用户消息会再次拉起 pod

### 2.3 已锁定的范围决策

当前已锁定下面这些范围决策：

- 先交付 **Phase 1：external 完整闭环**
  - `external-bare`
  - `external-docker`
- `internal-k8s` 保留为下一阶段交付
- 允许多个 task 绑定同一个 `file library`
  - 这代表它们共享同一份工作目录真相
- notebook 旧的“artifact 保存到文件库”交互**彻底删除**
- `artifacts` 面板只展示 task workspace 下 `.artifacts/` 目录内容
- 通过 `AGENTS.md` / 最佳实践约束 agent 把 deliverables 放入 `.artifacts/`
- internal 方案明确采用 **JuiceFS CSI Driver**
- internal 路线的 snapshot / restore **完全删除，不留兼容**

## 3. 当前现状

### 3.1 Notebook task 还没有工作空间文件库字段

当前 task 创建只要求：

- `title`
- `agent_id`
- `initial_inputs`

关键位置：

- [TaskCreateDialog.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/notebook/TaskCreateDialog.tsx)
- [task.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/types/task.ts)
- [task-models.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/notebook-task/task-models.ts)
- [task-route-handler.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/task-route-handler.ts)

现状结论：

- task 还没有 `workspace_file_library_id`
- notebook 创建流程也还不能选择文件库

### 3.2 External runner 已有 task cwd 模型

当前 runner 已支持：

- 使用 `execution_context.workspace_path` 作为 cwd
- 没有时退回 `/tmp/<username>/<taskId>`

关键位置：

- [task-workspace.ts](/home/percy/works/mbos-v1/agentsmith/packages/agent-codex-runner/src/task-workspace.ts)
- [index.ts](/home/percy/works/mbos-v1/agentsmith/packages/agent-codex-runner/src/index.ts)

现状结论：

- runner 并不需要从零重写
- 只需要把 task workspace 从 `/tmp` 切到“已准备好的工作目录”

### 3.3 File library 与 JuiceFS 基础已具备

当前 Files 主线已经具备：

- project-level `file-libraries`
- `storage-credential-exchange`
- `metadata_url`
- Web gateway
- local `juicefs mount`

关键位置：

- [juicefs-file-libraries-architecture.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/juicefs-file-libraries-architecture.md)
- [project-file-library-routes.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/project-file-library-routes.ts)
- [file-library-runtime.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/file-library-runtime.ts)

现状结论：

- 文件库作为持久化工作空间的底座已经存在
- 真正缺的是 notebook / runner 对这套能力的接线

### 3.4 Internal agent 已有 lazy start 骨架

当前 internal agent 已经支持：

- `managed` presence
- lazy `ensureAgentReady(...)`
- keepalive
- pod release
- pod 内启动 `agent-runner`
- `agent-runner` 通过 websocket 回连 AgentSmith

关键位置：

- [notebook-execution-orchestrator.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/notebook-execution-orchestrator.ts)
- [internal-agent-pod-manager.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/internal-agent-pod-manager.ts)
- [agent-execution-service.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/agent-execution-service.ts)

现状结论：

- internal agent 的运行模式方向是对的
- 但 pod 还没有接入持久化工作空间

## 4. 可行性判断

### 4.1 External：可直接推进

`external-bare` 和 `external-docker` 都可行。

原因：

- runner 已支持 task cwd
- file library 已支持 JuiceFS 元信息交换
- notebook 执行上下文已有 `task_id / api_base / user_bearer_token`
- 一个 runner 服务多个 task 的模式与本地 mount registry 兼容

### 4.2 Internal：方向可行，但当前 sandbox 不直接满足

当前 `/home/percy/works/mbos-v1/mbos-sandbox-v1` 具备：

- task/workload 级 pod
- lazy create
- keepalive / delete
- `/workspace` 工作目录

但当前 sandbox 还缺：

- 面向 AgentSmith workload 的 PVC 挂载能力
- 或者安全可控的 JuiceFS/FUSE 挂载能力
- 关闭 snapshot/finalizer 的 workload 开关

结论：

- internal agent 可以做
- 但必须先补 sandbox 能力

## 5. 推荐总方案

## 5.1 统一原则

统一的是：

- notebook task 模型
- notebook 执行上下文
- `agent-codex-runner` 业务执行逻辑

不强求统一的是：

- 工作空间的挂载实现方式

推荐抽象：

- `WorkspaceProvider.prepare(executionContext)`

三种运行载体：

- `external-bare`
- `external-docker`
- `internal-k8s`

### 5.2 External 工作空间方案

external 统一使用：

- runner 收到 notebook 请求后
- 从后端获取 task 专用的 workspace access
- 在本地或容器内执行 `juicefs mount`
- 把 mountpoint 作为 cwd

推荐路径：

- `external-bare`:
  - `~/ags-workspaces/<task-slug>`
- `external-docker`:
  - `/workspace/ags-workspaces/<task-slug>`

### 5.3 Internal 工作空间方案

internal 不建议在 pod 内直接运行 `juicefs mount`。

推荐方案：

- 使用 **JuiceFS CSI Driver**
- AgentSmith 为 file library 对应的 JuiceFS 文件系统准备：
  - Secret
  - PV
  - PVC
- internal task pod 直接把对应 PVC 挂到 `/workspace`
- pod 内 runner 只把 `/workspace` 当成 cwd

原因：

- 这是 Kubernetes 原生模式
- 避免在应用容器内直接做 FUSE 挂载
- 更适合 pod 回收和重建
- 与 lazy start + idle reclaim 更一致

## 6. 为什么 snapshot 可以删除

当前需求下，持久化真相应变成：

- 文件：`file library / JuiceFS`
- 任务元数据：AgentSmith 后端
- 会话/trace/artifact 记录：AgentSmith 后端

因此内部 pod 不需要再做：

- `/workspace` snapshot
- `/workspace` restore
- snapshot finalizer

推荐决策：

- 对 AgentSmith internal agent 这条线，**完全删除 snapshot 机制**
- 不保留兼容

理由：

- file library 已经提供持久化
- pod 回收后重新挂同一个文件库即可
- snapshot 会与 JuiceFS 持久化职责重叠
- snapshot 还会增加 pod 删除和回收复杂度

## 7. Docker 挂载权限判断

external 的 docker 模式下，如果要在容器内运行 `juicefs mount`，需要额外权限。

根据 JuiceFS 官方文档，典型前提包括：

- `juicefs` CLI 在镜像内可用
- `/dev/fuse`
- `SYS_ADMIN` capability 或更高权限
- 某些场景需要 `--privileged`
- AppArmor / seccomp 也可能需要放宽

这意味着：

- `external-docker` 不是“把裸跑 runner 装进容器”就够了
- 必须明确给出容器运行前提和镜像要求

## 8. 统一 runner 设计

推荐保留同一个：

- `packages/agent-codex-runner`

并让 execution context 统一带上工作空间信息：

- `workspace_file_library_id`
- `workspace_path`
- `workspace_binding_mode`

其中：

- `external-bare` / `external-docker`
  - `workspace_binding_mode = juicefs_local_mount`
- `internal-k8s`
  - `workspace_binding_mode = pre_mounted_volume`

这样 runner 主流程可以统一：

1. 准备 workspace
2. 确认 cwd
3. 写入 task inputs / credential files
4. 启动 codex CLI
5. 回传 trace / artifact / delta

## 9. 数据模型建议

### 9.1 notebook task 新增字段

建议新增：

- `workspace_file_library_id`
- `workspace_file_library_name`

不建议落库：

- `metadata_url`
- mount command
- k8s secret/pvc 名称

### 9.2 创建约束

- notebook task 创建必须选择 `file library`
- external agent 若不在线，不允许创建 task
- internal agent 允许创建 task，即使 pod 尚未启动

### 9.3 Artifact 语义收敛

本路线接受的新语义是：

- task workspace 就是选中的 `file library`
- `artifact` 仅表示 task workspace 下 `.artifacts/` 目录中的内容
- `artifacts` 面板是展示层，不再承担“复制到文件库”的入口职责

因此本路线应删除：

- notebook “保存 artifact 到文件库” 的前端交互
- 对应的后端业务路径
- 与该旧交互相关的测试与说明

推荐约束：

- 通过 `AGENTS.md` 明确要求 agent 把最终 deliverables 输出到 `.artifacts/`
- 中间过程文件保留在工作目录其它位置
- UI 优先展示 `.artifacts/` 目录内容

## 10. 后端接口建议

不建议直接把 `storage-credential-exchange` 的 UI 返回体原样塞进 notebook 执行上下文。

建议新增 runner 专用接口，例如：

- `POST /workspaces/{ws}/projects/{project}/tasks/{taskId}/workspace-access`

返回机器可用的最小字段：

- `file_library_id`
- `filesystem_name`
- `metadata_url`
- `workspace_path`
- `workspace_binding_mode`

说明：

- external runner 用它来 mount
- internal runner 可用它做一致性元信息，但不要求 pod 内自己 mount

## 11. Sandbox 满足度分析

### 11.1 已满足

- task/workload 级隔离
- lazy create pod
- keepalive
- delete/release
- `/workspace` 统一工作目录

### 11.2 缺口

当前 sandbox manager 还缺：

- workload 级 PVC 挂载声明
- AgentSmith internal workload 关闭 snapshot 的能力
- internal runner 专用 profile

如果坚持让 pod 内自己运行 `juicefs mount`，还会进一步缺：

- `/dev/fuse`
- 特权或 capability 配置
- runner image 内 FUSE/juicefs 工具链

因此推荐优先补：

- **PVC/CSI 挂载能力**

而不是先补容器内 FUSE。

## 12. External / Internal 生命周期差异

### 12.1 External

- 一个 runner 可处理多个 task
- 每个 task 独立 mountpoint
- 同 task 可复用 mount
- runner 不做自动回收
- runner 未连接则 agent 不可用于新 task

### 12.2 Internal

- 一个 workload 对应一个 task
- task 创建时不立刻起 pod
- 首条消息或回收后下一条消息触发 lazy start
- pod 起好后 runner 回连 websocket
- pod 空闲后自动回收
- 下次再拉起时重新挂同一个 file library 对应 PVC

## 13. 风险与边界

### 13.1 最大风险在 internal 平台，不在 notebook 本身

最大复杂度来自：

- sandbox 扩展
- CSI/PVC 编排
- internal workload 生命周期

### 13.2 Docker external 需要单独运维前提

必须明确：

- 镜像要求
- 启动参数
- 容器权限

### 13.3 同一 file library 被多个 task 复用是产品语义，不是 bug

若多个 task 选择同一 file library：

- 会共享同一工作目录真相
- 应在产品文案中明确这一点

## 14. 推荐推进顺序

建议按下面顺序推进：

1. `external-bare`
2. `external-docker`
3. sandbox 扩展（PVC/CSI + 去 snapshot）
4. `internal-k8s`

原因：

- external 现在就有足够多的代码基础
- internal 的主要风险在平台层
- 先把 external 路线跑通，能更快验证 notebook + file library 的产品模型

## 15. 最终判断

### 可以直接推进的部分

- task 必选 file library
- external runner 挂载 JuiceFS 工作目录
- notebook 以 file library 作为持久化工作空间
- notebook artifact 改成 `.artifacts/` 目录展示模型

### 需要先补平台能力的部分

- internal agent 通过 sandbox + JuiceFS CSI Driver 使用 file library
- sandbox 删除 snapshot 并支持 PVC 挂载

### 最终推荐

AgentSmith 应收成：

- **统一 runner 业务逻辑**
- **external 用本地 JuiceFS mount**
- **internal 用 k8s CSI 预挂载**
- **snapshot 完全删除**

这套方案最符合：

- 你的业务要求
- 当前现有代码基础
- 以及后续长期可维护性
