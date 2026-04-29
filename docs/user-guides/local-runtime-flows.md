# Local Runtime Flows

这份文档只讲本机开发和 rehearsal 怎么跑，尽量保持最简单的心智模型。

<!-- current-runtime-lines:local-runtime-flows:start -->
运行线职责、mode 边界、shared substrate 方法论以
[Runtime Lines Matrix](./runtime-lines-matrix.md)
为总入口；这份文档只展开本机操作顺序。

Machine-readable source:

- `scripts/governance/current-runtime-line-manifest.ts`

## 一句话基线

先起共享底座，再跑一条工作线；这是一条当前操作基线，不是系统正确性的前提。

## 当前操作基线

1. 本机共享一套 substrate，`local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用它。
2. 同一时间只建议一条本地工作线处于 active；切换前先停掉或 reset 当前工作线。

## 持续生效的 runtime contract

1. `demo-rehearsal` 和 `cluster-rehearsal` 都拥有自己的 scenario-owned local kind world 与 local registry，不再共用一个泛化本地集群。
2. rehearsal 线负责在开发机上排演 release 路径；deploy 线负责目标主机上的正式发布。

## 当前本机工作线

- `local-manual` — 日常开发、真实后端手测、notebook / runner 主链手测。
- `demo-rehearsal` — demo 发布线的本机排演入口，使用 `agentsmith-demo` / `agentsmith-demo-registry`。
- `cluster-rehearsal` — cluster 发布线的本机排演入口，使用 `agentsmith-cluster` / `agentsmith-cluster-registry`。
<!-- current-runtime-lines:local-runtime-flows:end -->

## Runtime 状态目录

当前 runtime-line 的 current state root 统一使用 `artifacts/runtime/lines/<line>/current`。

- `local-manual` → `artifacts/runtime/lines/local-manual/current`
- `demo-rehearsal` → `artifacts/runtime/lines/demo-rehearsal/current`
- `cluster-rehearsal` → `artifacts/runtime/lines/cluster-rehearsal/current`

## 普通本机真实环境入口

普通开发、真实后端手测、人工 UX/UI 巡检默认只用 clean local-real 入口：

```bash
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

含义：

- `local-real-up`
  - 启动真实本地环境
- `local-real-status`
  - 查看真实本地环境状态
- `local-real-down`
  - 停掉真实本地环境
- `local-real-reset`
  - 清空并重建真实本地环境

推荐习惯：

```bash
make local-real-up
make local-real-status
```

只有在环境明显脏了、端口冲突了、或者要彻底重来时，再用：

```bash
make local-real-reset
```

底层实现仍然复用共享 substrate 和 `local-manual` runtime line；这些低层命令只用于 maintainer diagnostics、owner runbook 或实现排障，不是新人默认 copyable 路径。

## 三条本地工作线

### 1. `local_manual` / 本机真实环境

用途：

- 日常本地开发
- 真实后端手测
- Notebook / external runner 手测
- 默认只保证 external 路径，不默认开启 internal sandbox

普通入口：

```bash
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

推荐顺序：

```bash
make local-real-up
make local-real-status
```

默认端口约定：

```bash
PORT_API=21000
PORT_WEB=3101
PROXY_PORT=39080
```

如果 `local-real-up` 直接提示共享底座端口被占用，说明当前机器上还有别的工作线占着底层环境；先执行对应的 clean `*-down` 或 `*-reset`，不要强行并跑。

如果要补 Notebook demo seeding、host external runner 或 internal notebook / sandbox / JuiceFS 验证，只在 owner runbook 明确要求时使用底层 maintainer diagnostic adapter：

```bash
make local-manual-seed-notebook
make local-manual-internal-up
make local-manual-internal-status
```

结束 internal 增强模式时：

```bash
make local-manual-internal-down
```

### 2. `demo-rehearsal`

用途：

- 在本机验证 demo deploy 这条完整工作线
- 使用本地 `agentsmith-demo` kind 集群和 `agentsmith-demo-registry`
- `up` 只推进到 environment-ready
- `bootstrap` / `verify` / `report` 分阶段执行

普通入口：

```bash
npm run rehearse:demo
npm run rehearse:demo -- --status
```

底层 `make demo-rehearsal-*` 只作为 owner runbook 里的 internal adapter 使用，不作为普通 copyable 顺序。

切换前如果本机真实环境还在运行，先停 clean local-real：

```bash
make local-real-down
```

### 3. `cluster-rehearsal`

用途：

- 在本机验证 cluster deploy 这条完整工作线
- 用本地 `agentsmith-cluster` 模拟 cluster 侧执行
- handoff package、`admin-ready.env`、rehearsal kubeconfig 等生成物统一落在 `artifacts/runtime/scenario/cluster-rehearsal/state/generated/`
- `up` 只推进到 environment-ready
- `bootstrap` 负责 admin handoff 后续动作、cluster prerequisites、sandbox deploy 和 bootstrap
- `verify` / `report` 分阶段执行

普通入口：

```bash
npm run rehearse:cluster
npm run rehearse:cluster -- --status
```

底层 `make cluster-rehearsal-*` 只作为 owner runbook 里的 internal adapter 使用，不作为普通 copyable 顺序。

## 怎么切换

最简单的切换方式就是：

1. 停掉当前工作线
2. 保留共享底座
3. 起下一条工作线

例如从本机真实环境切到 `demo-rehearsal`：

```bash
make local-real-down
npm run rehearse:demo
```

例如从 `demo-rehearsal` 切到 `cluster-rehearsal`：

```bash
npm run rehearse:cluster
```

如果你怀疑底座已经脏了，再加一步：

```bash
make local-real-reset
```

## 什么时候用哪条线

- 平时开发和页面 / API 手测
  - 用 `make local-real-up`
- 要快速验证 external notebook / runner
  - 先用 `make local-real-up`，需要 demo seeding 时按 owner diagnostic 执行底层 adapter
- 要在本机验证 internal notebook / sandbox / JuiceFS
  - 先起 `make local-real-up`
  - 再按 owner diagnostic 执行 internal adapter
- 要验证 demo 单机发布线
  - 用 `npm run rehearse:demo`
- 要验证 cluster 发布线
  - 用 `npm run rehearse:cluster`
- 要对真实目标主机发布
  - 不用这份文档
  - 看 `demo-deploy-operations.md` 或 `cluster-deploy-operations.md`

- 要跑 `backend-real` / `run-integration-e2e-full`
  - 默认走独立 support-service 端口
  - 当前基线是 `25432 / 27027 / 26379 / 29000 / 29001 / 28081`
  - 这条线不需要先停共享底层环境，但仍然要避开同名 `mbos-*` integration 容器残留

## 出问题先看哪里

先看状态：

```bash
make local-real-status
npm run rehearse:demo -- --status
npm run rehearse:cluster -- --status
```

再看这几个目录：

- `artifacts/runtime/substrate/`
- `artifacts/runtime/scenario/demo-rehearsal/`
- `artifacts/runtime/scenario/cluster-rehearsal/`

如果是 verify 失败，重点看：

- `artifacts/runtime/scenario/<flow>/reports/`

## 最后记住

本机运行时治理只需要记住这三句话：

1. 普通本机真实环境从 `make local-real-up` 开始。
2. 一次只跑一条本地工作线。
3. 切换前先停上一条，低层 adapter 只给 maintainer diagnostics 和 owner runbook 用。
