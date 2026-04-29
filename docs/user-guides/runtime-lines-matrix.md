# Runtime Lines Matrix

这份文档只回答一件事：当前 AgentSmith 已实现的运行线，分别负责什么、依赖什么、怎么切换。

它不替代详细 runbook。  
如果你要实际执行命令，继续看：

- [Local Runtime Flows](./local-runtime-flows.md)
- [Demo Deploy Operations](./demo-deploy-operations.md)
- [Cluster Deploy Operations](./cluster-deploy-operations.md)

如果你只想记住当前方法论，这一页就是总入口；其它 runbook 只负责展开具体步骤。

<!-- current-runtime-lines:runtime-matrix:start -->
## 当前本机操作基线

1. 本机共享一套 substrate，`local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用它。
2. 普通用户只通过 clean human entrypoints 操作：`make local-real-up` / `make local-real-status` / `make local-real-down` / `make local-real-reset` 与 `npm run rehearse:demo` / `npm run rehearse:cluster`。
3. 同一时间只建议一条本地工作线处于 active；切换前先用 clean entrypoint 停掉、查看或重置当前工作线。

## 持续生效的 runtime contract

1. `demo-rehearsal` 和 `cluster-rehearsal` 都拥有自己的 scenario-owned local kind world 与 local registry，不再共用一个泛化本地集群。
2. rehearsal 线负责在开发机上排演 release 路径；deploy 线负责目标主机上的正式发布。

## 运行线矩阵

| 运行线 | 当前正式命名 | 主要用途 | external 路径 | internal 路径 | substrate | 备注 |
|-------|-------------|---------|--------------|--------------|----------|------|
| 本地真实手测线 | `local-manual` | 日常开发、真实后端手测、notebook / runner 手测 | 通过 `make local-real-up` 启动，`make local-real-status` 查看 | 普通用户不直接开启；仅 owner runbook 明确要求时走 internal owner diagnostic adapter | 共享本地 substrate | 停止/重置使用 `make local-real-down` / `make local-real-reset` |
| demo 本机排演线 | `demo-rehearsal` | 本机排演 demo 发布线 | `npm run rehearse:demo` | `DEMO_DEPLOY_MODE=full` 时由 clean entrypoint 封装启用，运行在本地 `kind` | 共享本地 substrate | 状态入口是 `npm run rehearse:demo -- --status`；底层 adapters 只属于 owner runbook/internal adapter |
| demo 正式发布线 | `demo-deploy` | 单机 / demo 环境发布 | `simple` | `full` | 目标主机上的 compose substrate | 目标主机 release 线，不是本机 rehearsal 入口 |
| cluster 本机排演线 | `cluster-rehearsal` | 本机排演真实集群发布线 | `npm run rehearse:cluster` | 由 clean entrypoint 封装 internal k8s 执行面 | 共享本地 substrate | 状态入口是 `npm run rehearse:cluster -- --status`；底层 adapters 只属于 owner runbook/internal adapter |
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

- [Substrate Governance And Runtime Lines](../contracts/substrate-governance-and-runtime-lines-v1.md)

## mode 解释

### `local-manual`

- 默认只保证 external 路径。
- 普通本机真实手测使用 clean local-real 入口：
  - `make local-real-up`
  - `make local-real-status`
  - `make local-real-down`
  - `make local-real-reset`
- 需要 internal notebook / sandbox / JuiceFS 诊断时，只有 owner runbook 明确要求才进入 internal owner diagnostic adapter；它不是普通建议路径。

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

普通入口是：

1. `npm run rehearse:demo`
2. `npm run rehearse:demo -- --status`

clean entrypoint 会封装底层 `reset` / `up` / `bootstrap` / `verify` / `report` 阶段；底层 adapters 只属于 owner runbook/internal adapter，不列成普通执行顺序。

### `cluster-rehearsal`

它是 `cluster-deploy` 的本机排演线。

目标是提前在开发机验证：

- cluster bundle
- registry 推送与镜像引用
- target-host compose + k8s 分层
- sandbox deploy / bootstrap / verify / report
- generated handoff artifacts under `state/generated/`, so rehearsal `reset` can return to a clean-room starting point

普通入口是：

1. `npm run rehearse:cluster`
2. `npm run rehearse:cluster -- --status`

clean entrypoint 会封装底层 `reset` / `up` / `bootstrap` / `verify` / `report` 阶段；底层 adapters 只属于 owner runbook/internal adapter，不列成普通执行顺序。

注意：

- `cluster-rehearsal` 不是“另一个 cluster-deploy mode”
- 它只是 `cluster-deploy` 的本机 rehearsal 入口

## 切换规则

当前工程不支持在同一台开发机上同时维持多条 active scenario。

推荐切换方式：

1. `make local-real-down`
2. `npm run rehearse:demo`
3. `npm run rehearse:demo -- --status`

或者：

1. `npm run rehearse:demo -- --status`
2. `npm run rehearse:cluster`
3. `npm run rehearse:cluster -- --status`

如果本机真实手测环境脏了，再用 clean local-real 入口重置：

1. `make local-real-reset`

## 最短理解

如果只记一句话：

- `local-manual` 是本机真实手测线
- `demo-deploy` / `demo-rehearsal` 是单机 demo 发布线及其排演线
- `cluster-deploy` / `cluster-rehearsal` 是真实集群发布线及其排演线
- 所有本地线共享一套 substrate，并按 active scenario 串行切换
