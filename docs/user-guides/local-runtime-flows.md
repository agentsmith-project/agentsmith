# Local Runtime Flows

This guide covers local development and local verification on a developer machine.

For deployment operations, use [Unified Deploy Operations](./unified-deploy-operations.md).

<!-- current-runtime-lines:local-runtime-flows:start -->
运行线职责、部署 profile、substrate 边界以
[Runtime Lines Matrix](./runtime-lines-matrix.md)
为总入口；这份文档只展开本机操作顺序。

Machine-readable source:

- `scripts/governance/current-runtime-line-manifest.ts`

## 一句话基线

`local-real` 用来开发和手测；unified deploy 用来证明部署。两者在一台开发机上串行切换。

## 当前操作基线

1. `local-real` 是开发机上的正式人类入口；`local-manual` 只保留为底层 maintainer adapter。
2. `local-real` 与 unified deploy substrate 共享默认本地 substrate 端口，在同一开发机上必须串行切换。

## 持续生效的 runtime contract

1. 只有一个 AgentSmith deploy 模型；`local-kind` 与 `existing-cluster` 是 profile，不是两套产品。
2. Substrates 保持在 app namespace 外部，由 Docker 或运维提供的服务承载；AgentSmith app 工作负载运行在 Kubernetes。
3. 当前里程碑 `api replicas=1`，直到引入明确的多副本 execution routing 设计。

## 当前本机工作线

- `local-manual` — Daily development, real-backend manual validation, and focused Agent task / Files checks through the local-real entrypoint.

## 最小本机验证

```bash
make local-real-reset
PROMPT='Reply exactly: local real echo ok' POLL_MAX=30 POLL_INTERVAL_SEC=2 SCENARIO_ATTEMPTS=1 make agent-task-smoke-task
```

Files / file-library 的本机验证使用 local-real API 做 focused producer，不需要启动统一部署。

## 切到统一部署

```bash
make local-real-down
npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset
npm run test:unified-deploy:local-kind:images
npm run test:unified-deploy:local-kind
npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner
```

统一部署证据统一写到 `artifacts/unified-deploy/`。
<!-- current-runtime-lines:local-runtime-flows:end -->

## Troubleshooting

Start with:

```bash
make local-real-status
kubectl --context kind-agentsmith get pods -A
docker ps
```

If local test PVs remain after Agent task or file-library work, clean the local kind test namespaces and JuiceFS test PVs before rerunning deploy verification.

## Remember

1. `local-real` is the supported developer-machine runtime.
2. Unified deploy is the supported deployment runtime.
3. Run them serially on one machine.
4. Use focused checks first; reserve heavy gates for stage closeout or release sign-off.
