# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1

<!-- markdownlint-disable MD013 -->

Status: `p1_1_artifact_producer_passed_p2_online_target_registry_apply_evidence_spine_done_p3_airgap_bundle_render_check_done_p5_1_start_guard_done`
Date: 2026-05-26
Owner: Product + Engineering
Handoff scope: P0 machine guards passed; P1.1 CI release contract artifact
producer passed; release-kit input/evidence intake 已阶段性收口到 fail-fast
focused diagnostic。Full P1 adoption is not claimed. P4 AgentSmith runner
contract formal artifact producer/checker 已完成（AgentSmith commit
`d6648303`）；P5.0 runner repo consumer diagnostic skeleton 已完成并可消费
正式 artifact（runner repo commit `02feee8`）。P2 online target-registry
confirmed apply/evidence spine 已在 release-kit sibling repo 完成：initial
spine commit `2d4739b` remote CI run `26439931859` success；strict live ref
no-op 修正 commit `5e08da3` 已提交推送，本地按 GitHub Actions 顺序全量通过
并额外通过 syntax/diff/secret scan，remote CI run `26440847230` success。它覆盖
`inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`
在线 gate steps，render 使用 image-map target refs，rollout 对
`matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，
同 digest mixed source+target fail；target/adopted refs 如果 selected pods
只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail
fast；普通 source-registry rollout 仍保持 digest-only。online evidence root 是
`--evidence` revalidation 的
envelope/container，内含 `evidence.json`、`evidence-subject.json` 和
`online-deployment-gate-report.json`；machine accepted focused output 值是
`online-deployment-gate-report.json`，不是 evidence root 名称，也不是 release
readiness。
P3 `--airgap-bundle-render-check` focused diagnostic 已在 release-kit sibling
repo 完成（commit `3453c7d`，remote CI success）；它只证明 already assembled
airgap bundle 的 bundle-local offline render、render-check 和 target image
inventory，输出 `readiness=false`，且 `--evidence` 仍拒收
`airgap-bundle-render-check-report.json`。post-hardening review 已修复
forward-slash UNC-like path `//server/share/...` fail-fast 缺口。P5.1 runner
start guard 已在 runner sibling repo 完成（commit `cdfa800`，local consumer /
start-guard / full-gate-fail-closed checks passed，remote CI success）。这些
完成项不是 runtime migration、真实 registry login/push/pull/mirror/presence
proof、cloud provisioning、image load/import、offline install、P3 airgap
mechanism/app-current inventory closure、full online adoption、release-kit
operator signoff、AgentSmith product-flow evidence 收口、deployment/package/operator
full adoption 或 release readiness。P3-P6 仍受本计划里的 phase checks、evidence
mapping、provenance checks、redaction checks 和 image inventory truth 约束。
最新 review 结论已收口：当前
`existing-cluster` 仍降级为 Docker substrate/IP-only diagnostic；正式 runner
contract artifact 是外部 `runner-contract-artifact.json` + tgz，包内 manifest
是 package manifest v1。本切片已补齐 release contract 的
`deploy_image_inventory` 与 `deploy_template_package.required_image_ids` 双向
一致性 fail-fast guard，避免 orphan image truth；不新增第二套 top-level
required image IDs 字段。AgentSmith release boundary inventory alignment 已完成
（commit `86fbc7a0`，local tests/contracts passed，remote CI success）；
pre-GA scope clarification 已完成（commit `9fb1fa25`，
`contracts:check-engineering-governance` passed，remote Contracts Check
success）。DeepSeek/LLM real lane 没有 tracked changes；AgentSmith defaults
和 ignored local env 使用 DeepSeek endpoint/model，LLMUP real compatibility
smoke 15 passed / 0 failed / 1 skipped，未提交 secret。下一步不再是 P2
target-preflight、P2 online apply/evidence spine、P3 render-check focused
diagnostic 或 P5.1 启动，而是 P2 full online adoption、release-kit operator
signoff 与 AgentSmith product-flow evidence 分别收口，P3 airgap
mechanism/app-current inventory 剩余 load/import/offline install/deploy smoke
收口，以及 P5 runtime/image/adoption。

## 1. 目标

把 AgentSmith 当前的发布执行能力和 runner 执行进程拆成更清晰的工程制品边界，同时不扩大 AgentSmith 产品范围。

最终目标：

1. AgentSmith repo 负责产品代码、产品合同、产品验证、产品 image 和本地完整测试。
2. `agentsmith-release-kit` repo 负责在线部署、离线包、发布包校验、operator runbook 和部署证据；真实 Kubernetes / 云端托管 Kubernetes 是一等目标，kind 只作为本机/CI 演练工具，不是用户部署前提或 airgap declarable target。
3. `agentsmith-runner` repo 负责 runner 执行进程、builtin skills runtime、runner image 和 runner 侧测试；runner 协议包由 AgentSmith 合同/共享合同流程发布，runner repo 只消费。
4. 当前边界已取代早期过渡语义：`npm run release:ready` 是 AgentSmith product readiness / local complete / current product gate，内部覆盖 full visual、backend-real release 和 terminal aggregate；local-kind / unified deploy / product-flow deploy commands 只保留为 transition-only focused diagnostics / 过渡期专项诊断，不属于 AgentSmith 产品门禁结论。release-kit functional repo ready 后，在线/airgap deployment、package 和 operator runbook 的 verdict 归 release-kit repo-local gate/evidence，AgentSmith 只保留 product readiness、images/release contract、local full test 和 thin adapter。
5. 项目整体仍 pre-GA：不为旧名、旧路径、旧 env/profile 别名、已移除旧包或已移除字段保留长期心智负担。正式路径默认删除或 fail fast；确实临时需要时，只能出现在负向测试、过渡期专项诊断或 operator 短期说明里，并按第 3.2 节写清 owner、删除触发条件和验收证据。

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
- Unified deploy 只有一个部署模型，`local-kind` 和 `existing-cluster` 只是 profile，不是两个产品，见 [unified-deploy-contract.md](../contracts/unified-deploy-contract.md)。当前 `existing-cluster` 仍按 Docker substrate/IP-only transition diagnostic 处理，不能冒充真实 cloud/airgap substrate。
- Runner contract 当前事实源是 `@mbos/agent-runner-contract` / `packages/agent-runner-contract/src`；协议核心在 `TaskExecutionContext`、WS frame、runner spec 和路径/env 约束，见 [agent-execution-protocol.md](../contracts/agent-execution-protocol.md) 与 [protocol.ts](../../packages/agent-runner-contract/src/protocol.ts)。P4 已完成 formal artifact producer/checker；正式 artifact 是外部 `runner-contract-artifact.json` + tgz，包内 manifest 是 package manifest v1，`local_pack_manifest` 只允许作为负向测试输入。pre-GA 已移除旧包、旧输入、旧路径和旧字段不是正式输入；正式路径默认删除或 fail fast，只能出现在第 3.2 节定义的负向测试、过渡期专项诊断或 operator 短期说明里。P5.0 runner repo consumer diagnostic skeleton 已能消费正式 artifact；P5.1 start guard/CI 化已完成（runner repo commit `cdfa800`）。这些证据不能据此宣称 runtime migration、image adoption 或 release readiness。
- 当前仍是全项目 pre-GA：旧名、旧路径、旧 env/profile 别名不做长期双轨。它们只能作为第 3.2 节定义的负向测试、过渡期专项诊断或 operator 短期说明出现。部署 profile 映射口在 P2/P6 去掉 active workflow 后删除或归位到 operator docs；runner 已移除旧包/旧输入/旧路径/旧字段/旧 env 在 P5 runner repo/manifest/lock adoption 和 runtime migration 完成后删除或归位；P6 只保留必要 fail-fast 负向测试。
- 当前 runner 执行进程在 [packages/agent-task-runner](../../packages/agent-task-runner)，AgentSmith API 编排、Context Store、Files 与 execution ticket 仍在 [packages/api-entry-node](../../packages/api-entry-node)。
- AFSCP/ASBCP 只作为新 repo bootstrap 治理做法上的 family reference；本计划采用 ASBCP-lite / non-normative reference，只借鉴启动纪律：repo identity、scope boundary、docs/contracts/runbooks/ADR 入口、quick governance guard、单一 release gate 入口。不复制 AFSCP/ASBCP 的领域模型、风险台账规模、证据分类体系或 gate 实现。

工程判断：

1. 发布执行适合拆，产品验收不适合拆。
2. Runner 进程适合拆，Agent task / Files / Context Store / 调度真相不适合拆。
3. Airgap 必须做成真实离线包；当前只有部分 archive/load helper，不是完整离线发布能力。
4. 新 repo 创建必须遵守 [New repo bootstrap invariant](#41-new-repo-bootstrap-invariant)：P0 只冻结边界、命名和 quick guard，不迁源码、不迁工具、不发布；quick gate 只解锁 repo-local 专项工作，不表示 release readiness。
5. “参考同家族 repo 先建治理和文档，再让独立 team members 进入专项工作”
   是合理要求；它降低空 repo 直接堆实现的风险。KISS 做法是只借鉴
   AFSCP/ASBCP 的启动检查清单形态，不继承它们的领域模型、gate 脚本或事实源。

### 3.1 近期完成证据 / 下一步边界

本切片已收口 release contract image inventory 与 deploy template package
required image IDs 的双向一致性 guard；P2 online target-registry confirmed
apply/evidence spine、P3 `--airgap-bundle-render-check` focused diagnostic、
P5.1 runner start guard 已完成，仍不迁 runner runtime，也不宣称真实 registry
presence、full online adoption、release-kit operator signoff、AgentSmith
product-flow evidence 收口、deployment/package/operator full adoption 或 P3
airgap mechanism/app-current inventory closure。

近期完成证据：

1. AgentSmith release boundary inventory alignment 已完成：commit `86fbc7a0`，local tests/contracts passed，remote CI success。
2. AgentSmith pre-GA scope clarification 已完成：commit `9fb1fa25`，`contracts:check-engineering-governance` passed，remote Contracts Check success。
3. release-kit P2 online target-registry confirmed apply/evidence spine 已完成：initial spine commit `2d4739b`，remote `agentsmith-project/agentsmith-release-kit` CI run `26439931859` success；strict live ref no-op 修正 commit `5e08da3` 已提交推送，remote CI run `26440847230` success；本地按 GitHub Actions 顺序通过 `verify-release --quick`、`test-inputs`、`test-template-package`、`test-render`、`test-render-check`、`test-image-map`、`test-bundle-create`、`test-airgap-bundle-check`、`test-bundle-load-plan`、`test-airgap-bundle-render-check`、`test-apply`、`test-rollout`、`test-smoke`、`test-online-deployment-gate`、`test-evidence`、`test-target-preflight`；额外 `node --check scripts/verify-rollout.mjs`、`node --check scripts/verify-online-deployment-gate.mjs`、`bash -n scripts/test-online-deployment-gate.sh scripts/test-rollout.sh scripts/verify-release.sh`、`git diff --check` 和 secret scan passed，新增 diff 无真实 secret。
4. release-kit P3 `--airgap-bundle-render-check` focused diagnostic 已完成：sibling repo commit `3453c7d`，remote CI success；只证明 already assembled airgap bundle 的 bundle-local offline render、render-check 和 target image inventory，`readiness=false`，`--evidence` 仍拒收 `airgap-bundle-render-check-report.json`。
5. post-hardening review 已修复 forward-slash UNC-like path `//server/share/...` fail-fast 缺口。
6. runner P5.1 start guard 已完成：sibling repo commit `cdfa800`，local consumer / start-guard / full-gate-fail-closed checks passed，remote CI success。
7. DeepSeek/LLM real lane 没有 tracked changes；AgentSmith defaults 和 ignored local env 使用 DeepSeek endpoint/model，LLMUP real compatibility smoke 15 passed / 0 failed / 1 skipped，未提交 secret。

1. 部署/运维复审结论：当前 `existing-cluster` 只能命名为 Docker substrate/IP-only transition diagnostic。它不等于真实 Kubernetes/cloud/airgap substrate，也不能进入 AgentSmith `release:ready` 结论。真实 online/airgap/cloud substrate 由 release-kit repo-local gate 暴露；AgentSmith 侧只能降级展示、显式命名、误用就 fail fast。
2. Release kit image inventory guard 已收口：本切片已补齐 `deploy_template_package.required_image_ids` 与 `deploy_image_inventory` 的模板 image 范围双向一致性。release contract generator/check 必须覆盖所有模板 image 引用；缺失或 orphan image truth 时停止。P2 online gate 已覆盖 `inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`，render 使用 image-map target refs；rollout 对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。真实 registry login/push/pull/mirror/presence proof 和 release-kit operator signoff 不在本完成项内。
3. Release kit 复审结论：`--evidence` 只能接受当前 producer 能重新语义校验的 focused output：`image-map.json`、`online-deployment-gate-report.json`、`airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。online target-registry evidence root 只是 envelope/container，内含 `evidence.json`、`evidence-subject.json` 和 `online-deployment-gate-report.json`，可被 `--evidence` revalidate，但不列为 machine accepted focused output 值。`airgap-bundle-render-check-report.json` 虽已有 focused diagnostic producer，但仍是 `readiness=false` 诊断输出，`--evidence` 继续拒收。未来/预留 output 不预留长期双轨，未实现或未接入 `--evidence` 语义校验就 fail fast。`--inputs` / `--evidence` 的已实现输出、拒绝条件和 `readiness=false` 边界已随 P2 online apply/evidence spine 与 P3 render-check focused 切片阶段性收紧；后续继续 P2 full online adoption、release-kit operator signoff、AgentSmith product-flow evidence 分别收口，或 P3 airgap mechanism/app-current inventory 剩余工作。
4. Runner 复审结论：不要先搬 runtime。P4 AgentSmith formal artifact producer/checker 已完成，正式 artifact 是外部 `runner-contract-artifact.json` + tgz；P5.0 runner repo consumer diagnostic skeleton 已完成并可消费正式 artifact；P5.1 start guard/CI 化已完成。下一步才迁 runner runtime、image build 和 AgentSmith adoption。
5. Runner 迁移结论：旧 `@mbos/agent-runner` shim 不能成为长期双轨；`buildAgentRuntimeEnv` 归属必须在 P5 runtime 迁移时迁到 runner runtime 所属包或被正式 contract 覆盖，旧包只保留第 3.2 节定义的负向测试/短期诊断并在 P6 删除或归位。当前 runner image 仍走 AgentSmith 源码路径，不能作为拆分证据或 release proof。
6. 旧输入复审结论：项目仍 pre-GA，旧名、旧路径、旧 env/profile 别名、已移除旧包和已移除字段默认删除或 fail fast，不做长期兼容。只有负向测试、过渡期专项诊断或 operator 短期说明确实需要时才临时保留；任何暂留都必须挂 owner、删除触发条件和验收证据，并在 P2/P5/P6 删除或归位。

### 3.2 Pre-GA 已移除/旧输入处理规则

项目整体仍 pre-GA，KISS 规则是：能删就删，正式路径不能接受的输入就
fail fast，不为历史形态保留长期心智负担。这里的“旧输入/old/shim/兼容”
只表示 pre-GA 已移除输入、过渡诊断或一次性迁移说明，不是长期轨道。
只有下表列出的临时保留可以出现，且必须同时有 owner、删除触发条件和
验收证据。缺任一项时，不保留。

| 临时保留项 | Owner | 删除触发条件 | 验收证据 |
| --- | --- | --- | --- |
| `local-kind` / `existing-cluster` non-canonical profile name 映射口 | AgentSmith release-boundary owner | P2/P6 移除或隐藏 AgentSmith active status/workflow 中的 transition-only diagnostics，或 release-kit repo-local gate 已拥有 deployment/package/operator verdict | `contracts:check-unified-deploy-vocabulary`、`contracts:check-current-verification-campaigns`、`contracts:check-release-boundary` 证明新轴值为正式输入，混写和同义词漂移 fail fast |
| release-kit `--inputs` / `--evidence` focused diagnostic 输出和未来/预留 output 拒绝说明 | release-kit boundary owner | producer 已实现且 `--evidence` 能重新语义校验后进入正式接受清单；否则继续 fail fast 并在 P2/P3/P6 清掉无实现说明 | `contracts:check-release-boundary`、`contracts:check-release-kit-source-boundary -- --scan-root <repo>` 交接检查、provenance/redaction 负向测试 |
| 已移除 runner 包、字段、路径、`@mbos/agent-runner` shim、`buildAgentRuntimeEnv` 临时归属说明 | runner contract/runtime owner | P5 runner manifest/lock adoption 和 runtime migration 完成；P6 删除 AgentSmith 长期共享路径，只留必要 fail-fast 负向测试 | `contracts:check-agent-runner-contract-artifact`、`contracts:check-runner-contract-sync`、`contracts:check-release-boundary`、`contracts:check-runner-image-lock -- --adoption --manifest <path>` |
| operator 短期迁移说明中的已移除命令、路径或名称 | 对应 runbook/doc owner | runbook 不再需要一次性迁移提示，或 P6 收口时迁到 docs-only 历史说明并从 active workflow 删除 | `contracts:check-doc-governance`、`contracts:check-engineering-governance` 和对应 source-boundary/static guard 证明它不能被 Make/npm/GitHub Actions/release/local-real/backend-real wrapper 间接调用 |

## 4. Repo 职责

| Repo | 负责 | 不负责 |
| --- | --- | --- |
| `agentsmith` | 产品代码、产品合同、OpenAPI/AsyncAPI、产品 image、产品验证、本地完整测试、产品证据、外部 image/manifest adoption | operator 安装包、离线包、发布平台、runner 执行进程长期实现 |
| `agentsmith-release-kit` | 在线部署、离线包、image bundle、Kubernetes render/apply/smoke、可选 substrate 安装、外部 substrate 连接校验、发布包校验、operator runbook、部署/分发证据 | visual、backend-real、产品 DB/bootstrap 语义、产品 UI/e2e 真相、发布管理 UI、云资源 provisioning |
| `agentsmith-runner` | runner 执行进程、Codex/terminal/artifact/skills runtime、runner image、runner CI、contract conformance tests | runner contract source of truth、Agent task API、Agent Runners API、runner key、presence/heartbeat、Context Store、Files/file library、managed credential、审计/用量、前端管理面 |

补充说明：

1. AgentSmith 拥有产品 schema、初始化代码和 bootstrap 语义。
2. Release kit 可以打包、渲染、执行和等待 bootstrap workload，并产出部署证据；它不解释产品 schema，也不改 bootstrap 业务逻辑。
3. Runner repo 可以实现 builtin skills 的本地 runtime 和请求级投影消费；Context Store 权限、scope 和 managed credential 解析语义仍由 AgentSmith 定义。
4. 新 repo 本地目录与 `agentsmith` 同级只是当前 workspace bootstrap 约定：`/home/percy/works/mbos-v1/<repo>`，当前目标为 `/home/percy/works/mbos-v1/agentsmith-release-kit`、`/home/percy/works/mbos-v1/agentsmith-runner`；远端 org 已有，文档和创建命令使用 `https://github.com/agentsmith-project/<repo>.git`。CI/release 只认 normalized GitHub identity + provenance；canonical repo identity 固定为 `github.com/agentsmith-project/<repo>`。
5. `agentsmith-runner` 是唯一 canonical runner repo；当前同级目录已有的 `agentsmith-codex-runner` 只作为历史同级目录或归档对象，不能作为 bootstrap 输入，也不能成为第二条 runner 真相。任何正式 lock、release contract 或 CI adoption 指向 `agentsmith-codex-runner` 都必须 fail fast。
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
7. 不为旧名、旧路径、旧 env、已移除旧字段、已移除旧包保留长期双轨；pre-GA 只允许第 3.2 节列出的负向测试、过渡期专项诊断或 operator 短期说明，并在 P2/P6（deploy/profile）或 P5/P6（runner runtime/adoption）标明 owner、删除触发条件和验收证据。
8. 不为小概率环境做厚重兜底；缺合同、缺 digest、缺镜像、缺权限就快速失败。
9. 不把 AFSCP/ASBCP family reference 变成源码依赖、合同依赖、gate 依赖或新治理平台。
10. 不复制大型治理体系，不把 quick gate 等同 release readiness，不把新 repo 的
    sibling repo status 当 gate。
11. 不把源码迁移、工具迁移或从 `agentsmith` 工作树读取事实作为新 repo 第一步。
12. 不把 `site.env.example`、本地 site env 或当前 `existing-cluster` 诊断输出当作
    正式 prerequisite image truth。

## 6. 部署模式矩阵

Release kit 的部署模式由三根正交轴组成。三根轴是为了降低实施心智负担，不是新增产品线。

| 轴 | 值 | 含义 |
| --- | --- | --- |
| `target_cluster` | `existing_kubernetes` | 真实 Kubernetes 目标，包括私有 Kubernetes 和云端托管 Kubernetes。 |
| `target_cluster` | `kind_rehearsal` | 本机或 CI 演练目标。kind 是可选工具，不是用户部署前提。 |
| `substrate_source` | `kit_installed` | 后续独立 KISS slice：release kit 管理最小 adjacent substrate pack，并产出连接真相和 pod-routability preflight。只做最小 substrate pack，不做 provider matrix；它不是当前 release readiness，不是云资源 provisioning，也不是 in-cluster substrate。 |
| `substrate_source` | `external_declared` | operator 提供 PostgreSQL/pgvector、MongoDB、Redis、S3-compatible object storage、Keycloak/OIDC 等连接真相；release kit 只校验，不创建云资源。 |
| `distribution` | `online` | 从 GHCR 或 operator 指定 registry 拉取 digest-pinned images。 |
| `distribution` | `airgap` | 使用离线包、OCI layout 或 image archives，不联网拉镜像、工具或模板。 |

operator 默认只需要看三种选择：

| 选择 | 参数组合 | 用途 |
| --- | --- | --- |
| 真实在线部署 | `existing_kubernetes + external_declared + online` | 常规真实部署主路径。 |
| 真实离线部署 | `existing_kubernetes + external_declared + airgap` | 真实 airgap 主路径。 |
| 本机在线演练 | `kind_rehearsal + kit_installed + online` | 后续 `kit_installed` slice 的本机、CI 自测；不作为当前 release readiness。 |

其他组合只放在 troubleshooting / advanced runbook 里，不作为首次实施路径。

允许的工程组合：

| 组合 | 是否一等支持 | 用途 |
| --- | --- | --- |
| `existing_kubernetes + external_declared + online` | 是 | 常规真实部署主路径。 |
| `existing_kubernetes + external_declared + airgap` | 是 | 真实离线部署主路径；外部依赖作为 operator prerequisite 记录和校验。 |
| `existing_kubernetes + kit_installed + online/airgap` | 后续 advanced slice，需显式 pod-routability preflight | 自包含或受控环境；release kit 安装最小 adjacent substrate pack，但不把它伪装成云资源管理、provider matrix 或 in-cluster substrate。 |
| `kind_rehearsal + kit_installed + online` | 后续演练用途 | 本机/CI 自测，不作为当前 release readiness。 |

心智模型：

1. 用户先选目标：真实 Kubernetes，或本机 kind 演练。
2. 再选依赖：release kit 安装，或连接已有/云端依赖。
3. 最后选分发：在线拉镜像，或离线包导入。

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
3. 同一 payload 内混写 non-canonical pre-GA profile name 和新轴值、根据字符串隐式推断、或引入
   `kind` / `real-k8s` / `cluster` 等同义词漂移时 fail fast。
4. 这个映射口只服务 pre-GA 迁移入口；owner、删除触发条件和验收证据按第 3.2 节执行。P2/P6 去掉 non-canonical profile active workflow 后删除。若仍需说明已移除旧命令，只归位到 operator docs，不进入 machine contract。

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
6. P1 不发布 `managed_runner` 临时 digest，也不把本地/monorepo runner build 当 release proof；runner image 只有在 P5 runner manifest/lock adoption 后才能进入 release contract / deploy image inventory。
7. `adopted_provider_images` 放 AgentSmith 消费但不拥有发布 gate 的外部 provider image，例如 ASBCP、AFSCP、LLMUP。
8. `release_kit_prerequisite_images` 放 release kit 需要 mirror/load 的底座或集群组件镜像，例如 ingress controller/certgen、后续 `kit_installed` slice substrate images、kind rehearsal 所需 images。
9. `deploy_image_inventory` 是 AgentSmith release contract 输出的最终 image inventory，必须由 `product_images`、`adopted_provider_images`、`release_kit_prerequisite_images` 和 deploy template 渲染输入生成；release kit 只能验证 rendered manifests 与该 inventory 一致，不能另起一份 image 真相。
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
    truth 时 fail fast；不得新增第二套 top-level required image IDs 字段。
13. `required_product_flows` 当前最小集合是 `workspace_project`、`files`、`agent_task_managed_runner`。其他流程只有在 release scope 明确要求时才加入。
14. `target_profiles` 声明支持的 `target_cluster`、`substrate_source`、`distribution` 组合，以及每个组合的 namespace/RBAC/ingress/TLS/storage class/registry/pull secret prerequisites；`target_profiles.required` 表示 release-kit adoption / repo-local readiness 前必须有正式 evidence 的组合。
15. `substrate_connection_schema` 使用中性连接真相命名，例如 `agentsmith.substrate-connection.truth/v1`；`agentsmith.docker-substrate.truth/v1` 是真实 Docker substrate truth，只能作为 `kit_installed` 的内部 installer truth；已移除的未命名空间输入名 `docker-substrate.truth/v1` 是 pre-GA invalid input，直接 fail fast，两者都不得用于 `external_declared`。
16. `artifact_provenance` 至少包含 producer repo identity、commit SHA、workflow/run/job、artifact URI、artifact digest、generated_at 和 generator version。正式 release adapter 必须拒绝缺 provenance、local provenance 或 repo identity 不匹配的 contract。
17. bootstrap 阶段 `--inputs` / contract intake 只允许作为 focused diagnostic：
    它可以输出 `intake-report` 和 `image-digest-plan`，但不代表 deploy/package/operator verdict
    或 AgentSmith product gate；这类输出必须显式标记
    `readiness=false`，缺失或被上层当作 AgentSmith product gate 或 deploy/package/operator verdict 时 fail fast。
18. P1/P2 adoption 前，正式 intake 必须通过三项 guard：三轴枚举拒绝 non-canonical pre-GA profile names 和同义词；最小字段校验覆盖 image digest、deploy image inventory、
    template package、provenance 和 `target_profiles.required`；required 组合缺
    正式 evidence 时只能得到 `readiness=false`，不能进入 deploy/package/operator verdict 或 AgentSmith product gate。

### 7.2 Substrate Connection Truth v1

目标：让真实 Kubernetes / 云端部署不被 Docker-only 语义卡住，同时不引入 cloud provider framework。

最小字段：

- `SUBSTRATE_SOURCE=kit_installed|external_declared`
- PostgreSQL/pgvector：host、port、database、user secret ref、sslmode、required extension check
- MongoDB：host、port、database、user secret ref、TLS mode
- Redis：host、port、password secret ref、TLS mode
- object storage：S3-compatible endpoint、bucket、access key secret ref、scheme/TLS、path/virtual-host style
- Keycloak/OIDC：public issuer、realm/client id、JWKS/metadata reachability、read-only validation mode
- Kubernetes deploy prerequisites：namespace/RBAC mode、ingress host/TLS secret ref、registry pull secret ref、storage class/PV policy、substrate secret refs
- product-flow probe secret refs：仅在产品 flow 需要直接 DB/OIDC/admin probe 时由 operator 显式提供；不能从 Docker defaults 或云环境里猜
- redacted fingerprint

规则：

1. `external_declared` 允许 DNS/FQDN 和 TLS；不能 fallback 到 Docker defaults。
2. `external_declared` 不创建或修改云资源、bucket、DB user/database、Keycloak realm/client、IAM 或网络资源；只允许连接校验、能力校验，以及在 operator 已提供的数据库内运行 AgentSmith-owned product schema/bootstrap。
3. `kit_installed` 在后续独立 KISS slice 落地后，必须产出同一份中性 connection truth 和 pod-routability preflight，供 render/apply/smoke 消费；当前 release readiness 不依赖它。
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

online target-registry evidence root 是 envelope/container，不是 focused
output 值。它包含 `evidence.json`、`evidence-subject.json` 和
`online-deployment-gate-report.json`；`--evidence` 可以 revalidate 这个 root，
但 machine accepted output 清单只写上面的精确文件值。

其他 output，例如 `deploy-result.json#substrate`、standalone
`render-report.json` / `apply-report.json` / `rollout-report.json` /
`smoke-report.json`、`registry-mirror-map.json`、
`airgap-bundle-render-check-report.json`，只有在 producer 已实现且
`--evidence` 可重新语义校验后才能进入接受清单；当前 online render/apply/
rollout/smoke 只作为 online evidence root envelope 内的证据被重校验，不
新增长期 standalone 双轨。当前
`airgap-bundle-render-check-report.json` producer 已实现但仍保持
`readiness=false` focused diagnostic，`--evidence` 继续拒收；未实现或未接入
语义校验时直接 fail fast。

规则：

1. evidence 只证明部署和分发，不证明产品功能全部通过。
2. product flows 仍由 AgentSmith 生产；release kit 不伪造、不签署
   AgentSmith product-flow evidence。
3. online 与 airgap 共用同一份 image digest policy。
4. online 模式不要求 image archive；airgap 模式缺 archive、digest mismatch、联网访问尝试、生成 manifest 漂移都 fail fast。
5. release kit smoke 只证明部署、路由、镜像 adoption 和基础健康；AgentSmith product flows 必须能指向真实 Kubernetes/cloud base URL，不能只绑定 kind。
6. release kit smoke 必须证明每一个 rendered workload 的最终 pull ref 映射到 target registry digest，并在目标集群核对 Pod/Job 的 live `imageID` 与 release contract / mirror map 一致；当前 P2 online focused spine 已对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。
7. 正式 evidence 不能包含 kubeconfig、pull secret、DB password、OIDC client secret、execution ticket、API token、managed credential 或完整连接串；只允许 secret ref、redacted fingerprint 和最小诊断字段。
8. AgentSmith adapter 必须对 evidence JSON 和日志做 redaction check；发现明文 secret 时 fail fast，不能把 evidence 映射进 release summary。
9. contract intake / `--inputs` 产物如果只完成输入解析、digest 计划或模板依赖检查，只能进入 diagnostic evidence root；`intake-report` / `image-digest-plan` 不能写入 deploy/package/operator verdict 或 AgentSmith product gate，且必须保留 `readiness=false`。
10. `--evidence` 只能接受当前 producer 可重新语义校验的 focused output：`image-map.json`、`online-deployment-gate-report.json`、`airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。online evidence root 是 revalidation envelope，内含 `evidence.json`、`evidence-subject.json` 和 `online-deployment-gate-report.json`，但 root 名称不进入 accepted output 清单。`airgap-bundle-render-check-report.json` 仍是 `readiness=false` focused diagnostic，不进入 `--evidence` 接受清单。`deploy-result.json#substrate`、standalone render/apply/rollout/smoke report 等未来/预留 output 不保留长期双轨；未实现、不能重新校验语义或字段只在说明里预留时，直接 fail fast。

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

v1 冻结：

- WS endpoint/auth/query/envelope；
- `server.hello`、`server.request.start`、`server.request.cancel`、`server.ping`；
- `server.terminal.start`、`server.terminal.adopt`、`server.terminal.close`；
- `agent.ready`、`agent.pong`、`agent.response.*`、`agent.terminal.*`；
- `TaskExecutionContext`；
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

### 7.5 Truth Matrix

| Truth | Owner | 物理来源 | 生成器 | 校验器/消费者 | fail-fast 条件 |
| --- | --- | --- | --- | --- | --- |
| AgentSmith release contract | AgentSmith | AgentSmith CI artifact | AgentSmith release contract generator | release kit、AgentSmith release summary adapter | 缺 digest、缺 provenance、repo identity 不匹配、tag-only image、OpenAPI/AsyncAPI/template digest 漂移 |
| Deploy template package | AgentSmith | AgentSmith CI artifact | AgentSmith deploy template package generator | AgentSmith release contract validator、release kit source-boundary guard | 缺 package URI、缺 digest、缺 provenance、缺 `required_image_ids`、manifest digest 漂移、release kit 猜 AgentSmith repo path |
| Deploy image inventory | AgentSmith | release contract 内 `deploy_image_inventory` | AgentSmith contract generator | release kit render/check、mirror、smoke | rendered workload image 不在 inventory、`required_image_ids` 未覆盖模板引用、target registry digest 不匹配、live imageID 不匹配 |
| Substrate connection truth | release kit 生成/校验，AgentSmith 定义 schema | neutral truth JSON | 后续 `kit_installed` installer slice 或 `external_declared` validator | render/apply/smoke、AgentSmith product flow producer | Docker truth 用于 external、缺 endpoint/secret ref/TLS/extension、明文 secret |
| Release kit evidence | release kit | release kit evidence root | release kit commands | AgentSmith thin adapter、operator runbook | 缺 input digest/provenance、stale evidence、writer id 不匹配、secret 泄露 |
| Runner contract | AgentSmith shared-contract flow | `@mbos/agent-runner-contract` package (`packages/agent-runner-contract/src`) schema/types/fixtures，以及 P4 产出的外部 `runner-contract-artifact.json` + tgz；包内 manifest 是 package manifest v1；`local_pack_manifest` 只作为负向测试输入；已移除旧包 `@mbos/agent-runner` 是 pre-GA 旧输入，正式路径默认拒绝，只能出现在第 3.2 节定义的负向测试、过渡期专项诊断或短期迁移说明里，P5 runtime/adoption 后删除或归位 | AgentSmith runner contract artifact producer/checker from `@mbos/agent-runner-contract` | AgentSmith API、runner repo、AsyncAPI/doc checks、artifact-root install/import consumer test | 缺 artifact URI/digest/integrity/provenance、AsyncAPI 漂移、已移除旧字段、unsupported protocol version、手工复制类型、正式路径接受 `local_pack_manifest` |
| Runner release manifest | `agentsmith-runner` | runner repo CI artifact | runner repo release workflow | AgentSmith runner lock checker | 缺 image digest/provenance、缺 contract artifact URI/digest/integrity/provenance、contract version 不匹配、producer repo 不是 `agentsmith-runner` |
| Runner image lock | AgentSmith | `agent-task-runner-image.lock` | AgentSmith adoption PR | AgentSmith release contract generator、backend-real | lock 与 runner manifest/release contract digest 不一致 |

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
- `generated_at`
- `generator_version`
- `attestation_uri` 或明确 `attestation: none`

规则：

1. `subject_sha256` 永远哈 provenance 外部的 immutable subject，不能哈包含自身 provenance 的 JSON。
2. GitHub Actions / repo CI 必须校验 `normalized_remote` 指向 `github.com/agentsmith-project/<repo>`；本地路径不是 CI/release truth。
3. provenance kind 按 producer/run context 区分，不按 `distribution=online|airgap` 区分。
4. `ci_artifact` 用于 repo CI 生产的 AgentSmith release contract、runner release manifest 和 release kit CI evidence；缺 workflow/run/job 时失败。
5. `signed_operator_run` 用于 operator 在真实目标环境执行并签名的正式部署 evidence，包括 online 和 airgap；必须有 operator run id、operator identity、signature reference、subject sha256 和 runbook 声明的验证方式。
6. 本地生成且无签名的 artifact 可以用于 focused diagnostics，但 AgentSmith release adapter 不得把它当正式 release evidence。
7. redaction schema 必须覆盖 kubeconfig、pull secret、registry token、DB password、S3 secret、OIDC client secret、execution ticket、API token、managed credential 和完整连接串。
8. release kit、runner repo 和 AgentSmith adapter 都必须有 secret leak 负向测试；发现明文 secret 即失败。

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
12. 定义 release kit 如何读取 deploy template package；模板源码可以逐步迁到 release kit，但在迁移完成前必须由 AgentSmith 明确产出 template package，不允许 release kit 猜 repo 路径。`deploy_template_package.required_image_ids` 必须包含机器可读 required image IDs，并由 release contract generator/check 覆盖所有模板 image 引用和模板 image inventory 双向一致性。deploy template package 附近的 migration/vNext 说明不得形成兼容矩阵或长期迁移章节；必须说明旧输入不是正式路径，且只能按第 3.2 节归入一次性 operator note 或负向测试说明。
13. 定义 deterministic provenance subject：release contract body without provenance、release kit `evidence-subject.json`、runner manifest body without provenance；禁止 hash 包含自身 provenance 的 JSON。
14. 增加 truth matrix：release contract、deploy image inventory、substrate truth、release kit evidence、runner contract、runner release manifest、runner image lock 分别列 owner、物理来源、生成器、校验器、消费者、fail-fast 条件。
15. 增加 P0 handoff fixtures：release contract example、`external_declared` truth example、`kit_installed` truth example、release kit evidence example、runner manifest example。
16. 增加 release kit evidence adapter mapping，明确 release kit outputs 如何进入当前 `lane-unified-deploy-*` native `result.json`、`<campaign-root>/unified-deploy/*` 目录和 release summary 四段。
17. 增加 provenance/redaction schema 和 tests。
18. 增加 fail-fast contract tests：tag-only image、缺 digest、缺 required flow、deploy template `required_image_ids` 与 image inventory 不一致、`site.env.example` 被当作正式 image truth、已移除旧 runner field、release kit 误 import AgentSmith 产品源码、kind 被当成必需部署目标、`existing-cluster` 诊断被当成真实 cloud/airgap substrate 或 AgentSmith `release:ready` verdict、non-canonical pre-GA profile name 与新轴值混写、同义词漂移、`target_profiles.required` 缺失或被当成 optional、`--inputs` focused diagnostic 被当成 readiness、`--evidence` 接受未实现或不能重新语义校验的 output、external substrate 使用 Docker truth、local-kind evidence 冒充 existing Kubernetes evidence、明文 secret 泄露、缺 provenance、runner contract 与 AsyncAPI 漂移、provenance hash subject 自引用。

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
2. P1 不发布 `managed_runner` 临时 digest；runner release proof 归 P5 runner manifest/lock 和 AgentSmith lock adoption。
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
- P1 不要求 runner digest；不得为 `managed_runner` 补 release proof，它的缺席也不能被当作 P1 失败。
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
额外 syntax/diff/secret scan passed，新增 diff 无真实 secret。这个证据证明
online gate 的 target-registry confirmed apply、rollout、smoke 和 online
evidence root envelope positive path 能 repo-local fail fast；仍不等于 registry
login/push/pull/mirror/presence proof、cloud provisioning、full online
adoption、release-kit operator signoff、AgentSmith product-flow evidence 收口、
P3 airgap mechanism/app-current inventory closure 或 release readiness。

工作：

1. 先在 `agentsmith-release-kit` 按第 4.1 节完成 bootstrap-only/docs-governance-first PR；quick gate 通过不代表 release readiness。
2. bootstrap PR 通过前，repo-local workers 不迁部署工具、不迁 release-kit runtime；通过后只解锁专项开发，不解锁 release/adoption。
3. bootstrap PR 通过后，再迁入不依赖 AgentSmith 产品源码的 deploy 工具：manifest/render、Kubernetes apply/dry-run、substrate install/status/connection truth verify、address truth、API single-replica、route smoke。
4. 所有路径参数化，禁止默认读 AgentSmith repo root。
5. P2 online gate focused spine 已完成；online gate steps 固定为 `inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`。`target-preflight` 输入覆盖 host/TLS、pull secret、storage class、substrate secret refs；本切片不引入 provider matrix、rollback、airgap、镜像搬运/images mirror 或 cluster provisioning。
6. bootstrap 阶段 `release-kit --inputs` 和 `release-kit --evidence` 只做 focused diagnostic：
   `--inputs` 只能输出 `readiness=false` 的 `intake-report` / `image-digest-plan`；
   `--evidence` 只能接受当前 producer 可重新语义校验的 focused output：
   `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。
   online evidence root 是 envelope/container，内含 `evidence.json`、
   `evidence-subject.json` 和 `online-deployment-gate-report.json`；可以被
   `--evidence` revalidate，但 root 名称不是 accepted focused output 值。
   `airgap-bundle-render-check-report.json` 虽已由 P3 focused diagnostic 产出，
   但仍保持 `readiness=false`，`--evidence` 继续拒收。
   `deploy-result.json#substrate` 等未来/预留 output 不保留长期双轨，未实现就 fail fast；正式 adoption 前必须补齐三轴枚举、最小字段和
   `target_profiles.required` guard。
7. 当前完成项只使用 image-map target/adopted refs 做确认，不做 registry login/push/pull/mirror，也不证明 target registry presence；未来若补 mirror/prove presence，必须作为显式 operator/runbook 工作进入 repo-local gate。
8. `render/check` 必须验证 rendered workload images 全部来自 release contract 的 `deploy_image_inventory`，并覆盖 `deploy_template_package.required_image_ids`；当前 render 已使用 image-map 的 target refs。
9. `rollout/smoke` 必须采集所有 AgentSmith/runner/provider workload 的 live `imageID`，并和 release contract / target registry digest 对齐；当前 rollout 已对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。
10. API single-replica 等规则来源仍是 AgentSmith release contract / deploy contract；release kit 只执行检查，不独立定义产品部署规则。
11. 支持 `existing_kubernetes + external_declared + online` 作为在线部署主路径。
12. `kind_rehearsal + kit_installed + online` 只作为后续 `kit_installed` 独立 KISS slice 的本机/CI 证明工具；P2 当前 readiness 不依赖它。
13. `existing_kubernetes + kit_installed` 只在后续最小 substrate pack + pod-routability preflight slice 存在后进入 advanced runbook；不做 provider matrix，P2 MVP 不把它作为默认路径。
14. `agentsmith-release-kit` 必须把 source-boundary、remote identity、provenance check 作为 repo-local required CI；AgentSmith sibling scan/handoff evidence 只能证明交接输入可读，不能替代 release-kit CI。
15. AgentSmith 保留 thin adapter 只用于读取/链接 release-kit repo-local verdict artifact；不得把这些 artifact 接回 AgentSmith release campaign，也不得新增第二套 AgentSmith verdict。

不迁：

- `check-product-flows.ts`
- visual
- backend-real
- story/e2e
- product DB/bootstrap 语义

验收：

- online deploy focused spine 能从 GHCR/digest 或 operator 指定 target/adopted refs 渲染并执行 apply、rollout、smoke。
- `existing_kubernetes + external_declared + online` 的 focused path 能产出 preflight、render、render-check、apply、rollout、smoke 和 online evidence root envelope，并通过 `--evidence` revalidation。
- P2 online target-registry confirmed apply/evidence spine 已有 initial spine commit `2d4739b`、remote CI run `26439931859` success；strict live ref no-op 修正 commit `5e08da3` 已提交推送，remote CI run `26440847230` success，本地 GitHub Actions 顺序全量通过；这不是 full online adoption、release-kit operator signoff、AgentSmith product-flow evidence 收口或 release readiness 证据。
- 本切片不做 registry login/push/pull/mirror/prove registry presence，不做 cloud provisioning。
- 当前 AgentSmith `existing-cluster` 诊断在 P2 full adoption 前仍明确降级为 Docker substrate/IP-only transition diagnostic；任何把它写成真实 online/cloud/airgap substrate evidence 的路径都失败。
- `kit_installed` 是后续独立 KISS slice：最小 substrate pack + pod-routability preflight；不做 provider matrix，也不能写成当前 release-ready deploy snapshot。
- kind rehearsal 产出 images、rollout、route probe evidence，但不能作为用户真实部署前提。
- real Kubernetes/cloud smoke 只证明目标集群安装和路由，不声称 product flows 通过。
- P2 过渡说明以当前边界为准：AgentSmith `release:ready` 是 product readiness / local complete / current product gate，不要求 dependencies/images/rollout/product-flow deploy evidence；这些 unified deploy outputs 只保留为过渡期专项诊断，直到 P2/P3/P6 收口时从 AgentSmith active status/workflow 删除或隐藏。这里不暗示未来 AgentSmith release campaign 会继续消费它们。
- release kit CI 至少覆盖 contract schema、render/dry-run、digest-only、no source import；真实 Kubernetes/cloud smoke 可以是手动或 scheduled，需要 secrets/kubeconfig 时必须产出同一 evidence schema。
- release kit repo-local CI 覆盖 source-boundary、canonical remote identity 和 provenance；AgentSmith handoff scan 不算替代证明。
- AgentSmith transition diagnostic profile 还是 local-kind 时，真实 Kubernetes/cloud evidence 只能作为 operator deploy evidence；除非当前 manifest 显式新增/调整 writer，否则不能写入 local-kind gate id。

### P3. Release Kit Airgap MVP

目标：产出 airgap mechanism / app-current inventory 的离线发布包能力；kind
只能作为离线包机械自测、本机诊断或 CI rehearsal，不是 airgap declarable
target，也不能替代 `existing_kubernetes + external_declared + airgap` evidence。
product-full offline package 必须等 P5 runner digest/adoption 进入 release
contract 后才能宣称。

当前状态：P3 `--airgap-bundle-render-check` focused diagnostic 已在
release-kit sibling repo 完成（commit `3453c7d`，remote CI success）。它只证明
already assembled airgap bundle 的 bundle-local offline render、render-check 和
target image inventory，输出 `readiness=false`；不证明 registry execution、image
load/import、offline install、deploy/package/release readiness 或 product-full
offline package。
`--evidence` 仍拒收 `airgap-bundle-render-check-report.json`。post-hardening
review 已修复 forward-slash UNC-like path `//server/share/...` fail-fast 缺口。

工作：

1. 先实现 `bundle verify` 覆盖 online deploy 产物，再实现 `bundle create`、`bundle load`、`bundle apply`、`bundle smoke`。
2. 离线包包含所有实际会被安装触达的 images、deploy templates、profile-specific env/schema、scripts、runbook、checksums。
3. image bundle 使用统一 manifest，记录 source image、archive sha256、target registry digest。
4. 增加 target registry mirror map，支持真实集群使用 operator 指定的离线 registry。
5. 增加断网演练：不允许运行时联网拉 image、下载 tool 或访问在线 registry。
6. 禁止在 airgap 路径从公网下载工具、模板或 image；目标网络内的 operator-declared substrate endpoint 可以作为 prerequisite 被校验，但不代表 release kit 创建云资源。
7. 所有工具只有两种来源：包内携带并带 sha256，或 operator prerequisite 明确声明名称、版本、安装位置和 proof；两者都没有时 fail fast。

image 范围由 release contract 的 `deploy_image_inventory`、
`deploy_template_package.required_image_ids`、rendered manifests 和 operator
prerequisite 声明共同校验，避免手写清单漂移。`site.env.example` 不是正式
image truth。
最小类别：

- AgentSmith components：`agentsmith_app`（当前单一 canonical product image；未来真拆镜像时按 P1 guard 新增 machine IDs、fixtures 和 tests）；
- managed runner：仅在 P5 runner manifest/lock adoption 后由 release contract 的 `deploy_image_inventory` 引入；P1/P3 不伪造临时 digest 或 archive 要求；
- ASBCP、AFSCP、LLMUP；
- ingress controller / certgen；
- 后续 `kit_installed` 独立 slice bundle 需要的 substrate images：PostgreSQL/pgvector、MongoDB、Redis、MinIO、MinIO client、Keycloak；
- `kind_rehearsal` 需要的 registry/kind node/CSI 相关 images；
- `existing_kubernetes + external_declared` app bundle 可以把外部依赖列为 operator prerequisite，但必须有明确 prerequisite/evidence，不静默在线拉取。

验收：

- 缺任一 image archive 失败。
- digest mismatch 失败。
- tag-only image 失败。
- 缺工具或工具 proof 失败。
- verify/load/render/apply/smoke 任一步尝试联网下载失败。
- `existing_kubernetes + external_declared + airgap` 在断网环境基于 app-current inventory 完成 `verify/load/render/apply/smoke`；product-full package 仍等待 P5 runner digest/adoption 进入 release contract。
- `kind_rehearsal` 只在后续 `kit_installed` slice 中保留 `kit_installed + online` 作为可选演练；kind 可做离线包机械自测、本机诊断或 CI rehearsal，但不是 airgap declarable target，不能替代 `existing_kubernetes + external_declared + airgap` evidence。
- 手工 operator signoff 仍单独记录，不能被自动化冒充。

### P4. AgentSmith 发布 Runner Contract 包

目标：先由 AgentSmith 合同/共享合同流程把 runner 协议发布成稳定包，再迁执行进程。

当前状态：P4 已完成（AgentSmith commit `d6648303`）。正式 artifact 是外部
`runner-contract-artifact.json` + tgz，包内 manifest 是 package manifest
v1；GitHub Actions 先把 artifact 下载到本地 artifact root，再由 AgentSmith
producer/checker 用 `--artifact-root` 覆盖可发布、descriptor/tgz/sha256/
integrity/provenance/artifact URI binding 校验、安装和消费。`local_pack_manifest`
不是正式输入，只保留为负向测试语境。

工作：

1. 在现有 `packages/agent-runner-contract` 上完成唯一正式 contract 包 `@mbos/agent-runner-contract` 的可发布、可消费 artifact 最小闭环；P4 完成后 schema/types/fixtures 是唯一机器真相。
2. artifact 至少包含 machine-readable schema、types、fixtures、版本、artifact URI、sha256/integrity 和 provenance；AgentSmith 本仓用同一 artifact 消费路径验证，不能依赖 runner runtime 源码。
3. AsyncAPI 和协议文档改为从 contract package 生成或被 contract package 校验；漂移即 fail fast。
4. AgentSmith API 和 runner repo 都只依赖这个包；P4 只提供 runner repo consumer diagnostic skeleton 所需的合同输入，不迁 runner runtime。
5. 增加 protocol、terminal recovery/adopt/close 和 runner support HTTP conformance tests；runner support HTTP 只冻结 wire shape 和 error shape，不定义 authorization/scope/resource ownership 语义。
6. 增加 artifact-root 安装/导入 consumer test：GitHub Actions 先把 artifact 下载到本地 artifact root，再用 `--artifact-root` 校验 descriptor/tgz/sha256/integrity/provenance/artifact URI binding，并在干净 consumer workspace 安装、导入和运行 fixtures。

验收：

- AgentSmith 不再直接依赖 runner 实现类型。
- `@mbos/agent-runner-contract` artifact 可以发布，并能在已下载 artifact root 下被 AgentSmith 安装、消费和校验，且 descriptor/tgz/sha256/integrity/provenance/artifact URI binding 不缺失。
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
sha256/integrity/provenance/artifact URI binding。P5.1 start guard 已完成
（runner repo commit `cdfa800`），local consumer / start-guard /
full-gate-fail-closed checks passed，remote CI success。这不是 runtime
migration、image adoption 或 release readiness；下一步才是 runtime
migration、image build 和 adoption。

工作：

1. P5.0 已完成 consumer diagnostic skeleton：通过 `--artifact-root <dir>` 消费已下载的 `@mbos/agent-runner-contract` artifact root，校验 descriptor/tgz/sha256/integrity/provenance/artifact URI binding，在干净 workspace 安装/导入 smoke 并跑基础 protocol fixtures，证明 runner repo 能消费正式 artifact。KISS 默认是 CI/handoff 显式提供已下载 artifact root；未来若需要真实 URI downloader，归 future downloader/adoption/provenance work，不回写成 P5.1 已完成事实。
2. P5.1 start guard 已完成：consumer diagnostic skeleton 已接入 repo-local start guard / required CI，local consumer / start-guard / full-gate-fail-closed checks passed，remote CI success。P5.1 已完成边界只到 runner contract consumer skeleton、start guard 和 CI 化；不表示 HOME/TASK_HOME guard、request-scoped env projection、credential non-persistence、ticket/scope semantics、runtime smoke、Docker 或 image checks 已完成。
3. P5.1 通过只解锁 runtime 迁移专项，不解锁 release/adoption；env/credential/runtime smoke、Dockerfile 和 image build/adoption 仍必须在后续 P5 runtime/conformance/adoption gates 里验证。
4. 下一阶段再迁入 `packages/agent-task-runner`、builtin skills runtime、runner Dockerfile 和 runner 单测。
5. Runner repo 不允许定义 Context Store scopes、Files/file-library 行为、managed credential resolution、execution ticket 颁发或权限语义；这些语义仍由 AgentSmith contract/support API 和 fixtures 定义，runner 只消费请求级只读投影并执行本地 runtime；`mbos-context` 只能被执行/打包，不能定义 scope、write policy 或 managed credential 语义。
6. P5.1 repo-local start guard 已有 consumer / start-guard / full-gate-fail-closed 本地证据；runtime 迁移后再扩展 HOME/TASK_HOME、request-scoped env projection、credential non-persistence、builtin skill tests、Docker build 和启动缺 env fail-fast smoke。P5 后 source-boundary guard 只允许正式路径 import `@mbos/agent-runner-contract`，其他 `@mbos/*` import 失败。
7. Runner repo 发布 image 到 GHCR，release manifest 包含 image digest、source commit、contract version、contract artifact URI/digest/integrity/provenance、Codex version、breaking changes/fail-fast adoption policy 和 artifact provenance。
8. AgentSmith 新增 `agent-task-runner-image.lock`，并用 runner release manifest 比对 image digest、contract version、contract artifact digest/provenance、Codex version 和 fail-fast adoption policy。
9. Runner adoption 顺序固定为：P5.0 consumer diagnostic skeleton -> P5.1 start guard/CI 化和负向 fixtures -> runtime migration / image build CI 通过 -> runner repo release manifest/image digest -> AgentSmith 更新 lock -> AgentSmith release contract 输出锁定 digest -> release kit 消费 release contract。
10. P5 runtime 迁移前补 monorepo runner adapter inventory，并逐项迁移：local-kind runner image build、API 默认 managed runner image、internal agent pod health/imageID probe、`agent:task-runner` dev script、skills diagnostics、`buildAgentRuntimeEnv` ownership、P5 manifest/lock adoption 后的 release contract runner digest。
11. 旧 `@mbos/agent-runner` shim 只保留第 3.2 节定义的负向测试或短期诊断；`buildAgentRuntimeEnv` 必须随 runtime 迁入 runner repo 所属包，或被正式 contract 明确替代。它不能成为 AgentSmith 与 runner repo 的长期共享包。
12. 迁移期保留本地 dev 启动说明，但正式 release contract 只能接受 runner manifest + lock adoption；本地 dev 路径不能作为 release proof。P5 runner repo dev command 可用后删除 AgentSmith 本地开发启动入口，或归位为 docs-only 本地启动说明。

P5.1 start preflight: `scripts/governance/__fixtures__/release-boundary/runner-adapter-inventory.valid.json`
是当前 monorepo runner adapter 的机器清单，`npm run contracts:check-release-boundary` 必须校验必需 item、当前路径存在、canonical repo、`release_proof_allowed:false`
以及禁止 runner repo 读取 AgentSmith source / release kit 从 source build runner。它不证明 runner manifest、lock 和 release contract digest match；digest adoption proof 仍由 `contracts:check-runner-image-lock -- --adoption --manifest ...` 等 adoption gate 负责。local-kind build、本地开发启动入口、backend-real/skills diagnostics 都只能是过渡诊断，不能作为 release proof。

验收：

- AgentSmith 不从 monorepo source build 正式 runner image。
- AgentSmith backend-real / managed runner 主链可用。
- 本地开发可以保留 override，但不能作为 release proof。
- lock-only 更新不能算采纳成功；release contract 的 runner digest 与 lock/runner manifest 不一致时失败。
- runner release manifest adoption 必须比对 image digest、contract artifact digest/provenance 和 lock；任一不一致失败。
- 真实 Kubernetes smoke 校验 managed runner 运行中 pod `imageID` 与 release contract digest 一致。
- P5.0 consumer diagnostic skeleton 已通过；P5.1 start guard/CI 化已通过。后续 P5 runtime/adoption 阶段，source-boundary guard 只允许正式路径 import `@mbos/agent-runner-contract`。
- producer repo 不是 `agentsmith-runner`、缺 image/contract artifact digest 或 provenance、或指向 `agentsmith-codex-runner` 时 adoption 失败。
- 当前 runner image 若仍从 AgentSmith 源码路径 build，只能算过渡诊断，不能算拆分证据或 release proof。

### P6. 清理和防回流

目标：删除重复路径，避免 pre-GA 已移除旧路径形成双轨。

工作：

1. 在 release-kit / runner 集成面上，AgentSmith 只保留 thin adapters、contract checker、docs 指向和产品集成测试；AgentSmith 的产品合同、OpenAPI/AsyncAPI、验证入口和产品代码继续保留。
2. release kit adapter 完成 parity、release-kit repo-local verdict 已拥有 deployment/package/operator、回滚路径明确前，不删除底层部署合同语义；明确后从 AgentSmith active status/workflow 移除或隐藏 transition-only focused diagnostics / 过渡期专项诊断，只保留必要 fail-fast 负向测试。项目仍是 pre-GA，不为已移除旧输入保留长期心智负担；P6 后旧 profile、旧 writer、旧 command 只能归档到 docs-only 或负向测试，任何短期暂留都必须有 owner、删除触发条件和验收证据；若保留合同，必须归一到 `target_cluster` / `substrate_source` / `distribution` 三轴新模型。
3. 删除 runner runtime 源码、旧 `@mbos/agent-runner` shim 和 AgentSmith 侧
   `buildAgentRuntimeEnv` 长期共享路径；只保留 docs-only 迁移说明或必要
   fail-fast 负向测试，不保留长期本地启动双轨；第 3.2 节中的暂留项必须
   全部完成 owner、删除触发条件和验收证据核对。
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

### Airgap

离线发布包包含：

- online 包的全部内容；
- `images/` 或 OCI layout；
- `bundle-manifest.json`；
- checksums；
- load/import scripts；
- offline smoke runbook；
- 必要工具或明确的 operator prerequisite（含名称、版本、sha256/proof）。

airgap 的判断标准很简单：在断网环境里，包内内容足够完成 load、render、apply 和 smoke；如果选择 `external_declared`，外部 substrate / 云端依赖是 operator prerequisite，release kit 只校验连接和证据，不尝试离线创建这些云资源。

如果某个工具不在包内，它必须是 operator prerequisite；如果某个步骤尝试在线下载工具、模板或 image，该步骤失败。

operator-declared substrate endpoint 可以是目标网络内 prerequisite；release kit 只做连接、能力和证据校验，不因此获得创建云集群、数据库、bucket、Keycloak realm/client、IAM 或网络资源的职责。

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
   三轴枚举、最小字段和 `target_profiles.required` 语义校验。
9. bootstrap `--inputs` / intake diagnostic 产物保留 `readiness=false`，没有被
   写成 deploy/package/operator verdict 或 AgentSmith product gate；`--evidence`
   只接受 `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`，未来/预留
   output 未实现就 fail fast；standalone render/apply/rollout/smoke report 不作为
   长期双轨输入；`airgap-bundle-render-check-report.json` 虽已有 producer，但仍是
   `readiness=false` focused diagnostic，`--evidence` 继续拒收。online evidence
   root 只是 envelope/container，内含 `evidence.json`、`evidence-subject.json`
   和 `online-deployment-gate-report.json`，可被 `--evidence` revalidate，但
   不作为 machine accepted focused output 值列入清单。
10. P1.1 artifact producer 通过只表示 CI artifact producer 可产物；full P1 adoption
    仍未宣称完成。当前 `product_images` 只接受 `agentsmith_app`，P1 不发布
    `managed_runner` release proof。
11. `deploy_template_package.required_image_ids` 已提供机器可读 required image
    IDs，release contract generator/check 已证明模板引用与
    `deploy_image_inventory` 的模板 image 范围双向同步；`site.env.example`
    没有被当作正式 image truth。这个阻断项已由本切片解除，后续作为
    fail-fast guard 保持。Full P1 adoption 仍不能宣称完成，因为
    release-kit P2 full online adoption、release-kit operator signoff、AgentSmith
    product-flow evidence 收口、P3 airgap mechanism/app-current inventory 和 P5
    runtime/adoption 等后续阶段未完成，
    deployment/package/operator verdict 不回接 AgentSmith product gate。
12. 当前 `existing-cluster` 仍按 Docker substrate/IP-only diagnostic 降级命名；
    任何把它并入 AgentSmith `release:ready` 或真实 cloud/airgap evidence 的路径都失败。

### P2 online spine / P3 focused diagnostic / P5.1 start guard 完成后的后续门禁

必须确认：

1. P2 online target-registry confirmed apply/evidence spine、P3
   `--airgap-bundle-render-check` focused diagnostic 和 P5.1 start guard 已有
   完成证据，但只解锁后续专项；不等于 release readiness。后续任何 P2/P3/P5
   implementation workstream start
   前，仍必须经过 bootstrap-only/docs-governance-first PR；minimum bootstrap
   pack 包含 README.md、AGENTS.md、DEVELOPMENT/DEVELOPER guide、RELEASE_GATES
   或 verify-release、contracts/runbooks/ADR entrypoints；quick gate is not
   release readiness；formal release readiness comes from the repo-local release gate。
2. repo-local team members 只在 quick gate 后进入互不重叠的专项 workstream；
   主协调 agent 只做分发、审查和收口。
3. P2 release-kit 正式 adoption 前，`--inputs` 仍只是 focused diagnostic，`--evidence`
   只接受 `image-map.json`、`online-deployment-gate-report.json`、
   `airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`，且三轴枚举、
   最小字段、`target_profiles.required` guard 已通过。P3
   `airgap-bundle-render-check-report.json` 仍是 `readiness=false` focused
   diagnostic，不是 `--evidence` 接受输入；standalone render/apply/rollout/smoke
   report 不作为长期双轨输入。online evidence root 是 envelope/container，
   内含 `evidence.json`、`evidence-subject.json` 和
   `online-deployment-gate-report.json`，可重校验但不是 accepted output 值。
4. P2 release-kit 正式 adoption 前，repo-local required CI 已覆盖
   source-boundary、remote identity、provenance、digest-only、host/TLS/pull-secret/
   storage/substrate secret-ref 输入、online gate steps、target/adopted ref strict
   live check 和 no-op fail-fast、operator runbook；真实 registry login/push/pull/mirror/presence
   proof 和 release-kit operator signoff 仍必须显式补齐；AgentSmith
   product-flow evidence 仍归 AgentSmith，不进入 release-kit signoff。
5. P5 runner 正式 adoption 前，source-boundary guard 只允许
   `@mbos/agent-runner-contract`，runner support/context fixtures 来自 AgentSmith
   contract，`mbos-context` 不定义 scope/write/credential policy。
6. P4/P5.0 已证明 runner contract artifact 有 URI/digest/integrity/provenance
   且能被 runner repo consumer diagnostic skeleton 消费；P5.1 已把这些
   检查接入 repo-local start guard / required CI，并通过 consumer /
   start-guard / full-gate-fail-closed checks。runner release manifest adoption
   仍必须比对 image digest、contract artifact digest/provenance 和 lock。
7. 如果复制 AFSCP/ASBCP gate 脚本作为权威 gate、把 sibling repo status 当 gate、
   或让 quick gate/team signoff 变成 release readiness，停止并回到边界评审。
8. P5.1 start guard/CI 化通过后，runner runtime 迁移仍只能作为下一专项推进；
   runtime 迁出后，才进入 image 发布、manifest/lock adoption 和 release-kit
   image inventory 串联。

阶段收口必须回答：

1. 这次改动有没有新增用户概念？
2. 有没有把产品证据搬出 AgentSmith？
3. 有没有引入 tag-only image？
4. 有没有让 release kit import AgentSmith 产品源码？
5. 有没有让 runner repo 解释 Context Store、Files 或 managed credentials 权限？
6. 有没有把本地开发 override 当成 release proof？
7. 有没有把 release kit 产物当成新的 AgentSmith `release:ready` verdict？
8. 有没有把 kind 当成部署必需条件？
9. 有没有把云端支持写成云资源管理产品？
10. 有没有新增 substrate provider abstraction？
11. 有没有把 local-kind evidence 当成 real Kubernetes/cloud evidence？
12. 有没有让 runner contract 出现 package、AsyncAPI、文档三套机器真相？
13. 有没有接受缺 provenance、local provenance 或 non-canonical pre-GA `agentsmith-codex-runner` producer？
14. 有没有把明文 secret 写进 evidence、日志或 release summary？
15. 有没有把 AFSCP/ASBCP family reference 从新 repo bootstrap 治理做法参考扩大成源码依赖、合同依赖、gate 依赖或新治理平台？
16. 有没有跳过 bootstrap-only/docs-governance-first PR，直接迁部署工具或 runner runtime？
17. 有没有把 quick gate 或 team signoff 当成 release readiness / release gate？
18. 有没有复制 AFSCP/ASBCP gate 脚本作为权威 gate，或把 sibling repo status 当成 gate？
19. 有没有让 `--inputs` / contract intake 的 `intake-report`、`image-digest-plan`、standalone render/apply/rollout/smoke report 或 P3 `airgap-bundle-render-check-report.json` 变成 deploy/package/operator verdict 或 AgentSmith product gate，或让 `--evidence` 接受未实现/不能重新语义校验的 output？
20. 有没有让 runner repo 新定义 Context Store scopes、Files/file-library 行为、managed credential resolution、execution ticket 颁发或权限语义，或让 `mbos-context` 定义这些 policy？
21. 有没有让 runner repo 正式路径 import `@mbos/*` 中除 `@mbos/agent-runner-contract` 以外的包？
22. 有没有把 `existing-cluster` 诊断、`site.env.example` 或源码 build runner image 当成正式 release proof？
23. 有没有让 `deploy_template_package.required_image_ids` 与 release contract image inventory 的模板 image 范围脱节？
24. 有没有让旧 `@mbos/agent-runner` shim 或 `buildAgentRuntimeEnv` 形成长期双轨？
25. 有没有保留未挂 owner、删除触发条件和验收证据的 pre-GA 已移除输入或短期迁移说明？
26. 有没有把 P2 online evidence root envelope 写成 registry login/push/pull/mirror/presence proof、cloud provisioning、full online adoption、release-kit operator signoff、AgentSmith product-flow evidence 收口或 release readiness？

任一答案为“有”，停止并回到边界评审。

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
target-registry confirmed apply/evidence spine 已完成 -> P3
`--airgap-bundle-render-check` focused diagnostic 已完成 -> P2 full online
adoption、release-kit operator signoff 与 AgentSmith product-flow evidence 分别收口 -> P3 airgap mechanism/app-current inventory 剩余 load/import/offline install/deploy smoke 收口 -> P5.1 runner start guard/CI 化
已完成 -> P5 runtime/image/adoption -> P6 收口。P4 runner contract artifact
最小闭环已完成；P5.0 runner repo consumer diagnostic skeleton 已完成；P5.1
start guard 已完成。P2 online spine 和 P3 render-check 都不表示
deploy/package/release readiness；P4/P5.0/P5.1 都不进入 runner runtime 迁移；
P5 runtime/adoption 完成前也不能删除 monorepo runner build 或宣称最终发布包
闭环完成。

当前交接判断：P0 done，machine guards passed。P1.1 done，手动 CI release
contract artifact producer passed。AgentSmith release boundary inventory
alignment 已完成（commit `86fbc7a0`，local tests/contracts passed，remote CI
success）；AgentSmith pre-GA scope clarification 已完成（commit `9fb1fa25`，
`contracts:check-engineering-governance` passed，remote Contracts Check
success）。release-kit `--inputs` / `--evidence` intake 已阶段性收口到
fail-fast focused diagnostic；`deploy_image_inventory` 与
`deploy_template_package.required_image_ids` 的模板 image 双向一致性 guard 已由
本切片补齐，避免 orphan image truth。release-kit P2 online target-registry
confirmed apply/evidence spine 已在 sibling repo 完成：initial spine commit
`2d4739b` remote `agentsmith-project/agentsmith-release-kit` CI run
`26439931859` success；strict live ref no-op 修正 commit `5e08da3` 已提交推送，
remote CI run `26440847230` success，本地按 GitHub Actions 顺序全量 passed，
并额外通过 syntax/diff/secret scan。它覆盖
`inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`
online gate steps，render 使用 image-map target refs；rollout 对
`matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同
digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露
expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通
source-registry rollout 保持 digest-only；
online evidence root 作为 envelope/container 已能通过 `--evidence`
revalidation，machine accepted focused output 是
`online-deployment-gate-report.json`。
release-kit P3 `--airgap-bundle-render-check` focused diagnostic 已在 sibling
repo 完成（commit `3453c7d`，remote CI success）；它只证明 already assembled
airgap bundle 的 bundle-local offline render、render-check 和 target image
inventory，输出 `readiness=false`，`--evidence` 仍拒收
`airgap-bundle-render-check-report.json`，不证明 registry execution、image
load/import、offline install、deploy/package/release readiness 或 product-full
offline package。post-hardening review 已修复 forward-slash UNC-like path
`//server/share/...` fail-fast 缺口。Full P1 adoption 仍不能宣称完成，因为
release-kit P2 full online adoption、release-kit operator signoff、AgentSmith
product-flow evidence 收口、P3 airgap mechanism/app-current inventory 和 P5
runtime/adoption 等后续阶段未完成，deployment/package/operator
verdict 不回接 AgentSmith product gate。当前 `existing-cluster` 只按 Docker substrate/IP-only transition
diagnostic 处理。P4 `@mbos/agent-runner-contract` formal artifact
producer/checker 已完成；正式 artifact 是外部
`runner-contract-artifact.json` + tgz，包内 manifest 是 package manifest v1。
P5.0 runner repo consumer diagnostic skeleton 已完成并可消费正式 artifact；
P5.1 runner start guard 已完成（commit `cdfa800`，local consumer /
start-guard / full-gate-fail-closed checks passed，remote CI success）。这些
不是 runtime migration、真实 registry login/push/pull/mirror/presence proof、
cloud provisioning、full online adoption、release-kit operator signoff、
AgentSmith product-flow evidence 收口或 release readiness。DeepSeek/LLM real lane 没有 tracked changes；AgentSmith defaults 和 ignored local env 使用
DeepSeek endpoint/model，LLMUP real compatibility smoke 15 passed / 0 failed /
1 skipped，未提交 secret。下一步是 P2 full online adoption、release-kit
operator signoff 与 AgentSmith product-flow evidence 分别收口、P3 airgap
mechanism/app-current inventory 剩余 load/import/offline install/deploy smoke
收口，以及 P5 runtime/image/adoption。旧
`@mbos/agent-runner` shim、`buildAgentRuntimeEnv` 和源码路径 runner image 都不能
作为长期双轨或 release proof。
