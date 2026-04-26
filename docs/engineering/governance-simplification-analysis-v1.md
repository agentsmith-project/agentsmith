# Engineering Governance Simplification Analysis v1

更新时间：2026-04-25
状态：`analysis_for_implementation`
适用范围：AgentSmith 工程治理、测试治理、发布前验证与本地排演的人机交互简化

## 0. 文档地位

这份文档是后续实现工作的工程分析与实施路线，不是新的 authoritative truth。

仍然以这些 current truth 为准：

1. 产品范围与术语：[`docs/项目宪法.md`](../项目宪法.md) 与 [`docs/contracts/product-terminology.md`](../contracts/product-terminology.md)
2. UI 风格：[`DESIGN.md`](../../DESIGN.md)
3. 工程治理：[`docs/current-engineering-governance-model.md`](../current-engineering-governance-model.md)
4. Gate / workflow / campaign / runtime-line 机器真相：`scripts/governance/current-gate-manifest.ts`、`scripts/governance/current-workflow-manifest.ts`、`scripts/governance/current-verification-campaign-manifest.ts`、`scripts/governance/current-runtime-line-manifest.ts`
5. Gate result schema：`scripts/governance/current-gate-result-schema.ts`
6. User story contract：[`docs/contracts/user-story-contract-v1.md`](../contracts/user-story-contract-v1.md)

如果本文与上述 truth 冲突，以上述 truth 和 machine-readable manifests 为准。本文中的新命令、新对象、新报告在落地前都只是目标设计；进入 current truth 前必须同步 contracts、manifests、docs 和 gates。

## 1. 背景与目标

近期一次跨 chat / notebook / backend-real / visual / release rehearsal 的工作耗时超过 10 小时。复盘结论不是“治理质量要求过高”，而是当前治理体系把太多内部对象直接暴露给开发、测试、发布执行者，导致人需要记住过多命令、证据路径、lane/gate 差异和失败后的回退顺序。

截至 2026-04-25，当前 `package.json` 已有 177 个 scripts，其中 `test:*` 相关入口超过 70 个。能力完整是优势，但这些入口不应全部成为人类日常心智模型。

本文目标：

1. 保留现有治理质量，不减少 contract、unit、integration、e2e、visual、backend-real、release rehearsal 和 evidence completeness 要求。
2. 将普通使用者的入口收敛到少数动作：开发、真实本地、验证、发布。
3. 把复杂的 gate / lane / campaign / evidence / result schema 收入治理工具内部。
4. 用 user story、风险等级、验证级别和下一步建议替代“记命令和读日志”。
5. 一次性收敛人类入口和文档叙事；底层 evidence producer / adapter 可以作为内部实现保留，但不能继续作为普通开发、测试、发布人员的入口或心智模型。

## 1.1 非目标

本文明确不做：

1. 不重新定义产品对象、页面 IA、权限模型或 UI 设计系统。
2. 不把 release、deploy、rehearsal 扩展为 AgentSmith 的对外产品能力。
3. 不减少 release readiness 的证据要求。
4. 不用 QA/产品可读报告替代 machine-readable evidence。
5. 不让 diagnostic command 替代 owning gate / evidence producer / release verdict。
6. 不要求一次性重写所有底层 evidence producer 或 shell scripts；但旧 gate/lane/backend-real/release:campaign 入口不再作为普通路径、fallback 路径或文档主叙事。
7. 不改变 runner 安全边界：ticket/token/managed credential 不落盘，runner 工作目录和 Context Store 约束继续以现有 contracts 为准。

## 2. 当前问题

### 2.1 概念暴露过多

当前文档和脚本同时暴露这些概念：

- `test:*`
- `gate:*`
- `lane:*`
- `backend-real:*`
- `release:campaign:*`
- `gate:release:full`
- demo / cluster rehearsal 分阶段命令
- canonical `result.json`
- `visual_scene_catalog`
- `ux_trace_bundle`
- standalone evidence 与 campaign-scoped evidence

这些概念对治理实现是必要的，但对多数开发、QA、产品、发布执行者不是必要入口。

### 2.2 身份与适配器耦合

当前 `current-gate-manifest.ts` 同时承载 `test`、`gate`、`lane` 三类对象。`gate:release` 实际转调 `lane:backend-real:release`，`gate:release:full` 是 aggregate-only 复核命令但名称像完整执行入口。这会导致误用：

1. 把 diagnostic command 当最终验收。
2. 把 aggregate-only 命令当 release 执行入口。
3. 把 standalone evidence 当 official campaign evidence。
4. 忽略 command passed 之后还需要 evidence completeness。

### 2.3 测试选择不是从用户故事出发

当前 story markdown 是产品行为真相，但实际执行时开发者经常按脚本名选择测试，而不是按：

1. 改了哪个用户故事。
2. 影响了哪个产品 surface。
3. 风险等级是多少。
4. 需要哪些验证级别。

这会造成两类浪费：

1. 低风险改动过早进入 expensive lane。
2. 高风险改动缺少 targeted early feedback，问题到 full gate 才暴露。

### 2.4 执行编排偏串行和冷启动

当前 release campaign 已有依赖图，但 runner 按顺序执行。mock、visual、backend-real 多次启动 Next、warm routes、准备依赖、构建 runner image，导致同一组证明反复支付固定成本。

这属于执行平台问题，应该由调度器、资源锁、缓存和 evidence claim 解决，不应让人手动决定“哪些能并行、哪些能复用”。

## 3. 设计原则

1. 人类入口少，内部能力全。
2. 对外讲用户故事、风险、验证级别和结论；对内保留 checks、profiles、evidence contracts、resource locks。
3. 诊断和验收必须分开；任何 diagnostic success 都不能自动等于 release ready。
4. `command passed` 和 evidence completeness 同级；缺证据就是失败。
5. 缓存和复用只能复用可验证 evidence claim，不能复用“看起来存在的文件”。
6. release-grade verdict 只消费 producer-owned evidence，不从当前 checkout 重造证据真相。
7. 旧 gate/lane/backend-real/release:campaign 命令若保留，只能作为内部 adapter、evidence producer 或 maintainer diagnostic；不能作为普通入口、备用入口或发布执行叙事。
8. deploy 与 rehearsal 分层：demo/cluster rehearsal 是本机排演；demo/cluster deploy 是目标主机发布线，不能互相替代。
9. manual operator steps 可以影响 release sign-off，但不能伪装成 automated gate identity。

## 4. 目标人类模型

### 4.1 Clean 人类入口

普通开发、测试、发布执行者只需要优先理解以下 clean human entrypoints；普通 docs、help、quick path 和发布执行叙事都必须以这组入口为准。

| 场景 | Clean human entrypoint | 人类理解 | 背后能力 |
| --- | --- | --- | --- |
| 前端 / mock 开发 | `npm run dev` | 我要开发和快速看页面 | Next dev + MSW |
| 本地真实环境 | `make local-real-up` / `make local-real-status` / `make local-real-down` / `make local-real-reset` | 我要管理真实后端、runner 和手测环境 | substrate + local-manual adapter |
| 日常验证 | `npm run verify` | 请根据本次改动告诉我该跑什么 | impact selector + checks + evidence validation |
| 发布验收与查看 | `npm run release:ready` / `npm run release:status` | 我要发布前完整结论，或查看最新发布验收状态 | precheck + release campaign wrapper + summary/latest status |
| 本地排演 | `npm run rehearse:demo` / `npm run rehearse:cluster` | 我要做 demo 或 cluster 本机排演 | rehearsal adapters |

`verify:*`、旧 `gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 和相关 `test:*` 命令不属于 clean human entrypoints。若底层脚本仍被新入口调用，必须被描述为内部 implementation dependency、evidence producer / adapter、owner diagnostic adapter 或 maintainer-only traceability，而不是可选替代路径或发布执行叙事。

`local-real` 只表示面向人的入口名，不是新的 runtime-line id、evidence root、manifest identity 或产品术语。落地实现仍必须映射到现有 `local-manual` runtime-line truth。

### 4.2 `npm run verify` 的行为

`npm run verify` 不应是固定大 suite，而应是向导和执行器。为避免把“计划生成成功”误读成“验收通过”，默认行为必须是 dry-run 推荐；只有显式 `--run` 才通过 clean human entrypoint 执行检查。具体 `verify:*` scripts 若保留，只能作为内部 implementation dependency 或 owner diagnostic adapter。

推荐模式：

```bash
npm run verify
npm run verify -- --goal=debug
npm run verify -- --goal=pr
npm run verify -- --goal=visual
npm run verify -- --goal=real
npm run verify -- --goal=pr --run
```

`verify` 输出必须固定回答：

1. 本次改动影响哪些 stories / surfaces。
2. 推荐先跑哪些 checks。
3. 最终验收需要达到哪个验证级别。
4. 哪些 evidence 是 required。
5. 如果失败，下一步应该交给哪个 owner 或执行哪个命令。

示例输出：

```text
AgentSmith Verification

Goal: pr
Risk: R1 core user flow
Affected stories: chat-stop-terminate-idempotent-state-resync, notebook-cancel-terminate-refresh-recovery
Required levels: V0, V1, V3

Run now:
1. npm run verify -- --goal=pr --run

Final verdict: default acceptance + backend-real evidence
Note: this is not release readiness. Run npm run release:ready before release.
```

## 5. 验证级别与风险等级

### 5.1 对外验证级别

QA、产品、发布执行者不需要以 unit / integration / e2e / visual / backend-real 作为主导航。对外统一使用 V0-V4。

| 级别 | 名称 | 证明什么 | 内部对应 |
| --- | --- | --- | --- |
| V0 | 基础可信 | 类型、合约、低成本逻辑没有漂移 | contract / type / unit / small integration |
| V1 | 用户流程 | 用户故事在稳定 mock 环境能走通 | mock e2e / default gate / targeted visual |
| V2 | 视觉体验 | 页面布局、关键状态、视觉基线符合预期 | full visual catalog |
| V3 | 真实后端 | 真实认证、数据、权限、runner、Files、审计与用量闭环 | backend-real + `ux_trace_bundle` |
| V4 | 发布闭环 | 发布前 full visual、backend-real、demo rehearsal、cluster rehearsal 与 aggregate 全部通过 | release campaign |

V3 需要区分 scope：

1. `default real`：日常真实后端验证，实现层对应 internal `verify:real` adapter / core backend-real。
2. `release real`：发布级真实后端验证，只能作为 release campaign 的 producer-owned evidence，或作为 campaign 失败后的 owning diagnostic 通过 internal `verify:release-real` adapter 定位问题。

`verify:real` 通过不等于 release readiness，`verify:release-real` 通过也不能替代 campaign-scoped release verdict。

### 5.2 级别通过语义

某个验证级别通过，必须满足该级别 required checks 的 owning evidence contracts。diagnostic command 只能帮助定位问题，不能自动满足级别通过条件，除非它被 current manifest 和 evidence contract 明确声明为该级别的 owning producer。

Story 的 `passed` 也必须表示该 story 的 required levels 全部满足，而不是“存在一个最新绿色 evidence”。

### 5.3 风险等级

风险等级决定默认需要跑到哪个验证级别。

| 风险 | 适用场景 | 默认要求 |
| --- | --- | --- |
| R0 发布阻断 | 认证、权限、数据隔离、Notebook/runner、Files、Usage/Audit、发布主链 | V0 + V1 + V2 + V3，发布前再 V4 |
| R1 核心主链 | 高频用户旅程、跨页面状态、真实后端状态变化 | V0 + V1 + V3，UI 改动加 V2 |
| R2 普通功能 | 单模块、单页面、非高危交互 | V0 + V1，视觉变更加 V2 |
| R3 低风险 | 文案、非关键样式、局部展示 | V0 + 受影响 story 的最小 V1/V2 |

首版可以用 story 的 `family`、`personas`、`externalDependencies`、`gatePolicy` 推断风险，后续再允许显式 `riskLevel` 或 sidecar 风险映射。

风险推断必须 fail-closed：未映射文件、跨切面脚本、credential/security、runner/runtime-line、Context Store、evidence writer、release/deploy/rehearsal 变更默认升高风险，并要求人工确认或更高验证级别。首版只能推荐风险等级，不能自动下调 required levels。

## 6. 内部模型

下面对象是实现层需要维护的内部模型，普通使用者不需要记住。

| 内部对象 | 职责 | 对外展示 |
| --- | --- | --- |
| Product Story | 用户行为真相 | 用户故事 |
| Impact Policy | 从文件/API/组件/runner/权限点推导影响面 | verify 推荐 |
| Claim | 要证明的质量声明 | 验收点 |
| Check | 最小可执行验证单元 | 验证步骤 |
| Execution Profile | mock / visual / backend-real / rehearsal 等运行剖面 | 验证级别详情 |
| Evidence Contract | 证据 producer、schema、artifact、freshness、blocking scope | 证据卡 |
| Evidence Claim | 某次执行产出的可验证证明 | 可复用证据 |
| Verdict Policy | 聚合 evidence 后给出正式裁决 | 验收结论 |
| Run Plan | 一次工程治理执行的 DAG | 执行计划详情 |
| Adapter | npm / make / shell / CI job 内部调用桥接 | maintainer trace / owner diagnostic |

关键边界：

1. `Check` 可以执行命令。
2. `Evidence Claim` 记录“这次执行证明了什么”。
3. `Verdict Policy` 只消费 evidence claims，不直接替代 producer。
4. `Run Plan` 只负责编排，不拥有 evidence truth。
5. `Adapter` 只是内部调用桥接，不是治理身份，也不是对外承诺的入口。

这些对象只属于工程实现解释，不应写成产品对象或用户可见功能范围。

## 7. 证据与缓存安全

### 7.1 Evidence claim 最小字段

任何可复用证据都必须记录：

| 字段 | 含义 |
| --- | --- |
| `schema_version` | Evidence claim schema 版本 |
| `subject` | 证明对象，例如 `visual.full_catalog`、`backend_real.release_ux_trace` |
| `input_digest` | git sha、相关文件 hash、lockfile、tool versions、env profile |
| `artifact_digest` | result、manifest、screenshots、trace bundle、logs 的内容 hash |
| `producer` | 本地/CI、runner、Node 版本、command adapter |
| `gate_id` | 对应 current gate manifest 的 stable gate id；没有 gate id 的 claim 不能用于 gate verdict |
| `line_kind` | mock、visual、backend-real、rehearsal、release 等 runtime / verification line |
| `gate_adapter.npm_script` | 当前 npm adapter，仅保留内部执行链可追溯性 |
| `ci_job` / `step_id` | CI job、campaign step 或本地 run step 标识 |
| `campaign_root` / `run_id` | 所属 campaign 或 run；release-grade claim 必须绑定 campaign root |
| `evidence_dir` | producer-owned evidence 目录 |
| `result_digest` | canonical `result.json` 或等价 result artifact 的 hash |
| `failure_class` | 失败时使用 current gate result taxonomy，不新增平行分类 |
| `story_fingerprint` / `step_fingerprint` | story 与 step contract 指纹 |
| `freshness` | 是否允许跨 commit、跨 branch、跨 secret profile |
| `validator` | 聚合时重新校验 schema、fingerprint、membership、artifact existence |
| `scope` | debug、pr、visual、real、release 等使用范围 |

Evidence claim 是 index/cache，不是新的 verdict source。它只能指向 producer-owned artifacts，并由现有 manifests、schemas、campaign membership 和 result writer 共同验证；claim 自身不能独立产生 release verdict。

### 7.2 复用规则

允许：

1. PR 可复用同一 commit 的 CI claim。
2. 本地可复用同一 commit、同一 env profile 的 pure-check claim。
3. release aggregate 可以复核同一 campaign root 下 producer-owned evidence。

禁止：

1. 复用失败 claim。
2. 复用缺少 artifact digest 的 claim。
3. backend-real 跨 secret/provider profile 复用。
4. visual automated pass 直接替代人工 UX acceptance。
5. 用当前 checkout 的 story 定义重造旧 trace evidence 的语义。
6. 在 evidence、summary、trace、visual review 中泄露 API key、ticket、OAuth token 或 managed credential 内容。

### 7.3 Evidence truth 边界

必须继续遵守：

1. story markdown 是 user story 的 canonical truth；generated specs 是派生缓存。
2. visual full catalog 的 producer-owned truth 是 visual run manifest 和 run-scoped captures。
3. backend-real UX trace 的 producer-owned truth 是 `ux-trace-index.json`、per-bundle review、contract snapshot 和 canonical result。
4. official release verdict 只能优先消费 campaign-scoped evidence，standalone lane evidence 只能用于诊断或人工查看。
5. command exit code 为 0 但 required evidence 缺失时，验收仍然失败。

## 8. 执行平台方向

### 8.1 目标能力

后续 `governance run` 平台应负责：

1. 根据 goal 和 git diff 生成 run plan。
2. 按 DAG 调度 jobs。
3. 管理资源锁。
4. 分配动态端口和 run root。
5. 决定 cache hit / miss。
6. 收集 artifacts 并生成 evidence claims。
7. 输出 verdict 和 story acceptance report；其中 release 结论必须来自 delegated terminal aggregate 和 producer-owned evidence，runner 只负责汇总与呈现，不成为新的 release verdict source。

### 8.2 资源锁

必须显式建模的互斥资源：

| 资源 | 原因 |
| --- | --- |
| `next-source-contract` | typegen / tsc / build 共享 root generated state |
| shared substrate lifecycle | substrate up/down/reset/reseed 会影响所有 local runtime flows |
| destructive lifecycle commands | reset、reseed、down、cleanup 必须独占 |
| fixed local ports | API/Web/Keycloak/Postgres/Mongo/Redis/MinIO/proxy 端口冲突 |
| mutable current pointers | `artifacts/backend-real/current`、`mock-lane/current` 等会被覆盖 |
| release latest pointer | `release:status` 读取的 latest 指针必须避免并发覆盖 |
| campaign root writes | release campaign evidence root 必须单写者 |
| scenario world | demo/cluster rehearsal 的 kind cluster、registry、runtime root |
| backend-real provider quota | 同一 API key / provider / model 不能盲目并发 |
| provider secret profile | backend-real evidence 不能跨 secret/provider profile 复用 |
| visual baseline update | 更新截图和验收截图必须独占 |

`release-campaign-root-writes` 这类锁在并行化前必须先定义 scope key 和 lease 语义：同一 campaign root 写入需要可审计的运行时 lease；不同 root 或不同安全 scope 不应被 naive job-level exclusive 全部串行化；同时不能因为担心串行化而忽略锁。

可以并行的内容：

1. pure checks：lint、contract、OpenAPI、unit。
2. `gate-default` 与 full visual 在 `gate-fast` 之后并行。
3. isolated mock Playwright sessions。
4. isolated integration specs。
5. demo / cluster rehearsal 在运行时完全隔离后并行。

在本机默认 runtime-line 约束没有被平台明确建模前，不应鼓励人手工并行 heavy runtime world。

## 9. Story Acceptance Report

### 9.1 报告目标

`Story Acceptance Report` 是面向 QA、产品、reviewer、release operator 的默认报告。它按用户故事聚合，而不是按命令聚合。

输出位置：

```text
<run-root>/story-acceptance-report.md
<run-root>/story-acceptance-report.json
```

### 9.2 首页内容

首页只展示：

1. 最终结论。
2. 风险覆盖。
3. 缺失或过期证据。
4. 阻塞项。
5. 下一步建议。

### 9.3 Story card

每个 story card 展示：

| 字段 | 说明 |
| --- | --- |
| Story | 标题和 story id |
| Persona | 主要用户 |
| Risk | R0-R3 |
| Required levels | V0-V4 |
| Level status | V0-V4 逐级 passed / failed / missing / stale / manual-review-needed |
| Latest evidence | 最新证据卡 |
| Status | passed / failed / missing / stale / manual-review-needed |
| Failure reason | 一句话原因 |
| Next action | 一个推荐动作 |

`Status: passed` 只在 required levels 全部满足时出现。绿色证据默认折叠。只有以下情况要求人工 review：

1. visual diff。
2. story 内容变更。
3. evidence fingerprint 过期。
4. 风险等级被下调。
5. release exception。
6. failure class 是 `contract_drift`、`evidence_missing`、`product_regression` 或未知分类。

## 10. 发布入口

### 10.1 推荐命令

面向发布和部署执行者只暴露：

```bash
npm run release:ready
npm run release:status
npm run rehearse:demo
npm run rehearse:cluster
```

`release:ready` 是对现有 release campaign 的人类友好包装，不在 campaign 外创建第二套执行链。内部顺序是：

1. 运行 release precheck 作为非 verdict 的 readiness guard。
2. precheck 失败时停止，并明确输出“未进入 release campaign，因此没有 release verdict”。
3. precheck 通过后调用现有 release campaign。
4. 在 campaign 内完成 full visual、backend-real release verification、demo rehearsal、cluster rehearsal 与 terminal aggregate verdict。
5. 基于 campaign-scoped evidence 生成 release summary。

`release:ready` 是人类入口，不是新的 evidence truth。最终 automated release-grade verdict 仍必须来自 campaign-scoped evidence 与 terminal aggregate。若未来要让 precheck 成为正式 release-blocking step，必须先进入 current verification campaign manifest 和 result schema；在此之前它只能是前置诊断。

### 10.2 成功输出

```text
AgentSmith Release Readiness

Automated release verdict: PASSED
Campaign: <campaign-run-id>
Covered: default gate, full visual, backend-real, demo rehearsal, cluster rehearsal
Evidence package: artifacts/release-runs/<campaign-run-id>
Manual/operator sign-off: not covered by this command.
Next: attach summary.md to the release note and complete operator sign-off checklist.
```

### 10.3 失败输出

```text
AgentSmith Release Readiness

Automated release verdict: NOT STARTED
Blocked before: release campaign
Why: missing PRESET_ENDPOINT_API_KEY, real backend verification cannot start.
Next: set PRESET_ENDPOINT_API_KEY in .env.backend-real, then run: npm run release:ready
Evidence: no campaign evidence was produced.
Logs: artifacts/release-runs/<precheck-run-id>/
```

### 10.4 Failure guidance

按 `step_id + failure_class` 生成下一步建议。

| failure class | 用户说明 | 下一步 |
| --- | --- | --- |
| `infra_setup_failure` | 本地依赖、端口、Keycloak、API key 或外部服务未就绪 | 修环境后重跑 `npm run release:ready`；若发生在 precheck，说明没有 release verdict |
| `environment_conflict` | active runtime、端口或 scenario world 冲突 | 运行 `npm run release:status` 查看冲突并按提示 down/reset |
| `evidence_missing` | 命令可能执行过，但证据不完整 | 跑 owning diagnostic，再回到 `npm run release:ready` |
| `contract_drift` | manifest、schema 或 evidence contract 不一致 | 不要盲目重跑，交给治理维护者修正 |
| `product_regression` | 真实产品行为回归 | 修业务问题，按 `release:status` 提示跑最小验证 |

人工 review 触发条件应按 failure class 分组展示：环境类可以修环境后重跑，evidence/contract 类必须回到 owning producer 或治理维护者，product regression 必须修业务问题并重跑 required levels。

## 11. Clean 人类入口与内部实现映射

下表左侧只列 clean human entrypoints。右侧是内部实现依赖或 producer adapter，不是普通人员需要记忆的替代命令。落地后的 quick path、help、CI workflow 叙事必须以左侧入口为准。

| Clean human entrypoint | 内部实现依赖 | 说明 |
| --- | --- | --- |
| `npm run dev` | Next dev + MSW | 前端 / mock 开发 |
| `make local-real-up` | `make substrate-up && make substrate-reseed && make local-manual-up` | 本地真实环境 adapter；不新增 runtime-line id |
| `make local-real-status` | `make substrate-status && make local-manual-status` | 查看真实环境 |
| `make local-real-down` | `make local-manual-down` | 停止真实环境 |
| `make local-real-reset` | `make local-manual-reset` | 重置真实环境 |
| `npm run verify` | impact selector + internal verification adapters + evidence validation | 日常验证唯一 clean human entrypoint |
| `npm run release:ready` | `npm run test:release:precheck && npm run release:campaign:full` | 发布准备检查；precheck 是非 verdict guard，release verdict 只来自 campaign |
| `npm run release:status` | 读取 latest campaign summary | 查看最新 release 结论 |
| `npm run rehearse:demo` | `npm run lane:demo-rehearsal` | demo 本地排演 |
| `npm run rehearse:cluster` | `npm run lane:cluster-rehearsal` | cluster 本地排演 |

下表左侧不是人类入口，只是 internal implementation dependency、owner diagnostic adapter 或 maintainer-only traceability。它们不能出现在普通 quick path、help 输出或发布执行叙事中。

| Internal implementation dependency / maintainer diagnostic adapter | Owning producer / lower-level adapter | 允许语境 |
| --- | --- | --- |
| `npm run verify:quick` | `npm run gate:fast` | `npm run verify` 执行计划的内部实现映射，或 maintainer V0 诊断 |
| `npm run verify:default` | `npm run gate:default` | `npm run verify` 执行计划的内部实现映射，或 maintainer default gate 诊断 |
| `npm run verify:visual` | `npm run lane:visual` | `npm run verify` 执行计划的内部实现映射，或 maintainer full visual 诊断 |
| `npm run verify:real` | `npm run lane:backend-real:core` | `npm run verify` 执行计划的内部实现映射，或 backend-real owner 诊断 |
| `npm run verify:release-real` | `npm run gate:release` | release campaign 失败后的 backend-real owner 诊断；不能替代 campaign-scoped verdict |
| `npm run release:aggregate` | `RELEASE_CAMPAIGN_ROOT=<root> npm run gate:release:full` | maintainer-only terminal aggregate traceability；不能作为 release execution entrypoint |

落地时必须同步 `package.json`、Makefile、`scripts/governance/current-workflow-manifest.ts`、CI workflow 描述和相关 docs，避免入口、manifest、docs 和 CI 叙事不一致。

## 12. 实施路线

旧命令收敛不是 P3 才做的清理项，而是 P0 起必须满足的实施约束：普通开发、测试、发布路径只暴露新入口；旧 gate/lane/backend-real/release:campaign 命令若仍被调用，只能作为内部 evidence producer / adapter 或 maintainer diagnostic 被追溯。

### P0：入口收敛与报告

目标：在人类入口层完成 clean refactor。现有 gate identity 和 shell 脚本可以先作为内部实现复用，但普通路径、文档 quick path、help 输出和发布叙事必须一次性收敛到新入口。

交付：

1. 确立 `npm run verify` 为 canonical human verification entrypoint；`verify:*` scripts 仅作为内部 implementation dependency 或 owner diagnostic adapter。
2. 确立 `release:ready`、`release:status`、`rehearse:*` 为 canonical release/rehearsal entrypoints。
3. 新增 `make local-real-*` 包装入口。
4. release campaign 结束后生成 `summary.md` 和 `summary.json`。
5. 失败输出最后一屏固定显示 verdict、blocked step、why、next action、summary path。
6. 文档 quick path、help 和普通操作说明只写四类入口；旧命令族只允许出现在 maintainer 内部实现追溯中。

验收：

1. 普通开发、测试、发布文档和 help 不再列出旧 gate/lane/backend-real/release:campaign 命令作为可执行路径。
2. precheck 通过后，`npm run release:ready` 能基于 campaign-scoped evidence 和 terminal aggregate 给出 automated release-grade verdict。
3. precheck 失败时，`npm run release:ready` 明确输出没有进入 release campaign、没有 release verdict。
4. `release:status` 能读取 latest campaign 并给出下一步。
5. `npm run contracts:check-doc-governance` 通过。
6. `npm run contracts:check-current-workflows` 和 `npm run contracts:check-current-gates` 通过。
7. 新入口不会引入新的 top-level workflow term。

### P1：Impact selector 与 Story Acceptance Report

目标：让验证选择从 user story 和 risk 出发。

交付：

1. 从 canonical stories、current gate manifest、current verification campaign manifest、derived visual catalog metadata、gate result schema 生成只读 verification catalog；catalog 无 verdict state，不检查 artifact 目录；generated story specs 只能标记为 derived cache，不能作为 story truth。
2. 增加 story risk 推断。
3. 增加 changed files 到 affected stories / required levels 的 impact map。
4. `npm run verify` 根据 goal 和 diff 输出推荐执行计划。
5. 生成 `story-acceptance-report.md/json`。
6. 视觉证据和 backend-real trace 以 story card 方式展示。

验收：

1. 改 UI 文件能推荐 V1/V2。
2. 改 runner / Context Store / endpoint credential 能推荐 V3。
3. 改 release/deploy 脚本能推荐 V4 或 rehearsal。
4. P1/P1.1 报告能明确 required evidence owner、missing catalog mapping、`not_evaluated`、`missing`、`manual_review_needed` 和下一步；在 P2 evidence-claim validation 或明确限定的 artifact-inspection 切片消费 producer-owned artifacts 之前，报告不得声明 `passed`、`failed` 或 `stale`。
5. QA/产品报告不能绕过 canonical evidence；报告中每张证据卡都能追溯到 producer-owned artifact。

### P2：治理 runner 与 evidence claim

目标：把脚本编排升级为可调度、可缓存、可复用的治理执行平台。

本阶段新增的 run state、resume plan、scheduler、lock lease 等只属于治理 runner 内部工程模型，不改变产品范围，也不替代 current truth、producer-owned evidence 或 delegated terminal aggregate。

交付：

1. `governance run --goal=<debug|pr|visual|real|release>`。
2. Job metadata：inputs、outputs、locks、timeouts、retry、cache。
3. Resource lock manager。
4. Evidence claim schema。
5. Artifact index。
6. Run state and resume plan model：先实现无执行、无 verdict、基于 current manifests 与 evidence claim boundary 的 run state / resume decision model。
7. Executing DAG scheduler：后续才接入命令执行、资源锁运行时 lease 和 producer adapters。
8. CI 与本地共用 run plan。

实施顺序确认：

已完成 evidence claim schema、resource lock manifest、job metadata manifest 后，P2 不应先实现裸 `Artifact index` schema/validator。下一步先把这些 P2 模型接入只读报告或检查入口，让人能看到 job metadata、resource locks、evidence claim boundaries，减少查路径、猜并行/复用和误判 verdict。

`Artifact index` 仍是 P2 目标，但必须等到已有 P2 模型被只读报告/检查入口消费后再实现。未来 guardrails：它不得读取文件、扫描目录、计算 digest、声明 `exists` / `passed` / `failed` / `reusable` / `verdict` / `cache_hit` / `claim_id`，不得成为 release verdict source；digest 仍属于 evidence claim 责任。

`Run state and resume plan model` 必须先于 `executing DAG scheduler`：首阶段只判断哪些 producer-owned evidence / claims 在当前 manifests 边界内可复用、缺失或需要补跑，不启动命令、不持有运行时 lease、不输出 release verdict。只有该模型经只读报告和检查入口验证后，才进入执行型 DAG scheduler，接入命令执行、lease acquisition / renewal / release、producer adapters 和失败恢复。

`governance run --goal=release` 最终可以输出 release 结论，但结论来源必须仍是 delegated terminal aggregate 对 campaign-scoped producer-owned evidence 的聚合结果；runner 不得绕过 aggregate 自己裁决，也不得把 run state / resume decision 当作 release verdict。

验收：

1. `gate-default` 和 full visual 可在安全边界内并行。
2. 同一 commit 下 pure checks 可复用。
3. release failure 修复后，run state / resume plan 能说明失效 claims、需要补跑的 producers 和 downstream aggregate，不直接声明 release verdict。
4. release verdict 仍然只来自 producer-owned evidence。
5. resource lock、cache hit、claim reuse 都能在 run summary 中审计。

### P3：CI 与治理 runner 收口

目标：在 P0 已完成人类入口收敛的基础上，降低长期维护成本。

交付：

1. CI workflow 从手写步骤收敛为统一 `governance run` 或 canonical human entrypoint。
2. maintainer 文档能从新入口追溯到底层 evidence producer、adapter、manifest id 和 artifact root。
3. package scripts、workflow manifest 和 docs 不再形成多套并列 release 执行叙事。
4. 当没有内部调用者依赖时，旧命令实现可以删除、重命名或内联到治理 runner。

验收：

1. 新人只读 quick path 就能完成开发验证和发布验收。
2. Maintainer 仍能定位底层 evidence producer，但不需要把旧命令当成普通入口。
3. docs、manifest、package scripts 不再出现多套互相竞争的 release 执行叙事。

## 13. 不做事项

以下方向明确不做：

1. 不减少 release readiness 所需 evidence。
2. 不用 diagnostic success 代替 verdict。
3. 不把 `command passed` 当 evidence complete。
4. 不让 visual snapshot update 绕过人工审查。
5. 不在同一台本机强行并行共享 runtime world。
6. 不把 release / deploy / rehearsal 的实现细节提升为产品功能范围。
7. 不把旧 gate/lane/backend-real/release:campaign 入口作为普通路径、备用路径或 operator muscle memory 继续维护。
8. 不把 full visual 塞进 default gate，也不让 default gate 隐式承担 release 责任。
9. 不让 generated cache、summary report 或 README 命令块替代 story truth、manifest truth 或 evidence truth。

## 14. 主要风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 新入口与内部 producer 语义不一致 | 用户误判验收结果 | 用 manifest、evidence contract 和 mapping tests 锁定语义；不提供旧命令 fallback 叙事 |
| 缓存误用 | 放过真实回归 | evidence claim 必须包含 input digest、artifact digest、validator |
| report 过度摘要 | 审计信息不足 | 首页摘要 + 附录保留 evidence paths 和 raw logs |
| story risk 推断错误 | 跑少或跑多 | 首版只推荐，不自动降级 required levels |
| release status 指向旧 run | 使用过期结论 | latest pointer 必须记录 git sha、run id、generated_at |
| CI 与本地行为分裂 | 本地通过但 CI 失败 | P2 统一 run plan，CI 只做执行环境差异 |

## 15. 开发交付切片

建议按以下切片交付：入口层先 clean refactor，后续切片再逐步建设内部执行平台，避免把平台重写和人类入口收敛绑成一个不可交付的大包。

1. `release summary writer`
2. `release:ready` 和 `release:status`
3. `npm run verify` selector and internal `verify:*` adapter mapping
4. `make local-real-*`
5. verification catalog read-only generator
6. impact selector dry run
7. story acceptance report
8. evidence claim schema
9. resource lock manifest
10. job metadata manifest
11. P2 model read-only report/check projection
12. artifact index
13. governance runner shell adapter
14. run state and resume plan model
15. executing DAG scheduler
16. CI integration
17. human entrypoint cleanup and docs rewrite

每个切片都必须先有 tests，再改实现，并保留 evidence producer、manifest mapping 和 verdict contract 的回归测试；不新增旧入口可执行性的回归要求。

## 16. 首版成功标准

首版不要求完成全部执行平台重构。首版达到以下标准即可认为方向正确：

1. 普通开发者能通过 `npm run verify` 得到明确推荐。
2. 发布执行者只需要 `npm run release:ready` 和 `npm run release:status`。
3. QA/产品能读 `Story Acceptance Report`，不需要理解 lane/gate。
4. release 失败时最后一屏有唯一 next action。
5. 普通 docs、help 和发布执行说明不再要求理解或调用旧 gate/lane/backend-real/release:campaign commands。
6. docs governance、contracts check、现有 gate result schema 不被破坏。

## 17. 后续需要确认的决策

这些问题不阻塞 P0，但在 P1/P2 前需要收敛：

1. story `riskLevel` 是写入 canonical story contract，还是先用 sidecar mapping。
2. `verify --run` 是自动执行全部推荐项，还是只执行安全子集并要求显式确认 heavy runtime checks。
3. 若未来希望 precheck 成为正式 release-blocking step，是否 promote 到 verification campaign manifest 和 result schema。
4. evidence claim store 是 repo-local artifacts，还是未来支持 CI artifact promotion。

推荐默认：

1. P0 完成人类入口收敛和报告，不重写所有底层 producer。
2. P1 才引入 story risk sidecar。
3. P2 才考虑 evidence claim promotion。
4. `verify` 默认 dry-run，显式 `--run` 才执行推荐计划。
5. `local-real` 永远只作为 `local-manual` 的人类友好入口名，不新增 runtime-line identity。

## 18. 开发前检查清单

正式进入实现前，负责开发的 team 应再次确认：

1. 是否只改工程治理和测试发布体验，没有扩张产品范围。
2. 是否已把普通开发、测试、发布路径收敛到新入口，没有保留旧命令 fallback 叙事。
3. 是否已定义新入口与现有 stable gate id / workflow role / evidence owner 的映射。
4. 是否每个新报告字段都能追溯到 canonical evidence 或 manifest。
5. 是否对 secret、ticket、managed credential 做了不落盘和脱敏约束。
6. 是否有 TDD 切片：文档检查、manifest 检查、CLI 输出、summary writer、failure guidance、producer mapping 与 verdict contract。
7. 是否明确失败时最终回到哪个 owning gate、evidence producer 或 release verdict。
