# 治理验证运行耗时优化收敛计划 v1

<!-- markdownlint-disable MD013 -->

Status: `development_handoff_ready`
Date: 2026-05-18
Owner: Engineering governance maintainers

## 1. 目标和边界

本计划只做一件事：在同一次正式验证或发布准备运行里，减少重复准备，不减少安全检查。

它不改变发布结论来源，不新增公开命令，也不新增普通开发者需要学习的新治理概念。发布结论仍只来自本次正式报告目录里的证据；同一次命令里的内部运行标记只用于防误用和摘要说明，不能当作发布通过依据。

本计划是 [`governance-release-flow-simplification-plan-v3.md`](./governance-release-flow-simplification-plan-v3.md) 的收敛补充，不推翻 v3 已受 contract/doc checks 保护的 release-owned API/Web/deps 边界。实施时必须同步相关 contracts/docs，防止 v3 和本计划对同一 release 边界给出相互冲突的说法。

开发团队开工前只需要确认三件事：

- 现有公开入口保持不变。
- 普通公开收口目标只推荐 `pr`、`real`、`visual`。
- 没有本次正式证据证明的内容，一律保持不确定并由消费者继续执行自己的 contract 或 preflight。

## 2. 入口怎么选

普通使用者只需要看这一节。所有后续切片都必须保持这些公开入口和语义不变。

| 入口 | 什么时候用 | 执行语义 |
| --- | --- | --- |
| `npm run verify` | 想先看建议跑什么、影响哪些检查 | 生成检查建议和 dry-run 报告，不执行检查，不代表通过 |
| `npm run verify -- --goal=pr --run` | 日常 PR 收口、非发布级改动验收；UI 小改、组件改、页面局部改动先跑受影响 focused visual 场景后用此入口收口 | 执行 PR 级检查，允许在同轮内跳过重复基础准备；focused visual 只是局部证据，不新增公开入口 |
| `npm run verify -- --goal=real --run` | 改到真实后端、认证、权限、运行环境或需要 backend-real 证据 | 保留真实后端检查和 preflight |
| `npm run verify -- --goal=visual --run` | design-system、全局 token、布局框架、整页级/跨模块视觉风险，或最终需要完整视觉验收 | 执行 full visual，不用 focused visual 替代；如果检查建议或故事策略同时要求 backend-real，还必须跑 `real` |
| `npm run release:ready` | 发布前、部署前、发布候选需要签署时 | 执行发布准备总检查，保留 full visual、backend-real、unified deploy 和核心产品流程证据 |
| `npm run release:status` | 只想看上一次发布准备结果 | 只读展示，不重新检查 |
| `make local-real-up`<br>`make local-real-status`<br>`make local-real-down`<br>`make local-real-reset` | 管理本地真实环境 | 语义不变，不替代验证或发布结论 |

`debug`、`release-real` 和 `npm run verify:*` alias 只作为维护者诊断或内部命令，不作为普通开发者收口入口。`run-verify` 面向普通用户的 dry-run 建议、失败摘要、人读输出和可复制下一步只能推荐上表入口；内部 alias 只留在维护者诊断路径或明确内部的机器可读调试产物里，不能重新暴露为普通推荐命令。

不要新增任何公开 release 入口。

## 3. Visual 选择规则

Visual 只有两类心智：

- Focused visual 是局部证据。它适合 UI 小改、组件改、页面局部改动后的快速确认；收口口径是“受影响 focused visual 场景 + PR goal”。如果没有相关视觉改动，focused visual 可以不跑。
- Full visual 是完整视觉验收。design-system、全局 token、布局框架、整页级改动、跨模块视觉风险、最终视觉验收，至少必须升级到 full visual；如果检查建议或故事策略同时要求 backend-real，也必须跑 real，不能用视觉收口降低治理质量。

选择规则：

| 改动类型 | 推荐收口 |
| --- | --- |
| docs-only 或 env-only | 不触发 full visual，也不触发 backend-real visual |
| 纯逻辑、类型、脚本且无真实后端风险 | `npm run verify -- --goal=pr --run` |
| UI 小改、组件改、页面局部改动 | 受影响 focused visual 场景 + `npm run verify -- --goal=pr --run` |
| design-system、全局 token、布局框架、整页级/跨模块视觉风险、最终视觉验收 | 至少 `npm run verify -- --goal=visual --run`；如果检查建议或故事策略要求 backend-real，还要跑 `npm run verify -- --goal=real --run` |
| 真实后端、认证、权限、运行环境 | `npm run verify -- --goal=real --run` |
| 发布收口或发布候选签署 | `npm run release:ready` |

实现上不能用空选择、宽 grep 或降低 screenshot diff 标准换取通过。Focused visual 必须证明“应该跑的视觉场景”和“实际跑到的视觉场景”一致；full visual 必须覆盖现有完整视觉场景清单。

`npm run release:ready` 已经属于发布准备总检查，应保留 full visual。开发者已经跑过 focused visual，也不能因此跳过发布路径里的 full visual。

## 4. 可减少与必须保留

| 可减少的重复准备 | 必须保留的安全重复检查 |
| --- | --- |
| 同一次命令内重复的基础准备启动、等待和摘要噪音 | terminal aggregate revalidation |
| 执行层已经有 env hint 证明同轮完成过的重复基础准备 | rollout image preflight |
| 发布前快速观测结果在摘要里重复解释 | route smoke before product flows |
| 同轮 focused visual 场景选择的重复 grep/list 噪音 | 消费者自己的 contract/preflight |

这张表是第一批收敛边界：可以少做重复准备，但不能把安全重复检查优化掉。

## 5. 第一批实施范围

第一批只做低风险收敛：

- `npm run verify -- --goal=<pr|real|visual> --run` 在执行层用 env hint 跳过同轮重复基础准备，不改变推荐命令语义。
- 内部运行标记只做命名字段只读校验和防误用，不做通用 cache。
- Focused visual 改为校验应跑场景和实跑场景一致，不新增第二套视觉场景目录。
- `npm run release:ready` 第一批只保留 precheck observation 和摘要展示；正式结论只看 release campaign step evidence。
- 部署路径第一批只允许 local-kind image handoff identity 注记，不跳过 image preflight、rendered manifest 校验或 product flows。
- 失败输出只保留结论、主要阻塞项、原因、下一步和报告路径；内部定位信息留在机器可读报告里。

当前不做：

- 不新增公开入口。
- 不做跨命令 cache/resume。
- 不把 focused visual 当成 full visual。
- 不做 precheck 到 `gate-release` 的跨阶段 API/Web/deps handoff/复用；不扩大、也不移除 `gate-release` 内已有 ownership-verified release-owned API/Web/deps 复用。
- 不跳过 terminal aggregate revalidation。
- 不跳过 rollout image preflight。
- 不跳过 route smoke before product flows。
- 不跳过发布路径里的 backend-real、unified deploy 或核心产品流程检查。
- 不新增 rollout 准备状态字段。
- 不做并行执行。

## 6. 开发切片

本节不是要求重建 A-E。开发团队先跑每个 slice 列出的 focused tests；只有测试失败、覆盖缺失或实现与本计划不一致时，才补测试或补实现。

| Slice | 已落地基线 | 只补缺口 | 明确不要重建 |
| --- | --- | --- | --- |
| A | verify 公开入口、impact selector、default gate 复用开关已有基线 | 核对同轮基础准备去重只影响重复准备和摘要噪音 | 不新增普通开发者目标，不改公开入口语义 |
| B | 内部运行标记防误用和准备状态已有基线 | 核对命名字段只读校验、跨命令失效、未知字段回退 | 不重建第二套运行标记，不让运行标记成为发布证据 |
| C | 现有视觉场景清单、focused visual 支持和 gate 路径已有基线 | 核对应跑场景和实跑场景一致，补缺失 selector 覆盖 | 不重建第二套 visual selector 或 focused 场景目录 |
| D | release campaign step evidence 与 precheck observation 已有基线 | 核对快速观测只进摘要、正式结论只看 step evidence | 不重建第二套 release evidence owner，不做 precheck 到 `gate-release` 的跨阶段 handoff |
| E | local-kind image、rollout、product-flow producer 已有基线 | 核对 handoff identity 只作诊断且安全检查仍执行 | 不新增 rollout 准备状态，不跳过 preflight、manifest 或 product flows |

### Slice A. Verify 同轮重复基础准备收敛

状态：实现核对/补缺。

目标：`npm run verify -- --goal=... --run` 在同一次运行里只跳过重复基础准备，不改变 `pr`、`real`、`visual` 的推荐命令语义和报告语义。

先跑以下 focused tests；只有失败或缺失时再补测试/实现：

- `scripts/governance/__tests__/verify-entrypoints.test.ts`
- `scripts/governance/__tests__/verify-impact-selector.test.ts`
- `scripts/default-gate.test.ts`

实现重点：

- 在执行层通过 env hint 表达“同轮基础准备已完成”，让后续步骤跳过重复启动、等待或摘要噪音。
- 不把目标选择逻辑改成新的公开语义，不新增普通开发者要理解的目标。
- 复用已有内部开关，例如 `DEFAULT_GATE_REUSE_FAST_EVIDENCE`、`WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL`、`GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL`。
- `npm run verify` 生成检查建议和 dry-run 报告，不执行检查，不代表通过。
- 保持 `run-verify` 普通用户输出不泄漏内部 alias：`debug`、`release-real` 和 `npm run verify:*` 可以保留在维护者诊断或明确内部的机器可读调试产物里，但不能作为普通推荐命令出现。

验收标准：

- `--goal=pr --run` 不重复做同轮基础准备，但保留需要执行的检查。
- `--goal=visual --run` 保留 full visual，不重复跑默认 focused visual。
- `--goal=real --run` 保留真实后端检查和 preflight。
- 普通用户可见的建议、摘要和失败下一步不推荐 `--goal=debug`、`--goal=release-real` 或 `npm run verify:*` alias。
- 报告仍写 `story-acceptance-report`、`verification-catalog` 和 pure check audit。

停止条件：

- 如果某项检查没有被其他正式检查覆盖，不能跳过。
- 如果去重后证据缺少正式归属，先补证据映射，不继续扩大复用。

### Slice B. 内部运行标记防误用

状态：实现核对/补缺。

目标：把同轮运行标记只作为内部防误用。这里的内部运行标记只表示“同一次本地运行里的命名标记”，不是通用 cache，也不是通过证据。

先跑以下 focused tests；只有失败或缺失时再补测试/实现：

- `scripts/governance/__tests__/run-readiness-state.test.ts`
- `scripts/governance/__tests__/verify-entrypoints.test.ts`
- `scripts/governance/__tests__/release-readiness-entrypoints.test.ts`

实现重点：

- 只允许命名字段只读校验，例如运行身份、git sha、既有 schema 支持的关键环境字段和明确的 handoff identity。
- 消费者仍执行自己的 contract/preflight；不能因为运行标记存在就跳过安全检查。
- 子流程不能获得写入运行标记的权限。
- 运行标记缺失、不匹配或字段未知时，消费者按原路径执行自己的检查。

验收标准：

- 运行标记文件明确标记 `release_authority: not_release_authority`。
- 摘要只展示防误用命中、不匹配和未知原因，不表达“本项已通过”。
- 重新执行同一公开命令不能读取上一次命令的运行标记作为通过依据。
- 任一运行身份或关键环境指纹不匹配时，不确定就继续执行消费者自己的检查或失败。

停止条件：

- 运行标记不能替代正式证据，不能写成发布通过依据。
- 不能写入 token、Project secrets、OAuth managed credentials、runner ticket 或原始 env dump。

### Slice C. Focused Visual 场景集合校验

状态：实现核对/补缺。

目标：focused visual 不再只验证 grep 非空，而是验证“应该跑的视觉场景”和“实际跑到的视觉场景”一致。

先跑以下 focused tests；只有失败或缺失时再补测试/实现：

- `scripts/visual-baseline-support.test.ts`
- `scripts/run-mock-lane-playwright.test.ts`
- `scripts/workspace-project-default-gate.test.ts`
- `scripts/governance-default-gate.test.ts`

实现重点：

- 应该跑的视觉场景只能来自现有视觉场景清单，或作为现有清单的受控字段维护。
- 运行前用 Playwright list 或现有视觉场景清单得到实际跑到的视觉场景。
- 实际跑到的视觉场景必须等于应该跑的 `scenarioId + theme` 场景。
- docs-only、env-only 不触发 full visual 或 backend-real visual。
- UI 小改、组件改、页面局部改动走受影响 focused visual 场景 + PR goal。
- design-system、全局 token、布局框架、整页级改动、跨模块视觉风险和最终视觉验收至少触发 full visual；如果检查建议或故事策略要求 backend-real，也必须跑 real。
- 缺失、多选、空选择都失败，并在摘要里列出差异。

验收标准：

- Workspace/project focused visual 覆盖明确的 `scenarioId + theme` 集合。
- Governance focused visual 锁定 members、resource policy、audit detail、alerts 等现有视觉场景清单里的场景集合。
- Full visual 路径仍要求完整现有视觉场景清单，不受 focused visual 局部场景影响。

停止条件：

- 如果无法稳定从列表输出解析 scenario，先补现有视觉场景清单支持。
- 不能新增第二套 focused visual 场景目录。

### Slice D. Release precheck observation 降噪

状态：实现核对/补缺。

目标：`npm run release:ready` 第一批只保留 precheck observation 和摘要展示。正式结论只看 release campaign step evidence，即发布总检查每个步骤在本次报告目录写出的正式证据。

先跑以下 focused tests；只有失败或缺失时再补测试/实现：

- `scripts/governance/__tests__/release-readiness-entrypoints.test.ts`
- `scripts/governance/__tests__/release-campaign-runner.test.ts`
- `scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts`

实现重点：

- 发布前快速观测只进入摘要展示，回答“是否可以开始发布准备总检查”。
- 快速观测不能交给后续 release 阶段作为准备状态或复用输入。
- 第一批不做 precheck 到 `gate-release` 的跨阶段 API/Web/deps handoff/复用。
- 不扩大、也不移除 v3 已定义的 `gate-release` 内 ownership-verified release-owned API/Web/deps 复用；本计划只要求它继续由 `gate-release` 内正式 step evidence 证明。
- 正式 release 阶段继续由 release campaign steps 产出证据。

验收标准：

- `release:ready` 摘要能区分发布前快速观测和正式 release step evidence。
- 发布结论只来自本次 release 报告目录正式引用的 step evidence。
- Full visual、backend-real、unified deploy、核心产品流程检查都在最终自动化发布结论中保留。

停止条件：

- 任何 release 证据缺失都不能被 precheck observation 补齐。
- 第一批不能扩大为 precheck 到 `gate-release` 的 API/Web/deps 跨阶段 handoff，也不能削弱 `gate-release` 内已有 ownership-verified 复用边界。

### Slice E. Local-kind image handoff identity 注记

状态：实现核对/补缺。

目标：部署演练第一批只允许记录 local-kind image handoff identity，帮助维护者确认同一次运行里“哪个 local-kind context/cluster/site env 交给了哪个 rollout 步骤”。它不是 image build/push/import 准备状态复用。

先跑以下 focused tests；只有失败或缺失时再补测试/实现：

- `scripts/unified-deploy/local-kind-rollout.test.ts`：handoff matched 仍运行 image preflight；mutable refs 仍失败；identity mismatch fallback/fail；rendered manifest digest/args 仍校验；product flows 仍执行。
- `scripts/unified-deploy/local-kind-images.test.ts`：immutable digest refs、mutable local-kind tags、local-kind preflight Deployment/Job images、rendered AFSCP Job command args 仍校验。
- `scripts/unified-deploy/product-flows.test.ts`：`workspace_project`、`files`、`agent_task_managed_runner` product flows 仍执行，失败依赖关系仍保留。
- `scripts/governance/__tests__/release-campaign-runner.test.ts`

第一批允许做：

- 记录 local-kind image handoff identity 时，运行标记只放现有支持的 context、cluster、site env digest 等字段。
- image digest、rendered manifest 和 rendered Job args 校验继续落在正式 rollout/image evidence，不迁移进运行标记 schema。
- identity 只用于诊断和防误用，不用于跳过后续安全检查。
- 资源归属不明确的 container、cluster、registry 只输出 inspect/recovery action，不自动清理。

必须保留：

- 保留 image preflight。
- 保留 rendered manifest 校验。
- 保留 route smoke before product flows。
- 保留 `workspace_project`、`files`、`agent_task_managed_runner` 等 product flows。
- Release 路径继续运行正式核心产品流程检查，并保留其证据。

验收标准：

- 部署演练报告可以定位 local-kind image handoff identity，但不声明跳过了 image preflight、rendered manifest 或 product flows。
- 镜像和 rendered Job contract 仍验证实际 digest/args。
- 运行标记 schema 不要求承载 image digest、rendered manifest 指纹或 rendered args；这些只由正式 rollout/image evidence 负责。
- 任一本次运行身份不匹配或缺本次正式证据时，按原路径继续执行检查或失败。

停止条件：

- 不能要求 rollout 或核心产品流程检查写当前运行标记 schema 未支持的字段，尤其不能为了 handoff identity 迁移 image digest、rendered manifest 指纹或 rendered args。
- 不能复用不同 site env、image digest、git sha 或 rendered manifest 的结果。
- 不能删除本地真实环境重置能力；只能在资源归属和本次运行身份明确匹配时避免错误清理。

### Slice F. 失败输出和文档降噪

状态：已具备方向，按实现核对。

目标：失败时让人直接看到主要阻塞项、原因、下一步和报告路径；文档只推荐公开入口。

核对以下测试；只有失败或缺失时再补测试/实现：

- `scripts/governance/__tests__/status-projection.test.ts`
- `scripts/governance/__tests__/release-human-output.test.ts`
- 相关 shell script tests

实现重点：

- 人读摘要统一为结论、主要阻塞项、原因、下一步、最慢步骤、报告位置。
- `release:status` 只读展示上一次 release 结果，不重新检查。
- expected success stderr 不进入失败摘要。
- 内部定位命令只留在机器可读报告或维护者定位信息里。
- 普通用户输出不推荐 `debug`、`release-real` 或 `npm run verify:*` alias；如果这些 alias 需要保留，只能作为维护者诊断信息出现在内部/机器可读调试产物里。

验收标准：

- 普通失败摘要 10 到 15 行可读。
- 用户可复制的下一步只来自现有公开入口。
- 验收测试必须覆盖普通用户输出不推荐 `--goal=debug`、`--goal=release-real` 或 `npm run verify:*` alias。
- 文档不建议新 release 入口，也不把 focused visual 写成 release full visual 替代。

停止条件：

- 降噪不能删除机器可读失败详情。
- 多个失败项可以排序置顶，但不能隐藏。

## 7. 维护者实现约束

这一节只约束实现者，不进入普通用户心智。

- 内部文件、脚本和测试名可以继续使用既有命名；面向用户的表达统一写 `npm run verify -- --goal=... --run` 或 `npm run release:ready`。
- `debug`、`release-real` 和 `npm run verify:*` alias 只用于维护者诊断或内部命令，不进入普通入口推荐。
- 与 release flow v3 同步：本计划不能删除或放宽 v3 已受 contract/doc checks 保护的 `gate-release` release-owned API/Web/deps ownership truth；相关措辞和实现变化必须同步更新 contracts/docs。
- 同轮运行标记只在同一次父流程、同一个报告目录、同一个运行身份内有效，不能跨命令读取。
- 子流程不能获得写入运行标记的权限。
- 运行标记必须带 git sha、运行身份和既有 schema 支持的关键环境字段；local-kind handoff 运行标记只承载 context、cluster、site env digest 等现有字段，不承载 image digest、rendered manifest 指纹或 rendered args。不匹配时消费者继续执行自己的 contract/preflight 或失败。
- 发布结论只能引用正式证据，不能引用运行标记作为通过依据。
- 资源清理必须先确认资源归属；归属不明确时只提示 inspect/recovery action。
- 任何状态文件、报告或摘要都不能保存 token、Project secrets、OAuth managed credentials、runner ticket 或原始 env dump。

## 8. 实施顺序

建议按以下顺序交付，避免一次改太多运行路径：

1. Slice A + Slice B：先解决日常 verify 重复基础准备，并收紧内部运行标记防误用。
2. Slice C：修 focused visual 场景选择的假安全感，并补齐 visual 选择规则。
3. Slice D：只做 release precheck observation 和摘要降噪，不做 precheck 到 `gate-release` 的跨阶段 handoff，同时保留 v3 已有 `gate-release` 内 ownership-verified 复用边界。
4. Slice E：只做 local-kind image handoff identity 注记，不跳过部署安全检查。
5. Slice F：最后统一输出和文档。

每个 slice 先跑相关 focused unit、contract 或 script tests。阶段收口或跨模块改动时，再按风险升级到 `npm run verify -- --goal=pr --run`、`npm run verify -- --goal=real --run`、`npm run verify -- --goal=visual --run` 或 `npm run release:ready`。

`npm run release:ready` 只在发布前、部署前、发布候选签署、跨多个运行路径的最终收口，或用户明确要求发布准备证据时必要；普通小改不需要每次都跑。

## 9. 总体验收

最终交付必须证明：

- `npm run verify` 生成检查建议和 dry-run 报告，不执行检查，不代表通过。
- 普通公开收口目标只推荐 `pr`、`real`、`visual`。
- `npm run verify -- --goal=pr --run` 不重复执行同轮基础准备，但保留需要执行的检查。
- 普通用户可见的 `run-verify` 建议、摘要和失败下一步不推荐 `--goal=debug`、`--goal=release-real` 或 `npm run verify:*` alias；维护者 alias 只留内部/机器调试产物里。
- `npm run verify -- --goal=visual --run` 保留 full visual；focused visual 的场景集合来自现有视觉场景清单。
- `npm run verify -- --goal=real --run` 保留真实后端检查和 preflight。
- docs-only、env-only 不触发 full visual 或 backend-real visual；UI 小改、组件改、页面局部改动走受影响 focused visual 场景 + PR goal；design-system、全局 token、布局框架、整页级/跨模块视觉风险、最终视觉验收至少触发 full visual；检查建议或故事策略要求 backend-real 时也必须跑 real。
- `npm run release:ready` 保留 full visual、backend-real、unified deploy、核心产品流程检查，并写出可读摘要。
- `npm run release:status` 只读展示上一次 release 结果，不重新检查。
- `make local-real-up`、`make local-real-status`、`make local-real-down`、`make local-real-reset` 语义不变，不被发布结论替代。

## 10. 风险边界

- 同轮收敛只优化重复准备，不减少检查，不改变证据权威来源。
- 没有本次正式证据，就不能表达通过；消费者继续执行自己的 contract/preflight。
- 内部运行标记不能作为发布通过依据，不能跨命令复用，不能保存 secrets 或原始 env dump。
- Focused visual 不能成为第二套场景目录，也不能替代 full visual。
- Release 第一批不做 precheck 到 `gate-release` 的跨阶段 API/Web/deps handoff/复用；不扩大、也不移除 v3 已定义的 `gate-release` 内 ownership-verified release-owned API/Web/deps 复用。正式结论只看 release campaign step evidence。
- Deploy 第一批只做 local-kind image handoff identity 注记；运行标记不迁移 image digest、rendered manifest 指纹或 rendered args；不跳过 image preflight、rendered manifest、route smoke before product flows 或 product flows。
