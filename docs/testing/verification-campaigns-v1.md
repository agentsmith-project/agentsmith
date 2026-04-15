# Verification Campaigns v1

Last updated: 2026-04-14
Status: `current reference`

这份文档把当前仓库已经存在的 engineering governance、gate manifest、result schema、user story contract、visual policy 收束成一套**对人类可执行**的 testing 说明。

它的定位是：
- 帮开发者理解“什么时候该跑哪一层验证”
- 解释 release-grade automated verification campaign 应该怎么执行
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
- `lane:visual` 是唯一 full visual owner
- `gate:default` 只可能包含 targeted visual，不拥有 full visual

补充目录说明：
- [测试与证据目录模型](../user-guides/test-and-evidence-directory-model.md)

## 2. 这份文档适用于什么场景

这份文档讲的是 **release-grade automated verification campaign**。

它不是日常默认开发路径。日常开发通常只需要：
- 当前改动相关的 type / contract / unit
- 当前改动相关的 integration 或 targeted e2e
- 必要时补跑相关 domain gate

你应该使用这份文档的情况：
- 大范围重构后，想确认没有系统级回归
- 发布前，需要跑完整 automated verification
- 某个 incident 修复后，需要做跨层复验
- 涉及 notebook / terminal / files / governance / backend-real / visual 等跨域链路调整

## 3. 诊断路径 vs verdict 路径

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

这些命令很重要，但它们主要服务于排查和收敛，不是最终 release verdict。

### verdict 路径

verdict 路径的目标是：**给出当前变更是否可接受的正式判断**。

当前 automated verdict 以这些命令为主：
- `npm run gate:fast`
- `npm run gate:default`
- `npm run gate:release`
- `npm run gate:release:full`

其中：
- `gate:default` 不是 full visual，也不是 full release
- `lane:visual` 是 full visual 的唯一 owner
- `gate:release` 不替代 `lane:visual`
- `gate:release:full` 才是当前 automated release-grade 最终 verdict

结论：
- 诊断路径可以帮助你修问题
- verdict 路径负责给出最后结论
- 不能用前者代替后者，也不应该每修一个小问题就直接从头跑到 `gate:release:full`

## 4. 当前 campaign taxonomy

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

当前核心门禁：
- `npm run gate:fast`
- `npm run gate:default`
- `npm run gate:release`
- `npm run gate:release:full`

适合：
- 合并前验收
- 跨域改动后的正式确认

### C. 验证通道

用途：
- 跑一条有独立真相源和独立证据义务的验证路径

当前核心验证通道：
- `npm run lane:mock`
- `npm run lane:visual`
- `npm run lane:backend-real:core`
- `npm run lane:backend-real:release`
- `npm run lane:demo-rehearsal`
- `npm run lane:cluster-rehearsal`

理解方式：
- `lane:visual` 证明 full visual
- backend-real lanes 证明真实环境行为与 trace evidence

### D. 发布级 automated verification campaign

用途：
- 在自动化范围内给出 release-grade 最终 verdict

当前应以现有 gate / lane 组合理解，而不是发明新的 machine-readable campaign id：
1. 先完成当前改动所需的诊断路径
2. 再完成 `gate:fast`
3. 再完成 `gate:default`
4. 再完成 `lane:visual`
5. 再完成 `gate:release`
6. 再完成 `lane:demo-rehearsal` 与 `lane:cluster-rehearsal`
7. 最终以 `gate:release:full` 收口

手工 Feishu 操作位于 [Release Readiness Checklist](../user-guides/release-readiness-checklist.md) 的 operator 流程中，不属于这份文档定义的 automated campaign 默认范围。

## 5. 证据完整性和命令通过同等重要

对 evidence-owning gate 和 lane 来说，`command passed` 不等于“真的通过”。

必须同时满足：
- 命令通过
- canonical machine-readable evidence 生成完整
- 对当前已注册 writer 的 gate/lane，canonical `result.json` 写到了正确 evidence root

当前关键证据关系：

1. `visual_scene_catalog`
- owner: `test:visual` / `lane:visual`
- canonical linkage 见 gate manifest contract

2. `ux_trace_bundle`
- default-tier owner: `test:backend-real:core` / `lane:backend-real:core`
- release-tier owner: `gate:release` / `lane:backend-real:release`

3. `result.json`
- canonical truth 见 [Current Gate Result Schema Contract](../contracts/current-gate-result-schema-contract.md)
- 仅对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的 gate/lane 生效
- 位置必须是 `<evidence_dir>/result.json`

如果证据应该存在但不存在，不能把它当成“只是少了附件”。
对声明了 blocking tier 的 gate，这属于正式失败。

## 6. story truth 与 story evidence 的关系

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

## 7. visual baseline 更新准入

visual baseline 更新不是“修测试”，而是一个受控审查动作。

当前规则来自：
- [Visual Baseline Policy v1](./visual-baseline-policy-v1.md)
- [视觉基线审查与交付规范 v1](../UXUI/00-设计系统/视觉基线审查与交付规范-v1.md)

执行顺序应该是：

1. 先跑 `npm run lane:visual`
2. 如果失败，先看截图、trace、相关页面代码
3. 判断差异是：
- 产品/样式回归
- 预期的 UX/UI 改进
- 环境噪音或错误基线
4. 只有确认是**预期改动**，才更新 baseline
5. 更新后必须重新跑 visual lane

禁止的做法：
- 不看图就更新 baseline
- 把 snapshot update 当成修复手段
- 用“解释上说得通”代替截图审查
- 把 `gate:default` 当成 full visual 替代品

## 8. 失败分类后的下一动作

这里要区分两层：

1. gate-level verdict field
- canonical `failure_class` 看 result schema contract

2. 实际排查动作
- 这份文档只给出推荐动作，不修改 schema

推荐对应关系：

| `failure_class` | 含义 | 推荐下一动作 |
| --- | --- | --- |
| `product_regression` | 产品行为、交互、文案、视觉、story 执行结果与预期不一致 | 先补失败测试或收紧现有断言，再修实现；修完先重跑最小切片 |
| `infra_setup_failure` | 环境、依赖、bootstrap、service readiness 没准备好 | 先修环境或 bootstrap，不继续向后跑 release-grade campaign |
| `environment_conflict` | 端口、runtime line、ownership、残留进程、共享状态冲突 | 先处理冲突与残留，再回到当前 wave；不要带病继续 |
| `contract_drift` | manifest / docs / generated contract / gate alignment 漂移 | 先修 truth source 与同步面，再重跑受影响层 |
| `evidence_missing` | 应该生成的 review、trace、catalog、result 没有完整落盘 | 先查 evidence root、writer、artifact path、run-root，再重跑 evidence owner |
| `none` | 当前 gate 没有失败 | 继续向下一层 verdict path 推进 |

## 9. 给经验较少开发者的执行步骤

如果你第一次负责一次较大的验证活动，按这个顺序做：

1. 先判断这次是不是 release-grade automated verification
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

4. 只在需要 full visual 时跑 `lane:visual`
- 不是所有改动都要第一步就跑 visual
- 但 release-grade campaign 最终必须看它

5. backend-real 与 release gate 分开理解
- `test:backend-real:core` / `lane:backend-real:core` 更像默认层真实验证
- `gate:release` / `lane:backend-real:release` 才是 release-grade backend-real 义务

6. 最后才看 `gate:release:full`
- 它是最终 automated verdict
- 不要把它当成第一轮问题定位工具

## 10. 常见误区

1. `gate:default` 过了，就等于发布可接受
- 错。它不拥有 full visual，也不是 full release verdict

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

## 11. 如何把这份文档和其他入口一起使用

如果你想：

### 理解 testing / gate / evidence 原则
先看：
- [Current Engineering Governance Model](../current-engineering-governance-model.md)
- [Current Gate Manifest Contract](../contracts/current-gate-manifest-contract.md)
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
