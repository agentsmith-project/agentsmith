# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1

<!-- markdownlint-disable MD013 -->

Status: `active-pre-ga-kiss-split-plan`
Date: 2026-05-27
Owner: Product + Engineering
Handoff state: `handoff-ready`

Active plan 读法：

1. AgentSmith 当前是 pre-GA。旧名称、旧路径、旧职责、旧 profile、旧 env、旧脚本入口和已移除字段默认不保留长期正式路径；正式路径不能接就删除或 fail fast。
2. 旧名称和现有 AgentSmith unified deploy / runner 诊断只允许作为负向测试、失败边界、本机诊断或短期待删清单；任何短期临时兼容都必须在第 3.2 节有 owner、删除条件、删除时机/阶段和验收证据。
3. 功能核心优先 / 治理最小化：后续只保留服务当前用户路径、当前合同边界、当前安全边界、真实发布/运行安全或 operator 低心智负担的 gate/docs/script；没有明确风险绑定的治理项不进入 active workflow。过时、低收益、只增加心智负担的治理检查/文档/脚本删除优先，其次降级为 focused diagnostic，最后才保留长期 gate。
4. 本补充不写入 `docs/项目宪法.md`，也不新增宪法条款；宪法已有 MVP 收敛边界，当前计划只负责 release-kit / runner 拆分的执行层约束。
5. operator-facing 发布语言只说 `online` / `airgap` × `use_existing` / `install_substrates`。`external_declared` / `kit_installed` 只是 release contract 的内部机器值，不并列成第二套 operator 词；`install_substrates` 是 release-kit-owned minimal/adjacent substrate pack 能力，不是 AgentSmith 部署 substrates，也不是 provider matrix 扩张。
6. `kind` / `local-kind` 只表示 pre-GA/local diagnostic rehearsal，用于本机或 CI 演练；它不是正式 release target，不和四个真实生产组合放在同一层。
7. 历史 evidence ledger 已移至 [Evidence log reference](archive/release-kit-and-runner-repo-split-evidence-log-v1.md)；它是只读交接证据，不是规范源。
8. 当前 active 正文只维护状态、下一步、阻断项和必要 artifact/CI 链接；历史 evidence 不能替代当前 release-kit repo-local deployment/package/operator verdict。

## 治理克制记录

本轮团队 review 不改 `docs/项目宪法.md`，只收敛当前产品计划和工程文档。功能核心优先：release/deploy 相关门禁只保留能直接证明可安装、可回滚、可排障的证据；不能证明这些结果的检查降级为 focused diagnostic 或删除。pre-GA 旧路径、旧命名、旧脚本和旧计划默认删除或标为 reference，不为旧实现增加长期心智负担。`release:ready` 的当前口径仍以 AgentSmith product-side readiness / handoff input completeness 为边界，deployment/package/operator verdict 归 release-kit repo-local gate/evidence。

## 当前状态 / 下一步切片

回答用户问题：治理层不写进 `docs/项目宪法.md`，也不新增宪法条款；治理克制只记录在当前 release-kit / runner split 计划。治理克制已经作为执行约束：能直接服务当前功能、安全、operator 低心智和真实发布/运行风险的检查保留；其余删除、合并或降级为 focused diagnostic。

近期完成（active plan 只留摘要，历史细节见 evidence log）：

1. release-kit P2 最小 online adoption 聚合已完成；它只是 repo-local aggregation / handoff input，`online-adoption-report.json` 仍是 `readiness=false`，不是 release readiness、deploy/package/operator verdict 或 AgentSmith `release:ready` 结论。
2. AgentSmith link-level `release-kit-online-adoption-handoff` validator 已完成：AgentSmith commits `9fa11298` / `914244a5`。Focused test 结论：validator 覆盖 digest/provenance/link 级 happy path，malformed handoff contract fail fast；它未接入 `release:ready` 或 `contracts:check`，不产生 release-kit verdict。
3. P6-lite summary/status 降噪已完成：AgentSmith commits `d2e38da3` / `6b72a8f3`。Focused test 结论：默认 `release:ready` / `release:status` human output 不再展示 transition-only unified deploy diagnostics，release-kit focused evidence 不再像 product readiness summary item。

尚未完成事项 / 当前真实下一步：

1. 继续 P6-lite 文档/旧引用归档清理：合并、删除或降级不服务当前功能、安全、真实发布运行风险或 operator 低心智的文档和检查；只保留必要 fail-fast 负向测试和短期待删说明。
2. release-kit formal release gate、offline install-deploy smoke 和 operator adoption 仍未完成；不得把 release-kit focused evidence、`online-adoption-report.json` 或未来 repo-local verdict 接回 AgentSmith `release:ready`。
3. runner backend-real / full runtime semantics 仍未完成；现有 runner focused image/task-execution 证据不代表真实 LLM、backend-real 或 full runtime semantics。

历史 evidence ledger 已移至 [Evidence log reference](archive/release-kit-and-runner-repo-split-evidence-log-v1.md)。

该记录只读、非规范，只用于交接追溯；不能替代当前 release-kit repo-local deployment/package/operator verdict，也不能把 focused diagnostic 升级为 readiness。

## 1. 目标

把 AgentSmith 当前的发布执行能力和 runner 执行进程拆成更清晰的工程制品边界，同时不扩大 AgentSmith 产品范围。

最终目标：

1. AgentSmith repo 负责产品代码、产品合同、产品验证、product image、managed runner image adoption truth、本地完整测试和 handoff readiness input；AgentSmith 不给 deployment/package/operator release verdict。
2. `agentsmith-release-kit` repo 负责 online/airgap 发布、发布包校验、发布测试、repo-local gate、operator runbook 和部署证据；真实 Kubernetes / 云端托管 Kubernetes 是正式目标，kind 只作为 pre-GA/local diagnostic rehearsal，不是用户部署前提、正式 release target 或 airgap declarable target。
3. `agentsmith-runner` repo 负责 runner 执行进程、builtin skills runtime、runner image 和 runner 侧测试；runner 协议包由 AgentSmith 合同/共享合同流程发布，runner repo 只消费。
4. `agentsmith-release-kit` / `agentsmith-runner` 长期只保留服务当前发布/运行功能、合同/安全、digest/provenance、真实 deploy/runtime 安全和 operator 低心智的 gate/docs/script；重复证明“不是 release readiness”的文档矩阵不再扩张，后续按触达范围删除、合并或降级。
5. 当前边界已取代早期过渡语义：`npm run release:ready` 是 AgentSmith product readiness / local complete / current product gate，内部覆盖 full visual、backend-real release 和 terminal aggregate；local-kind / unified deploy / product-flow deploy commands 只保留为 transition-only focused diagnostics / 过渡期专项诊断，不属于 AgentSmith 产品门禁结论。online/airgap deployment、package、发布测试和 operator runbook 的 verdict 归 release-kit repo-local gate/evidence，AgentSmith 只保留 product readiness、product image / managed runner image handoff truth、local full test、release contract 和 thin adapter。
6. Pre-GA 旧输入/旧路径/旧命名/旧职责不背长期正式路径：项目整体仍 pre-GA，旧命名、旧路径、旧职责、旧入口、旧文档/旧脚本引用、旧 env/profile 别名、已移除旧包或已移除字段默认不保留。正式路径不能接就删除或 fail fast；确实需要短期临时兼容时，只能作为负向测试、失败边界、过渡期专项诊断、operator 短期说明或后续删除清单存在，并按第 3.2 节写清删除条件、删除时机/阶段、owner 和验收证据，且不能成为长期发布/部署契约。

这不是新增 DevOps 发布平台，也不是新增 runner 产品面。

## 2. 一句话决策

拆 repo 可以做，但第一刀只拆工程制品和部署执行，不拆产品真相。

AgentSmith 仍保留：

- 产品对象和用户入口；
- API、权限、审计、用量、Context Store、Files、Agent tasks、Agent Runners 管理面；
- `npm run verify`、`npm run release:ready`、product flows、visual、backend-real 等产品验收真相。

外部 repo 只通过 versioned contract、image digest、release manifest 和 focused evidence 与 AgentSmith 对接。

## 3. 当前事实

当前边界已经在文档里写得很清楚：

- AgentSmith 不提供对外 DevOps 发布编排或发布管理平台能力，见 [项目宪法](../项目宪法.md)。
- `release` 在当前 repo 中只是工程验收术语，不是产品功能，见 [Release Readiness Checklist](../user-guides/release-readiness-checklist.md)。
- 当前 release campaign 只绑定 AgentSmith product readiness / local complete / current product gate、full visual、backend-real release 和 terminal aggregate；unified deploy / local-kind / product-flow deploy commands 是 transition-only focused diagnostics / 过渡期专项诊断，不属于当前产品门禁结论，见 [current-verification-campaign-manifest.ts](../../scripts/governance/current-verification-campaign-manifest.ts)。
- Unified deploy 只有一个部署模型，正式机器轴是 `target_cluster` / `substrate_source` / `distribution`，见 [unified-deploy-contract.md](../contracts/unified-deploy-contract.md)。`local-kind` / `existing-cluster` 只是 pre-GA 诊断入口名，不是权威发布轴，也不是两个产品；当前 `existing-cluster` 仍按 Docker substrate/IP-only transition diagnostic 处理，不能冒充真实 cloud/airgap substrate。
- Runner contract 当前事实源是 `@mbos/agent-runner-contract` / `packages/agent-runner-contract/src`；协议核心在 `TaskExecutionContext`、WS frame、runner spec 和路径/env 约束，见 [agent-execution-protocol.md](../contracts/agent-execution-protocol.md) 与 [protocol.ts](../../packages/agent-runner-contract/src/protocol.ts)。P4 已完成 formal artifact producer/checker；正式 artifact 是外部 `runner-contract-artifact.json` + tgz，包内 manifest 是 package manifest v1，`local_pack_manifest` 只允许作为负向测试输入。pre-GA 已移除旧包、旧输入、旧路径和旧字段不是正式输入；正式路径默认删除或 fail fast，只能作为第 3.2 节定义的负向测试、失败边界或短期待删清单，出现在过渡期专项诊断或 operator 短期说明里。P5.0 runner repo consumer diagnostic skeleton 已能消费正式 artifact；P5.1 start guard/CI 化已完成（runner repo commit `cdfa800`）；P5.2 formal artifact handoff 已完成（AgentSmith commit `fcecb85b`），只证明 AgentSmith producer 产物能被 runner repo consumer 消费；P5.3a runner release manifest skeleton/checker/start-guard 集成已完成（runner repo commit `7c43ba8`，remote CI run `26455289999` success）；P5.3b first half 已完成并推进到 boundary closure，`a6ddb50` 保留为 projection-only builtin skills 修复事实，`fd6d851` 保持 runner workspace contract-only，`4dbbd26` 保持 artifact scan policy-local，当前 P5.3b boundary closure HEAD 是 `7d21959`；P5 focused image build/start smoke 已完成（runner repo commit `b80ea3c feat: add runner image smoke gate`）。
  remote CI：P5.3b boundary closure `a6ddb50` run `26463276084` success，`fd6d851` run `26465341186` success，`4dbbd26` run `26465733200` success，`7d21959` run `26465985945` success；P5 image smoke run `26468415599` success，jobs `Runner image smoke`、`Runner skeleton start guard`、`Quick governance` success；P5 runner publish manifest final run `26662288580` success，runner HEAD `f588d88`，manifest subject/artifact sha `sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837`，published image ref `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-f588d88@sha256:67fd8ba56dcbe763c1b9f81d1e18d7755f38c9eaf0db618554032aecb4be34f0`；P5 request-scoped projected dependencies contract/env wiring focused slice 已完成，AgentSmith commit `8c6df24c` remote Contracts Check run `26522251350`、Image Publish run `26522249787`、Quality Gates run `26522250713` success，runner repo commit `c67e837` remote CI run `26522674596` success；P5 runner focused image task-execution smoke 已完成，runner repo commit `7a98d40`，remote CI run `26616757307` success。runner repo 已拥有 repo-local runtime source、builtin skills、root package/tsconfig/vitest、source-boundary/product semantics guard、runtime fast focused diagnostic、clean-dependency start-guard guard、no-push image smoke、focused publish manifest evidence、opaque request projection env wiring 和 fake-Codex focused task-execution image smoke；builtin skill/runtime 边界已收敛为只消费 AgentSmith opaque request projections + explicit CLI 参数，`MBOS_AGENT_PROJECTED_DEPENDENCIES` 只是 bulk opaque env；runner runtime 不消费 workspace-access/file-library product API、AFSCP binding schema 或 release fence payload，artifact scan 不承载 file-library reserved namespace policy，`agent.response.done` 不伪造 `usage_tokens`，也不定义 Context Store、managed credential、scope 或 write policy 语义。P5.3a 证据不能据此宣称 runtime migration、image build/publish、AgentSmith adoption、lock update 或 release readiness；P5.3b first half/boundary closure 证据也不能据此宣称 image build/publish、Dockerfile migration、AgentSmith adoption lock、release contract digest adoption、release readiness，或把 AgentSmith 侧 support API / projection contract 一致性收口归因给 runner repo；P5 image smoke 仍不能单独宣称 GHCR publish、registry login、release manifest、release manifest image digest、AgentSmith adoption lock、release contract runner digest、release readiness 或 AgentSmith product semantics 迁入 runner repo；fake-Codex focused task-execution image smoke 已完成，但仍不是 backend-real、真实 LLM、release readiness、AgentSmith adoption、GHCR publish 或 full runtime semantics；P5 runner publish manifest evidence 也只证明 focused GHCR publish + manifest artifact，不证明 AgentSmith adoption lock、release contract runner digest adoption、backend-real、真实 LLM、full runtime semantics、release-kit deployment readiness 或 release readiness；P5 request-scoped projected dependencies contract/env wiring 也不是 release readiness、deployment/offline/airgap readiness 或 AgentSmith full adoption。
- AgentSmith contract 收口：`agent.response.done.payload.usage_tokens` 已在 [agent-execution-protocol.md](../contracts/agent-execution-protocol.md)、AsyncAPI YAML 和 AsyncAPI JSON 从必填修为可选；缺省表示 runner 未上报真实 usage，runner 不得本地估算。这不是后端行为新增，后端原本已按 optional 处理。
- 当前仍是全项目 pre-GA：旧命名、旧路径、旧职责、旧入口、旧文档/旧脚本引用、旧 env/profile 别名默认不保留，也不成为长期发布/部署契约。它们只能作为第 3.2 节定义的负向测试、失败边界或短期待删清单，出现在过渡期专项诊断或 operator 短期说明里，并带删除条件、删除时机/阶段、owner 与 fail-fast 验收；旧 runner 路径/包名只作为负向测试或短期待删说明，不作为正式成功路径，也不作为长期发布/部署契约。部署 profile 映射口在 P2/P6 去掉 active workflow 后删除或归位到 operator docs；runner 已移除旧包/旧输入/旧路径/旧字段/旧 env 在 P5 runner repo/manifest/lock adoption 和 runtime migration 完成后删除或归位；P6 只保留必要 fail-fast 负向测试。
- 当前 AgentSmith 产品侧 runner 集成和 managed runner 运行路径仍以 [packages/agent-task-runner](../../packages/agent-task-runner) 为迁移对象；runner repo P5.3b first half 已拥有 repo-local runtime source 和 builtin skills，P5 image smoke 只证明 no-push image build/start missing-env fail-fast。AgentSmith API 编排、Context Store、Files 与 execution ticket 仍在 [packages/api-entry-node](../../packages/api-entry-node)，这些语义不是 runner release identity。
- AFSCP/ASBCP 只作为新 repo bootstrap 治理做法上的 family reference；本计划采用 ASBCP-lite / non-normative reference，只借鉴启动纪律：repo identity、scope boundary、docs/contracts/runbooks/ADR 入口、quick governance guard、单一 release gate 入口。不复制 AFSCP/ASBCP 的领域模型、风险台账规模、证据分类体系或 gate 实现。

工程判断：

1. 发布执行适合拆，产品验收不适合拆。
2. Runner 进程适合拆，Agent task / Files / Context Store / 调度真相不适合拆。
3. Airgap 必须做成真实离线包；当前只有部分 archive/load helper，不是完整离线发布能力。
4. 新 repo 创建必须遵守 [New repo bootstrap invariant](#41-new-repo-bootstrap-invariant)：P0 只冻结边界、命名和 quick guard，不迁源码、不迁工具、不发布；quick gate 只解锁 repo-local 专项工作，不表示 release readiness。
5. “参考同家族 repo 先建治理和文档，再让独立 team members 进入专项工作”
   是合理要求；它降低空 repo 直接堆实现的风险。KISS 做法是只借鉴
   AFSCP/ASBCP 的启动检查清单形态，不继承它们的领域模型、gate 脚本或事实源。

### 3.1 Evidence reference / 当前边界

历史完成证据和逐切片 ledger 已移至 [Evidence log reference](archive/release-kit-and-runner-repo-split-evidence-log-v1.md)。该文件只读、非规范；active plan 不再滚动追加长历史。

当前边界保持不变：focused diagnostics 不等于 readiness；AgentSmith `release:ready` 不给 deployment/package/operator verdict；release-kit repo-local gate/evidence 才能给部署、发布包和 operator 结论。

当前尚未完成事项已从旧三切片继续收窄为：P6-lite 文档/旧引用归档清理、release-kit formal release gate / offline install-deploy smoke / operator adoption，以及 runner backend-real / full runtime semantics。已完成的 release-kit operator surface、operator `online/use_existing` confirmed apply、release-kit P2 最小 online adoption 聚合、AgentSmith link-level handoff validator、P6-lite summary/status 降噪、runner manual image-smoke、docs/governance slim、release-kit `kit_installed/online` evidence parity 和 runner real-path boundary smoke 不再作为待办；release-kit verdict 也不能接回 AgentSmith `release:ready`。

### 3.2 Pre-GA 旧路径/旧引用处理规则

项目整体仍 pre-GA，KISS 规则是：能删就删，正式路径不能接受的输入就
fail fast。旧命名、旧路径、旧职责、旧入口、旧文档/旧脚本引用、旧输入、
旧 shim 入口默认不保留，不为历史形态保留长期心智负担。它们只表示
pre-GA 已移除内容、过渡诊断、负向测试、失败边界或短期待删清单，
不是长期轨道。
旧 runner 路径/包名只允许作为负向测试或短期待删说明，不作为正式成功路径。
只有下表列出的短期临时兼容可以出现，且必须同时有 owner、
删除条件、删除时机/阶段和验收证据，且不能作为长期发布/部署契约。
缺任一项时，不保留；临时价值用完后，
按表中时机删除或移出 active workflow/docs。

| 短期待删项 | owner | 删除条件 | 删除时机/阶段 | 验收证据 |
| --- | --- | --- | --- | --- |
| `local-kind` / `existing-cluster` non-canonical profile name 映射口 | AgentSmith release-boundary owner | P2/P6 移除或隐藏 AgentSmith active status/workflow 中的 transition-only diagnostics，或 release-kit repo-local gate 已拥有 deployment/package/operator verdict；不得继续作为长期入口或长期发布/部署契约 | 条件满足后立即删除 active workflow/adapter 映射，或至少从 active workflow 隐藏，只保留必要 fail-fast 负向测试 | `contracts:check-unified-deploy-vocabulary`、`contracts:check-current-verification-campaigns`、`contracts:check-release-boundary` 证明新轴值为正式输入，active workflow/adapter 不再接受映射口，混写和同义词漂移 fail fast |
| `use_existing` / `install_substrates` operator-facing strategy 与内部机器值 `external_declared` / `kit_installed` 的映射说明 | release-kit boundary owner | release-kit repo-local contract、runbook 和 gate 已明确 operator 只看 `use_existing` / `install_substrates`，机器值只出现在 release contract / evidence；`install_substrates` 明确为 release-kit-owned minimal/adjacent substrate pack，不得让两套词都成为 operator 心智负担，也不得写成 AgentSmith substrate deployment 或 provider matrix | P2/P3/P6 收口时删除重复说明或归一到 release-kit repo-local contract；AgentSmith docs 只保留 handoff input 需要的映射 | release-kit repo-local strategy schema/gate、`contracts:check-release-boundary`、`contracts:check-doc-governance` 和 handoff note 证明 online/airgap 都覆盖 `use_existing` 与 `install_substrates`，且 kind 仍只是 optional local rehearsal |
| release-kit `--inputs` / `--evidence` focused diagnostic 输出和未来/预留 output 拒绝说明 | release-kit boundary owner | producer 已实现且 `--evidence` 能重新语义校验后进入正式接受清单；否则继续 fail fast | P2/P3/P6 清掉无实现说明，不把预留 output 写成长期发布/部署契约 | `contracts:check-release-boundary`、`contracts:check-release-kit-source-boundary -- --scan-root <repo>` 交接检查、provenance/redaction 负向测试 |
| 已移除 runner 包、字段、路径、`@mbos/agent-runner` shim、旧 env helper / monorepo-side `buildAgentRuntimeEnv` 短期待删归属说明 | runner contract/runtime owner | P5 runner manifest/lock adoption、Dockerfile/image build adoption、release contract digest adoption 和 runtime semantics 后续收口完成；不能成为长期共享路径或 release proof；runner repo `buildAgentRuntimeEnv` 的 projected dependencies opaque env wiring 不属于旧路径成功轨 | P6 删除 AgentSmith 长期共享路径，只留必要 fail-fast 负向测试 | `contracts:check-agent-runner-contract-artifact`、`contracts:check-runner-contract-sync`、`contracts:check-release-boundary`、`contracts:check-runner-image-lock -- --adoption --manifest <path>` |
| operator 短期待删说明中的已移除命令、路径、旧文档链接、旧脚本入口或名称 | 对应 runbook/doc owner | runbook 不再需要一次性提示，或 P6 收口；不得继续作为 active operator 心智负担或长期发布/部署契约 | 从 active runbook/workflow 删除；若确需历史说明，只能归档到非规范历史说明，并设 P6 后删除/归档验收 | `contracts:check-doc-governance`、`contracts:check-engineering-governance` 和对应 source-boundary/static guard 证明 active runbook/workflow 不再引用它，且它不能被 Make/npm/GitHub Actions/release/local-real/backend-real wrapper 间接调用 |

## 4. Repo 职责

| Repo | 负责 | 不负责 |
| --- | --- | --- |
| `agentsmith` | 产品代码、产品合同、OpenAPI/AsyncAPI、product image、managed runner image handoff truth、产品验证、本地完整测试、产品证据、外部 image/manifest adoption、handoff readiness input | deployment/package/operator release verdict、operator 安装包、离线包、发布平台、runner 执行进程长期实现 |
| `agentsmith-release-kit` | online/airgap 发布、离线包、image bundle、发布包测试、repo-local release/deploy gate、Kubernetes render/apply/smoke、`use_existing` 连接校验、`install_substrates` 最小 substrate 安装、operator runbook、部署/分发证据和 deployment/package/operator verdict | visual、backend-real、产品 DB/bootstrap 语义、产品 UI/e2e 真相、发布管理 UI、云资源 provisioning |
| `agentsmith-runner` | runner 执行进程、Codex/terminal/artifact/skills runtime、runner image、runner CI、contract conformance tests | runner contract source of truth、Agent task API、Agent Runners API、runner key、presence/heartbeat、Context Store、Files/file library、managed credential、审计/用量、前端管理面 |

补充说明：

1. AgentSmith 拥有产品 schema、初始化代码和 bootstrap 语义。
2. Release kit 可以打包、渲染、执行和等待 bootstrap workload，并产出部署证据；它不解释产品 schema，也不改 bootstrap 业务逻辑。
3. Runner repo 可以实现 builtin skills 的本地 runtime 和请求级投影消费；Context Store 权限、scope 和 managed credential 解析语义仍由 AgentSmith 定义。
4. 新 repo 本地目录与 `agentsmith` 同级只是当前 workspace bootstrap 约定：`/home/percy/works/mbos-v1/<repo>`，当前目标为 `/home/percy/works/mbos-v1/agentsmith-release-kit`、`/home/percy/works/mbos-v1/agentsmith-runner`；远端 org 已有，文档和创建命令使用 `https://github.com/agentsmith-project/<repo>.git`。CI/release 只认 normalized GitHub identity + provenance；canonical repo identity 固定为 `github.com/agentsmith-project/<repo>`。
5. `agentsmith-runner` 是唯一 canonical runner repo；当前同级目录已有的 `agentsmith-codex-runner` 只作为短期待删说明或归档对象，不能作为 bootstrap 输入，也不能成为第二条 runner 真相。若相关说明留在 active docs，必须按第 3.2 节挂 owner、删除条件、删除时机/阶段和验收证据；任何正式 lock、release contract 或 CI adoption 指向 `agentsmith-codex-runner` 都必须 fail fast。
6. `agentsmith-runner` 不定义 Context Store scopes、Files/file-library 行为、managed credential resolution、execution ticket 颁发或权限语义；runner 侧 builtin skills runtime 只消费 AgentSmith 请求级只读投影并做本地运行，不能新增权限、scope 或 credential 解析语义。

ASBCP / AFSCP / LLMUP 继续作为外部 provider image 被消费。AgentSmith 只 pin digest 和验证 adoption，不拥有这些 provider 的 release gate。

### 4.1 New repo bootstrap invariant

新建 `agentsmith-release-kit`、`agentsmith-runner` 必须遵守同一个 invariant；
后文 P0/P2/P5/handoff 只引用它，不再新增一套 gate。

1. 本地 repo 与 `agentsmith` 同级，路径形如 `/home/percy/works/mbos-v1/<repo>`；
   canonical 远端身份固定为 `github.com/agentsmith-project/<repo>`，
   创建命令使用 `https://github.com/agentsmith-project/<repo>.git`。
2. AFSCP / ASBCP 只能作为 non-normative family reference，借鉴启动纪律；
   不能成为源码依赖、合同依赖、gate 依赖或新 repo 事实源。
3. 新 repo bootstrap 顺序固定为：先建立最小治理与文档边界，再开放
   repo-local 专项任务，最后才迁入实现。第一条 PR 必须是
   bootstrap-only/docs-governance-first；minimum bootstrap pack 只包含
   README.md、AGENTS.md、DEVELOPMENT/DEVELOPER guide、RELEASE_GATES 或
   verify-release、contracts/runbooks/ADR entrypoints，以及 CODEOWNERS/OWNERS
   或 README owner 元数据和 repo-local handoff checklist；不迁源码、不迁工具、不发布。
4. AFSCP/ASBCP 可以提供非规范检查清单灵感，例如“是否有 owner、
   scope/non-goals、合同入口、runbook 入口、quick guard、单一 gate 入口”；
   这些条目必须被改写成当前 repo-local 事实，不能复制为权威规范或硬依赖。
5. quick governance guard 只检查 canonical repo identity、required bootstrap files、
   scope/non-goals、owner/team 元数据、gate 入口存在且不声称 release readiness、
   无 raw secret、无 mutable image 或 tag-only release claim、无 AFSCP/ASBCP
   源码/合同/gate 依赖、无 sibling repo status gate。
6. quick gate 通过只表示 repo-local team members 可以领取互不重叠的 docs、
   contracts、runbooks、CI gate 或 implementation workstream；它不是 team
   signoff，也不是 release readiness。
   implementation workstream 仍必须按 P2/P5 对应范围推进，不解锁
   release/adoption，也不允许跳过合同或证据边界。
7. 新 repo 的事实源只能是 repo-local 文档、合同、runbook、ADR、gate，以及
   AgentSmith 发布出来的 versioned contract / image digest / release manifest；
   不能回读 `agentsmith` 工作树或 sibling repo 状态当作事实源。
8. `agentsmith-release-kit` 自己必须把 source-boundary、remote identity 和
   provenance check 接入 repo-local required CI；AgentSmith handoff 的 sibling
   scan 只能作为交接证据，不能替代 release-kit 自身门禁。

## 5. 不做

本计划明确不做：

1. 不新增发布控制台、发布 dashboard、DevOps 编排产品。
2. 不新增普通用户 runner picker、runner marketplace、运行时切换、runner image selector。
3. 不把 ASBCP、K8s、image digest、internal URL/key、sandbox/control plane 等内部细节暴露给普通用户。
4. 不把 `check-product-flows.ts`、visual、backend-real、story/e2e 迁到 release kit。
5. 不把 Context Store、Files/file library、managed credential、execution ticket 迁到 runner repo。
6. 不做 API 多副本、execution gateway、离线队列、Keycloak operator、Kubernetes substrate、云集群/数据库/bucket/IAM/network 自动创建。
7. 不为旧名、旧路径、旧职责、旧文档/旧脚本引用、旧 env、已移除旧字段、已移除旧包保留长期发布/部署契约；pre-GA 只允许第 3.2 节列出的负向测试、失败边界和短期待删项，并在 P2/P6（deploy/profile）或 P5/P6（runner runtime/adoption）标明 owner、删除条件、删除时机/阶段和验收证据。
8. 不为小概率环境做厚重兜底；缺合同、缺 digest、缺镜像、缺权限就快速失败。
9. 不把 AFSCP/ASBCP family reference 变成源码依赖、合同依赖、gate 依赖或新治理平台。
10. 不复制大型治理体系，不把 quick gate 等同 release readiness，不把新 repo 的
    sibling repo status 当 gate。
11. 不把源码迁移、工具迁移或从 `agentsmith` 工作树读取事实作为新 repo 第一步。
12. 不把 `site.env.example`、本地 site env 或当前 `existing-cluster` 诊断输出当作
    正式 prerequisite image truth。

## 6. 部署模式矩阵

Release kit 的正式部署模式由三根正交机器轴组成。三根轴是为了降低实施心智负担，
不是新增产品线；`local-kind` / `kind` 不在正式 release target 层。

| 轴 | 值 | 含义 |
| --- | --- | --- |
| `target_cluster` | `existing_kubernetes` | 真实 Kubernetes 目标，包括私有 Kubernetes 和云端托管 Kubernetes。 |
| `substrate_source` | `kit_installed` | release-kit-owned minimal/adjacent substrate pack，由 release kit 安装并产出连接真相和 pod-routability preflight；`kit_installed/online` focused composition/evidence parity 已完成，但不等于 full release-kit verdict、formal release gate、release readiness 或 deployment/package/operator verdict。只做最小 substrate pack，不做 provider matrix；它不是 AgentSmith substrate deployment，不是云资源 provisioning，也不是 in-cluster substrate。 |
| `substrate_source` | `external_declared` | operator 提供 PostgreSQL/pgvector、MongoDB、Redis、S3-compatible object storage、Keycloak/OIDC 等连接真相；release kit 只校验，不创建云资源。 |
| `distribution` | `online` | 从 GHCR 或 operator 指定 registry 拉取 digest-pinned images。 |
| `distribution` | `airgap` | 使用离线包、OCI layout 或 image archives，不联网拉镜像、工具或模板。 |

Release handoff / release-kit runbook 面向 operator 只使用两个 substrate
strategy 名称；机器合同仍写 `substrate_source` 值：

- `use_existing`：连接 operator 已有 substrates 或云端接口；内部机器值是
  `external_declared`。
- `install_substrates`：由 release kit 安装 release-kit-owned minimal/adjacent
  substrate pack 并产出同一份连接真相；内部机器值是 `kit_installed`。它
  不表示 AgentSmith 负责部署 substrates，也不表示 provider matrix 扩张。

online 和 airgap 都必须覆盖这两个 strategy。未覆盖任一 strategy 时，
release-kit 不能给 deployment/package/operator verdict。

operator 默认只需要看四种正式生产组合：

| operator 选择 | 内部机器值 | 用途 |
| --- | --- | --- |
| `online` + `use_existing` | `target_cluster=existing_kubernetes`，`substrate_source=external_declared`，`distribution=online` | 常规真实部署主路径。 |
| `online` + `install_substrates` | `target_cluster=existing_kubernetes`，`substrate_source=kit_installed`，`distribution=online` | 自包含或受控环境，release kit 安装最小 substrate pack。 |
| `airgap` + `use_existing` | `target_cluster=existing_kubernetes`，`substrate_source=external_declared`，`distribution=airgap` | 真实 airgap 主路径，外部依赖作为 operator prerequisite。 |
| `airgap` + `install_substrates` | `target_cluster=existing_kubernetes`，`substrate_source=kit_installed`，`distribution=airgap` | 真实 airgap 自包含路径，包内必须包含 substrate images/tools/proofs。 |

`kind` / `local-kind` 只作为 pre-GA/local diagnostic rehearsal。若机器合同中
仍出现 `kind_rehearsal`，只能服务本机、CI 自测或离线包机械演练；它不和上面四个
生产组合同层，不作为生产默认、正式 release target 或当前 release readiness。
其他组合只放在 troubleshooting / advanced runbook 里，不作为首次实施路径。

正式工程组合：

| 组合 | 是否一等支持 | 用途 |
| --- | --- | --- |
| `existing_kubernetes + external_declared + online` | 是 | 常规真实部署主路径。 |
| `existing_kubernetes + external_declared + airgap` | 是 | 真实离线部署主路径；外部依赖作为 operator prerequisite 记录和校验。 |
| `existing_kubernetes + kit_installed + online` | 目标一等支持；当前需最小 substrate pack + pod-routability preflight slice 补齐 | 自包含或受控在线环境；release kit 安装最小 adjacent substrate pack，但不把它伪装成云资源管理、provider matrix 或 in-cluster substrate。 |
| `existing_kubernetes + kit_installed + airgap` | 目标一等支持；当前需最小 substrate pack + pod-routability preflight slice 补齐 | 自包含或受控离线环境；离线包必须包含 substrate images/tools/proofs。 |

心智模型：

1. operator 先选正式目标：真实 Kubernetes。
2. 再选依赖：release kit 安装，或连接已有/云端依赖。
3. 最后选分发：在线拉镜像，或离线包导入。

本机 kind 演练是诊断工具，不进入正式目标选择。

Release kit 对云端的支持只表示“部署到 operator 已提供的 Kubernetes 和依赖服务”。它不创建云集群、数据库、bucket、Keycloak realm/client、IAM 或网络资源。

过渡期规则：

1. 当前权威实现仍是 Docker-only substrate truth；Docker-only local-kind
   unified deploy 是当前 pre-GA focused diagnostic baseline，不是长期部署真相；
   `external_declared` 在 P0 是 schema、fixtures、validator 和 evidence
   boundary，不等于 P2/P3 已完整支持真实 Kubernetes、cloud 或 airgap handoff。
2. local-kind evidence 不能代替 `existing_kubernetes` evidence；反过来也不能把 operator smoke 自动算成默认 `release:ready` 结论。

Profile vocabulary pre-GA 映射口：

1. 唯一映射位置必须由 P0 固定：AgentSmith non-canonical pre-GA profile name `local-kind`
   映射为 release-kit contract 轴值 `target_cluster=kind_rehearsal`，
   `existing-cluster` 映射为 `target_cluster=existing_kubernetes`。
2. AgentSmith adapter 是唯一允许使用 non-canonical pre-GA profile name 的位置；release contract、
   release-kit evidence、release-kit repo-local gate 和 handoff artifact 只接受新轴值。
   `kind_rehearsal` 只可标记本机诊断演练，不能作为正式 release target。
3. 同一 payload 内混写 non-canonical pre-GA profile name 和新轴值、根据字符串隐式推断、或引入
   `kind` / `real-k8s` / `cluster` 等同义词漂移时 fail fast。
4. 这个映射口只服务 pre-GA 失败边界；owner、删除条件、删除时机/阶段和验收证据按第 3.2 节执行。P2/P6 去掉 non-canonical profile active workflow 后删除。若仍需说明已移除旧命令，只作为 operator docs 的一次性短期待删说明，并按第 3.2 节后续删除，不进入 machine contract。

## 7. 最小合同

### 7.1 AgentSmith Release Contract v1

AgentSmith CI 产出一个机器可读 release contract，给 release kit 消费。

最小字段：

- `schema_version`
- `product: "agentsmith"`
- `release_id`
- `git_sha`
- `product_images`
- `adopted_provider_images`
- `release_kit_prerequisite_images`
- `managed_runner_image`
- `deploy_image_inventory`
- `deploy_template_digest`
- `deploy_template_package`
- `openapi_digest`
- `asyncapi_digest`
- `required_product_flows`
- `target_profiles`
- `substrate_connection_schema`
- `min_release_kit_version`
- `artifact_provenance`

规则：

1. 所有正式 image 必须是 immutable digest，优先 `image:tag@sha256:<digest>`。
2. tag-only image 直接失败。
3. release contract 只描述产品制品和必要验证，不描述发布流程细节。
4. release kit 不 import AgentSmith 源码，只读 contract 和部署模板包。
5. `product_images` 只放 AgentSmith 拥有的正式 image。当前唯一 canonical product image ID 是 `agentsmith_app`；它可以承载 app/API/product schema bootstrap workload，但 release contract 不补 `web` / `api` / `product_schema_bootstrap` 这类当前没有机器实现的假 component ID。未来真拆产品镜像时，先新增 canonical machine IDs、fixtures 和 tests，再进入 contract。
6. 当前不发布 `managed_runner` 临时 digest，也不把本地/monorepo runner build 当 release proof；release contract runner digest adoption 已把 canonical runner lock 投影为顶层 `managed_runner_image`，其 artifact identity 仍是 `agentsmith-runner`，并在 `deploy_image_inventory` 中使用稳定 release inventory id `managed_runner`。
7. `adopted_provider_images` 放 AgentSmith 消费但不拥有发布 gate 的外部 provider image，例如 ASBCP、AFSCP、LLMUP。
8. `release_kit_prerequisite_images` 放 release kit 需要 mirror/load 的底座或集群组件镜像，例如 ingress controller/certgen、后续 `kit_installed` slice substrate images、kind rehearsal 所需 images。
9. `deploy_image_inventory` 是 AgentSmith release contract 输出的最终 image inventory，必须由 `product_images`、`adopted_provider_images`、`release_kit_prerequisite_images`、`managed_runner_image` 和 deploy template 渲染输入生成；release kit 只能验证 rendered manifests 与该 inventory 一致，不能另起一份 image 真相。
10. 所有会被 pull/load/apply 的 image 都必须能追溯到 digest。
11. `deploy_template_package` 是 release contract required field，包含模板包
    URI、package sha256、manifest sha256、机器可读 `required_image_ids` 和
    provenance；release kit 读取它，不能猜 AgentSmith repo path 或直接
    import 产品源码。
12. `deploy_template_package.required_image_ids` 是 deploy template package
    manifest 内的单一机器事实，覆盖所有模板引用的 image ID；release
    contract generator/check 必须把它与 `deploy_image_inventory` 的模板
    image 范围做双向一致性校验：required ID 必须存在于 inventory，模板
    引用的 inventory ID 也必须被 required list 覆盖。模板新增 image 引用
    但未更新 manifest 或 inventory、或 inventory 留下模板 orphan image
    truth 时 fail fast；`MANAGED_RUNNER_IMAGE` 必须映射到
    `images.managed_runner.image`，不得作为长期 `values.MANAGED_RUNNER_IMAGE`
    成功路径；不得新增第二套 top-level required image IDs 字段。
13. `required_product_flows` 当前最小集合是 `workspace_project`、`files`、`agent_task_managed_runner`。其他流程只有在 release scope 明确要求时才加入。
14. `target_profiles` 声明支持的 `target_cluster`、`substrate_source`、`distribution` 组合，以及每个组合的 namespace/RBAC/ingress/TLS/storage class/registry/pull secret prerequisites；target prerequisites 的 registry allowlist 只允许 `pull_secret_ref`，拒绝 pseudo-proof/secret fields 和 raw secret 字段。当前 pre-GA/release-kit focused diagnostics 阶段，`target_profiles.required` 不是 readiness 开关，当前实现若拒绝 `required: true` 是 pre-GA fail-fast posture。只有 P2/P3/P6 明确 adoption 条件满足、repo-local gate 拥有对应正式 evidence 后，才允许把某些组合翻为 required；翻转时缺对应 gate/evidence 就 fail fast。
15. `substrate_connection_schema` 使用中性连接真相命名，例如 `agentsmith.substrate-connection.truth/v1`；`agentsmith.docker-substrate.truth/v1` 是真实 Docker substrate truth，只能作为 `kit_installed` 的内部 installer truth；已移除的未命名空间输入名 `docker-substrate.truth/v1` 是 pre-GA invalid input，直接 fail fast，两者都不得用于 `external_declared`。
16. `artifact_provenance` 至少包含 producer repo identity、commit SHA、workflow/run/job、artifact URI、artifact digest、generated_at 和 generator version。正式 release adapter 必须拒绝缺 provenance、local provenance 或 repo identity 不匹配的 contract。
17. bootstrap 阶段 `--inputs` / contract intake 只允许作为 focused diagnostic：
    它可以输出 `intake-report` 和 `image-digest-plan`，但不代表 deploy/package/operator verdict
    或 AgentSmith product gate；这类输出必须显式标记
    `readiness=false`，缺失或被上层当作 AgentSmith product gate 或 deploy/package/operator verdict 时 fail fast。
18. P1/P2 adoption 前，正式 intake 必须通过三项 guard：三轴枚举拒绝 non-canonical pre-GA profile names 和同义词；最小字段校验覆盖 image digest、deploy image inventory、
    template package、provenance 和 `target_profiles.required`；required profiles 当前不能当作 readiness 开关，`required: true` 若被拒绝是 pre-GA fail-fast posture。后续只有对应 repo-local gate/evidence 已存在的组合才能翻为 required；否则继续 fail fast，不能进入 deploy/package/operator verdict 或 AgentSmith product gate。

### 7.2 Substrate Connection Truth v1

目标：让真实 Kubernetes / 云端部署不被 Docker-only 语义卡住，同时不引入 cloud provider framework。

最小字段：

- `SUBSTRATE_SOURCE=kit_installed|external_declared`
- PostgreSQL/pgvector：host、port、database、user secret ref、sslmode、required extension check
- MongoDB：host、port、database、user secret ref、TLS mode
- Redis：host、port、password secret ref、TLS mode
- object storage：S3-compatible endpoint、bucket、access key secret ref、scheme/TLS、path/virtual-host style
- Keycloak/OIDC：public issuer、realm/client id、JWKS/metadata reachability、read-only validation mode
- Kubernetes deploy prerequisites：namespace/RBAC mode、ingress host/TLS secret ref、registry pull secret ref、storage class/PV policy、substrate secret refs；registry prerequisite allowlist 只接受 `pull_secret_ref`，拒绝 pseudo-proof/secret fields
- product-flow probe secret refs：仅在产品 flow 需要直接 DB/OIDC/admin probe 时由 operator 显式提供；不能从 Docker defaults 或云环境里猜
- redacted fingerprint

规则：

1. `external_declared` 允许 DNS/FQDN 和 TLS；不能 fallback 到 Docker defaults。
2. `external_declared` 不创建或修改云资源、bucket、DB user/database、Keycloak realm/client、IAM 或网络资源；只允许连接校验、能力校验，以及在 operator 已提供的数据库内运行 AgentSmith-owned product schema/bootstrap。
3. `kit_installed` 必须产出同一份中性 connection truth 和 pod-routability preflight，供 render/apply/smoke 消费；已完成的 `kit_installed/online` focused composition/evidence parity 只证明 repo-local focused path，不等于当前 release readiness 或 full release-kit verdict。
4. 缺 endpoint、凭据、issuer、bucket、extension、TLS/sslmode 或可达性时 fail fast。
5. `external_declared` 的产品 flow 如果需要 direct DB/admin/OIDC probe，必须依赖 operator 显式给出的 probe secret refs；缺这些 refs 时可以完成 deploy smoke，但不能声称对应 product flow release evidence 已通过。
6. 持久化 truth、evidence 和日志只能保存 secret refs、redacted fingerprint 和能力检查结果；raw secrets 只能作为请求级/operator 输入进入进程内存，不能写盘。

### 7.3 Release Kit Evidence v1

Release kit 产出部署证据，AgentSmith adapter 在 pre-GA 只把 focused diagnostic 映射回当前 release summary。这个 adapter 是唯一允许 release kit evidence 进入 AgentSmith release summary 的入口；release-kit functional repo ready 后，deployment/package/operator verdict 属于 release-kit repo-local gate/evidence，而不是由 AgentSmith `release:ready` 长期拥有。

所有 evidence 都必须绑定本次输入制品，至少包含 `release_contract_digest`、`release_id`、`git_sha`、`release_kit_version`、`target_cluster`、`substrate_source`、`distribution`、`target`、`status`、`failure_class`、`artifact_provenance` 和 evidence root。缺这些字段时 AgentSmith adapter 必须拒绝映射，避免 stale evidence 混入当前 release summary。

`artifact_provenance` 至少包含：

- `provenance_kind: "ci_artifact" | "signed_operator_run"`；
- producer repo identity；
- normalized remote identity；
- commit SHA；
- `subject_name`；
- `subject_sha256`；
- `subject_uri`；
- CI path 的 workflow/run/job，或 operator path 的 signed operator run id；
- artifact URI；
- generated_at；
- generator command/version；
- optional attestation/signature reference。

hash subject 规则：

1. `subject_sha256` 永远哈 provenance 外部的 immutable subject，不能哈包含自身 provenance 的 JSON，避免自引用。
2. 对 release contract，subject 是 canonical release contract body without `artifact_provenance`，按 P0 定义的稳定 JSON canonicalization 计算。
3. 对 release kit evidence，subject 是 evidence root 下的 `evidence-subject.json` 或 bundle manifest；它列出所有 evidence 文件相对路径和 sha256，且自身不包含 `artifact_provenance`。
4. 对 runner release manifest，subject 是 runner manifest body without `artifact_provenance`。
5. `artifact_uri` 指向可下载 artifact 或离线包内 subject 文件；它不是 hash subject 的定义。

当前 `--evidence` 接受的 focused outputs：

- `image-map.json`
- `online-deployment-gate-report.json`
- `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`

`image-map.json` 是 mirror/image-map focused diagnostic 的
accepted/revalidatable focused output。image-map-only 不等于
deploy/package/operator verdict 或 release readiness；release-kit evidence
intake 接受它只是为了重新语义校验 mirror/image-map focused diagnostic，
不代表部署成功。

online target-registry evidence root 是 envelope/container，不是 focused
output 值。它包含 `evidence.json`、`evidence-subject.json` 和
`online-deployment-gate-report.json`；`--evidence` 可以 revalidate 这个 root，
但 machine accepted output 清单只写上面的精确文件值。online gate report
若含 image-map，必须使用 canonical `image-map,registry-presence` producer
sequence；standalone `registry-presence-report.json` 仍不能作为 accepted
focused output。

另有 P2 `--online-adoption` 聚合 producer：它消费
`online/use_existing` 与 `online/install_substrates` 两路 confirmed apply/evidence
root，输出 `online-adoption-report.json`，包含 digest/provenance/coverage
summary 且 `readiness=false`。该报告只作为 release-kit repo-local online
adoption 聚合与 AgentSmith handoff 输入事实，不是 `release:ready`、
release readiness、deploy/package/operator verdict 或 formal release gate。

其他 output，例如 `deploy-result.json#substrate`、standalone
`render-report.json` / `apply-report.json` / `rollout-report.json` /
`smoke-report.json`、`registry-mirror-map.json`、
`airgap-bundle-render-check-report.json`、
`airgap-image-archive-check-report.json`、`airgap-image-load-report.json`，只有在 producer 已实现且
`--evidence` 可重新语义校验后才能进入接受清单；当前 online render/apply/
rollout/smoke 只作为 online evidence root envelope 内的证据被重校验，不
新增长期 standalone 正式输入。当前
`airgap-bundle-render-check-report.json` producer 已实现但仍保持
`readiness=false` focused diagnostic，`--evidence` 继续拒收；未实现或未接入
语义校验时直接 fail fast。
standalone `registry-presence-report.json` 也保持 `readiness=false` focused
diagnostic，只证明 deterministic mirror ref + operator probe digest match，
`--evidence` 继续拒收。
standalone `airgap-image-archive-check-report.json` 也保持
`readiness:false`、`scope: airgap_image_archive_content_check_only` focused
diagnostic，只证明 operator-owned trusted local `--archive-probe` stdout
digest 与 image-map `target_digest` / release contract / bundle manifest 对齐；
`--evidence` 继续拒收。release-kit 不 sandbox、不证明 probe 自身可信，也不
把该 report 写成 airgap ready 或 release readiness。
standalone `airgap-image-load-report.json` 也保持 `readiness:false`、
`scope: airgap_image_load_only` focused diagnostic，只证明 operator-provided
`--image-loader` 执行并返回与 `target_digest` 对齐的 stdout digest；
`--evidence` 继续拒收，不写成 offline install、package、deploy、registry 或
release readiness。

规则：

1. evidence 只证明部署和分发，不证明产品功能全部通过。
2. product flows 仍由 AgentSmith 生产；release kit 不伪造、不签署
   AgentSmith product-flow evidence。
3. online 与 airgap 共用同一份 image digest policy。
4. online 模式不要求 image archive；airgap 模式缺 archive、digest mismatch、联网访问尝试、生成 manifest 漂移都 fail fast。
5. release kit smoke 只证明部署、路由、镜像 adoption 和基础健康；AgentSmith product flows 必须能指向真实 Kubernetes/cloud base URL，不能只绑定 kind。
6. release kit smoke 必须证明每一个 rendered workload 的最终 pull ref 映射到 target registry digest，并在目标集群核对 Pod/Job 的 live `imageID` 与 release contract / mirror map 一致；当前 P2 online focused spine 已对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。target-registry apply 必须先完成 `image-map,registry-presence` producer sequence；source-registry apply 不受影响，target-registry server-dry-run 不要求且不允许 probe。
7. 正式 evidence 不能包含 kubeconfig、pull secret、DB password、OIDC client secret、execution ticket、API token、managed credential 或完整连接串；只允许 secret ref、redacted fingerprint 和最小诊断字段。
8. AgentSmith adapter 必须对 evidence JSON 和日志做 redaction check；发现明文 secret 时 fail fast，不能把 evidence 映射进 release summary。
9. contract intake / `--inputs` 产物如果只完成输入解析、digest 计划或模板依赖检查，只能进入 diagnostic evidence root；`intake-report` / `image-digest-plan` 不能写入 deploy/package/operator verdict 或 AgentSmith product gate，且必须保留 `readiness=false`。
10. `--evidence` 只能接受当前 producer 可重新语义校验的 focused output：`image-map.json`、`online-deployment-gate-report.json`、`airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。`image-map.json` 只作为 mirror/image-map focused diagnostic 的 accepted/revalidatable output 被重校验，不是 deploy/package/operator verdict 或 release readiness，也不代表部署成功。online evidence root 是 revalidation envelope，内含 `evidence.json`、`evidence-subject.json` 和 `online-deployment-gate-report.json`，但 root 名称不进入 accepted output 清单；online gate report 若含 image-map，必须使用 canonical `image-map,registry-presence` producer sequence。`airgap-bundle-render-check-report.json`、`airgap-image-archive-check-report.json`、`airgap-image-load-report.json` 和 standalone `registry-presence-report.json` 仍是 `readiness=false` focused diagnostic，不进入 `--evidence` 接受清单。operator signoff intake 也接受该 canonical target-registry sequence。`deploy-result.json#substrate`、standalone render/apply/rollout/smoke report 等未来/预留 output 不进入长期发布/部署契约；未实现、不能重新校验语义或字段只在说明里预留时，直接 fail fast。

Pre-GA transition-only diagnostic mapping（不属于 AgentSmith product gate）：

下表是过渡映射位置说明，不等于当前 `--evidence` 接受清单。
`deploy-result.json#substrate`、standalone render/apply/rollout/smoke report
等 output 在 producer 实现且 `--evidence` 可重新语义校验之前，必须 fail fast；
当前已验证的是 online evidence root envelope revalidation，不是把 root
名称或每个 step report 开成长期独立输入。

| Release-kit-style diagnostic output | AgentSmith diagnostic writer | diagnostic path | diagnostic section | reject 条件 |
| --- | --- | --- | --- | --- |
| `image-map.json` / mirror report | `lane-unified-deploy-local-kind-images` / `unified_deploy_local_kind_images`，仅限 transition local-kind diagnostic profile | `<diagnostic-root>/lane-unified-deploy-local-kind-images/native/result.json` 与 `<diagnostic-root>/unified-deploy/local-kind-images/` | images | tag-only image、digest mismatch、local-kind evidence 被用于 `existing_kubernetes` |
| `render-report.json` + `rollout-report.json` | `lane-unified-deploy-local-kind` / `unified_deploy_local_kind`，仅限 transition local-kind diagnostic profile | `<diagnostic-root>/lane-unified-deploy-local-kind/native/result.json` 与 `<diagnostic-root>/unified-deploy/local-kind/` | rollout | rendered image inventory 与 release contract 不一致、live imageID 缺失、不匹配 target digest |
| AgentSmith product flow aggregate | `lane-unified-deploy-product-flows` / `unified_deploy_product_flows` | `<diagnostic-root>/lane-unified-deploy-product-flows/native/result.json` 与 `<diagnostic-root>/unified-deploy/product-flows/` | product flows | 由 release kit 伪造、缺 required flows、仍从 Docker defaults 猜外部 substrate |

说明：

1. writer truth 仍是 `gate_id + line_kind`，campaign 和 release summary 都不是 writer。
2. P0 可以新增/调整 manifest 来支持真实 Kubernetes deploy diagnostics，但 deploy/package/operator verdict 归 release-kit repo-local gate/evidence；AgentSmith active release campaign 不消费这些诊断作为 product gate。在此之前，`existing_kubernetes` evidence 只能作为 operator deploy evidence，不得塞进 local-kind writer id。
3. `gate:release:full` 仍只聚合当前 manifest 声明的 required evidence，不执行、不重写 release kit diagnostic evidence。

### 7.4 Runner Contract v1

Runner contract 已从旧 `packages/agent-runner` shim 收敛到
`packages/agent-runner-contract` / `@mbos/agent-runner-contract` 方向。P4
已完成 AgentSmith formal artifact producer/checker（AgentSmith commit
`d6648303`）；正式 artifact 是外部 `runner-contract-artifact.json` + tgz，
包内 manifest 是 package manifest v1。`local_pack_manifest` 已被拒绝，
只能作为负向测试输入。

P4 完成后，唯一机器真相是 contract package 内的 schema/types/fixtures。
AsyncAPI 和协议文档是生成或校验输出；它们可以解释语义，但不能新增
contract package 没有的字段。AgentSmith 产品合同仍决定产品边界，runner
repo 只消费 contract package，不反向定义 Agent task 产品语义。

P5 request-scoped projected dependencies contract/env wiring focused slice 已完成：
`TaskExecutionContext.projected_dependencies` 是 optional request-scoped read-only
projection envelope；它可以被 runner 以 `MBOS_AGENT_PROJECTED_DEPENDENCIES`
bulk env 传给 helper/runtime，但 runner repo 不解释 Context Store、managed
credential、scope 或 write policy 语义。`projected_dependencies.dependencies.*.fields`
中的旧字段/旧职责继续 fail fast，不作为 legacy 成功路径。

v1 冻结：

- WS endpoint/auth/query/envelope；
- `server.hello`、`server.request.start`、`server.request.cancel`、`server.ping`；
- `server.terminal.start`、`server.terminal.adopt`、`server.terminal.close`；
- `agent.ready`、`agent.pong`、`agent.response.*`、`agent.terminal.*`；
- `TaskExecutionContext`，包含 request-scoped `resource_proxy` 和 optional
  `projected_dependencies`；
- runner support HTTP contract：execution ticket、workspace access/release、Context Store 请求级投影、managed credential 只读投影、resource proxy；
- `TASK_HOME` / `HOME` / `workspace_path` / `.artifacts` 路径约束；
- terminal recovery/adopt/close fixtures；
- 负向合同测试：已移除旧字段和已移除旧路径直接拒绝。

规则：

1. AgentSmith 和 runner repo 都依赖同一个 contract 包。
2. 不手工复制类型。
3. breaking change 升 major。
4. 不支持的 protocol version fail fast。
5. runner support HTTP contract 只冻结 wire shape 和 error shape；
   authorization、scope、resource ownership、write policy 与 managed credential
   语义来自 AgentSmith contract/fixtures。
6. AsyncAPI、协议文档、API 实现和 runner 实现都必须校验 against contract package；任何一方漂移都 fail fast。
7. runner repo 对 `projected_dependencies` 只做 opaque request projection env
   wiring；per-dependency env、Context Store scope/write policy、managed credential
   refresh/resolution、credential files 和 bearer token 都不是 runner 成功路径。

### 7.5 Truth Matrix

| Truth | Owner | 物理来源 | 生成器 | 校验器/消费者 | fail-fast 条件 |
| --- | --- | --- | --- | --- | --- |
| AgentSmith release contract | AgentSmith | AgentSmith CI artifact；runner digest 由 canonical `agentsmith-runner-image.lock` 通过 `runnerImageLock` 投影为 `managed_runner_image` 和 `deploy_image_inventory.id=managed_runner` | AgentSmith release contract generator | release kit、AgentSmith release contract validator、AgentSmith release boundary checker | 缺 digest、缺 provenance、repo identity 不匹配、tag-only image、OpenAPI/AsyncAPI/template digest 漂移、runner lock/contract managed runner image 漂移、caller 自报 `managed_runner_image` |
| Deploy template package | AgentSmith | AgentSmith CI artifact | AgentSmith deploy template package generator | AgentSmith release contract validator、release kit source-boundary guard | 缺 package URI、缺 digest、缺 provenance、缺 `required_image_ids`、manifest digest 漂移、release kit 猜 AgentSmith repo path |
| Deploy image inventory | AgentSmith | release contract 内 `deploy_image_inventory`，包含 `managed_runner` inventory alias | AgentSmith contract generator | release kit render/check、mirror、smoke | rendered workload image 不在 inventory、`required_image_ids` 未覆盖模板引用、managed runner inventory 未绑定 runner lock、target registry digest 不匹配、live imageID 不匹配 |
| Substrate connection truth | release kit 生成/校验，AgentSmith 定义 schema | neutral truth JSON | 后续 `kit_installed` installer slice 或 `external_declared` validator | render/apply/smoke、AgentSmith product flow producer | Docker truth 用于 external、缺 endpoint/secret ref/TLS/extension、明文 secret |
| Release kit evidence | release kit | release kit evidence root | release kit commands | AgentSmith thin adapter、operator runbook | 缺 input digest/provenance、stale evidence、writer id 不匹配、secret 泄露 |
| Runner contract | AgentSmith shared-contract flow | `@mbos/agent-runner-contract` package (`packages/agent-runner-contract/src`) schema/types/fixtures，以及 P4 产出的外部 `runner-contract-artifact.json` + tgz；包内 manifest 是 package manifest v1；`local_pack_manifest` 只作为负向测试输入；P5 request-scoped projected dependencies contract/env wiring focused slice 已完成，`TaskExecutionContext.projected_dependencies` 是 optional request projection envelope；已移除旧包 `@mbos/agent-runner` 是 pre-GA 旧输入，正式路径默认拒绝，只能出现在第 3.2 节定义的负向测试、失败边界、过渡期专项诊断或短期待删说明里；AgentSmith manifest/lock adoption 与 release contract runner digest adoption 已完成，剩余 P5 runtime 后续 wiring 完成后删除或归位 | AgentSmith runner contract artifact producer/checker from `@mbos/agent-runner-contract` | AgentSmith API、runner repo、AsyncAPI/doc checks、artifact-root install/import consumer test | 缺 descriptor `artifact.uri` / `artifact.sha256` / `artifact.integrity` 或 `artifact_provenance`、AsyncAPI 漂移、已移除旧字段、`projected_dependencies.dependencies.*.fields` 接受 `context_store` / `writable_scopes` / `managed_credential_refresh` / `credential_files` / `user_bearer_token`、unsupported protocol version、手工复制类型、正式路径接受 `local_pack_manifest` |
| Runner release manifest | `agentsmith-runner` | runner repo CI artifact；P5.3a 已有 skeleton/checker/start-guard；P5 image smoke 已有 no-push build/start evidence；P5 publish manifest final run `26662288580` 已上传 `runner-release-manifest`，subject/artifact sha `sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837`，image ref `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-f588d88@sha256:67fd8ba56dcbe763c1b9f81d1e18d7755f38c9eaf0db618554032aecb4be34f0`；AgentSmith positive fixture 已采用该 final manifest | runner repo release workflow；P5.3a skeleton generator 只要求 workflow/job/generator 非空，publish slice 绑定 final run/job/artifact URI、image digest 和 AgentSmith contract artifact package URI | AgentSmith runner lock checker；P5.3a 校验 manifest skeleton 和 fail-closed start guard；AgentSmith manifest/lock adoption 与 release contract runner digest adoption 已完成 | `image.id` 不是 `agentsmith-runner`、保留 `agent-task-runner` 旧别名、缺 image digest 或 `artifact_provenance`、`contract_artifact` 未绑定 P5.2 字段 `package_uri` / `package_sha256` / `package_integrity` / `descriptor_subject_sha256`、发明 `descriptor_uri` / `descriptor_sha256`、contract version 不匹配、producer repo 不是 `agentsmith-runner`、P5.3a skeleton 把 `artifact_provenance.artifact_sha256` 写成非 `subject_sha256` 或冒充可下载 artifact 内容 hash / 远端 artifact digest 证明、把 manifest/lock/contract adoption 写成 runtime/backend-real/release-kit readiness |
| Runner image lock | AgentSmith | canonical positive fixture `scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock` 已从 final publish manifest/run `26662288580` 投影更新，正式 lock identity 为 `agentsmith-runner`；旧 `agent-task-runner-image.lock` 已移出 positive fixture，`image_id=agent-task-runner` 只允许出现在负向测试/短期待删说明 | AgentSmith manifest/lock adoption PR | AgentSmith runner image lock checker、release contract generator、release boundary checker；backend-real 是后续专项 | lock 与 runner manifest 不一致、release contract `managed_runner_image` / `managed_runner` inventory 与 lock 不一致、接受 caller 自报 `managed_runner_image`、接受 `agent-task-runner` 作为正式 lock identity、保留旧别名 |

### 7.6 Provenance 与 Redaction

P0 必须定义一份最小 provenance schema，供 release contract、release kit evidence 和 runner manifest 复用。

最小字段：

- `provenance_kind: "ci_artifact" | "signed_operator_run"`
- `producer_repo`
- `normalized_remote`
- `commit_sha`
- `subject_name`
- `subject_sha256`
- `subject_uri`
- CI path: `workflow_name`、`run_id`、`run_attempt`、`job`
- signed operator path: `operator_run_id`、`operator_identity`、`signature_uri`、`signature_sha256`
- `artifact_uri`
- `artifact_sha256`
- `generated_at`
- `generator_version`
- `attestation_uri` 或明确 `attestation: none`

规则：

1. `subject_sha256` 永远哈 provenance 外部的 immutable subject，不能哈包含自身 provenance 的 JSON。
2. GitHub Actions / repo CI 必须校验 `normalized_remote` 指向 `github.com/agentsmith-project/<repo>`；本地路径不是 CI/release truth。
3. provenance kind 按 producer/run context 区分，不按 `distribution=online|airgap` 区分。
4. `ci_artifact` 用于 repo CI 生产的 AgentSmith release contract、runner release manifest 和 release kit CI evidence；缺 workflow/run/job 时失败。
5. P5.3a runner release manifest skeleton 阶段，`artifact_provenance.artifact_sha256 == subject_sha256` 只是 runner manifest subject binding / skeleton-compatible field，不是可下载 artifact 内容 hash 或远端 artifact digest 证明；P5 publish manifest slice 已有远端 artifact URI、subject hash、image digest 和 contract artifact package URI evidence，AgentSmith manifest/lock adoption、release contract runner digest adoption 与 release-kit managed runner image closure consumption 已完成；P3 airgap image load/import focused diagnostic 和 airgap focused deployment gate 已完成，剩余 blocker 是 airgap full offline install/package/adoption readiness 和 runtime/backend-real 专项。
6. `signed_operator_run` 用于 operator 在真实目标环境执行并签名的正式部署 evidence，包括 online 和 airgap；必须有 operator run id、operator identity、signature reference、subject sha256 和 runbook 声明的验证方式。
7. 本地生成且无签名的 artifact 可以用于 focused diagnostics，但 AgentSmith release adapter 不得把它当正式 release evidence。
8. redaction schema 必须覆盖 kubeconfig、pull secret、registry token、DB password、S3 secret、OIDC client secret、execution ticket、API token、managed credential 和完整连接串。
9. release kit、runner repo 和 AgentSmith adapter 都必须有 secret leak 负向测试；发现明文 secret 即失败。

## 8. 分阶段计划

### P0. 边界冻结，不搬代码

目标：先冻结边界、命名、schema/fixture/guard 入口，不搬代码；详细
evidence/provenance 生产与 adoption 在对应阶段落地。

工作：

1. 在 AgentSmith 增加 repo ownership matrix。
2. 增加 Repo Bootstrap Contract：本地 bootstrap 校验新 repo 位于 `/home/percy/works/mbos-v1/<repo>`，与 `agentsmith` 同级；远端 org 已有，canonical repo identity 是 `github.com/agentsmith-project/<repo>`，文档示例使用 `https://github.com/agentsmith-project/<repo>.git`，本地 origin 可以是等价的 HTTPS 或 SSH，只要 normalize 后 identity 一致；GitHub Actions / repo CI 只校验 GitHub org/repo identity、artifact provenance、contract 和 image digest，不校验 Percy 机器路径。
3. 增加 New Repo Governance Bootstrap Contract，并把第 4.1 节作为唯一
   bootstrap invariant；P0 只定义 identity、scope/non-goals、minimum bootstrap
   pack、quick guard 和 handoff 入口，不创建 repo、不迁代码、不发布。
4. 固定 runner repo 命名：`agentsmith-runner` 是唯一 canonical repo，`agentsmith-codex-runner` 只作为历史同级目录或归档对象，不作为 bootstrap 输入；增加归档/redirect checklist，并让 release lock/adoption guard 拒绝 `agentsmith-codex-runner` producer。
5. 同步更新权威合同和入口文档：`docs/contracts/unified-deploy-contract.md`、`docs/contracts/product-terminology.md`、runtime lines / unified deploy operations docs 必须增加 migration/vNext 说明，从 Docker-only/local-kind/`existing-cluster` pre-GA diagnostic baseline 逐步收敛到 deployment mode matrix 和 substrate connection truth；在 validator/fixtures 落地前，不能把 `external_declared` 或真实 cloud/airgap support 写成当前已支持事实。
6. 定义 deployment mode matrix：`target_cluster`、`substrate_source`、`distribution` 三轴，以及允许组合。
7. 定义 pre-GA profile vocabulary 映射口：唯一映射 `local-kind -> kind_rehearsal`、`existing-cluster -> existing_kubernetes`；release contract 和 release-kit evidence 只接受新轴值，只有 AgentSmith adapter 可以显式映射 non-canonical pre-GA profile name；P2/P6 移除这些 active workflow 后删除映射口。
8. 定义 `agentsmith-release-contract/v1` schema。
9. 定义中性 `substrate-connection truth/v1` schema。
10. 定义 release kit evidence schema。
11. 定义 runner contract package 的 v1 冻结范围。
12. 定义 release kit 如何读取 deploy template package；模板源码可以逐步迁到 release kit，但在迁移完成前必须由 AgentSmith 明确产出 template package，不允许 release kit 猜 repo 路径。`deploy_template_package.required_image_ids` 必须包含机器可读 required image IDs，并由 release contract generator/check 覆盖所有模板 image 引用和模板 image inventory 双向一致性。deploy template package 附近的 migration/vNext 说明不得形成长期迁移章节；必须说明旧输入不是正式路径，且只能按第 3.2 节归入一次性 operator note 或负向测试说明，带 owner、删除条件、删除时机/阶段和验收证据并 fail fast。
13. 定义 deterministic provenance subject：release contract body without provenance、release kit `evidence-subject.json`、runner manifest body without provenance；禁止 hash 包含自身 provenance 的 JSON。
14. 增加 truth matrix：release contract、deploy image inventory、substrate truth、release kit evidence、runner contract、runner release manifest、runner image lock 分别列 owner、物理来源、生成器、校验器、消费者、fail-fast 条件。
15. 增加 P0 handoff fixtures：release contract example、`external_declared` truth example、`kit_installed` truth example、release kit evidence example、runner manifest example。
16. 增加 release kit evidence adapter mapping，明确 release kit outputs 如何进入当前 `lane-unified-deploy-*` native `result.json`、`<campaign-root>/unified-deploy/*` 目录和 release summary 四段。
17. 增加 provenance/redaction schema 和 tests。
18. 增加 fail-fast contract tests：tag-only image、缺 digest、缺 required flow、deploy template `required_image_ids` 与 image inventory 不一致、`site.env.example` 被当作正式 image truth、已移除旧 runner field、release kit 误 import AgentSmith 产品源码、kind 被当成必需部署目标、`existing-cluster` 诊断被当成真实 cloud/airgap substrate 或 AgentSmith `release:ready` verdict、non-canonical pre-GA profile name 与新轴值混写、同义词漂移、`target_profiles.required` 缺失、或 formal adoption 翻 required 后被当成 optional、`--inputs` focused diagnostic 被当成 readiness、`--evidence` 接受未实现或不能重新语义校验的 output、external substrate 使用 Docker truth、local-kind evidence 冒充 existing Kubernetes evidence、明文 secret 泄露、缺 provenance、runner contract 与 AsyncAPI 漂移、provenance hash subject 自引用。

验收：

- 计划和 schema 能回答“谁负责、谁不负责、失败在哪里停”。
- 没有新增用户可见产品入口。
- 没有移动 runtime 代码。
- kind 被明确为 rehearsal，不是用户部署前提。
- P0 fixtures 通过 machine-readable validation。
- 当前 Docker-only truth 与 vNext neutral truth 的生效边界清楚，不互相冒充。
- provenance subject 和 redaction 负向测试通过。

建议验证：

```bash
npm run contracts:check
npm run contracts:check-current-verification-campaigns
```

### P1. AgentSmith 产出可消费 release contract

目标：AgentSmith 先成为清晰的制品提供方。

当前入口：P0 machine guards 已通过，P1.1 artifact producer 已通过；full P1
merge/adoption 必须等 P0 fixtures、provenance subject、redaction checks、
release evidence adapter mapping 和 release contract intake 三项 guard 通过。

工作：

1. AgentSmith CI 发布 product image digest，当前只覆盖 canonical `agentsmith_app`。它是单一 app image digest；不得为计划补 `web` / `api` / `product_schema_bootstrap` 假 component ID。未来真拆镜像时再新增 machine IDs、fixtures 和 tests。
2. 当前不发布 `managed_runner` 临时 digest；runner release proof 已由 P5 runner manifest/lock、AgentSmith lock adoption 和 release contract runner digest adoption 收口。
3. 生成 `agentsmith-release-contract.json`，包含 `product_images`、`adopted_provider_images`、`release_kit_prerequisite_images`、`deploy_image_inventory`、`deploy_template_package.required_image_ids` 和 `artifact_provenance`。
4. release summary 记录 release contract 路径、digest 和 provenance。
5. AgentSmith adapter 拒绝 local/stale/缺 provenance 的 release contract。
6. 保持 `npm run release:ready` 作为 AgentSmith product readiness / local complete / current product gate 入口不变，避免同时改产品验收和部署工具归属。
7. `site.env.example` 只能作为示例或本地诊断输入；正式 prerequisite image truth 只能来自 release contract、deploy template manifest 和 profile-specific env/schema。

P1.1 当前已完成：手动触发的 AgentSmith CI artifact producer 只生成并上传
`agentsmith-release-contract.json`。该 producer 的 provenance 只来自 GitHub CI 环境
（commit、workflow、run、attempt、job），输入只负责提供 digest-pinned image、template、
OpenAPI/AsyncAPI 和 profile 数据；它不是 AgentSmith product gate，也不是 deploy/package/operator verdict，也不表示 full P1 adoption 已完成。

验收：

- contract 中每个 image 都有 digest。
- 当前 `product_images` 只接受 `agentsmith_app`，没有 fake component ID。
- 当前 release contract 已通过 runner image lock 引入 `managed_runner` digest；P1.1 当时不得补临时 runner proof，历史缺席不回写成 P1.1 失败。
- contract 与当前 OpenAPI/AsyncAPI 和 deploy template digest 对齐。
- deploy image inventory 是唯一 image inventory 输入。
- `deploy_template_package.required_image_ids` 与 `deploy_image_inventory` 的模板 image 范围双向同步；缺失、孤儿 image 或模板引用未覆盖都失败。
- `release:ready` 仍使用当前产品证据闭环，不消费 deploy/package/operator verdict。

### P2. Release Kit Online MVP

目标：独立 repo 先跑通真实 Kubernetes online deploy，不碰产品验收；kind 只作为可选 rehearsal。

当前状态：P2 online target-registry confirmed apply/evidence spine 已在
release-kit sibling repo 完成：initial spine commit `2d4739b` remote
`agentsmith-project/agentsmith-release-kit` CI run `26439931859` success；
strict live ref no-op 修正 commit `5e08da3` 已提交推送，remote CI run
`26440847230` success。
本地按 GitHub Actions 顺序全量通过：`verify-release --quick`、`test-inputs`、
`test-template-package`、`test-render`、`test-render-check`、`test-image-map`、
`test-bundle-create`、`test-airgap-bundle-check`、`test-bundle-load-plan`、
`test-airgap-bundle-render-check`、`test-apply`、`test-rollout`、`test-smoke`、
`test-online-deployment-gate`、`test-evidence`、`test-target-preflight`；
额外 syntax/diff/secret scan passed，新增 diff 无真实 secret。
release-kit operator signoff intake focused guard 也已完成：sibling repo
commit `0854eeb`，GitHub Actions CI run `26444123230` success；
`--operator-signoff-intake` 只做 operator signoff intake JSON 与 confirmed
apply `online-deployment-gate-report.json` 的机器绑定校验，输出
`readiness=false`，绑定 release id、git sha、release contract raw sha256、
target profile、operator_run_id 和 raw online gate report sha；online gate
report 必须是 apply 模式、canonical focused chain steps，并包含
`capability_map` 和 `generated_at`；target-registry report 含 image-map 时，
operator signoff intake 接受 canonical `image-map,registry-presence`
producer sequence。
release-kit P2 operator-preloaded registry prerequisite binding 也已完成：
sibling repo commit `49caf6f`。本地 focused gates 已通过
`bash scripts/test-operator-signoff-intake.sh`、`bash scripts/test-evidence.sh`、
`bash scripts/test-online-deployment-gate.sh`、
`bash scripts/test-registry-presence.sh`、`bash scripts/test-target-preflight.sh`、
`bash scripts/verify-release.sh --quick`、`node --check` touched mjs、
`bash -n` touched sh 和 `git diff --check`。远端 GitHub 已记录 PushEvent 到
`main`，但 GitHub Actions run 仍未创建，沿用当前 GitHub Actions
outage/pending，不写 remote CI success。
后续同仓主线 commit `1d35fcc` 已有 remote CI run `26449565986` success，覆盖
registry-presence 和完整 focused gate 序列；这更新的是最新 head 证据，不把
`49caf6f` 本身的历史 push run 改写成 success。
上述 P2 远端 CI 证据只覆盖 online gate 的 target-registry confirmed apply、
rollout、smoke、online evidence root envelope positive path，以及 operator
signoff intake 与 confirmed apply online gate report 的机器绑定。`49caf6f`
本地证据覆盖 target-registry apply 必须带 `--registry-probe`、image-map 后
registry-presence、且 registry-presence 在 render/apply/rollout/smoke/evidence
前完成；source-registry apply 不受影响，target-registry server-dry-run 不要求且
不允许 probe。后续 P2 最小 online adoption 聚合已由 `--online-adoption`
切片收口，但这些 focused 证据和聚合报告仍不等于 registry mirror/login/push/pull、
deploy adoption、cloud provisioning、full release-kit verdict、formal release
gate、release-kit operator signature/identity/full
verdict（正式签名验证/身份/完整 verdict）、AgentSmith product-flow evidence
收口、airgap full offline install/package/adoption readiness、airgap ready 或
release readiness。

工作：

1. 先在 `agentsmith-release-kit` 按第 4.1 节完成 bootstrap-only/docs-governance-first PR；quick gate 通过不代表 release readiness。
2. bootstrap PR 通过前，repo-local workers 不迁部署工具、不迁 release-kit runtime；通过后只解锁专项开发，不解锁 release/adoption。
3. bootstrap PR 通过后，再迁入不依赖 AgentSmith 产品源码的 deploy 工具：manifest/render、Kubernetes apply/dry-run、substrate install/status/connection truth verify、address truth、API single-replica、route smoke。
4. 所有路径参数化，禁止默认读 AgentSmith repo root。
5. P2 online gate focused spine 已完成；source-registry apply 的 online gate base steps 固定为 `inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`。`target-preflight` 输入覆盖 host/TLS、pull secret、storage class、substrate secret refs；registry prerequisites allowlist 只允许 `pull_secret_ref`，拒绝 pseudo-proof/secret fields。`--online-deployment-gate --mode apply --target-registry` 必须带 `--registry-probe`；canonical producer sequence 是 `image-map,registry-presence`，且 registry-presence 必须在 render/apply/rollout/smoke/evidence 前完成。source-registry apply 不受影响；target-registry server-dry-run 不要求且不允许 `--registry-probe`。本切片不引入 provider matrix、rollback、airgap、镜像搬运/images mirror 或 cluster provisioning。
6. bootstrap 阶段 `release-kit --inputs` 和 `release-kit --evidence` 只做 focused diagnostic：
   `--inputs` 只能输出 `readiness=false` 的 `intake-report` / `image-digest-plan`；
   `--evidence` 只能接受当前 producer 可重新语义校验的 focused output：
   `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。
   `image-map.json` 在这里仅是 mirror/image-map focused diagnostic 的
   accepted/revalidatable focused output；image-map-only 不等于
   deploy/package/operator verdict 或 release readiness，接受它只是为了重校验
   mirror/image-map focused diagnostic，不代表部署成功。
   online evidence root 是 envelope/container，内含 `evidence.json`、
   `evidence-subject.json` 和 `online-deployment-gate-report.json`；可以被
   `--evidence` revalidate，但 root 名称不是 accepted focused output 值。
   `airgap-bundle-render-check-report.json` 虽已由 P3 focused diagnostic 产出，
   但仍保持 `readiness=false`，`--evidence` 继续拒收。
   `airgap-image-archive-check-report.json` 也已由 P3 focused diagnostic 产出，
   但仍保持 `readiness:false`、`scope: airgap_image_archive_content_check_only`，
   `--evidence` 继续拒收。
   `airgap-image-load-report.json` 已由 P3 focused diagnostic 产出，但仍保持
   `readiness:false`、`scope: airgap_image_load_only`，`--evidence` 继续拒收。
   `registry-presence-report.json` 只证明 deterministic mirror ref + operator
   probe digest match，也保持 `readiness=false`，`--evidence` 继续拒收。
   online gate report 若含 image-map，必须使用 canonical
   `image-map,registry-presence` producer sequence。
   `deploy-result.json#substrate` 等未来/预留 output 不进入长期发布/部署契约，未实现就 fail fast；当前 pre-GA/release-kit focused diagnostics 阶段，
   `target_profiles.required` 不是 readiness 开关，`required: true` 若被拒绝是 fail-fast posture。只有 P2/P3/P6 adoption 条件满足且 repo-local gate 拥有正式 evidence 后，才允许把组合翻为 required；缺 gate/evidence 就 fail fast。
7. `--operator-signoff-intake` 只做 intake JSON 与 confirmed apply online gate report 的绑定校验：release id、git sha、release contract raw sha256、target profile、operator_run_id 和 raw online gate report sha 必须一致；online gate report 必须是 apply 模式、canonical focused chain steps，并包含 `capability_map` 和 `generated_at`；target-registry report 含 image-map 时接受 canonical `image-map,registry-presence` producer sequence。它输出 `readiness=false`，不是 operator signature/identity/full verdict（正式签名验证、身份系统、完整 operator verdict），也不是 `--evidence` accepted output。
8. 当前完成项只使用 image-map target/adopted refs 做确认；registry presence 只要求 `target_image` 等于 release contract source image + `target_registry` 的 deterministic mirror ref，并要求 operator 只读 probe 返回同一 target digest。它不做 registry mirror/login/push/pull，不证明 deploy adoption，也不是 release readiness；未来若补 mirror execution，必须作为显式 operator/runbook 工作进入 repo-local gate。
9. `render/check` 必须验证 rendered workload images 全部来自 release contract 的 `deploy_image_inventory`，并覆盖 `deploy_template_package.required_image_ids`；当前 render 已使用 image-map 的 target refs。
10. `rollout/smoke` 必须采集所有 AgentSmith/runner/provider workload 的 live `imageID`，并和 release contract / target registry digest 对齐；当前 rollout 已对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。
11. API single-replica 等规则来源仍是 AgentSmith release contract / deploy contract；release kit 只执行检查，不独立定义产品部署规则。
12. online release-kit verdict 必须覆盖 `use_existing` 和
    `install_substrates` 两种 operator-facing substrate strategy；机器值分别是
    `target_cluster=existing_kubernetes, substrate_source=external_declared, distribution=online`
    与
    `target_cluster=existing_kubernetes, substrate_source=kit_installed, distribution=online`。
    当前 `online/use_existing` confirmed apply、`kit_installed/online` focused
    composition/evidence parity 和 release-kit repo-local online adoption
    aggregation 都已完成；`online-adoption-report.json` 只输出
    digest/provenance/coverage summary 且 `readiness=false`。AgentSmith
    link-level handoff validator 已完成，但未接入 `release:ready` 或
    `contracts:check`；full release-kit verdict / formal release gate 仍未完成，
    不能据此给 deployment/package/operator verdict。
13. `kind_rehearsal + kit_installed + online` 只作为本机/CI 证明工具；kind 是可选
    local option，不是生产默认，也不是用户部署前提。
14. `existing_kubernetes + kit_installed` 不做 provider matrix，不创建云资源；只安装
    release-kit 管理的最小 substrate pack，并产出与 `use_existing` 同形的连接真相。
15. `agentsmith-release-kit` 必须把 source-boundary、remote identity、provenance check 作为 repo-local required CI；AgentSmith sibling scan/handoff evidence 只能证明交接输入可读，不能替代 release-kit CI。
16. AgentSmith 保留 thin adapter 只用于读取/链接 release-kit repo-local verdict artifact；不得把这些 artifact 接回 AgentSmith release campaign，也不得新增第二套 AgentSmith verdict。

不迁：

- `check-product-flows.ts`
- visual
- backend-real
- story/e2e
- product DB/bootstrap 语义

验收：

- online deploy focused spine 能从 GHCR/digest 或 operator 指定 target/adopted refs 渲染并执行 apply、rollout、smoke。
- `online + use_existing` 的 focused path 能产出 preflight、render、render-check、apply、rollout、smoke 和 online evidence root envelope，并通过 `--evidence` revalidation；内部机器值是 `existing_kubernetes + external_declared + online`。
- `online + install_substrates` / `existing_kubernetes + kit_installed + online` focused composition/evidence parity 已完成；它仍不是 full release-kit verdict、formal release gate 或 release readiness，缺正式 repo-local verdict/adoption 收口时不能给 deployment/package/operator verdict。
- P2 online target-registry confirmed apply/evidence spine 已有 initial spine commit `2d4739b`、remote CI run `26439931859` success；strict live ref no-op 修正 commit `5e08da3` 已提交推送，remote CI run `26440847230` success，本地 GitHub Actions 顺序全量通过；这不是 full release-kit verdict、formal release gate、release-kit operator signature/identity/full verdict（正式签名验证/身份/完整 verdict）、AgentSmith product-flow evidence 收口或 release readiness 证据。
- release-kit operator signoff intake focused guard 已有 commit `0854eeb`、GitHub Actions CI run `26444123230` success；它只证明 intake JSON 与 confirmed apply `online-deployment-gate-report.json` 的 release id、git sha、release contract raw sha256、target profile、operator_run_id 和 raw online gate report sha 绑定关系；target-registry report 含 image-map 时接受 canonical `image-map,registry-presence` producer sequence。不证明 operator signature/identity/full verdict（正式签名验证、身份系统、完整 operator verdict）、registry mirror/login/push/pull、full release-kit verdict 或 release readiness。
- release-kit P2 最小 online adoption 聚合已完成：`dc0ec224e60d128c262343cbf0d95c42851c36ed` 新增 `--online-adoption` 和 `online-adoption-report.json`，要求 `online/use_existing` + `online/install_substrates` 两路 confirmed apply/evidence root，输出 digest/provenance/coverage summary 且 `readiness=false`；`50b8f7127260b4e7102932f2431f95f8a40ad0cc` 将 `bash scripts/test-online-adoption.sh` 接入 CI，CI run `26666469542` success 且包含 `Online adoption aggregation focused guard` success。本地/worker 验证 `bash scripts/test-online-adoption.sh`、`bash scripts/test-operator-release-surface.sh`、`bash scripts/test-online-deployment-gate.sh`、`bash scripts/test-evidence.sh`、`bash scripts/verify-release.sh --quick`、`git diff --check` 通过。它不是 release readiness、deploy/package/operator verdict 或 release engineering gate；AgentSmith link-level handoff validator 已完成但不接入 `release:ready` / `contracts:check`，下一步转为 release-kit formal release engineering gate / offline install-deploy / operator adoption，或继续 P6-lite 文档/旧引用清理。
- release-kit operator-preloaded registry prerequisite binding 已有 commit `49caf6f`；`--online-deployment-gate --mode apply --target-registry` 必须带 `--registry-probe`，registry-presence 必须在 image-map 后、render/apply/rollout/smoke/evidence 前完成。source-registry apply 不受影响；target-registry server-dry-run 不要求且不允许 probe。standalone `registry-presence-report.json` 仍被 `--evidence` 拒收。本地 gates 已通过，但远端 GitHub 只记录 PushEvent，GitHub Actions run 仍未创建。这里是 GitHub Actions outage/pending，不是 remote CI success。
- 后续 release-kit mainline commit `1d35fcc` 的 remote CI run `26449565986` success 已覆盖 quick、inputs、template-package、render、render-check、image-map、registry-presence、bundle-create、airgap-bundle-check、airgap-image-archive-check、bundle-load-plan、airgap-bundle-render-check、apply、rollout、smoke、online-deployment-gate、operator-signoff-intake、evidence、target-preflight；这是最新 head 证据，不是 `49caf6f` 历史 push run success。
- 本切片不做 registry mirror/login/push/pull，不把 probe presence 写成 deploy adoption，不做 release readiness，不做 operator signature/identity/full verdict，不做 cloud provisioning。
- 当前 AgentSmith `existing-cluster` 诊断在 release-kit formal release gate / offline install-deploy / operator adoption 收口前仍明确降级为 Docker substrate/IP-only transition diagnostic；任何把它写成真实 online/cloud/airgap substrate evidence 的路径都失败。
- `install_substrates` 的内部机器值是 `kit_installed`；`kit_installed/online` focused composition/evidence parity 已完成，但只做最小 substrate pack + pod-routability preflight 的 focused 证据边界；不做 provider matrix，也不能写成当前 release-ready deploy snapshot、full release-kit verdict 或 formal release gate。
- kind rehearsal 只是 optional local capability；当前不是 release-kit executable evidence，不产出当前 release readiness 证据，也不是用户真实部署前提。
- real Kubernetes/cloud smoke 只证明目标集群安装和路由，不声称 product flows 通过。
- P2 过渡说明以当前边界为准：AgentSmith `release:ready` 是 product readiness / local complete / current product gate，不要求 dependencies/images/rollout/product-flow deploy evidence；这些 unified deploy outputs 只保留为过渡期专项诊断，直到 P2/P3/P6 收口时从 AgentSmith active status/workflow 删除或隐藏。这里不暗示未来 AgentSmith release campaign 会继续消费它们。
- release kit CI 至少覆盖 contract schema、render/dry-run、digest-only、no source import；真实 Kubernetes/cloud smoke 可以是手动或 scheduled，需要 secrets/kubeconfig 时必须产出同一 evidence schema。
- release kit repo-local CI 覆盖 source-boundary、canonical remote identity 和 provenance；AgentSmith handoff scan 不算替代证明。
- AgentSmith transition diagnostic profile 还是 local-kind 时，真实 Kubernetes/cloud evidence 只能作为 operator deploy evidence；除非当前 manifest 显式新增/调整 writer，否则不能写入 local-kind gate id。

### P3. Release Kit Airgap MVP

目标：产出 airgap mechanism / dynamic image closure 的离线发布包能力；airgap
必须覆盖 `use_existing` 和 `install_substrates` 两种 operator-facing substrate
strategy；内部机器值分别是 `existing_kubernetes + external_declared + airgap`
和 `existing_kubernetes + kit_installed + airgap`。kind 只能作为离线包机械自测、本机诊断或 CI rehearsal，不是 airgap
declarable target，也不能替代真实 Kubernetes airgap evidence。
product-full offline package 的 blocker 已从 P5 runner digest/adoption 转为
airgap full offline install/package/adoption readiness 和 runtime/backend-real 专项；
release-kit managed runner image closure consumption blocker 已解除。

当前状态：P3 `--airgap-bundle-render-check` focused diagnostic 已在
release-kit sibling repo 完成（commit `3453c7d`，remote CI success）。它只证明
already assembled airgap bundle 的 bundle-local offline render、render-check 和
target image inventory，输出 `readiness=false`；不证明 registry execution、image
load/import、offline install、deploy/package/release readiness 或 product-full
offline package。
`--evidence` 仍拒收 `airgap-bundle-render-check-report.json`。post-hardening
review 已修复 forward-slash UNC-like path `//server/share/...` fail-fast 缺口。
P3 app-current image inventory closure 已完成（commit `b6e2fe7`，remote CI run
`26447029947` success）：valid fixtures 当时升级到 6 个 app-current image ids
`agentsmith_app`、`llmup`、`afscp`、`asbcp`、
`ingress_nginx_controller`、`ingress_nginx_certgen`；`required_image_ids` 在
inputs/template-package/airgap-bundle-check/image-map/render 关键入口做
exact-set closure，并校验 required ids 存在于 `deploy_image_inventory`；
bundle create/load-plan/render-check 相关测试不再隐含 pre-GA 旧 3-image 输入；
当前规范口径是 dynamic release contract image closure，不把 6-image 历史切片写成
长期固定清单。
render/apply/rollout 旁路测试修掉 unknown digest 碰撞。它仍是 focused
diagnostic / inventory truth closure，不做 registry login/pull/push/mirror、
image load/import、offline install/apply/smoke、render-check
report 接入 evidence 或 release readiness。
P3 airgap image archive materiality focused diagnostic 已完成（commit
`1d35fcc` / `1d35fcca7c9742a28dfb1220bd3ea777000ee7da`，remote CI run
`26449565986` success，head `1d35fcc`）。新增
`--airgap-image-archive-check` 只接受
`existing_kubernetes/external_declared/airgap`，先复用
`--airgap-bundle-check`，再用 operator-owned trusted local `--archive-probe`
检查每个 bundle image archive stdout digest 与 image-map `target_digest` /
release contract / bundle manifest 对齐；输出
`airgap-image-archive-check-report.json`、`readiness:false`、
`scope: airgap_image_archive_content_check_only`，且 `--evidence` 明确拒收。
probe 信任边界是 operator-owned/trusted local executable；release-kit 不
sandbox、不证明 probe 自身可信，只校验 stdout digest alignment。它不是
airgap ready 或 release readiness，不做 docker/skopeo/oras/kubectl/curl/wget
调用，不做 registry mirror/login/push/pull/import，不做 image load/import/
offline install/apply/smoke，也不做 package/deploy/release readiness 或
kind/cloud/provider matrix。
P3 airgap image load/import focused diagnostic 已完成（commit
`11e3964` / `11e39646992cd27522f35b34af0bb3138e2c3f29`，remote CI run
`26514017089` success）。本地 evidence：`bash scripts/test-airgap-image-load.sh`
passed，`bash scripts/test-evidence.sh` passed，`node --check
scripts/verify-airgap-image-load.mjs scripts/verify-evidence.mjs` passed，
`bash -n scripts/test-airgap-image-load.sh scripts/verify-release.sh` passed，
release-kit `git diff --check` passed。新增 `--airgap-image-load` 只接受
`existing_kubernetes/external_declared/airgap`，先复用
`--airgap-image-archive-check`，再调用 operator-provided `--image-loader`；
输出 `airgap-image-load-report.json`、`readiness:false`、
`scope: airgap_image_load_only`，且 `--evidence` 明确拒收。loader 信任边界是
operator-owned executable；release-kit 不选择 Docker/skopeo/oras/kubectl 或
registry credentials，只校验 loader stdout digest 与 `target_digest` 对齐。
它不是 offline install/deploy/package/registry/release readiness，也不是
airgap ready。

工作：

1. 先实现 `bundle verify` 覆盖 online deploy 产物，再实现 `bundle create`、`bundle load`、`bundle apply`、`bundle smoke`。
2. 离线包包含所有实际会被安装触达的 images、deploy templates、profile-specific env/schema、scripts、runbook、checksums。
3. image bundle 使用统一 manifest，记录 source image、archive sha256、target registry digest。
4. 增加 target registry mirror map，支持真实集群使用 operator 指定的离线 registry。
5. 增加断网演练：不允许运行时联网拉 image、下载 tool 或访问在线 registry。
6. 禁止在 airgap 路径从公网下载工具、模板或 image；`use_existing` 可以把目标网络内的 operator-declared substrate endpoint 作为 prerequisite 校验，但不代表 release kit 创建云资源；`install_substrates` 必须从 airgap 包内安装最小 substrate pack。
7. 所有工具只有两种来源：包内携带并带 sha256，或 operator prerequisite 明确声明名称、版本、安装位置和 proof；两者都没有时 fail fast。
8. 已完成的 `--airgap-image-archive-check` 只证明 archive content materiality
   digest alignment；不能从该 report 推导 image load/import、offline
   install/apply/smoke 或 release readiness。
9. 已完成的 `--airgap-image-load` 只证明 focused operator-loader execution；
   后续若要做 offline install/apply/smoke，必须作为新的 P3 mechanism
   workstream 显式补齐，不能从该 report 推导。

image 范围由 release contract 的 `deploy_image_inventory`、
`deploy_template_package.required_image_ids`、rendered manifests 和 operator
prerequisite 声明共同校验，避免手写清单漂移。`site.env.example` 不是正式
image truth。
P3 app-current exact set（`agentsmith_app`、`llmup`、`afscp`、`asbcp`、
`ingress_nginx_controller`、`ingress_nginx_certgen`）只保留为已完成 focused
slice 的历史证据。当前 active truth 是 dynamic release contract image closure
和 `deploy_template_package.required_image_ids`；pre-GA 不保留旧 3-image 正式成功路径。
最小类别：

- AgentSmith components：`agentsmith_app`（当前单一 canonical product image；未来真拆镜像时按 P1 guard 新增 machine IDs、fixtures 和 tests）；
- managed runner：仅在 P5 runner manifest/lock adoption 后由 release contract 的 `deploy_image_inventory` 引入；P1/P3 不伪造临时 digest 或 archive 要求；
- ASBCP、AFSCP、LLMUP；
- ingress controller / certgen；
- `install_substrates` bundle 需要的 substrate images；内部机器值是 `kit_installed`：PostgreSQL/pgvector、MongoDB、Redis、MinIO、MinIO client、Keycloak；
- `kind_rehearsal` 需要的 registry/kind node/CSI 相关 images；
- `use_existing` app bundle 可以把外部依赖列为 operator prerequisite；内部机器值是 `existing_kubernetes + external_declared`，且必须有明确 prerequisite/evidence，不静默在线拉取。

验收：

- 缺任一 image archive 失败。
- digest mismatch 失败。
- tag-only image 失败。
- 缺工具或工具 proof 失败。
- verify/load/render/apply/smoke 任一步尝试联网下载失败。
- `airgap + use_existing` 和 `airgap + install_substrates` 都必须在断网环境基于
  dynamic release contract image closure 完成 `verify/load/render/apply/smoke`；内部机器值分别是
  `existing_kubernetes + external_declared + airgap` 和
  `existing_kubernetes + kit_installed + airgap`；
  product-full package 当前剩余 blocker 是 airgap full offline install/package/adoption readiness、
  substrate install strategy evidence 和 runtime/backend-real 专项，release-kit managed
  runner image closure consumption blocker 已解除。
- 已完成的 `--airgap-image-archive-check` 只作为
  `existing_kubernetes/external_declared/airgap` 的 image archive materiality
  focused diagnostic；缺 archive 或 stdout digest 与 image-map `target_digest`
  / release contract / bundle manifest 不一致时失败，但它不证明 probe 自身可信、
  不证明 load/import/offline install/apply/smoke，也不是 airgap ready 或
  release readiness。
- 已完成的 `--airgap-image-load` 只作为
  `existing_kubernetes/external_declared/airgap` 的 focused operator-loader
  execution diagnostic；它必须先复用 archive check，再调用 operator-provided
  loader 并校验 stdout digest 与 `target_digest` 对齐，但不证明 offline
  install/apply/smoke，也不是 registry readiness、airgap ready 或 release
  readiness；`airgap-image-load-report.json` 仍被 `--evidence` 拒收。
- `kind_rehearsal` 在 `kit_installed/online` focused composition 中只作为可选演练；kind 可做离线包机械自测、本机诊断或 CI rehearsal，但不是 airgap declarable target，不能替代真实 Kubernetes 的 `use_existing` 或 `install_substrates` airgap evidence。
- 正式手工 operator signoff / verdict 仍单独记录，不能被 intake 绑定自动化冒充。

### P4. AgentSmith 发布 Runner Contract 包

目标：先由 AgentSmith 合同/共享合同流程把 runner 协议发布成稳定包，再迁执行进程。

当前状态：P4 已完成（AgentSmith commit `d6648303`）。正式 artifact 是外部
`runner-contract-artifact.json` + tgz，包内 manifest 是 package manifest
v1；GitHub Actions 先把 artifact 下载到本地 artifact root，再由 AgentSmith
producer/checker 用 `--artifact-root` 覆盖可发布、descriptor/tgz、
`artifact.uri` / `artifact.sha256` / `artifact.integrity` 与
`artifact_provenance` binding 校验、安装和消费。`local_pack_manifest`
不是正式输入，只保留为负向测试语境。

工作：

1. 在现有 `packages/agent-runner-contract` 上完成唯一正式 contract 包 `@mbos/agent-runner-contract` 的可发布、可消费 artifact 最小闭环；P4 完成后 schema/types/fixtures 是唯一机器真相。
2. artifact 至少包含 machine-readable schema、types、fixtures、版本、descriptor `artifact.uri` / `artifact.sha256` / `artifact.integrity` 和 `artifact_provenance`；AgentSmith 本仓用同一 artifact 消费路径验证，不能依赖 runner runtime 源码。
3. AsyncAPI 和协议文档改为从 contract package 生成或被 contract package 校验；漂移即 fail fast。
4. AgentSmith API 和 runner repo 都只依赖这个包；P4 只提供 runner repo consumer diagnostic skeleton 所需的合同输入，不迁 runner runtime。
5. 增加 protocol、terminal recovery/adopt/close 和 runner support HTTP conformance tests；runner support HTTP 只冻结 wire shape 和 error shape，不定义 authorization/scope/resource ownership 语义。
6. 增加 artifact-root 安装/导入 consumer test：GitHub Actions 先把 artifact 下载到本地 artifact root，再用 `--artifact-root` 校验 descriptor/tgz、`artifact.uri` / `artifact.sha256` / `artifact.integrity` 与 `artifact_provenance` binding，并在干净 consumer workspace 安装、导入和运行 fixtures。

验收：

- AgentSmith 不再直接依赖 runner 实现类型。
- `@mbos/agent-runner-contract` artifact 可以发布，并能在已下载 artifact root 下被 AgentSmith 安装、消费和校验，且 descriptor/tgz、`artifact.uri` / `artifact.sha256` / `artifact.integrity` 与 `artifact_provenance` binding 不缺失。
- 已移除旧字段和已移除旧路径在 pre-GA 直接 fail-fast 拒绝，负向测试通过。
- protocol version 不匹配时 fail fast。
- execution ticket、workspace access/release、Context Store 请求级投影、managed credential 只读投影都有 fixtures。
- AsyncAPI `execution_context` 与 contract package 保持机器校验一致。
- runner runtime 仍未迁出；P4 不以 runtime 迁移作为完成条件。

### P5. Runner Repo Consumer Skeleton 与 Runtime 迁移

目标：先让 runner repo 证明能消费 `@mbos/agent-runner-contract`，再把 runner 执行进程和 image 构建迁出。

当前状态：P5.0 已完成（runner repo commit `02feee8`）。runner repo 已有
contract artifact consumer diagnostic skeleton，能通过 `--artifact-root <dir>`
消费已下载的 `runner-contract-artifact.json` + tgz，并校验 descriptor/tgz/
`artifact.uri` / `artifact.sha256` / `artifact.integrity` 与
`artifact_provenance` binding。P5.1 start guard 已完成
（runner repo commit `cdfa800`），local consumer / start-guard /
full-gate-fail-closed checks passed，remote CI success。P5.2 formal artifact
handoff 已完成（AgentSmith commit `fcecb85b feat: add runner repo contract handoff`）：
AgentSmith `runner-repo-contract-handoff` job 从同 run 下载 producer artifact
root，并调用 runner repo `--contract-consumer` 消费它。这只证明 AgentSmith
producer 产物能被 runner repo consumer 消费，不是 runtime migration、image
adoption 或 release readiness。P5.3a release manifest skeleton/checker/start-guard
集成已完成（runner repo commit `7c43ba8 feat: add runner release manifest skeleton`，
已推送到 `agentsmith-project/agentsmith-runner` main；remote CI run
`26455289999` success，jobs `Quick governance` 和 `Runner start guard`
success）。P5.3a 只证明 release manifest skeleton 可校验、可接入 start
guard，且默认 full release gate fail-closed；不是 runtime migration、image
build/publish、AgentSmith adoption、lock update 或 release readiness。P5.3b
first half 已完成并推进到 boundary closure：`a6ddb50 fix: keep runner skills
projection-only` 保留为 projection-only builtin skills 修复事实；
`fd6d851 fix: keep runner workspace contract-only` 保持 runner workspace
contract-only，移除 workspace-access/file-library product API、AFSCP binding
schema 和 release fence payload，`prepareTaskWorkspace` 只消费
`@mbos/agent-runner-contract` execution context/path fields，release no-op，
`agent.response.done` 不再伪造 `usage_tokens`；`4dbbd26 fix: keep runner
artifact scan policy-local` 保持 artifact scan policy-local，只保留 runner
runtime/local tool roots filtering；当前 P5.3b boundary closure runner HEAD 是
`7d21959 test: harden runner product boundary guard`，guard/self-test 覆盖
`.trash`、`.minio.sys`、file-library reserved namespace、`usage_tokens` 多种
键/赋值形态、workspace-access/release fence 等 forbidden patterns。remote CI：
`a6ddb50` run `26463276084` success；`fd6d851` run `26465341186` success；
`4dbbd26` run `26465733200` success；`7d21959` run `26465985945`
success。runner repo 已拥有 repo-local runtime source、builtin skills、
root package/tsconfig/vitest、source-boundary/product semantics guard、runtime
fast focused diagnostic 和 clean-dependency start-guard guard；builtin skill
runtime 已从本地定义 Context Store scopes / writable scopes / managed
credential resolution/refresh endpoint，收敛为只消费 AgentSmith 已提供的
opaque request projections + explicit CLI 参数。本地 evidence：`bash scripts/test-runner-runtime-fast.sh`
passed，Vitest 16 files / 152 tests passed，builtin skill Python tests 3+2+4
passed；`bash scripts/verify-release.sh --quick` passed；`bash scripts/verify-release.sh --start-guard`
passed；`npm run build` passed；clean no-node_modules start-guard passed；
clean no-node_modules runtime fast expected fail-fast rc=2 with explicit
dependency/artifact message。`--start-guard` 在 clean CI 不跑 runtime fast；
runtime fast 需要显式 contract artifact package/dev deps；
`@mbos/agent-runner-contract` 当前未发布到 npm，普通 `npm install` 不能写成证据。
AgentSmith contract 已把 `agent.response.done.payload.usage_tokens` 从必填修为
可选；缺省表示 runner 未上报真实 usage，runner 不得本地估算；这不是后端行为
新增，后端原本已按 optional 处理。
P5 focused image build/start smoke 已完成：runner repo commit `b80ea3c feat: add runner image smoke gate`，
remote CI run `26468415599` success，jobs `Runner image smoke`、`Runner skeleton start guard`
和 `Quick governance` success；本地主控 evidence 覆盖 quick/start-guard、
explicit artifact root `/tmp/agentsmith-runner-contract-artifact.xxwfV1` 的
`--contract-consumer`、`--image-smoke` Docker build 和 missing-env `Usage`
fail-fast、`git diff --check`。只读 review 无阻断；ADR bootstrap 历史口径和
PR template image smoke checklist 两个 low consistency gap 已修复。
P5 runner publish manifest focused evidence 已完成：runner final HEAD `f588d88`，
final publish run `26662288580` success，manifest subject/artifact sha
`sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837`，published
image ref `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-f588d88@sha256:67fd8ba56dcbe763c1b9f81d1e18d7755f38c9eaf0db618554032aecb4be34f0`。
AgentSmith manifest/lock adoption 已完成：positive manifest fixture 与 canonical
`agentsmith-runner-image.lock` 已采用 final publish manifest/run `26662288580`
投影；release contract runner digest adoption 也已完成；release-kit managed runner
image closure consumption 已完成；AgentSmith 侧 support API / projection contract
一致性也已由当前 gate 切片收口；P5 request-scoped projected dependencies
contract/env wiring focused slice 已完成。下一步不是从 manifest/lock adoption 或该切片
直接跳到 release readiness，而是 P2/P3 deployment/operator/adoption 和
backend-real、真实 LLM、full runtime semantics 后续专项，按 KISS 小切片推进。

工作：

1. P5.0 已完成 consumer diagnostic skeleton：通过 `--artifact-root <dir>` 消费已下载的 `@mbos/agent-runner-contract` artifact root，校验 descriptor/tgz、`artifact.uri` / `artifact.sha256` / `artifact.integrity` 与 `artifact_provenance` binding，在干净 workspace 安装/导入 smoke 并跑基础 protocol fixtures，证明 runner repo 能消费正式 artifact。KISS 默认是 CI/handoff 显式提供已下载 artifact root；未来若需要真实 URI downloader，归 future downloader/adoption/provenance work，不回写成 P5.1/P5.2 已完成事实。
2. P5.1 start guard 已完成：consumer diagnostic skeleton 已接入 repo-local start guard / required CI，local consumer / start-guard / full-gate-fail-closed checks passed，remote CI success。P5.1 已完成边界只到 runner contract consumer skeleton、start guard 和 CI 化；不表示 HOME/TASK_HOME guard、request-scoped env projection、credential non-persistence、ticket/scope semantics、runtime smoke、Docker 或 image checks 已完成。
3. P5.2 formal artifact handoff 已完成：`.github/workflows/runner-contract-artifact.yml` 的 `runner-repo-contract-handoff` 依赖 `produce-runner-contract-artifact`，下载同 run 的 `agentsmith-runner-contract-artifact`，checkout `agentsmith-project/agentsmith-runner` 到 `agentsmith-runner`，运行 `bash scripts/verify-release.sh --contract-consumer --artifact-root "$GITHUB_WORKSPACE/artifacts/runner-contract-download"`。Governance guard 固定 handoff job 为 5 个步骤、2 个 run step，禁止混入 release readiness/runtime/image/adoption/signing/attestation/downloader。
4. P5.3a release manifest skeleton/checker/start-guard 集成已完成：runner repo commit `7c43ba8 feat: add runner release manifest skeleton` 已推送到 `agentsmith-project/agentsmith-runner` main；remote CI run `26455289999` 成功，jobs `Quick governance` 和 `Runner start guard` 成功。本地 runner evidence：`bash scripts/test-runner-release-manifest.sh` passed；`node --check scripts/check-runner-release-manifest.mjs` passed；`bash scripts/verify-release.sh --quick` passed；`bash scripts/verify-release.sh --start-guard` passed；`bash -n scripts/verify-release.sh scripts/test-runner-release-manifest.sh scripts/check-governance-guard.sh scripts/test-runner-contract-consumer.sh` passed；`git diff --check` passed；`bash scripts/verify-release.sh` 默认 fail-closed，退出码 2，明确 full release gate 未实现。
5. P5.3a 设计收口：`image.id` 使用 `agentsmith-runner`，不保留 `agent-task-runner` 旧别名；`contract_artifact` 绑定 P5.2 正式事实字段 `package_uri`、`package_sha256`、`package_integrity`、`descriptor_subject_sha256`，不发明 `descriptor_uri` / `descriptor_sha256`；workflow/job/generator 只要求非空，不硬编码未来 release producer；P5.3a skeleton 阶段 `artifact_provenance.artifact_sha256 == subject_sha256` 只是 runner manifest subject binding / skeleton-compatible field，不是可下载 artifact 内容 hash 或远端 artifact digest 证明；CLI/docs 使用 `<manifest-path>`。team review 结论是之前两个 block（旧 image id、contract_artifact 不对齐 P5.2 handoff / artifact_sha256 未绑定）已修正；最终复核无语义阻断，只提醒新增脚本必须纳入 commit，已纳入。
6. P5.1/P5.2/P5.3a 通过只解锁 runtime 迁移、publish manifest 和 manifest/lock adoption 专项（现已完成）；P5.3b first half/boundary closure 只证明 repo-local runtime source、builtin skills、runtime fast focused diagnostic、source-boundary/product semantics guard、clean-dependency start-guard guard 和产品语义防回流 guard，不解锁 release/adoption。P5 focused image smoke 只证明 no-push image build/start missing-env fail-fast；P5 publish manifest slice 只证明 focused GHCR publish + manifest artifact evidence；AgentSmith manifest/lock adoption、release contract runner digest adoption、AgentSmith 侧 support API / projection contract consistency focused gate、P5 request-scoped projected dependencies contract/env wiring focused slice 和 fake-Codex focused task-execution image smoke 已完成，但 backend-real、真实 LLM、full runtime semantics 和 adoption 串联仍必须在后续 P5 runtime/conformance/adoption gates 里验证。
7. P5.3b first half 已迁入 repo-local runtime source、builtin skills、root package/tsconfig/vitest 和 runner 单测 fast gate，并完成 projection-only / contract-only / policy-local boundary closure：builtin skill runtime 只消费 AgentSmith 已提供的 opaque request projections + explicit CLI 参数，不在 runner repo 本地定义 Context Store scopes / writable scopes / managed credential resolution/refresh endpoint；`prepareTaskWorkspace` 只消费 `@mbos/agent-runner-contract` execution context/path fields；artifact scan 只保留 runner runtime/local tool roots filtering；`agent.response.done` 不伪造 `usage_tokens`。runner no-push Dockerfile/image smoke、focused publish manifest evidence、AgentSmith manifest/lock adoption、release contract runner digest adoption、release-kit managed runner image closure consumption、AgentSmith 侧 support API / projection contract consistency focused gate 和 P5 request-scoped projected dependencies contract/env wiring 已完成。旧 `packages/agent-task-runner` 路径/包名只作为负向测试或短期待删说明，不作为正式成功路径。
8. Runner repo 不允许定义 Context Store scopes、Files/file-library 行为、managed credential resolution、execution ticket 颁发或权限语义；这些语义仍由 AgentSmith contract/support API 和 fixtures 定义，runner 只消费请求级只读投影并执行本地 runtime；`MBOS_AGENT_PROJECTED_DEPENDENCIES` 是 bulk opaque env，不是 runner 侧 per-dependency env 或语义扩张；`mbos-context` 只能被执行/打包，不能定义 scope、write policy 或 managed credential 语义。`scripts/check-runner-source-boundary.mjs` 的 product semantics guard 禁止 runner repo 定义 `project_member` / `writable_scopes` / `context_store` capability/managed credential schemas、`/context` endpoints、managed credential refresh/key semantics、workspace-access/release fence、file-library reserved namespace policy 和 `usage_tokens` 本地估算/伪造形态；local dependency protocols 也增加 `portal:`。该 keyword/static guard 只是 fail-fast 下限；完整“不负责”清单仍以第 4 节职责表和 contract wire shape 为准，runner repo 不承载 Agent task API、Agent Runners API、runner key、presence/heartbeat、Files、audit/usage 等产品语义。
9. P5.1 repo-local start guard 已有 consumer / start-guard / full-gate-fail-closed 本地证据；P5.2 AgentSmith workflow handoff 已有同 run artifact 下载和 runner repo `--contract-consumer` 证据；P5.3a 已有 manifest skeleton/checker/start-guard 证据；P5.3b first half 已有 runtime fast、builtin skill Python tests 3+2+4、verify-release quick/start-guard、build、clean no-node_modules start-guard 和 clean dependency fail-fast 证据，boundary closure HEAD 是 `7d21959`，remote CI run `26465985945` 已成功。P5 focused image smoke 已有 `b80ea3c` / run `26468415599` 证据；P5 publish manifest focused evidence 已有 final HEAD `f588d88` / run `26662288580` / subject sha `sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837` 证据；P5 request-scoped projected dependencies contract/env wiring 已有 AgentSmith `8c6df24c` remote runs `26522251350` / `26522249787` / `26522250713` 和 runner `c67e837` remote run `26522674596` 证据；P5 runner focused image task-execution smoke 已有 runner `7a98d40` / run `26616757307` 证据。后续再扩展 HOME/TASK_HOME、credential non-persistence、backend-real、真实 LLM、full runtime semantics 和 adoption 串联。P5 后 source-boundary guard 只允许正式路径 import `@mbos/agent-runner-contract`，其他 `@mbos/*` import 失败。
10. Runner repo 已完成 focused GHCR publish + release manifest artifact evidence；manifest 当前包含 image digest、source commit、contract version、`contract_artifact.package_uri` / `contract_artifact.package_sha256` / `contract_artifact.package_integrity` / `contract_artifact.descriptor_subject_sha256`、`adoption_policy` 和 `artifact_provenance`；provenance 由 `artifact_provenance` 承载，`contract_artifact` 不承载 provenance；不包含 Codex version 或 breaking changes 字段。P5 image smoke 本身不产生 release manifest image digest；P5 publish manifest evidence 本身不更新 AgentSmith lock 或 release contract runner digest，AgentSmith manifest/lock adoption 已由后续小切片完成。
11. AgentSmith manifest/lock adoption 已完成：正式 lock identity 仍是 `agentsmith-runner`，positive fixture 使用 final publish manifest/run `26662288580` 和 `agentsmith-runner-image.lock`，adoption checker 默认读取 canonical lock path，并通过 runner release manifest 比对 image digest、contract version 和 manifest subject binding hash。旧 `agent-task-runner-image.lock` 不再作为 positive fixture 保留，`image_id=agent-task-runner` 只做负向测试/短期待删说明，不做正式路径支持。
12. Release contract runner digest adoption 已完成：assembly input 接受 `runnerImageLock`，拒绝 caller-provided `managed_runner_image`；generator 从 lock 投影顶层 `managed_runner_image` 和 inventory alias `managed_runner`；deploy template package required ids 包含 `managed_runner`，并把 source template placeholder 渲染到 `images.managed_runner.image`。release-kit managed runner image closure consumption 已由后续切片完成；该切片本身不是 deployment readiness、不是 airgap/offline package readiness、不是 backend-real、真实 LLM 或 full runtime semantics。
13. Runner adoption 顺序固定为：P5.0 consumer diagnostic skeleton -> P5.1 start guard/CI 化和负向 fixtures -> P5.2 formal artifact handoff -> P5.3a release manifest skeleton/checker/start-guard -> P5.3b first-half runtime fast/source-boundary/boundary closure -> P5 focused image build/start smoke -> runner repo GHCR publish + release manifest/image digest -> AgentSmith 更新 lock -> AgentSmith release contract 输出锁定 digest -> release kit 消费 release contract -> P5 request-scoped projected dependencies contract/env wiring -> P5 runner focused image task-execution smoke。当前 release-kit managed runner image closure consumption 已完成：release-kit 消费 dynamic release contract image closure，`managed_runner` 是普通 digest-bound inventory image，`required_image_ids` / `deploy_template_package.required_image_ids` / `deploy_image_inventory` ids exact-set 对齐；projected dependencies 语义仍归 AgentSmith/support API/contract。
14. P5 runtime 后续仍需逐项迁移或收口：local-kind runner image publish/adoption、API 默认 managed runner image、internal agent pod health/imageID probe、`agent:task-runner` dev script、skills diagnostics、credential non-persistence、HOME/TASK_HOME、backend-real、真实 LLM 和 full runtime semantics。`agent:task-runner` dev script 是短期待删说明，不是 release identity；release-kit managed runner image closure consumption、projected dependencies env wiring 和 fake-Codex focused task-execution image smoke 已完成但不替代 backend-real、真实 LLM、release readiness、AgentSmith adoption、GHCR publish 或 full runtime semantics。
15. 旧 `@mbos/agent-runner` shim 只保留第 3.2 节定义的负向测试或短期诊断；projected dependencies 已由 runner repo `buildAgentRuntimeEnv` 输出 `MBOS_AGENT_PROJECTED_DEPENDENCIES` opaque bulk env，但旧 shim/旧字段/旧职责不能形成 AgentSmith 与 runner repo 的长期共享包或 legacy 成功路径。
16. 本地 dev 启动说明只能是第 3.2 节短期待删项下的短期本地说明；正式 release contract 只能接受 runner manifest + lock adoption，本地 dev 路径不能作为 release proof。P5 runner repo dev command 可用后删除 AgentSmith 本地开发启动入口，或按第 3.2 节的 owner、删除条件、删除时机/阶段和验收证据短期归位；不能成为长期 dev 正式路径或 release proof。

P5.1 start preflight: `scripts/governance/__fixtures__/release-boundary/runner-adapter-inventory.valid.json`
是当前 monorepo runner adapter 的机器清单，`npm run contracts:check-release-boundary` 必须校验必需 item、当前路径存在、canonical repo、`release_proof_allowed:false`
以及禁止 runner repo 读取 AgentSmith source / release kit 从 source build runner。它不证明 runner manifest、lock 和 release contract digest match；digest adoption proof 已由 `contracts:check-runner-image-lock -- --adoption --manifest ...` 等 adoption gate 证据收口。local-kind build、本地开发启动入口、backend-real/skills diagnostics 都只能是过渡诊断，不能作为 release proof。

验收：

- AgentSmith 不从 monorepo source build 正式 runner image。
- AgentSmith backend-real / managed runner 主链可用。
- 本地开发可以保留 override，但不能作为 release proof。
- lock-only 更新不能算采纳成功；release contract 的 runner digest 与 lock/runner manifest 不一致时失败。
- runner release manifest adoption 必须比对 image digest、`contract_artifact.package_uri` / `contract_artifact.package_sha256` / `contract_artifact.package_integrity` / `contract_artifact.descriptor_subject_sha256`、由 `artifact_provenance` 承载的 provenance 和 lock；任一不一致失败。
- 真实 Kubernetes smoke 校验 managed runner 运行中 pod `imageID` 与 release contract digest 一致。
- P5.0 consumer diagnostic skeleton 已通过；P5.1 start guard/CI 化已通过；P5.2 formal artifact handoff 已通过；P5.3a release manifest skeleton/checker/start-guard 已通过；P5.3b first-half runtime fast/source-boundary/boundary closure 已通过，本地事实收口到 `7d21959`，remote CI run `26465985945` 已成功；P5 focused image build/start smoke 已通过，runner repo commit `b80ea3c feat: add runner image smoke gate`，remote CI run `26468415599` success；P5 runner publish manifest focused evidence 已通过，final runner HEAD `f588d88`，final publish run `26662288580` success，manifest subject/artifact sha `sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837`；AgentSmith manifest/lock adoption、release contract runner digest adoption、release-kit managed runner image closure consumption、AgentSmith support API / projection contract consistency focused gate 与 P5 request-scoped projected dependencies contract/env wiring 已通过。source-boundary guard 仍只允许正式路径 import `@mbos/agent-runner-contract`。
- producer repo 不是 `agentsmith-runner`、缺 image digest、任一 `contract_artifact.package_uri` / `contract_artifact.package_sha256` / `contract_artifact.package_integrity` / `contract_artifact.descriptor_subject_sha256` 字段或 `artifact_provenance`、或指向 `agentsmith-codex-runner` 时 adoption 失败。
- 当前 runner image 若仍从 AgentSmith 源码路径 build，只能算过渡诊断，不能算拆分证据或 release proof。

### P6. 清理和防回流

目标：删除重复路径，避免 pre-GA 已移除旧路径形成长期正式路径。

P6-lite 清理从最后阶段提前为当前并行收口项：没有产品功能价值、合同安全价值、
secret/redaction 价值、真实发布/运行安全价值或 operator 低心智价值的检查/文档/脚本，
删除优先，其次降级为 focused diagnostic，最后才保留长期 gate。
后续新增 gate/docs/script 必须绑定当前功能、安全、真实运行/发布安全或 operator 低心智；
过时低收益治理项删除优先，其次降级 focused diagnostic，不升级为长期 gate。

工作：

1. 在 release-kit / runner 集成面上，AgentSmith 只保留 thin adapters、contract checker、docs 指向和产品集成测试；AgentSmith 的产品合同、OpenAPI/AsyncAPI、验证入口和产品代码继续保留。
2. release kit adapter 完成 parity、release-kit repo-local verdict 已拥有 deployment/package/operator、回滚路径明确前，不删除底层部署合同语义；明确后从 AgentSmith active status/workflow 移除或隐藏 transition-only focused diagnostics / 过渡期专项诊断，只保留必要 fail-fast 负向测试。项目仍是 pre-GA，不为已移除旧输入、旧路径、旧文档/旧脚本引用或过时低收益的治理检查/文档/脚本保留长期心智负担；后者应删除、降级为 focused diagnostic 或 fail fast；P6 后旧 profile、旧 writer、旧 command、旧 doc/script 引用不得留在 active docs/workflow；如确需历史说明，只能作为非规范归档或一次性短期待删说明，并有删除/归档验收；若保留合同，必须归一到 `target_cluster` / `substrate_source` / `distribution` 三轴新模型。
3. 删除 AgentSmith 侧旧 runner runtime 源码路径、旧 `@mbos/agent-runner` shim 和 AgentSmith 侧
   旧 env helper / monorepo-side `buildAgentRuntimeEnv` 长期共享路径；旧说明不得留在 active docs/workflow，
   只允许非规范归档、一次性短期待删说明或必要 fail-fast 负向测试，不保留长期本地启动正式路径；第 3.2 节中的短期待删项必须
   全部完成 owner、删除条件、删除时机/阶段和验收证据核对。
4. 增加 static guard，防止正式路径重新 import 外部 repo 源码、tag-only image、已移除旧 runner fields、release kit import 产品源码。

验收：

- `npm run verify -- --goal=pr --run` 通过。
- runner/skills 相关改动按范围跑 `npm run test:skills:fast` 或 `npm run test:agent-task:runner:fast`。
- AgentSmith product readiness 收口跑 `npm run release:ready`。
- P2/P3/P6 完成后，移除或隐藏 AgentSmith active status/workflow 中的 unified deploy transition-only diagnostics；deploy/package/operator verdict 只由 release-kit repo-local gate/evidence 给出。

## 9. 发布模式

### Online

在线发布包只包含：

- scripts；
- docs；
- runbook；
- `agentsmith-release-contract.json`；
- deploy templates；
- checksums；
- operator examples。

它从 GHCR 或配置的在线 registry 拉取 digest-pinned images。它不 build AgentSmith 或 runner 源码。正式输入不能使用含 mutable tag 的 `site.env.example`，也不能把 `site.env.example` 当 prerequisite image truth；必须由 release contract、deploy template manifest 和 profile-specific env/schema 生成。在线 smoke 的最低证明是：rendered image ref、target registry digest、live workload `imageID` 三者一致。

online verdict 必须覆盖两种 operator-facing substrate strategy：`use_existing`
连接已有 substrates / 云端接口，`install_substrates` 由 release kit 安装最小 substrate pack。
只证明其中一路时，只能算 focused diagnostic，不能给 deployment/package/operator verdict。

### Airgap

离线发布包包含：

- online 包的全部内容；
- `images/` 或 OCI layout；
- `bundle-manifest.json`；
- checksums；
- load/import scripts；
- offline smoke runbook；
- 必要工具或明确的 operator prerequisite（含名称、版本、sha256/proof）。

airgap 的判断标准很简单：在断网环境里，包内内容足够完成 load、render、apply 和 smoke。
如果 operator 选择 `use_existing`，release contract 内部对应
`substrate_source=external_declared`；外部 substrate / 云端依赖是 operator
prerequisite，release kit 只校验连接和证据，不尝试离线创建这些云资源。
如果 operator 选择 `install_substrates`，release contract 内部对应
`substrate_source=kit_installed`；离线包必须包含最小 substrate pack
所需 image、工具和校验证据，不能联网补下载。

如果某个工具不在包内，它必须是 operator prerequisite；如果某个步骤尝试在线下载工具、模板或 image，该步骤失败。

operator-declared substrate endpoint 可以是目标网络内 prerequisite；release kit 只做连接、能力和证据校验，不因此获得创建云集群、数据库、bucket、Keycloak realm/client、IAM 或网络资源的职责。

airgap verdict 必须覆盖 `use_existing` 和 `install_substrates` 两种 strategy。kind
runbook 只能做本机 rehearsal，不能替代真实 Kubernetes airgap evidence，也不是正式 release target。

### Kubernetes Targets

真实 Kubernetes / 云端部署 runbook 必须覆盖：

- kubeconfig/context；
- namespace 创建或检查；
- RBAC；
- registry mirror / pull secret；
- ingress class 与 TLS；
- storage class / PV 权限；
- substrate connection truth；
- upgrade / rollback；
- evidence 目录；
- 失败分类和清理流程。

kind runbook 单独标记为 `kind rehearsal`，只服务本机演练、CI 诊断和离线包自测。

## 10. Handoff 检查清单

### P0 start 前

必须确认：

1. Product 同意不新增发布产品面和 runner 产品面。
2. Engineering 同意 AgentSmith 仍拥有产品验收证据。
3. Release kit 团队同意只做部署/分发证据。
4. Runner 团队同意只拆执行进程和 contract，不搬产品 API。
5. Release kit 团队同意 kind 是 rehearsal，不是用户部署前提。
6. 每个阶段都有明确 fail-fast tests。
7. 每个阶段都能独立回滚或停止，不要求一次性大爆炸迁移。

### P1 full adoption / P2+ engineering gate 前

必须确认：

1. P0 truth matrix、fixtures、evidence mapping、provenance/redaction schema 已经落地并通过检查。
2. provenance subject hash 不自引用，且 release contract / release kit evidence / runner manifest 三类 subject 都有 fixture。
3. `ci_artifact` 和 `signed_operator_run` 两种 provenance path 的接受/拒绝条件清楚。
4. persisted truth/evidence/logs 不保存 raw secrets。
5. `npm run contracts:check-release-kit-source-boundary` 在 AgentSmith 总
   `contracts:check` 中 defaults to the committed fixture only；真实
   release-kit repo 或 CI handoff 必须显式运行
   `npm run contracts:check-release-kit-source-boundary -- --scan-root <repo>`。
6. `npm run contracts:check-repo-split-bootstrap` 暂不接入总
   `contracts:check`；新建 sibling repo 或 CI handoff 时显式运行。
7. 非默认自动检查必须写进 handoff note，避免交接漏跑：
   `npm run contracts:check-release-kit-source-boundary -- --scan-root <repo>` 和
   `npm run contracts:check-repo-split-bootstrap`。
8. release contract formal intake 已拒绝 non-canonical pre-GA profile names / 同义词漂移，并完成
   三轴枚举、最小字段和 `target_profiles.required` 语义校验；当前 pre-GA focused diagnostics 中 required profiles 不能作为 readiness 开关，`required: true` 若被拒绝是 fail-fast posture。只有 P2/P3/P6 adoption 条件满足且 repo-local gate 拥有对应正式 evidence 后，才能翻 required。
9. bootstrap `--inputs` / intake diagnostic 产物保留 `readiness=false`，没有被
   写成 deploy/package/operator verdict 或 AgentSmith product gate；`--evidence`
   只接受 `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。`image-map.json` 是 mirror/image-map focused diagnostic 的 accepted/revalidatable output；image-map-only 不等于 deploy/package/operator verdict 或 release readiness，接受它不代表部署成功。未来/预留
   output 未实现就 fail fast；standalone render/apply/rollout/smoke report 不作为
   长期发布/部署契约输入；`airgap-bundle-render-check-report.json` 虽已有 producer，但仍是
   `readiness=false` focused diagnostic，`--evidence` 继续拒收；
   `airgap-image-archive-check-report.json` 虽已有 producer，但仍是
   `readiness:false`、`scope: airgap_image_archive_content_check_only` focused
   diagnostic，`--evidence` 继续拒收；`airgap-image-load-report.json` 虽已有
   producer，但仍是 `readiness:false`、`scope: airgap_image_load_only` focused
   diagnostic，`--evidence` 继续拒收；standalone `registry-presence-report.json`
   也继续拒收。online evidence
   root 只是 envelope/container，内含 `evidence.json`、`evidence-subject.json`
   和 `online-deployment-gate-report.json`，可被 `--evidence` revalidate，但
   不作为 machine accepted focused output 值列入清单；online gate report 若含
   image-map，必须使用 canonical `image-map,registry-presence` producer sequence。
10. P1.1 artifact producer 通过只表示 CI artifact producer 可产物；full P1 adoption
    仍未宣称完成。`product_images` 仍只接受 `agentsmith_app`；`managed_runner`
    release proof 已由后续 release contract runner digest adoption 切片提供，不能回写成
    P1.1 当时已证明。
11. `deploy_template_package.required_image_ids` 已提供机器可读 required image
    IDs，release contract generator/check 已证明模板引用与
    `deploy_image_inventory` 的模板 image 范围双向同步；`site.env.example`
    没有被当作正式 image truth。这个阻断项已由本切片解除，后续作为
    fail-fast guard 保持。release-kit P3 app-current image inventory closure
    和 airgap image archive materiality / image load/import focused diagnostics 已完成，但 Full P1
    adoption 仍不能宣称完成，因为
    release-kit full verdict / formal release gate、AgentSmith product-flow evidence
    收口、airgap full offline install/package/adoption readiness 和 P5 runtime
    migration 等后续阶段未完成；release-kit operator signature/identity/full verdict
    （正式签名验证/身份/完整 verdict）deferred，只有出现明确客户/合规/发布消费方需要时再做，
    真实 deploy/smoke 站稳前不推进；AgentSmith manifest/lock adoption、release contract
    runner digest adoption 与 release-kit managed runner image closure consumption 已完成，
    但它们都不是 deployment/package/operator verdict，不回接 AgentSmith product gate。
12. 当前 `existing-cluster` 仍按 Docker substrate/IP-only diagnostic 降级命名；
    正式机器轴只看 `target_cluster` / `substrate_source` / `distribution`。
    任何把 `existing-cluster` 并入 AgentSmith `release:ready` 或真实 cloud/airgap evidence 的路径都失败。

### P2 online spine / online adoption aggregation / registry prerequisite binding / operator signoff intake / P3 focused diagnostics/inventory closure / P5.3a manifest skeleton / P5.3b boundary closure / P5 image smoke / P5 publish evidence / release-kit image closure consumption / P5 request projection env wiring / runner projection smoke lock truth 完成后的后续门禁

必须确认：

1. P2 online target-registry confirmed apply/evidence spine、
   `--registry-presence` focused diagnostic、operator-preloaded registry
   prerequisite binding、`--operator-signoff-intake` focused guard、P2
   `--online-adoption` aggregation focused guard、P3
   `--airgap-bundle-render-check` focused diagnostic、P3 app-current image
   inventory closure、P3 `--airgap-image-archive-check` materiality focused
   diagnostic、P3 `--airgap-image-load` focused diagnostic、P3
   `--substrate-routability` focused producer、P5.1 start guard、P5.2 formal artifact handoff、P5.3a
   runner release manifest skeleton/checker/start-guard 集成和 P5.3b runtime fast
   first half/boundary closure、P5 focused image build/start smoke、P5 publish
   manifest focused evidence、AgentSmith manifest/lock adoption、release contract
   runner digest adoption、release-kit managed runner image closure consumption 和
   P5 request-scoped projected dependencies contract/env wiring 和 AgentSmith
   `--runner-projection-smoke` canonical lock truth 已有完成证据，
   但只解锁后续专项；
   不等于 airgap ready 或 release readiness。只有新增 repo、新增 release
   gate family 或新增职责边界时，才先做 bootstrap-only/docs-governance-first
   PR；已 bootstrap repo 的普通功能切片走最小 contract/test/evidence，不先做仪式性治理 PR。
   minimum bootstrap pack 包含 README.md、AGENTS.md、DEVELOPMENT/DEVELOPER guide、
   RELEASE_GATES 或 verify-release、contracts/runbooks/ADR entrypoints；quick gate
   is not release readiness；formal release readiness comes from the repo-local release gate。
2. repo-local team members 只在 quick gate 后进入互不重叠的专项 workstream；
   主协调 agent 只做分发、审查和收口。
3. P2 formal release gate 前，`--inputs` 仍只是 focused diagnostic，`--evidence`
   只接受 `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`；其中 `image-map.json` 只作为 mirror/image-map focused diagnostic 的 accepted/revalidatable output 被重校验，不是 deploy/package/operator verdict 或 release readiness，也不代表部署成功。三轴枚举、
   最小字段、`target_profiles.required` guard 已通过；当前 pre-GA focused diagnostics 中 required profiles 不能作为 readiness 开关，只有 P2/P3/P6 adoption 条件满足且 repo-local gate 拥有正式 evidence 后才能翻 required。P3
   `airgap-bundle-render-check-report.json` 仍是 `readiness=false` focused
   diagnostic，不是 `--evidence` 接受输入；`airgap-image-archive-check-report.json`
   仍是 `readiness:false`、`scope: airgap_image_archive_content_check_only`
   focused diagnostic，不是 `--evidence` 接受输入；`airgap-image-load-report.json`
   仍是 `readiness:false`、`scope: airgap_image_load_only` focused diagnostic，
   不是 `--evidence` 接受输入；`substrate-routability-report.json` 仍是
   `readiness:false` Pod-network routability focused output，不是 `--evidence`
   接受输入；standalone
   `registry-presence-report.json` 同样是 `readiness=false` focused diagnostic，不是 `--evidence` 接受输入；standalone render/apply/rollout/smoke
   report 不作为长期发布/部署契约输入；pre-GA 旧 3-image 输入只保留为负向测试线索并 fail fast。online evidence root 是 envelope/container，
   内含 `evidence.json`、`evidence-subject.json` 和
   `online-deployment-gate-report.json`，可重校验但不是 accepted output 值；online gate report 若含 image-map，必须使用 canonical `image-map,registry-presence` producer sequence。operator signoff intake 也接受该 canonical target-registry sequence。
4. P2 formal release gate 前，repo-local required CI 已覆盖
   source-boundary、remote identity、provenance、digest-only、host/TLS/pull-secret/
   storage/substrate secret-ref 输入、online gate steps、target/adopted ref strict
   live check、no-op fail-fast、operator runbook，以及 operator signoff intake
   与 confirmed apply online gate report 的机器绑定；`49caf6f` 本地证据已覆盖
   target-registry apply 必带 `--registry-probe`、canonical
   `image-map,registry-presence` producer sequence、source-registry apply 不受影响、
   target-registry server-dry-run 不要求且不允许 probe；`49caf6f` 远端 GitHub
   已记录 PushEvent，但 GitHub Actions run 仍未创建，沿用 outage/pending；
   后续同仓主线 `1d35fcc` 的 remote CI run `26449565986` success 已覆盖
   registry-presence 和完整 focused gate 序列，但不改写 `49caf6f` 本身的历史
   push run success。registry mirror/login/push/pull 仍必须显式补齐；
   operator signature/identity/full verdict（正式签名验证、身份系统、完整 operator verdict）deferred，
   只有出现明确客户/合规/发布消费方需要时再做，真实 deploy/smoke 站稳前不推进；
   AgentSmith product-flow evidence 仍归 AgentSmith，不进入 release-kit signoff。
5. P5 runner 正式 adoption 前，source-boundary guard 只允许
   `@mbos/agent-runner-contract`，runner support/context fixtures 来自 AgentSmith
   contract，`mbos-context` 不定义 scope/write/credential policy；
   `MBOS_AGENT_PROJECTED_DEPENDENCIES` 只传 opaque request projection bulk env。
6. P4/P5.0 已证明 runner contract artifact 的 descriptor/package URI、digest
   和 integrity 完备，provenance 由 descriptor 的 `artifact_provenance` 承载，
   且能被 runner repo consumer diagnostic skeleton 消费；P5.1 已把这些
   检查接入 repo-local start guard / required CI，并通过 consumer /
   start-guard / full-gate-fail-closed checks；P5.2 已在 AgentSmith workflow
   中用同 run 下载的 `agentsmith-runner-contract-artifact` 调 runner repo
   `--contract-consumer`。handoff job 必须保持固定 5 个步骤、2 个 run step，
   不混入 release readiness/runtime/image/adoption/signing/attestation/downloader。
   P5.3a 已在 runner repo 完成 release manifest skeleton/checker/start-guard
   集成；`image.id` 必须是 `agentsmith-runner`，不能保留
   `agent-task-runner` 旧别名；`contract_artifact` 必须绑定 P5.2 正式字段
   `package_uri` / `package_sha256` / `package_integrity` /
   `descriptor_subject_sha256`，不能发明 `descriptor_uri` / `descriptor_sha256`；
   workflow/job/generator 只要求非空；P5.3a 的
   `artifact_provenance.artifact_sha256 == subject_sha256` 只是 runner manifest
   subject binding / skeleton-compatible field，不是可下载 artifact 内容 hash 或
   远端 artifact digest 证明。P5.3b first half 已完成 repo-local
   runtime source、builtin skills、root package/tsconfig/vitest、source-boundary/product
   semantics guard、runtime fast focused diagnostic、clean-dependency start-guard guard
   和 projection-only / contract-only / policy-local boundary closure；当前 runner
   HEAD 是 `7d21959`，remote CI run `26465985945` success。builtin skill
   runtime 只消费 AgentSmith opaque request projections + explicit CLI 参数，不本地定义 Context Store scopes /
   writable scopes / managed credential resolution/refresh endpoint；`prepareTaskWorkspace`
   只消费 `@mbos/agent-runner-contract` execution context/path fields；artifact scan
   只保留 runner runtime/local tool roots filtering；`agent.response.done` 不伪造
   `usage_tokens`。`scripts/check-runner-source-boundary.mjs`
   禁止 runner repo 定义 `project_member` / `writable_scopes` / `context_store`
   capability/managed credential schemas、`/context` endpoints、managed credential
   refresh/key semantics、workspace-access/release fence、file-library reserved
   namespace policy 和 `usage_tokens` 本地估算/伪造形态，local dependency
   protocols 也增加 `portal:`。`--start-guard`
   在 clean CI 不跑 runtime fast，runtime fast 需要显式 contract artifact package/dev
   deps，`@mbos/agent-runner-contract` 当前未发布到 npm，普通 `npm install` 不能作为证据。
   P5 focused image smoke 已完成：runner repo commit
   `b80ea3c feat: add runner image smoke gate`，remote CI run `26468415599`
   success，jobs `Runner image smoke`、`Runner skeleton start guard`、`Quick governance`
   success；本地主控 evidence 为 quick/start-guard、explicit artifact root
   `/tmp/agentsmith-runner-contract-artifact.xxwfV1` 的 `--contract-consumer`、
   `--image-smoke` Docker build + missing-env `Usage` fail-fast、`git diff --check`
   passed。只读 review 无阻断；ADR bootstrap 历史口径和 PR template image smoke
   checklist 已修复。
   P5 runner publish manifest focused evidence 已完成：final runner HEAD `f588d88`，
   final publish run `26662288580` success，manifest subject/artifact sha
   `sha256:adde057b9204201cf4d9c915e3ecc65281980e043cf73f038420162ba93c1837`，
   image ref
   `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-f588d88@sha256:67fd8ba56dcbe763c1b9f81d1e18d7755f38c9eaf0db618554032aecb4be34f0`。
   P5 request-scoped projected dependencies contract/env wiring focused slice 已完成：
   AgentSmith commit `8c6df24c` 添加 optional `projected_dependencies` contract 并
   保持旧字段 fail-fast，remote runs `26522251350` / `26522249787` /
   `26522250713` success；runner commit `c67e837` 始终输出
   `MBOS_AGENT_PROJECTED_DEPENDENCIES`，缺省为空字符串以防 parent env leakage，
   remote run `26522674596` success。runner repo 只消费 opaque request projection，
   不新增 per-dependency env，不定义 Context Store / managed credential / scope /
   write policy 语义。
   AgentSmith `--runner-projection-smoke` 只使用 canonical
   `scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock`
   作为 runner image truth；未传 `INTEGRATION_INTERNAL_AGENT_IMAGE` 时使用 lock
   digest image，默认 build 为 0，显式 mismatch、legacy image/path 或 build 非 0
   fail fast，且不引入第二 lock path。
   runner release manifest adoption 仍必须比对 image digest、`contract_artifact.package_uri` /
   `contract_artifact.package_sha256` / `contract_artifact.package_integrity` /
   `contract_artifact.descriptor_subject_sha256`、由 `artifact_provenance` 承载的 provenance 和 lock。
7. 如果复制 AFSCP/ASBCP gate 脚本作为权威 gate、把 sibling repo status 当 gate、
   或让 quick gate/team signoff 变成 release readiness，停止并回到边界评审。
8. P5.3a/P5.3b first half/boundary closure/P5 image smoke/P5 publish manifest
   evidence 通过后，下一步仍不是 release readiness；AgentSmith manifest/lock adoption 已完成，
   release contract runner digest adoption 已完成，release-kit managed runner image
   closure consumption、P5 request-scoped projected dependencies contract/env wiring
   和 AgentSmith runner projection smoke lock truth 也已完成。runtime source 迁出、no-push image smoke、focused publish
   evidence、该 consumption、projected dependency env wiring、fake-Codex task-execution image smoke
   和 runner projection smoke lock truth 都不是 release readiness；
   后续仍需按 KISS 小切片推进
   backend-real、真实 LLM、full runtime semantics 与 P2/P3 deployment/operator/adoption 收口。

阶段收口审查只看这些 invariant；详细历史问题已移至 [Evidence log reference](archive/release-kit-and-runner-repo-split-evidence-log-v1.md)，不是每次切片默认必答清单：

1. 不新增用户概念、产品范围、发布控制台、runner 产品面或 substrate provider abstraction。
2. Pre-GA 旧名称、旧路径、旧字段、旧 env、旧 profile 和旧 shim 默认删除或 fail fast；短期待删项必须有 owner、删除条件、删除时机/阶段和验收证据。
3. AgentSmith 只给 product readiness / local complete / current product gate；`release:ready` 不给 deployment/package/operator verdict，也不把 release-kit focused output 当产品门禁。
4. Focused diagnostics、image smoke、publish manifest evidence、registry presence、airgap/archive/load/substrate probes 都不能写成 release readiness、airgap ready、deploy adoption 或 package/operator verdict。
5. `kind` / `local-kind` 只用于 pre-GA/local diagnostic rehearsal，不是正式 release target、生产默认或用户部署前提。
6. release-kit 不 import AgentSmith 产品源码，不创建云资源，不把 registry mirror/login/push/pull 或 operator signature/identity/full verdict 写成已完成；runner repo 不定义 Context Store、Files、managed credential、execution ticket 或 write-policy 语义。
7. 任何长期 gate/docs/script 必须直接服务当前功能、安全、真实发布/运行安全或 operator 低心智；低收益治理项优先删除，其次降级为 focused diagnostic。

任一 invariant 被破坏，停止并回到边界评审。

## 11. 成熟度判断

这份计划成熟的标准不是“覆盖所有未来可能”，而是：

1. 每个 repo 的职责能一句话说清楚。
2. 每个阶段都能 fail fast。
3. 每个阶段都能交付可验证结果。
4. 每个复杂点都回到已有合同，而不是发明新体系。
5. AgentSmith 产品范围没有变大。

推荐执行顺序：P0/P1.1 -> release-kit `--inputs` / `--evidence` 收口 ->
`deploy_image_inventory` / `deploy_template_package.required_image_ids` 双向
一致性已收口 -> P2 target-preflight focused 切片已完成 -> P2 online
target-registry confirmed apply/evidence spine 已完成 -> P2 operator-preloaded
registry prerequisite binding 已完成（GitHub Actions outage/pending） -> P3
`--airgap-bundle-render-check` focused diagnostic 已完成 -> release-kit
operator signoff intake focused guard 已完成 -> P3 app-current image inventory
closure 已完成 -> P3 airgap image archive materiality focused diagnostic 已完成 ->
P3 airgap image load/import focused diagnostic 已完成 ->
P3 airgap focused deployment gate 已完成 ->
P3 substrate routability focused producer 已完成 ->
kit_installed/online focused composition 已完成 ->
P2 release-kit repo-local online adoption aggregation 已完成 ->
AgentSmith digest/provenance/link handoff validator 已完成 ->
P6-lite summary/status 降噪已完成 ->
P6-lite 文档/旧引用归档清理当前并行收口 ->
formal release gate 与 AgentSmith product-flow evidence 分别收口 ->
airgap full offline install/package/adoption readiness 收口 -> P6-lite 清理当前并行收口 ->
P5.1 runner start guard/CI 化
已完成 -> P5.2 formal artifact handoff 已完成 -> P5.3a runner release
manifest skeleton/checker/start-guard 已完成 -> P5.3b runner runtime fast first half
和 projection-only / contract-only / policy-local boundary closure 已完成 -> P5 focused image build/start smoke 已完成 -> P5 runner publish manifest focused evidence 已完成 -> AgentSmith manifest/lock adoption 已完成 -> release contract runner digest adoption 已完成 -> release_kit_managed_runner_image_closure_consumption_done -> AgentSmith support API / projection contract consistency focused gate 已完成 -> P5 request-scoped projected dependencies contract/env wiring focused slice 已完成 -> P5 runner focused image task-execution smoke 已完成 -> P6 收口。

当前交接判断：

1. 当前计划 handoff-ready，主计划只保留状态、下一步和阻断项。
2. 历史证据和逐切片 ledger 见 [Evidence log reference](archive/release-kit-and-runner-repo-split-evidence-log-v1.md)。
3. 仍未完成 release readiness、deploy verdict 或 package readiness。
4. 下一步继续 P6-lite 文档/旧引用归档清理，并推进 release-kit formal release gate、offline install-deploy smoke、operator adoption，以及 runner backend-real / full runtime semantics；这些都不是 AgentSmith `release:ready` 结论。
