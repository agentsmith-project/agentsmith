# 发布前检查清单

这份清单用于当前 AgentSmith product-side readiness：本地完整验证、合同完整性、release-kit/operator 交接输入完整性。当前 `npm run product:ready` 不给部署、package 或 operator runbook 下最终结论；unified deploy、local-kind、existing-cluster 与 product-flow deploy 命令只保留为 transition-only focused diagnostics / 过渡期专项诊断。Product-flow 额外有一个 AgentSmith-owned post-deploy product smoke report producer：它按 deployed target/run 给 release-kit `--ga-release` 提供 finalized reports，final GA 至少消费一份 online report 和一份 airgap report，但仍不进入默认 `product:ready` / release-full。真实 Kubernetes / release-kit adoption target profile 在 AgentSmith release boundary 中只能作为 optional/candidate handoff。当前 GA 边界下，release-kit 只通过 repo-local final GA gate/evidence 给最终 GA 结论；deployment、package 和 operator runbook 证据只是 final GA 输入。AgentSmith 长期保留 product readiness、images/release contract、local full test 和 thin adapter。

术语边界：
- 这里的 `release` 仅表示工程验收与上线准备流程。
- 不代表 AgentSmith 提供对外 DevOps 发布管理能力。
- 不代表 AgentSmith 拥有在线/airgap 部署执行、发布包验收或 operator runbook 最终结论；这些只作为 release-kit final GA gate/evidence 的输入。
- release-kit handoff boundary: AgentSmith product:ready is product readiness / local complete / current product gate for product evidence, full visual, backend-real product readiness, and terminal aggregate evidence for handoff input completeness. It is not a deployment/package/operator verdict. Unified deploy and local-kind deploy commands are transition-only focused diagnostics / 过渡期专项诊断. The product-flow lane is only the AgentSmith-owned producer for canonical post-deploy product smoke reports consumed by release-kit `--ga-release`; release-kit final GA requires at least one online report and one airgap report. It is not a default product readiness or release-full step. Release-kit owns the final GA verdict through repo-local gate/evidence over deployment/package/operator inputs; AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.
- `npm run release:ready` / `npm run release:status` remain deprecated transition aliases / 过渡 alias for `npm run product:ready` / `npm run product:status`; they do not produce deployment, package, or operator verdicts.

## 当前 Product Readiness 通过标准

只有下面 4 类检查都通过，当前 AgentSmith product-side readiness 才可视为通过：
1. 合约与类型检查通过。
2. 默认业务链与治理门禁通过。
3. backend-real product readiness 验证通过。
4. full visual、machine-readable story evidence 与 aggregate readiness check 通过。

补充判定规则：
1. 当前面向人的 AgentSmith product-side readiness 执行入口统一是 `npm run product:ready`。
2. `npm run product:status` 是只读入口，只读取 latest summary 及其中冻结的 status/deploy snapshot，不重新聚合 evidence；默认人类输出是短摘要，机器可读完整投影用 `--json`。
3. 默认 product readiness campaign 不执行 online/airgap deploy，也不要求 `local-kind`、`existing-cluster` 或 focused product-flow deploy diagnostics 作为 AgentSmith readiness 证据。
4. 机器可读报告语境：`gate:default` does not run the full visual lane，也不能代替 backend-real product readiness 或当前 AgentSmith product-side readiness 结论。
5. 对 evidence-owning gates 和 lanes，`command passed` 与 machine-readable evidence completeness 同级；缺少 required review artifacts、`visual_scene_catalog` 或 `ux_trace_bundle`，都不能算通过。
6. 维护者排障语境：`gate:release:full` is aggregate-only readiness verification；它只验证已有 campaign evidence，不执行 suite，也不是普通人工入口。
7. `product:ready` / `product:status` 不清理或改写原始日志；NO_COLOR、Postgres already exists、containerd deprecation 这类常见 setup warning 只有在 summary/evidence 明确列为 blocker 时才影响主结论。
8. Product Readiness 前必须保留 Files restore continuation focused backend-real gate 作为重点证据；它证明 Files restore、read export pending、runtime-access release convergence 没有在完整 readiness 前断链。
9. 观察 CI/gate 状态时，连续多次 non-terminal 后等待间隔递增；第一次可执行环境 unavailable 后重跑通过记为 runtime flake，连续出现则升级稳定性 blocker。
10. Files restore continuation focused gate 中，terminal 已有关闭最终态但 workspace-binding release/revoke 仍 pending 时，按 runtime readiness 继续收口；AFSCP revoke 409 conflict 需要作为 retryable readiness 证据记录，不按普通 Files operation failed 处理。
11. `<campaign-root>/gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json` 必须携带 runtime readiness convergence policy、classification rules 和 AGENT_SANDBOX_UNAVAILABLE 调用摘要；缺这些字段时不能作为 Product Readiness 前的重点证据。

## 环境前提

product readiness 验证前，先确认：
1. Keycloak 集成依赖可用。
2. 真实 backend-real 所需的 endpoint / API key 已配置。
3. 本机没有残留的多余 `next dev` 进程与 scenario。

## 自动化与手工边界

1. 本文里的自动化 product readiness campaign，指当前 machine-readable gates、lanes 与 backend-real product readiness 证据链。
2. `gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 都是 internal adapter / evidence producer surface，保留给 CI、`npm run product:ready` 和 owner runbook，不作为普通发布人员的 copyable command 目录。

## 验证顺序

### 1. Clean Human Entrypoints

日常 AgentSmith product-side readiness 自动化入口只跑：

```bash
npm run product:ready
npm run product:status
```

维护者排障语境：`npm run product:ready` 先运行 `npm run test:release:precheck` 作为非 verdict guard。precheck 失败时会停止并输出 NOT STARTED，表示未进入 campaign、没有 product readiness 结论。precheck 通过后才委托 internal adapter family 编排 required steps，并在 campaign context 内调用 aggregate readiness check。结束时优先看短摘要里的 `Evidence` / `Summary` 路径；上方原始日志仍保留用于排障。

### 2. 维护者排障 / Owner Producer Diagnostics

Unified deploy、local-kind、existing-cluster 和 focused product-flow 的
transition-only diagnostics / 过渡期专项诊断不是默认 Product Readiness
证据。只有 failure summary、owner runbook 或 manifest 明确指向这些诊断时，
维护者才进入 [Unified Deploy Operations](./unified-deploy-operations.md)
或对应 owner runbook 定位问题；常用 focused diagnostics 是
`npm run test:unified-deploy:local-kind` 和
`npm run test:unified-deploy:existing-cluster-smoke`。诊断变绿后仍回到
`npm run product:ready` 重新给出 AgentSmith product-side readiness 结论。

### 3. 维护者排障 / 机器可读报告 Role Map

下面的 role table 用于理解证据所有权、排障和复核，不是要求新人手工维护第二套命令顺序。

| Role | Surface | 当前用途 |
| --- | --- | --- |
| human product readiness entry | `npm run product:ready` | precheck 通过后进入当前 AgentSmith product readiness campaign，并在结束后生成 summary |
| status reader | `npm run product:status` | 读取 latest/summary 指针与 summary 中冻结的 status/deploy snapshot；不重新聚合 evidence，也不读取 mutable per-step result |
| transition-only deploy diagnostics / 过渡期专项诊断 | [Unified Deploy Operations](./unified-deploy-operations.md) / owner runbook | 本机或目标集群 deploy、rollout、route smoke 定位；不属于 AgentSmith product readiness 必需证据 |
| focused product-flow diagnostic / 过渡期专项诊断 | owner runbook | deploy profile 上的 product-flow aggregate 定位；不是 release-kit canonical report producer，也不属于 AgentSmith product readiness 必需证据 |
| post-deploy product smoke handoff producer | release-kit GA handoff artifact | 绑定 downloaded `agentsmith-release-contract.json`、同一 deployed target 的 site env 和 substrate truth，按 deployed target/run 输出 canonical report；final GA 至少把 `<online-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json` 和 `<airgap-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json` 交给 release-kit `--ga-release`；不属于默认 `product:ready` / release-full |
| preflight | internal adapter `gate:fast` | 基础 contract、static、cheap checks 没先坏 |
| tier verdict | internal adapter `gate:default` | 默认工程门禁通过；它不能代替 full visual |
| evidence owner | internal adapter `lane:visual` | full visual 与 `visual_scene_catalog` 完整 |
| evidence owner | internal adapter `gate:release` / `lane:backend-real:release` | backend-real product readiness 与 `ux_trace_bundle` 完整 |
| aggregate readiness check | internal verifier `gate:release:full` | aggregate-only 复核已有 campaign evidence，不执行任何 suite |

说明：
1. `gate:default` 只覆盖默认业务链与治理门禁，以及它们自己的 targeted visual。
2. `lane:visual` 是 full visual 证据 owner，不能被 `gate:default` 代替，并且它承担 `visual_scene_catalog` 证据所有权。
3. `gate:release` / `lane:backend-real:release` 承担 backend-real product readiness `ux_trace_bundle` 证据所有权。
4. unified deploy 的 `local-kind` 与 `existing-cluster` 是同一部署模型的 profile；这些命令保留为 transition-only focused diagnostics / 过渡期专项诊断，不属于默认 product readiness campaign。route smoke 不能替代 focused product-flow 诊断，也不是 release-kit 职责归属证明。
5. Post-deploy product smoke handoff 只消费 downloaded `agentsmith-release-contract.json`、同一 deployed target 的 site env / substrate truth 与该目标的 `<ga-smoke-evidence-root>`，然后把 finalized report 交给 release-kit；final GA 至少需要 online 和 airgap 两个目标各一份 report；不要把该 lane 加回默认 `product:ready` / release-full。
6. 如果某条 focused 测试、targeted lane 或 backend-real 局部命令通过，只能说明对应诊断切片恢复了，不能替代 `npm run product:ready`。

### 4. CI Green 的含义（机器可读报告）

CI green 不是完整 product-side readiness sign-off：

1. PR 默认 CI 代表 `gate:fast` 和 `gate:default` 对应的内部 CI surfaces 通过。
2. `lane:visual` 只在手动 workflow dispatch 且 opt-in `run_visual_lane` 时运行，并且在 CI 图里只依赖 `gate:fast`，不需要等待 `gate:default` 才开始。
3. `lane-backend-real-core` 仍然是手动 dispatch，并且依赖 backend-real secret。
4. 当前 AgentSmith product-side readiness 仍然必须看 `npm run product:ready` 产生的 campaign evidence、`lane:visual`、backend-real product readiness、aggregate readiness check 与 `summary.md`。

## 当前证据路径

### Official Campaign-Scoped Machine-Readable Reports

`npm run product:ready` 通过 precheck 后会产生 canonical product readiness evidence root：

```text
artifacts/release-runs/<campaign-run-id>
```

在下面示例里用 `<campaign-root>` 表示这个目录。当前 AgentSmith readiness 结论必须优先看 campaign-scoped evidence，而不是看 standalone lane 上一次留下的默认 artifacts。

- aggregate readiness check：
  - `<campaign-root>/gate-release-full/result.json`
  - `<campaign-root>/gate-release-full/evidence.json`
- release summary：
  - `<campaign-root>/summary.json`
  - `<campaign-root>/summary.md`
  - `artifacts/release-runs/latest.json`
- full visual scene catalog and product readiness campaign visual evidence：
  - `e2e/visual-baseline-support.ts`
  - `e2e/__screenshots__/visual.spec.ts`
  - `<campaign-root>/lane-visual/native/result.json`
  - `<campaign-root>/lane-visual/evidence.json`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/automated-pass.md`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/review.md`（独立 UX/UI review runbook）
- backend-real product readiness review and trace evidence：
  - `<campaign-root>/gate-release/native/result.json`
  - `<campaign-root>/gate-release/evidence.json`
  - `<campaign-root>/gate-release/backend-real-visual/review.md`
  - `<campaign-root>/gate-release/backend-real-visual/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
  - `<campaign-root>/gate-release/backend-real-visual/ux-traces`

`gate:release:full` 会按当前 `CURRENT_VERIFICATION_CAMPAIGN_MANIFEST` 的 `evidenceChecks` 重新计算这些证据是否存在，并校验 wrapper/native `result.json` 的 `schema_version`、`gate_id`、`line_kind`、`gate_adapter.npm_script`、`evidence_dir` 和 `failure_class`。旧格式 `evidence.json` 只写 dummy `required_paths`，或者缺少当前 required check id，都不能得到绿色 product readiness 结论。

### Standalone Lane Evidence

下面路径只表示单独运行某个 lane/gate adapter 时的默认产物位置，可用于诊断或人工查看；它们不能替代 `npm run product:ready` 产生的 campaign-scoped evidence。

- standalone backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces`
- standalone unified deploy evidence：
  - `artifacts/unified-deploy/`
  - transition-only focused diagnostics / 过渡期专项诊断由 [Unified Deploy Operations](./unified-deploy-operations.md) 维护，不在 product readiness checklist 里复制命令
  - existing-cluster smoke remains standalone/operator-scoped; deployment/package/operator conclusion belongs to release-kit repo-local gate/evidence

## 当前 Story Evidence 真相（机器可读报告）

- `visual_scene_catalog`
  - owner: `test:visual`, `lane:visual`
  - source: `e2e/visual-baseline-support.ts`
- `ux_trace_bundle`
  - owner: `gate:release`, `lane:backend-real:release`
  - product readiness campaign root: `<campaign-root>/gate-release/backend-real-visual/ux-traces`
  - standalone diagnostic root: `artifacts/backend-real-visual/<run-id>/ux-traces`

## 失败时的处理原则

如果门禁失败：
1. 只修阻塞 product readiness / handoff 的问题。
2. 不顺带扩新功能。
3. 如果是 visual 差异，先确认是否为真实 UX/UI 变更。
4. 只有在页面行为正确且变更合理时才更新基线。
5. 先判断这是 automated readiness check 失败、evidence 缺失，还是手工联调失败；不要把不同层次的问题混成同一条结论。
6. focused 诊断命令只用于缩小范围；当前仍要回到 automated product readiness campaign 重新给出结论。

## 当前结论模板

当前 AgentSmith product-side readiness 结论只允许两种：
- `ready for handoff`
- `not ready for handoff`

如果 `not ready for handoff`，必须同时列出：
1. 阻塞项。
2. 失败命令或 failing internal adapter id。
3. 最小修复方向。
