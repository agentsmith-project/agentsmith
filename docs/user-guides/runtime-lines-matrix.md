# Runtime Lines Matrix

这份文档只回答一件事：当前 AgentSmith 已实现的运行线，分别负责什么、依赖什么、怎么切换。

它不替代详细 runbook。  
如果你要实际执行命令，继续看：

- [Local Runtime Flows](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/local-runtime-flows.md)
- [Demo Deploy Operations](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/demo-deploy-operations.md)
- [Cluster Deploy Operations](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/cluster-deploy-operations.md)

如果你只想记住当前方法论，这一页就是总入口；其它 runbook 只负责展开具体步骤。

<!-- current-runtime-lines:runtime-matrix:start -->
## 当前本机操作基线

1. 本机共享一套 substrate，`local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用它。
2. 同一时间只建议一条本地工作线处于 active；切换前先停掉或 reset 当前工作线。

## 持续生效的 runtime contract

1. `demo-rehearsal` 和 `cluster-rehearsal` 都拥有自己的 scenario-owned local kind world 与 local registry，不再共用一个泛化本地集群。
2. rehearsal 线负责在开发机上排演 release 路径；deploy 线负责目标主机上的正式发布。

## 运行线矩阵

| 运行线 | 当前正式命名 | 主要用途 | external 路径 | internal 路径 | substrate | 备注 |
|-------|-------------|---------|--------------|--------------|----------|------|
| 本地真实手测线 | `local-manual` | 日常开发、真实后端手测、notebook / runner 手测 | 默认启用 | 通过 `local-manual-internal-up` 显式开启 | 共享本地 substrate | 当前推荐本机真实手测入口 |
| demo 本机排演线 | `demo-rehearsal` | 本机排演 demo 发布线 | `DEMO_DEPLOY_MODE=simple` 时 external-only | `DEMO_DEPLOY_MODE=full` 时启用，运行在本地 `kind` | 共享本地 substrate | 使用 scenario-owned `agentsmith-demo` 与 `agentsmith-demo-registry` |
| demo 正式发布线 | `demo-deploy` | 单机 / demo 环境发布 | `simple` | `full` | 目标主机上的 compose substrate | 目标主机 release 线，不是本机 rehearsal 入口 |
| cluster 本机排演线 | `cluster-rehearsal` | 本机排演真实集群发布线 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 共享本地 substrate | 使用 scenario-owned `agentsmith-cluster` 与 `agentsmith-cluster-registry` |
| cluster 正式发布线 | `cluster-deploy` | 真实集群发布 | 始终包含 external runner | 始终包含 internal k8s 执行面 | 目标主机上的 compose substrate | mode 描述自动化边界，不是 external/internal 能力差异 |
<!-- current-runtime-lines:runtime-matrix:end -->

## Runtime 状态目录真相

当前 runtime-line 的 current state root 统一使用 `artifacts/runtime/lines/<line>/current`。

| 运行线 | current state root |
|-------|--------------------|
| `local-manual` | `artifacts/runtime/lines/local-manual/current` |
| `demo-rehearsal` | `artifacts/runtime/lines/demo-rehearsal/current` |
| `demo-deploy` | `artifacts/runtime/lines/demo-deploy/current` |
| `cluster-rehearsal` | `artifacts/runtime/lines/cluster-rehearsal/current` |
| `cluster-deploy` | `artifacts/runtime/lines/cluster-deploy/current` |

## 词典

- `substrate`
  - 本机共享底座
- `scenario`
  - 一条当前正在编排的本机工作线
- `rehearsal`
  - 在开发机上排演正式发布流程
- `deploy`
  - 在目标环境上执行正式发布
- `mode`
  - 当前运行线内部的能力边界或自动化边界
- `external path`
  - system 管理侧之外的外部 agent / 用户访问链路
- `internal path`
  - system 管理侧内部的 sandbox / k8s 执行链路

正式 contract 见：

- [Substrate Governance And Runtime Lines](/home/percy/works/mbos-v1/agentsmith/docs/contracts/substrate-governance-and-runtime-lines-v1.md)

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

## 阶段语义

当前 rehearsal 线都遵守同一套阶段语义：

- `up`
  - 只把环境推进到 environment-ready
  - 不自动执行 `bootstrap`、`verify`、`report`
- `bootstrap`
  - 只完成 runner 接入、管理员交接后续动作、sandbox 等 bootstrap 真相
- `verify`
  - 只执行验证
- `report`
  - 只生成报告
- `down`
  - 只清当前 scenario
- `reset`
  - 清当前 scenario 状态并回到干净阶段
- `status`
  - 只汇报当前阶段和 readiness

### `demo-rehearsal`

它是 `demo-deploy` 的本机排演线。

目标是提前在开发机验证：

- bundle / env / render 结果
- compose 服务
- `simple` / `full` 行为
- 本地 `kind` internal 执行面

顺序是：

1. `make demo-rehearsal-up`
2. `make demo-rehearsal-bootstrap`
3. `make demo-rehearsal-verify`
4. `make demo-rehearsal-report`

### `cluster-rehearsal`

它是 `cluster-deploy` 的本机排演线。

目标是提前在开发机验证：

- cluster bundle
- registry 推送与镜像引用
- target-host compose + k8s 分层
- sandbox deploy / bootstrap / verify / report
- generated handoff artifacts under `state/generated/`, so rehearsal `reset` can return to a clean-room starting point

顺序是：

1. `make cluster-rehearsal-up`
2. `make cluster-rehearsal-bootstrap`
3. `make cluster-rehearsal-verify`
4. `make cluster-rehearsal-report`

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
