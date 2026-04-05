# Runtime Lines Matrix

这份文档只回答一件事：当前 AgentSmith 已实现的运行线，分别负责什么、依赖什么、怎么切换。

它不替代详细 runbook。  
如果你要实际执行命令，继续看：

- [Local Runtime Flows](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/local-runtime-flows.md)
- [Demo Deploy Operations](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/demo-deploy-operations.md)
- [Cluster Deploy Operations](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/cluster-deploy-operations.md)

## 核心方法论

当前工程基线只有这些规则：

1. 本机共享一套 `substrate`。
2. `local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用这套底座。
3. 同一时间只允许一条 active scenario。
4. `scenario` 只负责编排，不自己实现 substrate 生命周期。
5. deploy 线与 rehearsal 线使用同一套 contract，但职责不同：
   - rehearsal 用来本机排演
   - deploy 用来正式目标环境发布

正式 contract 见：

- [Substrate Governance And Runtime Lines](/home/percy/works/mbos-v1/agentsmith/docs/contracts/substrate-governance-and-runtime-lines-v1.md)

## 运行线矩阵

| 运行线 | 当前正式命名 | 主要用途 | external 路径 | internal 路径 | substrate | 备注 |
|-------|-------------|---------|--------------|--------------|----------|------|
| 本地真实手测线 | `local-manual` | 日常开发、真实后端手测、notebook / runner 手测 | 默认启用 | 通过 `local-manual-internal-up` 显式开启 | 共享本地 substrate | 当前推荐本机真实手测入口 |
| demo 本机排演线 | `demo-rehearsal` | 本机排演 demo 发布线 | `DEMO_DEPLOY_MODE=simple` 时 external-only | `DEMO_DEPLOY_MODE=full` 时启用，运行在本地 `kind` | 共享本地 substrate | 使用本地 `kind-agentsmith` 与本地 registry |
| demo 正式发布线 | `demo-deploy` | 单机 / demo 环境发布 | `simple` | `full` | 目标主机上的 compose substrate | `full` 使用本地 `kind` 模拟 internal 执行面 |
| cluster 本机排演线 | `cluster-rehearsal` | 本机排演真实集群发布线 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 共享本地 substrate | 用本地 `kind-agentsmith` 模拟真实 k8s 环境 |
| cluster 正式发布线 | `cluster-deploy` | 真实集群发布 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 目标主机上的 compose substrate | mode 区分 `semi-auto` / `full-auto`，不是 external/internal 能力差异 |

## mode 解释

### `local-manual`

- 默认只保证 external 路径。
- 需要 internal notebook / sandbox / JuiceFS 时，再执行：
  - `make local-manual-internal-up`

### `demo-deploy`

- `DEMO_DEPLOY_MODE=simple`
  - external-only
  - 不启用 local `kind` / JuiceFS CSI / sandbox-manager
- `DEMO_DEPLOY_MODE=full`
  - external + internal
  - internal 执行面运行在本地 `kind`

### `cluster-deploy`

- `CLUSTER_DEPLOY_MODE=semi-auto`
  - external + internal 都属于正式目标面
  - 区别在于 cluster-scope 前置条件由管理员手工完成
- `CLUSTER_DEPLOY_MODE=full-auto`
  - external + internal 都属于正式目标面
  - 区别在于 AgentSmith 自动完成 AgentSmith-owned cluster prerequisites

规则：

- `cluster-deploy` 的 mode 只表达自动化与权限边界。
- `cluster-deploy` 不存在当前正式支持的 “external-only mode”。

## rehearsal 与 deploy 的关系

### `demo-rehearsal`

它是 `demo-deploy` 的本机排演线。

目标是提前在开发机验证：

- bundle / env / render 结果
- compose 服务
- `simple` / `full` 行为
- 本地 `kind` internal 执行面

### `cluster-rehearsal`

它是 `cluster-deploy` 的本机排演线。

目标是提前在开发机验证：

- cluster bundle
- registry 推送与镜像引用
- target-host compose + k8s 分层
- sandbox deploy / bootstrap / verify / report

注意：

- `cluster-rehearsal` 不是“另一个 cluster-deploy mode”
- 它只是 `cluster-deploy` 的本机 rehearsal 入口

## 切换规则

当前工程不支持在同一台开发机上同时维持多条 active scenario。

推荐切换方式：

1. `make local-manual-down`
2. `make demo-rehearsal-up`

或者：

1. `make demo-rehearsal-down`
2. `make cluster-rehearsal-up`

如果底座脏了，再加：

1. `make substrate-reset`

## 最短理解

如果只记一句话：

- `local-manual` 是本机真实手测线
- `demo-deploy` / `demo-rehearsal` 是单机 demo 发布线及其排演线
- `cluster-deploy` / `cluster-rehearsal` 是真实集群发布线及其排演线
- 所有本地线共享一套 substrate，并按 active scenario 串行切换
