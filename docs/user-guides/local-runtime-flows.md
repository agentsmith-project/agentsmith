# Local Runtime Flows

这份文档只讲本机开发和 rehearsal 怎么跑，尽量保持最简单的心智模型。

运行线职责、mode 边界、shared substrate 方法论以
[Runtime Lines Matrix](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/runtime-lines-matrix.md)
为唯一总入口；这份文档只展开本机操作顺序。

## 一句话规则

先起共享底座，再跑一条工作线；同一时间只跑一条。

这里的两个词只表示：

- `substrate`
  - 本机共享底座
  - 包含 postgres、mongo、redis、minio、keycloak、universal-proxy
- `flow`
  - 一条完整工作线
  - 当前本机常用的是 `local-manual`、`demo-rehearsal`、`cluster-rehearsal`

## 固定规则

1. 本机只有一套共享底座。
2. `local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用这套底座。
3. 同一时间只允许一条工作线处于 active。
4. 切换工作线前，先把当前工作线停掉。
5. `local-manual` 只保留自己的 app 端口，默认读取共享 substrate 的连接文件；如果共享 substrate 端口已被别的工作线占用，会直接失败并给出冲突提示。
6. `backend-real` / `integration-full` 默认使用独立 support-service 端口，不复用共享 substrate 的 `15432/17017/16379/19000/18080`。
7. 本地 rehearsal 使用 scenario-owned local kind world：
   - `demo-rehearsal` 默认使用 `agentsmith-demo` / `agentsmith-demo-registry`
   - `cluster-rehearsal` 默认使用 `agentsmith-cluster` / `agentsmith-cluster-registry`
8. `*-reset` 会把对应 rehearsal 的本地 kind world 清回干净状态；`*-down` 只负责停当前运行态。

## 先管底座

常用命令：

```bash
make substrate-up
make substrate-reseed
make substrate-status
make substrate-down
make substrate-reset
```

含义：

- `substrate-up`
  - 启动共享底座
- `substrate-reseed`
  - 重建最小可用数据
- `substrate-status`
  - 查看底座状态
- `substrate-down`
  - 停掉底座，但不删数据
- `substrate-reset`
  - 清空底座并回到干净状态

推荐习惯：

```bash
make substrate-up
make substrate-reseed
```

只有在环境明显脏了、端口冲突了、或者要彻底重来时，再用：

```bash
make substrate-reset
```

## 三条本地工作线

### 1. `local-manual`

用途：

- 日常本地开发
- 真实后端手测
- Notebook / external runner 手测
- 默认只保证 external 路径，不默认开启 internal sandbox

常用命令：

```bash
make local-manual-up
make local-manual-seed-notebook
make local-manual-status
make local-manual-down
make local-manual-reset
```

推荐顺序：

```bash
make substrate-up
make substrate-reseed
make local-manual-up
make local-manual-seed-notebook
```

默认端口约定：

```bash
PORT_API=21000
PORT_WEB=3101
PROXY_PORT=39080
```

如果 `local-manual-up` 直接提示共享 substrate 端口被占用，说明当前机器上还有别的工作线占着共享底座；先执行对应的 `*-down` 或 `*-reset`，不要强行并跑。

如果要在本机补 internal notebook / sandbox / JuiceFS 验证，再执行：

```bash
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

常用命令：

```bash
make demo-rehearsal-up
make demo-rehearsal-bootstrap
make demo-rehearsal-verify
make demo-rehearsal-report
make demo-rehearsal-status
make demo-rehearsal-down
make demo-rehearsal-reset
```

推荐顺序：

```bash
make local-manual-down
make demo-rehearsal-up
make demo-rehearsal-bootstrap
make demo-rehearsal-verify
make demo-rehearsal-report
```

### 3. `cluster-rehearsal`

用途：

- 在本机验证 cluster deploy 这条完整工作线
- 用本地 `agentsmith-cluster` 模拟 cluster 侧执行
- handoff package、`admin-ready.env`、rehearsal kubeconfig 等生成物统一落在 `artifacts/runtime/scenario/cluster-rehearsal/state/generated/`
- `up` 只推进到 environment-ready
- `bootstrap` 负责 admin handoff 后续动作、cluster prerequisites、sandbox deploy 和 bootstrap
- `verify` / `report` 分阶段执行

常用命令：

```bash
make cluster-rehearsal-up
make cluster-rehearsal-bootstrap
make cluster-rehearsal-verify
make cluster-rehearsal-report
make cluster-rehearsal-status
make cluster-rehearsal-down
make cluster-rehearsal-reset
```

推荐顺序：

```bash
make demo-rehearsal-down
make cluster-rehearsal-up
make cluster-rehearsal-bootstrap
make cluster-rehearsal-verify
make cluster-rehearsal-report
```

## 怎么切换

最简单的切换方式就是：

1. 停掉当前工作线
2. 保留共享底座
3. 起下一条工作线

例如从 `local-manual` 切到 `demo-rehearsal`：

```bash
make local-manual-down
make demo-rehearsal-up
```

例如从 `demo-rehearsal` 切到 `cluster-rehearsal`：

```bash
make demo-rehearsal-down
make cluster-rehearsal-up
```

如果你怀疑底座已经脏了，再加一步：

```bash
make substrate-reset
```

## 什么时候用哪条线

- 平时开发和页面 / API 手测
  - 用 `local-manual`
- 要快速验证 external notebook / runner
  - 继续用默认 `local-manual`
- 要在本机验证 internal notebook / sandbox / JuiceFS
  - 先起 `local-manual`
  - 再执行 `local-manual-internal-up`
- 要验证 demo 单机发布线
  - 用 `demo-rehearsal`
- 要验证 cluster 发布线
  - 用 `cluster-rehearsal`
- 要对真实目标主机发布
  - 不用这份文档
  - 看 `demo-deploy-operations.md` 或 `cluster-deploy-operations.md`

- 要跑 `backend-real` / `run-integration-e2e-full`
  - 默认走独立 support-service 端口
  - 当前基线是 `25432 / 27027 / 26379 / 29000 / 29001 / 28081`
  - 这条线不需要先停共享 substrate，但仍然要避开同名 `mbos-*` integration 容器残留

## 出问题先看哪里

先看状态：

```bash
make substrate-status
make local-manual-status
make demo-rehearsal-status
make cluster-rehearsal-status
```

再看这几个目录：

- `artifacts/runtime/substrate/`
- `artifacts/runtime/scenario/demo-rehearsal/`
- `artifacts/runtime/scenario/cluster-rehearsal/`

如果是 verify 失败，重点看：

- `artifacts/runtime/scenario/<flow>/reports/`

## 最后记住

本机运行时治理只需要记住这三句话：

1. 先起共享底座。
2. 一次只跑一条工作线。
3. 切换前先停上一条。
