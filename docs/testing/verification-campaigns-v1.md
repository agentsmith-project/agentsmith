# Verification Campaigns v1

Last updated: 2026-04-14
Status: `current reference`

这份文档把当前仓库已经存在的 engineering governance、gate manifest、result schema、user story contract、visual policy 收束成一套**对人类可执行**的 testing 说明。

它的定位是：
- 帮开发者理解“什么时候该跑哪一层验证”
- 解释 AgentSmith product-side readiness campaign 应该怎么执行
- 说明证据、story、visual、gate verdict 之间的关系

它**不**做下面这些事：
- 不发明新的 gate、line、story、evidence truth
- 不替代 [Current Engineering Governance Model](../current-engineering-governance-model.md)
- 不替代 [Current Gate Manifest Contract](../contracts/current-gate-manifest-contract.md)
- 不替代 [Current Gate Result Schema Contract](../contracts/current-gate-result-schema-contract.md)
- 不替代 [User Story Contract v1](../contracts/user-story-contract-v1.md)
- 不替代 [Release Readiness Checklist](../user-guides/release-readiness-checklist.md)

## 1. 先理解什么是“真相”

当前 testing / verification 真相源按职责分层：

1. 工程治理总则
- [Current Engineering Governance Model](../current-engineering-governance-model.md)
- 说明 top-level workflow terms、gate ownership、visual ownership、backend-real ownership、runtime baseline

2. 门禁与验证通道真相
- [Current Gate Manifest Contract](../contracts/current-gate-manifest-contract.md)
- 稳定 gate identity 看 `id`，不是 launcher string
- 哪个 gate 拥有 targeted visual、full visual、backend-real、story evidence，看 manifest
- canonical command inventory 同步面看 `scripts/governance/current-workflow-manifest.ts`

3. gate verdict 与 `result.json`
- [Current Gate Result Schema Contract](../contracts/current-gate-result-schema-contract.md)
- 对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的 gate/lane，canonical `result.json` 位置固定是 `<evidence_dir>/result.json`
- canonical `failure_class` 只能用 schema 里定义的枚举

4. user story 真相
- [User Story Contract v1](../contracts/user-story-contract-v1.md)
- canonical truth 是 `e2e/stories/backend-real/*.story.md` 与 `e2e/stories/mock-lane/*.story.md`
- generated specs、trace bundles、review artifacts 都是 derived artifacts，不是 story truth

5. visual 证据规则
- [Visual Baseline Policy v1](./visual-baseline-policy-v1.md)
- `lane:visual` 是 internal full visual evidence owner
- `gate:default` 只可能包含 targeted visual，不拥有 full visual

补充目录说明：
- [测试与证据目录模型](../user-guides/test-and-evidence-directory-model.md)

## 2. 这份文档适用于什么场景

这份文档讲的是 **AgentSmith product-side readiness / handoff input completeness campaign**。

它不是日常默认开发路径。日常开发通常只需要：
- 当前改动相关的 type / contract / unit
- 当前改动相关的 integration 或 targeted e2e
- 必要时补跑相关 domain gate

你应该使用这份文档的情况：
- 大范围重构后，想确认没有系统级回归
- 发布前，需要跑完整 AgentSmith product-side readiness verification
- 某个 incident 修复后，需要做跨层复验
- 涉及 notebook / terminal / files / governance / backend-real / visual 等跨域链路调整

## 3. gate / lane / e2e / campaign 的关系

直白理解：

- `e2e` 是验证手段，回答“怎么测”。当前仓库通常用 Playwright 从用户视角走完整流程。
- `lane` 是验证通道，回答“在哪条真相路径下测”。例如 `lane:mock`、`lane:visual`、`lane:backend-real:release`。
- `gate` 是验收裁决，回答“这一层是否算通过”。稳定 gate identity 看 `current-gate-manifest.ts` 里的 `id`。
- `campaign` 是围绕一个目标组织的一组动作，例如 AgentSmith product-side readiness verification。campaign 消费 gate / lane truth，不发明第二套 gate。
- `diagnostic` 是定位路径，目标是更快找到失败层。
- `verdict` 是正式结论，必须同时看命令结果和 required evidence completeness。

最容易混淆的点：

- 一个 lane 里可以跑 e2e，但 lane 不是 e2e。
- 一个 gate 可以消费 lane 结果，也可以直接跑某些 tests，但 gate 的本质是 verdict。
- `lane:mock` 是 current workflow 里的 diagnostic lane surface；它有价值，但不是 product readiness evidence。
- `npm run product:ready` 是面向人的 product-side readiness / handoff input completeness 入口；`npm run product:status` 是只读状态入口。`npm run release:ready` / `npm run release:status` 只是 deprecated transition aliases / 过渡 alias，不给 deployment、package 或 operator verdict。`release:campaign:full` 只作为 `product:ready` 后面的 internal adapter identity 出现，`gate:release:full` 只是在 campaign context 内做 aggregate-only readiness check，不执行任何 suite。

## 4. 诊断路径 vs verdict 路径

这是最容易被新人搞混的一件事。

### 诊断路径

诊断路径的目标是：**更快定位问题**。

它通常包含：
- 单项 contract / type / unit / integration 测试
- 当前 domain 的 Playwright spec
- `test:default-e2e`
- `test:governance`
- `test:backend-real:core`
- 某个 notebook/files/skills/runner 的 backend-real 或 fast suite

这些命令很重要，但它们主要服务于排查和收敛，不是最终 product readiness 结论。

### verdict 路径

verdict 路径的目标是：**给出当前变更是否可接受的正式判断**。

当前人类可复制 verdict 入口只保留 clean surface：
- `npm run verify`（dry-run plan）
- `npm run verify -- --goal=pr --run`
- `npm run verify -- --goal=real --run`
- `npm run verify -- --goal=visual --run`
- `make local-real-up` / `make local-real-status` / `make local-real-down` / `make local-real-reset`
- `npm run product:ready`
- `npm run product:status`
unified deploy 的 producer 命令只保留为 transition-only focused diagnostics / 过渡期专项诊断；
当前 AgentSmith product readiness campaign 不编排 unified deploy，也不把
local-kind / product-flow deploy evidence 作为 product readiness 必需证据。
这些命令仅在 owner 排障时显式执行，不作为普通人类 verdict 入口。

底层 diagnostics / internal identity 仍然看 current manifests 和 owner runbooks，例如 `test:*`、`gate:*`、`lane:*`、`backend-real:*`、unified deploy producers、`release:campaign:full` 和 `gate:release:full`。这些 identity 可以用于证据所有权、排障归因和 aggregate verification 描述，但不作为 verification campaign guide 的 copyable/default command surface。

其中：
- `gate:default` 不是 full visual，也不是 product readiness 结论
- `lane:visual` 是 full visual 的 internal evidence owner
- `gate:release` 不替代 `lane:visual`
- `product:ready` 先跑非 verdict precheck，precheck 失败时不进入 campaign、也不写 product readiness 结论
- internal adapter `release:campaign:full` 编排 product-side readiness required steps，并在最后调用 aggregate-only 的 `gate:release:full`
- `gate:release:full` 只能在显式 campaign root / run id context 下复核已有 evidence，不是日常执行入口

结论：
- 诊断路径可以帮助你修问题
- verdict 路径负责给出最后结论
- 不能用前者代替后者，也不应该每修一个小问题就直接从头跑完整 `product:ready`

## 5. 当前 campaign taxonomy

这里的 taxonomy 是**对现有治理真相的解释**，不是新增一套 gate truth。

### A. 单项测试

用途：
- 验证一个明确范围，例如某个 Vitest suite、某个 Playwright spec、某个 shell check

典型例子：
- `npm run contracts:check`
- `npx tsc --noEmit`
- `npm run test:run`
- `npm run test:integration`

适合：
- 日常开发
- TDD
- 根因定位

### B. 工程门禁

用途：
- 作为必须通过的工程验收捆绑检查

当前核心门禁 identity：
- `gate:fast`
- `gate:default`
- `gate:release`
- internal verifier `gate:release:full`（aggregate-only，必须已有 campaign context）

适合：
- 合并前验收
- 跨域改动后的正式确认

### C. 验证通道

用途：
- 跑一条有独立真相源和独立证据义务的验证路径

当前核心验证通道 identity：
- `lane:mock`
- `lane:visual`
- `lane:backend-real:core`
- `lane:backend-real:release`
- unified deploy producers for substrate reset, local-kind image handoff, local-kind rollout, explicit existing-cluster smoke when in scope, and focused product-flow diagnostics

理解方式：
- internal adapter `lane:visual` 拥有 full visual evidence；release 外 full visual verification 用 `npm run verify -- --goal=visual --run`
- backend-real lanes 证明真实环境行为与 trace evidence

### D. AgentSmith product-side readiness campaign

用途：
- 在自动化范围内给出 AgentSmith product-side readiness / handoff input completeness 结论

当前应按角色理解，而不是在多份文档里各自维护一套冲突顺序：

| Role | Surface | What it proves |
| --- | --- | --- |
| human visual entry | `npm run verify -- --goal=visual --run` | release 外 full visual verification |
| human product readiness entry | `npm run product:ready` | 先执行非 verdict precheck，precheck 通过后进入 official campaign |
| read-only status | `npm run product:status` | 读取 latest summary / status，不重新聚合 evidence |
| deploy diagnostic | unified deploy producers | transition-only focused diagnostics / 过渡期专项诊断 for local-kind image handoff、K8s rollout、ingress route smoke；不属于当前 AgentSmith product readiness 必需证据 |
| deploy smoke diagnostic | `npm run test:unified-deploy:existing-cluster-smoke` | target cluster in scope 时显式执行 existing-cluster app apply、rollout、route ownership smoke |
| product diagnostic | focused `npm run test:unified-deploy:product-flows` | deploy profile 上的 canonical seven-flow deployed product smoke matrix；仍是 transition-only focused diagnostic，不属于当前 AgentSmith product readiness 必需证据 |
| campaign launcher | internal adapter `release:campaign:full` | official campaign launcher，编排所有 required steps 并调用 aggregate readiness check |
| preflight | internal adapter `gate:fast` | 快速确认基础 contract / static / cheap checks 没先坏 |
| tier verdict | internal adapter `gate:default` | 默认工程层是否可接受 |
| evidence owner | internal adapter `lane:visual` | full visual 和 `visual_scene_catalog` 证据 |
| evidence owner | internal adapter `gate:release` / `lane:backend-real:release` | backend-real product readiness 与 `ux_trace_bundle` 证据 |
| aggregate readiness check | internal verifier `gate:release:full` | aggregate-only 聚合已有 campaign evidence，不执行任何 suite |

`npm run product:ready` 是 AgentSmith product-side readiness / handoff input completeness 的人类入口；release 外 full visual verification 用 `npm run verify -- --goal=visual --run`。internal adapter `release:campaign:full` 必须消费同一组 role 和 evidence truth；不能绕过这些 owner 自己发明 readiness 判断。`gate:release:full` 如果没有 campaign context，就不应该被新人当作 release 执行入口。

## 6. 证据完整性和命令通过同等重要

对 evidence-owning gate 和 lane 来说，`command passed` 不等于“真的通过”。

必须同时满足：
- 命令通过
- canonical machine-readable evidence 生成完整
- 对当前已注册 writer 的 gate/lane，canonical `result.json` 写到了正确 evidence root
- terminal aggregate verifier 按当前 `CURRENT_VERIFICATION_CAMPAIGN_MANIFEST.evidenceChecks` 重新计算 evidence completeness
- campaign wrapper result、native result 和 `evidence.json` 的 `step_id` / `gate_id` / `line_kind` / `gate_adapter.npm_script` / `evidence_dir` 必须与当前 campaign step 匹配

当前关键证据关系：

1. `visual_scene_catalog`
- owner: `test:visual` / `lane:visual`
- canonical linkage 见 gate manifest contract
- product readiness campaign automated evidence:
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/automated-pass.md`
- standalone UX/UI review runbook artifact:
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/review.md`

2. `ux_trace_bundle`
- default-tier owner: `test:backend-real:core` / `lane:backend-real:core`
- product readiness owner: `gate:release` / `lane:backend-real:release`
- product readiness campaign trace root: `<campaign-root>/gate-release/backend-real-visual/ux-traces`

3. `result.json`
- canonical truth 见 [Current Gate Result Schema Contract](../contracts/current-gate-result-schema-contract.md)
- 仅对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的 gate/lane 生效
- 位置必须是 `<evidence_dir>/result.json`

如果证据应该存在但不存在，不能把它当成“只是少了附件”。
对声明了 blocking tier 的 gate，这属于正式失败。

## 7. story truth 与 story evidence 的关系

这是第二个最容易被误解的点。

### story truth

story truth 是：
- `e2e/stories/backend-real/*.story.md`
- `e2e/stories/mock-lane/*.story.md`

story markdown 不是说明文，它是可执行 contract。

### derived artifacts

下面这些都不是 truth source：
- `e2e/generated/story-specs.generated.json`
- `artifacts/` 里的 trace bundles
- backend-real visual review records

它们只是由 canonical story truth 投影出来的证据或缓存。

### story evidence

story evidence 仍然是 gate truth 的一部分。

意思是：
- story markdown 定义“应当发生什么”
- gate manifest 定义“哪条 gate 必须产出哪些 story-related evidence”
- artifacts 记录“实际发生了什么”

不要把 generated specs 当真相，也不要把 trace bundle 当真相。

## 8. visual baseline 更新准入

visual baseline 更新不是“修测试”，而是一个受控审查动作。

当前规则来自：
- [Visual Baseline Policy v1](./visual-baseline-policy-v1.md)
- [视觉基线审查与交付规范 v1](../UXUI/00-设计系统/视觉基线审查与交付规范-v1.md)

执行顺序应该是：

1. 先用 `npm run verify -- --goal=visual --run` 生成或复核视觉证据；internal evidence owner 是 `lane:visual`
2. 如果失败，先看截图、trace、相关页面代码
3. 判断差异是：
- 产品/样式回归
- 预期的 UX/UI 改进
- 环境噪音或错误基线
4. 只有确认是**预期改动**，才更新 baseline
5. 更新后必须重新跑相同 visual clean entrypoint

禁止的做法：
- 不看图就更新 baseline
- 把 snapshot update 当成修复手段
- 用“解释上说得通”代替截图审查
- 把 `gate:default` 当成 full visual 替代品

## 9. 失败分类后的下一动作

这里要区分两层：

1. gate-level verdict field
- canonical `failure_class` 看 result schema contract

2. 实际排查动作
- 这份文档只给出推荐动作，不修改 schema

推荐对应关系：

| `failure_class` | 含义 | 推荐下一动作 |
| --- | --- | --- |
| `product_regression` | 产品行为、交互、文案、视觉、story 执行结果与预期不一致 | 先补失败测试或收紧现有断言，再修实现；修完先重跑最小切片 |
| `infra_setup_failure` | 环境、依赖、bootstrap、service readiness 没准备好 | 先修环境或 bootstrap，不继续向后跑 product readiness campaign |
| `environment_conflict` | 端口、runtime line、ownership、残留进程、共享状态冲突 | 先处理冲突与残留，再回到当前 wave；不要带病继续 |
| `contract_drift` | manifest / docs / generated contract / gate alignment 漂移 | 先修 truth source 与同步面，再重跑受影响层 |
| `evidence_missing` | 应该生成的 review、trace、catalog、result 没有完整落盘 | 先查 evidence root、writer、artifact path、run-root，再重跑 evidence owner |
| `none` | 当前 gate 没有失败 | 继续向下一层 verdict path 推进 |

## 10. 给经验较少开发者的执行步骤

如果你第一次负责一次较大的验证活动，按这个顺序做：

1. 先判断这次是不是 AgentSmith product-side readiness verification
- 如果只是小改动，不要直接跑完整 campaign
- 如果是跨域改动、发布前验证、incident 复验，再进入下面流程

2. 先跑低成本诊断
- contract
- typecheck
- unit
- 当前改动相关 integration

3. 发现失败就先停在当前层
- 不要一边红一边继续往后跑
- 先定位、先修、先在最小切片复现

4. 只在 release 外需要 full visual 时跑 `npm run verify -- --goal=visual --run`
- 不是所有改动都要第一步就跑 visual
- product-side readiness / handoff verification 用 `npm run product:ready`

5. backend-real 与 release gate 分开理解
- `test:backend-real:core` / `lane:backend-real:core` 更像默认层真实验证
- `gate:release` / `lane:backend-real:release` 才是 backend-real product readiness 义务

6. 发布级人类入口看 `npm run product:ready`
- 它先执行 non-verdict precheck，再调用 official one-shot product readiness campaign
- campaign 会在 context 内调用 aggregate-only 的 `gate:release:full`
- 不要把 `gate:release:full` 当成第一轮问题定位工具或 suite launcher

## 11. 常见误区

1. `gate:default` 过了，就等于发布可接受
- 错。它不拥有 full visual，也不是 product readiness 结论

2. visual diff 可以靠更新 baseline 解决
- 错。先审图、审代码、审 story / scene 绑定

3. generated story specs 比 story markdown 更“结构化”，所以它才是真相
- 错。generated 只是投影缓存

4. backend-real:core 和 gate:release 没差别
- 错。它们的 tier、evidence obligation、结论用途都不同

5. 只要命令 exit code 是 0 就算通过
- 错。evidence-owning gate 还必须有完整证据

6. README 或 checklist 上的命令顺序就是唯一工程真相
- 错。machine-readable manifests 与 contracts 才是 enforcement truth

## 12. 如何把这份文档和其他入口一起使用

如果你想：

### 理解 testing / gate / evidence 原则
先看：
- [Current Engineering Governance Model](../current-engineering-governance-model.md)
- [Current Gate Manifest Contract](../contracts/current-gate-manifest-contract.md)
- [Diagnostic Catalog v1](./diagnostic-catalog-v1.md)
- 这份文档

### 找 canonical result / story / visual 规则
看：
- [Current Gate Result Schema Contract](../contracts/current-gate-result-schema-contract.md)
- [User Story Contract v1](../contracts/user-story-contract-v1.md)
- [Visual Baseline Policy v1](./visual-baseline-policy-v1.md)

### 真正执行 release operator 流程
看：
- [Release Readiness Checklist](../user-guides/release-readiness-checklist.md)

### 查证据目录
看：
- [测试与证据目录模型](../user-guides/test-and-evidence-directory-model.md)
