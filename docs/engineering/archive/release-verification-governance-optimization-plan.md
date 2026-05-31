# Release Verification Governance Optimization Plan

Status: `historical_reference`
Former status: `decision-complete minimal handoff`

Scope: release verification, backend-real verification, unified deploy evidence, product-flow evidence, and release status output.

Primary input: `docs/engineering/archive/release-verification-governance-optimization-log.md` plus current implementation under `scripts/governance/` and `scripts/unified-deploy/`.

## 1. 决策摘要

本方案从“完整治理重构”收敛为“最小可落地治理优化”。原则是少改动、先解决最大耗时和最大误诊断，不为了少数异常引入大机制。

保留当前真相：

- release campaign 仍是固定 `campaign_id=release-full`，动态运行身份继续用当前 `RELEASE_CAMPAIGN_RUN_ID` / `run_id` / `campaign_run_id`。
- release evidence root 仍是 `artifacts/release-runs/<campaign-run-id>`。
- resource lock 真相仍是 `scripts/governance/current-resource-lock-manifest.ts`。
- release step pointer 仍沿用当前 `<campaign-root>/<step>/evidence.json` 和 `release-campaign-io.ts`。
- evidence claim 优先使用现有 claim / digest / freshness / governance run state 能力。
- product-flow 继续使用现有 `flow`、`failure`、`flow_evidence_paths`、`mongo_evidence.afscp_mapping`、`afscp_operation`。

本轮只解决四个用户能感知的问题：

1. **Preflight**：重 gate 前先知道环境是否冲突，以及谁占用资源。
2. **Reuse**：单次命令进程内不要重复启动 deps、重复 build/load 最大耗时产物。
3. **Blocker**：失败时只给一个最可能的 blocker。
4. **Rerun**：只给一个可复制的下一步验证命令。

## 2. 非目标

- 不做全局缓存平台。
- 不做复杂并行调度。
- 不做跨 run runtime 复用。
- 不重做全量 evidence schema。
- 不要求所有异常中断都有兜底处理。
- 不扩普通产品 API 暴露 AFSCP/JVS 内部状态。
- 不新增复杂人类入口。继续保留 `npm run verify`、`npm run release:ready`、`npm run release:status`、`make local-real-*`。

## 3. 最小方案

### 3.1 Preflight 与 Cleanup

在 `npm run release:ready`、`npm run verify -- --goal=real --run`、`make local-real-status`、`make local-real-up` 进入重步骤前，基于 `scripts/governance/current-resource-lock-manifest.ts` 做真实 owner check。

优先检查：

- fixed ports：遍历 `current-resource-lock-manifest` 中 `fixed-local-ports` 声明的端口和端口 family。
- Docker compose owner：integration deps 与 unified-deploy substrate 是否互相占用。
- kind/local registry：只检查明显冲突和 owner，可给 cleanup 指引，不做复杂自动修复。

cleanup 必须按 `actual_owner` 分流：

| actual owner | Fix |
| --- | --- |
| integration deps | `npm run integration:deps:down` |
| local-real substrate | `make substrate-down` |
| unified-deploy substrate | `npx tsx scripts/unified-deploy/substrate-lifecycle.ts down` |
| local-real app processes | `make local-real-down` |
| kind/local registry | 不输出 copyable `Fix:`；只输出 `Inspect:` 指引，例如 `docker ps --filter name=kind-registry`、`kind get clusters` |

失败摘要 10 行以内，只给一个 blocker 和一个 rerun command：

```text
AgentSmith Release Readiness
Verdict: FAILED
Blocker: environment_conflict
Stage: preflight
Why: port 27027 is owned by agentsmith-unified-substrate-mongodb-1
Fix: npx tsx scripts/unified-deploy/substrate-lifecycle.ts down
Rerun: npm run release:ready
Evidence: artifacts/release-runs/<campaign-run-id>/preflight/evidence.json
```

`Rerun:` 只放会执行验证的命令。只读查看使用 `Inspect:` 或 `Check:`，例如 `npm run release:status`。

Diagnostic / owner adapter 输出第一行必须说明：

```text
Diagnostic only: not a release verdict.
```

最终 verdict 只由 release aggregate / verify aggregate 产生。

### 3.2 单次命令进程内 Readiness Reuse

只覆盖最大耗时对象：

- integration deps readiness
- runner image digest / import
- AFSCP image digest / command smoke
- unified-deploy substrate readiness
- AFSCP schema/default volume bootstrap readiness

实现方式只使用现有 `input_digest` / `artifact_digest` / freshness / governance run state / step evidence / lifecycle evidence，不改 claim schema，不做通用 broker 平台。

规则：

- 仅同一次 `npm run release:ready` 或 `npm run verify -- --goal=real --run` 命令进程内复用 runtime readiness。
- 重新执行 `npm run release:ready` 是新的 run，不承诺自动续跑，不承诺跨命令 runtime 复用。
- 输入、git sha、env、image digest 不匹配时，在当前命令进程内也必须重跑。
- 跨命令不复用 runtime readiness。
- 远端 immutable image digest 可以重新校验，但不代表本地 runtime ready。

必须移除无条件固定 sleep。integration deps 不再固定等满 25s：服务健康即继续；不健康则 bounded timeout，并把失败原因写入现有 evidence/report。

### 3.3 Failure Projection

`release:ready` 结束后、`release:status` 只读查看时，基于现有 aggregate result、step result、preflight evidence 和 lifecycle evidence 投影：

- `Blocker`
- `Stage`
- `Why`
- `Fix`
- `Rerun`
- `Evidence`

不向用户暴露内部恢复参数，也不承诺重新执行命令时自动续跑。`Rerun: npm run release:ready` 表示启动新的 release run；本轮只优化单次命令进程内的去重和 readiness polling。CLI 只显示 canonical command：

- release 收口：`npm run release:ready`
- real/backend-real 收口：`npm run verify -- --goal=real --run`
- visual 收口：`npm run verify -- --goal=visual --run`

### 3.4 Product-flow 与 AFSCP Command Contract

Product-flow 只做低改动增强：

- 不新增 `blocked` status。
- 依赖阻断用 `status=failed` + `failure.code=DEPENDENCY_BLOCKED`。
- 可在现有 flow evidence 上追加 `blocked_by`、`root_cause_flow`。
- `flow_evidence_paths` 仍只放 aggregate。
- pending 到上限时，尽量补当前已有 `mongo_evidence.afscp_mapping` 和 redacted `afscp_operation`；不可用时写 enrichment unavailable，不阻塞主要结论。

AFSCP command contract 只覆盖实际部署会跑的 Job：

- 从 rendered Kubernetes Job/manifest 读取实际 command/args。
- 用选中的 AFSCP image 执行 positive smoke。
- 覆盖 negative smoke：缺 action flag 必须失败；volume bootstrap 收到错误 `--apply` 必须失败。
- 不让 producer 硬编码“正确参数”绕过模板。

必须覆盖的实际参数：

- rendered `afscp-schema-bootstrap` Job 中的 `afscp-migrate --apply --check --timeout=60s`
- rendered `afscp-volume-bootstrap` Job 中的 `afscp-volume-bootstrap --ensure --check --timeout=60s`

### 3.5 Noise 与 Heavy Visual Selector

轻量 cleanup：

- grep/list 空匹配直接写 skipped evidence，不启动完整 Vitest/Playwright。
- expected stderr 收敛到断言或静默捕获，避免污染失败摘要。
- env-only 变更不触发 full visual，也不触发 backend-real visual review。
- UI/design-system 变更触发 full visual。
- release closure 按当前 manifest 触发必要 backend-real visual review。
- 单次命令进程内 digest 匹配时不重复触发 heavy visual。

## 4. 开发切片与 DoD

### Slice A. Preflight Owner Check + Low-mind Output

| 项 | 内容 |
| --- | --- |
| 产物 | owner check、cleanup mapper、preflight evidence、`Fix:` / `Rerun:` 输出 |
| 必要测试 | 27027 被 `agentsmith-unified-substrate-mongodb-1` 占用时，`release:ready` 和 `verify --goal=real --run` 在 heavy steps 前失败，`Fix:` 为 `npx tsx scripts/unified-deploy/substrate-lifecycle.ts down` |
| focused 命令 | `npm run test:run -- scripts/governance/__tests__/sentinel-preflight.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts scripts/governance/__tests__/verify-entrypoints.test.ts` |
| 验收 | `make local-real-status` 显示 owner/status；`make local-real-up` 冲突时给 cleanup；失败摘要 10 行以内 |

### Slice B. 单次命令进程内 Readiness Reuse + Readiness Polling

| 项 | 内容 |
| --- | --- |
| 产物 | reuse check、integration deps readiness polling、runner/AFSCP image digest/import reuse、substrate/AFSCP bootstrap readiness reuse |
| 必要测试 | deps healthy 时不等固定 25s；单次命令进程内 digest 匹配时不重复 deps up 或 image import；digest/env 变化时重跑；重新执行 `npm run release:ready` 不复用上一命令的 runtime readiness |
| focused 命令 | `npm run test:run -- scripts/governance/__tests__/current-evidence-claim-schema.test.ts scripts/governance/__tests__/pure-check-runtime-shadow.test.ts scripts/unified-deploy/substrate-lifecycle.test.ts` |
| 验收 | 单次 `release:ready` 进程内多个 lane 不重复 bootstrap；失败时写 bounded timeout evidence |

### Slice C. Release/Status Failure Projection

| 项 | 内容 |
| --- | --- |
| 产物 | status projection、single blocker selection、safe rerun renderer |
| 必要测试 | 失败后 `release:status` 只读显示同一个 blocker、`Fix:`、`Rerun:`，且 `Rerun:` 不包含只读命令 |
| focused 命令 | `npm run test:run -- scripts/governance/__tests__/status-projection.test.ts scripts/governance/__tests__/clean-status-entrypoints.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts` |
| 验收 | 用户不需要理解 digest、step pointer 或内部 adapter 参数 |

### Slice D. Product-flow Dependency Block + AFSCP Rendered Job Contract

| 项 | 内容 |
| --- | --- |
| 产物 | `failed + DEPENDENCY_BLOCKED`、`blocked_by`、`root_cause_flow`、AFSCP rendered Job args smoke |
| 必要测试 | Files flow pending 后 managed runner 不继续高成本动作；rendered Job 参数错误时 image contract smoke 失败 |
| focused 命令 | `npm run test:unified-deploy:product-flows:unit`、`npm run test:unified-deploy:local-kind:images:unit` |
| 验收 | 这是已发生过晚失败的轻量 guard，不是本轮时间优化第一优先级；aggregate root cause 指向上游 flow；AFSCP command smoke 使用 rendered Job 实际 args |

### Slice E. Noise / Empty-run / Heavy Visual Selector

| 项 | 内容 |
| --- | --- |
| 产物 | empty-run skipped evidence、stderr cleanup、heavy visual selector tests |
| 必要测试 | 空 grep 不启动测试进程；env-only 不触发 full visual/backend-real visual；UI/design-system 触发 full visual；release closure 触发必要 backend-real visual |
| focused 命令 | `npm run test:run -- scripts/governance/__tests__/verify-impact-selector.test.ts scripts/governance/__tests__/verify-entrypoints.test.ts` |
| 验收 | 非视觉环境修复不重复跑 heavy visual；summary 噪音明显下降 |

## 5. 验收标准

| 场景 | 验收 |
| --- | --- |
| 端口冲突 | heavy steps 前失败，按 actual owner 给 `Fix:` |
| cleanup | integration deps、local-real、unified-deploy substrate 都给明确可复制命令 |
| readiness | integration deps 无固定 sleep；健康即继续，失败 bounded timeout |
| reuse | 单次命令进程内最大耗时 readiness 可复用；跨命令 runtime 不复用 |
| status | `release:status` 只读展示唯一 blocker、`Fix:`、`Rerun:` |
| product-flow | 依赖阻断用 `failed + DEPENDENCY_BLOCKED`，root cause flow 置顶 |
| AFSCP command | 从 rendered Job 读取实际 args 后做 positive/negative smoke |
| visual | env-only 不触发 heavy visual；UI/design-system 与 release closure 按规则触发 |
| noise | 空匹配不启动完整测试；预期 stderr 不污染普通 summary |

## 6. 风险与边界

- 只优化高频、已证实耗时路径，不为了少数异常写大量兜底代码。
- Preflight 只诊断并给 cleanup，不擅自删除不属于当前 owner 的资源。
- Lifecycle cleanup/status 只覆盖已有入口：integration deps、local-real、unified-deploy substrate。kind/local registry 只输出 inspect 指引，不新增 public cleanup 入口。
- Product-flow release-only projection 必须 redaction，不进入普通产品 API。
- AFSCP/JVS 分工不变：AgentSmith 验证 AFSCP image/API/operation projection，不管理 AFSCP 内部工具生命周期。
- focused diagnostic 通过不能替代 `npm run release:ready` 或对应 `npm run verify -- --goal=... --run`。

## 7. 推荐顺序

1. Slice A：先让环境冲突早失败。
2. Slice B：去掉固定 sleep，并在单次命令进程内复用最大耗时 readiness。
3. Slice C：把失败摘要收敛成唯一 blocker 和下一步命令。
4. Slice E：清理空跑、噪音和 heavy visual 误触发。
5. Slice D：仅在 unified deploy / AFSCP 相关改动或发布前补上，减少 product-flow 级联误判并守住 rendered Job command contract。

这五步已经覆盖本轮最影响测试/gate/发布治理耗时与体验的关键点，不再扩大成通用治理平台。
