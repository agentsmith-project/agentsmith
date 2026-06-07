# AgentSmith GA 发布交付计划 v1

<!-- markdownlint-disable MD013 -->

Status: `implementation-ready`
Date: 2026-05-31
Owner: Product + Engineering
Scope: AgentSmith 项目集 GA 发布、部署验证、发布工具与面向实施/运维文档

## 0. 一句话结论

GA 的工作不是继续扩大功能或治理，而是把已经锁定的产品能力、runner、外部镜像依赖、release contract、online/airgap 部署工具和 operator runbook 收成一个可执行、可验证、可排障、可发布的交付面。

最终状态必须让实施/运维人员只回答四个问题：

1. 我选择哪种部署路径？
2. 我要准备哪些输入文件和凭据引用？
3. 跑哪一个入口命令？
4. 成功或失败看哪一个报告？

### 0.1 GA 治理瘦身原则

GA 只保留两类正式 verdict：

1. AgentSmith product readiness。
2. Release-kit final GA verdict。

`test:*`、`gate:*`、`lane:*`、backend-real/unified-deploy producer、surface/adoption/candidate report、历史 evidence 与旧迁移说明默认是 owner diagnostic 或 reference，不能成为 operator、普通开发者或发布签署人的心智模型。

新增 gate、docs、script 必须满足至少一条：

1. 替代、删除或降级一个旧负担。
2. 直接控制当前安全、合同、真实发布或真实运行风险。

否则默认不进 GA。反过度治理本身也不能发展成新的流程、看板、审批或概念层。

## 1. GA 范围锁定

### 1.1 本轮必须覆盖

本轮 GA 只覆盖 AgentSmith Web 与 system 管理侧交付，不覆盖 Desktop。

纳入 GA 发布验证的 repo：

| Repo | 本地路径 | GA 责任 |
| --- | --- | --- |
| `agentsmith` | `/home/percy/works/mbos-v1/agentsmith` | 产品代码、产品合同、product readiness、app image、release contract、deploy template package、runner contract artifact、外部镜像锁 |
| `agentsmith-release-kit` | `/home/percy/works/mbos-v1/agentsmith-release-kit` | online/airgap 发布执行、airgap 包、部署验证、operator runbook、final GA verdict |
| `agentsmith-runner` | `/home/percy/works/mbos-v1/agentsmith-runner` | managed runner 执行进程、runner image、runner release manifest、runner 侧 GA gate |
| `llm-universal-proxy` | `/home/percy/works/mbos-v1/llm-universal-proxy` | AgentSmith 依赖的 llmup pinned image release |
| `agentsmith-fs-control-plane` | `/home/percy/works/mbos-v1/agentsmith-fs-control-plane` | AgentSmith Files/task HOME 依赖的 AFSCP pinned image release |
| `agentsmith-sandbox-control-plane` | `/home/percy/works/mbos-v1/mbos-sandbox-v1` | Agent task sandbox execution 依赖的 ASBCP pinned image release；证据里必须使用 canonical repo identity |

顶层不纳入：

- `jvs`：由 AFSCP release evidence 覆盖，不作为 AgentSmith 顶层 GA repo。
- `agentsmith-desktop`：独立交付面，且不在 `agentsmith-project` org 当前 Web release contract 内。
- 本地 `codex`、sandbox/dev 目录：不是 AgentSmith GA 发布对象。

### 1.2 本轮明确不做

不新增产品功能，不新增治理产品面，不新增 DevOps 发布管理 UI。

不做：

- 云资源 provisioning。
- 多云/多 registry/多 ingress/storage 组合爆炸矩阵。
- kind 作为正式 release target。
- 服务商专用 runner skills、OAuth、managed credential refresh API 或 provider-specific 成功路径。
- 组织级治理总控、复杂审批、发布看板。
- 为 pre-GA 旧命名和旧路径保留长期兼容层。

### 1.3 Substrate 决策

用户要求 GA 发布同时支持：

1. 使用已有 substrates / 云端接口。
2. 可选由发布包提供 substrates 安装。

因此 GA 计划采用两个 operator-facing substrate 策略：

- `use_existing`：operator 提供 PostgreSQL/pgvector、MongoDB、Redis、S3-compatible storage、Keycloak/OIDC、存储类、ingress/TLS 等连接真相。
- `install_substrates`：release-kit 在 operator 提供的现有 Kubernetes namespace/storage/registry 前提下，安装 release-kit 自带的最小 substrate pack，并产出可被部署链消费的 substrate truth。

KISS 边界：

- `install_substrates` 只安装 release-kit 自带的 namespace-scoped substrate pack。
- 不创建云数据库、云桶、IAM、VPC、托管 OIDC realm 或 Kubernetes 集群。
- 不做多云 provider matrix。
- `kit_provided` 作为当前内部/历史词需要在 GA cut 中收敛：面向 operator 的 GA 文档优先使用 `install_substrates`；如果 CLI 需要短期兼容 `kit_provided`，必须只作为 alias/迁移说明，不能成为第二套心智模型。

`install_substrates` 是 GA 的 blocking prerequisite。它必须先补齐最小 installer producer，再出现在 operator 主文档里。它只允许创建带 release-kit ownership label 的 namespace-scoped Kubernetes 资源：`Secret`、`ConfigMap`、`Service`、`Deployment`、`StatefulSet`、`Job`、`PVC`。不得创建 CRD、`ClusterRole`、`StorageClass`、Ingress controller、云资源、备份/恢复系统、HA/升级控制器或长期 substrate lifecycle manager。发现同名未归属资源必须 fail fast。外部 OIDC/Keycloak 不得被静默修改；如果 substrate pack 内含 Keycloak，只能初始化 kit-owned realm/client 并输出 secret refs。

`install_substrates` 必须要求 `operator-inputs` 包内的显式安装确认，例如 `install_confirmation.confirmed=true`、`install_confirmation.operator_run_id` 和 `confirm_current_install_parameters=true` 或匹配的 `install_parameters_sha256`，并输出 `substrate-install-report.json`。Airgap 场景必须把 installer manifests、images、checksums、runbook 和 required tools 一起放进离线包。

Team review 记录了一个可选裁剪项：若为了更快 GA 而放弃 substrate 安装，必须由产品明确改口为 “GA 不安装 substrates，只验证 kit-supplied substrate pack/truth”。在没有这个产品裁剪决定前，本计划按用户要求保留 `install_substrates`，同时把它严格限制为上述最小 namespace-scoped installer。

## 2. GA 成功定义

GA 发布完成必须同时满足：

1. AgentSmith product readiness 通过，并归档 runtime pending/readiness 收口证据。
2. Artifact/image freshness 闭合：六个纳入 repo 均有 canonical provenance、当前 release/tag 或 CI run evidence、digest-pinned artifact/image evidence；release contract / deploy template package / app image / runner image lock 均来自当前可追溯 artifact 链。
3. 四条生产部署路径都有 path-level deployment evidence：
   - `online/use_existing`
   - `online/install_substrates`
   - `airgap/use_existing`
   - `airgap/install_substrates`
4. Release-kit final `ga-release-report.json` 输出 `status: pass` 且 `formal_verdict: issued`。
5. Airgap 包可以在无公网下载前提下完成：bundle check、image archive materiality、image load、offline render check、apply、rollout、smoke。
6. 最小功能 smoke 在部署后通过：
   - auth/profile
   - workspace/project
   - Files / file library
   - managed runner Agent task
   - provider-neutral Endpoint
   - audit/usage readback for events generated by the smoke
7. 面向实施/运维人员的文档入口不要求阅读工程计划、历史 evidence 或 schema 细节即可完成部署、排障和基础操作。

最小治理核心只包括：product readiness、release-kit final GA verdict、runtime pending/readiness 收口证据、post-deploy product smoke、digest/provenance/freshness、airgap offline closure、权限/secret/redaction/contract/source-boundary 检查。Standalone diagnostics、surface report、adoption report、candidate intake、runbook acceptance 和历史 evidence 不得单独升级为 GA gate。Runtime pending/readiness 是 Files、Agent Task sandbox、AFSCP workspace binding 和 read export 的运行时收口主题，不是第三类正式 verdict。

## 3. 最小 GA 发布工具链

### 3.1 Operator 入口

Release-kit 保留一个 operator-facing facade，隐藏 producer catalog：

```bash
bash scripts/operator-release.sh --init-operator-inputs <deployment_path> --output-dir <package-dir>
bash scripts/operator-release.sh --operator-inputs <package-or-json> --doctor
bash scripts/operator-release.sh --operator-inputs <package-or-json> --run
bash scripts/operator-release.sh --ga-report \
  --operator-inputs <online-use-existing-package> \
  --operator-inputs <online-install-substrates-package> \
  --operator-inputs <airgap-use-existing-package> \
  --operator-inputs <airgap-install-substrates-package> \
  --product-readiness-report <agentsmith/product-readiness-report.json> \
  --post-deploy-product-smoke-report <online-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json \
  --post-deploy-product-smoke-report <airgap-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json \
  --output-dir <dir>
```

`deployment_path` 只允许四个 GA operator 选择：`online/use_existing`、`online/install_substrates`、`airgap/use_existing`、`airgap/install_substrates`。Airgap bundle 制作、bundle check、image load、render/check、apply、rollout 和 route smoke 是 package-driven `--operator-inputs <package> --run` 内部 producer/finalizer 步骤；`airgap-bundle/*` 这类历史 positional 命令最多作为 maintainer/internal diagnostic，不是 operator 主路径。

`operator-inputs` 是 operator 的唯一输入包入口。它可以是一个目录或一个 JSON 文件，由 release-kit 的 init/doctor 工具生成或校验，并在内部生成/派生 `render-values.json`、`substrate-truth.json`、`target-prerequisites.json`、image map 和缺项清单。Operator 不需要理解 `target_cluster`、`substrate_source`、`distribution`、`external_declared`、`kit_installed` 等机器值。

### 3.2 Maintainer GA verdict 入口

Release-kit 增加一个最终聚合入口：

```bash
bash scripts/verify-release.sh --ga-release \
  --release-contract <agentsmith-release-contract.json> \
  --deploy-template-package <agentsmith-deploy-template-package.json> \
  --deployment-path-report <online/use_existing/deployment-path-report.json> \
  --deployment-path-report <online/install_substrates/deployment-path-report.json> \
  --deployment-path-report <airgap/use_existing/deployment-path-report.json> \
  --deployment-path-report <airgap/install_substrates/deployment-path-report.json> \
  --product-readiness-report <agentsmith/product-readiness-report.json> \
  --post-deploy-product-smoke-report <online-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json \
  --post-deploy-product-smoke-report <airgap-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json \
  --output-dir <dir>
```

输出：

- `ga-release-report.json`
- `ga-release-summary.md`（从 `ga-release-report.json` 生成的人读视图，不是独立 gate evidence）
- `ga-evidence-index.json`（从 `ga-release-report.json` 派生的归档索引，不发独立 verdict）

最小字段：

- schema/version
- release id / git sha / release contract digest
- app image digest
- runner image digest and manifest digest
- adopted dependency images: llmup / AFSCP / ASBCP
- deploy template package digest
- four deployment path reports and report digests
- airgap bundle manifests, bundle reports, image archive reports, image load reports, offline render reports, checksums/index
- product readiness artifact reference and digest
- product runtime readiness observation policy and Files restore continuation backend-real evidence reference
- online and airgap post-deploy product smoke artifact references and digests
- canonical repos: normalized remote, commit sha, release/tag or CI run URL for the six GA repos
- embedded `artifact_index`
- embedded human summary fields
- derived evidence index source report digest
- `status: pass|fail`
- `formal_verdict: issued|not_issued`
- blocker list

只要任一 required path 缺失、digest 漂移、artifact freshness 不匹配、smoke 缺失或 airgap 在线下载，final verdict 必须 fail fast。Freshness 只能按 `release_id + git_sha + producer_repo + workflow run_id/run_attempt + digest/provenance` 判断，不能靠人工判断“新旧”。

`--ga-release` 只消费 finalized path reports，不重新跑 producer。裸 `operator-release-surface-report.json`、adoption report、candidate intake、operator signoff intake 和 runbook acceptance 只能作为 path report 的内部子步骤证据；不能直接作为 GA verdict 输入，也不能成为 operator 主文档的成功判断对象。

Post-deploy product smoke 的 AgentSmith-owned producer 是 `npm run lane:unified-deploy:product-flows`。它需要下载后的 `agentsmith-release-contract.json`，可通过 `UNIFIED_DEPLOY_RELEASE_CONTRACT` 或 `AGENTSMITH_RELEASE_CONTRACT_PATH` 指向；`UNIFIED_DEPLOY_RELEASE_SITE_ENV` 指向部署目标 site env，`UNIFIED_DEPLOY_RELEASE_ROOT_DIR=<ga-smoke-evidence-root>` 指向输出根。该 lane 每次为一个 deployed target/run 写一份 canonical report；final GA 至少要用不同 site env / evidence root 跑出一份 online report 和一份 airgap report，再用 repeated `--post-deploy-product-smoke-report` 交给 release-kit。`npm run test:unified-deploy:product-flows` 只是 focused aggregate diagnostic，不是 release-kit `--ga-release` 的 canonical report producer。该 lane 不加入默认 `product:ready` / release-full；release-kit `--ga-release` 只消费它已经写好的 finalized reports。

### 3.3 AgentSmith 保持产品侧入口

AgentSmith 不变成部署平台：

```bash
npm run product:ready
npm run product:status
```

它只给 product-side readiness / handoff input completeness，不给 deployment/package/operator verdict。

## 4. 验证矩阵

### 4.1 必跑矩阵

| 维度 | 必跑证据 | Owner |
| --- | --- | --- |
| Product handoff | `product:ready`、release contract artifact、deploy template package、release contract source gate、runtime pending/readiness 收口证据 | AgentSmith |
| Runner | runner CI、runtime fast、image publish、locked image task-execution smoke、runner release manifest、AgentSmith lock adoption | Runner + AgentSmith |
| Dependency images | llmup release/image digest、AFSCP release/image digest、ASBCP release/image digest、AgentSmith lock adoption | AgentSmith |
| online/use_existing | target preflight、render/check、registry presence、apply、rollout、route smoke、deployment path report | release-kit |
| online/install_substrates | substrate installer、substrate truth、routability、render/check、apply、rollout、route smoke、deployment path report | release-kit |
| airgap/use_existing | bundle create/check、image archive materiality、offline image load、offline render/check、apply、rollout、route smoke、deployment path report | release-kit |
| airgap/install_substrates | bundle create/check、substrate installer bundle、image load、substrate install truth、offline render/check、apply、rollout、route smoke、deployment path report | release-kit |
| Post-deploy product smoke | `npm run lane:unified-deploy:product-flows` 按 deployed target/run 产出的 canonical reports；final GA 至少需要 `<online-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json` 和 `<airgap-ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json`，覆盖 auth/profile、workspace/project、Files、managed runner Agent task、provider-neutral Endpoint、audit/usage readback | AgentSmith |
| Runtime pending/readiness | Product Readiness report 中的 `runtime_readiness.observation_policy` 与 Files restore continuation focused backend-real `runtime-readiness-details.json`，覆盖 pending/releasing/offline/not_found 收口规则、AGENT_SANDBOX_UNAVAILABLE 诊断摘要、runtime flake / stability blocker 分类和递增等待间隔 | AgentSmith |
| Final GA | `--ga-release` aggregate over required reports | release-kit |

### 4.2 不做矩阵爆炸

不按云厂商、registry 产品、ingress controller 产品、storage class 产品做笛卡尔积。

GA 的判定是：

- 符合 prerequisites 的 Kubernetes。
- 明确的 substrate truth。
- digest-pinned image closure。
- online 或 airgap artifact 消费。
- 最小产品链路 smoke。

## 5. 实施阶段

### P0: GA 范围冻结与文档路由

目标：让团队知道 GA 只解决发布、部署、验证、文档和潜在问题，不扩产品范围。

任务：

1. 新增/确认本计划为 active GA plan。
2. `docs/engineering/README.md` 指向本计划，旧 release-kit/runner split plan 降为 pre-GA reference。
3. `docs/CURRENT_BASELINE.md` 增加 GA 阅读顺序。
4. 项目宪法把 “pre-GA 工程治理克制” 改为 “GA 后范围锁定与治理克制”。
5. 统一 `product:ready/status` 与 release-kit verdict 的边界说明。
6. `docs/current-engineering-governance-model.md`、`docs/CURRENT_BASELINE.md`、release-kit `docs/RELEASE_GATES.md` 和 release-kit `operator-release.sh --help` 明确：GA operator-facing 只保留 `use_existing` / `install_substrates`，`kit_provided` 最多是短期 alias，并带删除版本或日期。
7. `docs/engineering/governance-lean-closure-plan-v1.md` 归档或标为 reference，只抽出 clean entrypoints、one blocker output、heavy evidence selector 三条仍有效原则。
8. AGENTS / DEVELOPMENT / current governance model 只保留 clean entrypoints 和边界说明，避免重复解释 gate/lane/campaign/verdict taxonomy。
9. 不新增 `current-*` manifest/gate 家族；新检查默认必须合并进现有 `contracts:check`、release-kit final gate 或 diagnostic catalog。
10. 更新 `contracts:check-unified-deploy-vocabulary` 的 GA 路由：GA plan 成为当前实施计划，split plan 降为 pre-GA reference；在 release-kit GA guard 未落地前，仍保留 P0 boundary / `kit_provided` fail-fast 保护，避免把目标态误写成已实现态。

验收：

- doc governance focused tests 通过。
- 没有新产品对象、治理面、角色或权限模型。

### P1: Artifact freshness 链闭合

目标：确保每次 GA 都从同一条 artifact 链产生，不手工拼凑。

任务：

1. AgentSmith current HEAD 生成 runner contract artifact。
2. Runner 消费该 artifact，发布 digest-pinned runner image 和 manifest。
3. AgentSmith 采用 runner manifest 更新 lock。
4. AgentSmith Image Publish 生成 app image 与 release contract input。
5. AgentSmith Release Contract Artifact 生成 release contract。
6. Release-kit intake 验证 release contract + deploy template package + image inventory exact-set。

验收：

- 任一 artifact run id、head sha、digest 不一致即 fail fast。
- runner/image/release contract digest 能用命令复核。

### P2: Release-kit GA gate

目标：把 release-kit 从 focused diagnostics 收敛为 GA 发布 authority。

任务：

1. 新增 maintainer `--ga-release` 聚合入口，并由 operator-facing `operator-release.sh --ga-report` facade 包装。
2. 新增每条 operator path 的 `deployment-path-report.json`，把 surface/adoption/candidate/runbook acceptance 等现有报告降为内部子步骤证据。
3. 支持四条 required operator paths。
4. 输出 `ga-release-report.json`、从它派生的简短 human summary，以及归档用 `ga-evidence-index.json`。
5. Release-kit CI 新增 manual GA workflow；默认 PR/push 仍跑 quick/core，避免重门禁拖慢开发。
6. Bootstrap 语义迁移：
   - producer/path 子步骤报告继续可以是 `readiness:false`
   - adoption/candidate/intake 报告不再是 GA 概念，只能作为 path report 内部输入或 `--ga-release --dry-run` 诊断
   - 只有 `ga-release-report.json` 可以表达正式结果：通过时 `status: pass` + `formal_verdict: issued`；blocked 时 `status: fail` + `formal_verdict: not_issued` + blockers
   - `ga-evidence-index.json` 只绑定最终 report digest、path evidence、product readiness、product runtime readiness、post-deploy smoke coverage 和 blockers，用于归档，不发独立 verdict
   - `target_profiles.required:true` 只在 GA release contract/final gate 模式允许
   - 删除或降级 “full release gate future/not implemented” 这类 operator-facing 文案，保留在 maintainer reference 时必须说明不属于 operator 主路径

验收：

- 缺任一 required path 报告 fail。
- 使用 stale release contract fail。
- 使用 tag-only/mutable image fail。
- online path 和 airgap path digest 不一致 fail。
- 缺 airgap-bundle report、缺 bundle manifest、缺 smoke、`install_substrates` 无确认参数均 fail。Runbook acceptance 只在 path report 内部被声明为 required evidence 时参与 fail-fast，不作为独立 GA 输入或 operator 成功判断对象。

### P3: Substrate install 与 existing substrate 双路径

目标：让 operator 可以选择已有 substrates，也可以选择 release-kit 安装最小 substrate pack。

任务：

1. 新增 `operator-inputs init/doctor`：生成输入包骨架、校验 secret refs/TLS/reachability、输出缺项清单。
2. `use_existing`：收敛 substrate truth schema、target prerequisite schema 和 doctor/preflight 输出；`substrate_secret_refs` 等重复列表优先由 substrate truth 推导，不要求 operator 手工维护两份。
3. `install_substrates`：新增最小 installer producer，安装 namespace-scoped substrate pack，输出 `substrate-install-report.json` 和 substrate truth。
4. airgap bundle 包含 installer 所需 images、manifests、scripts、checksums、runbook。
5. 明确不做 cloud resource provisioning。
6. `kit_provided` 旧词收敛为 alias/历史说明或删除。

验收：

- operator 不需要同时理解 `external_declared` / `kit_installed` 机器值。
- operator 主命令只接收 `--operator-inputs <dir|json>` 和少数确认参数。
- `install_substrates` 没有显式确认参数不得执行。
- installer 输出的 substrate truth 被后续 render/apply/smoke 消费。
- installer 不创建 CRD、cluster-wide RBAC、StorageClass、Ingress controller、云资源、备份/恢复系统或长期 lifecycle manager。

### P4: 部署与功能 smoke

目标：证明部署后的已有功能能工作。

任务：

1. Release-kit 只负责 route smoke、rollout 和部署证据，不拥有产品 flow semantics。
2. AgentSmith 产出部署后 product smoke artifact，覆盖 auth/profile、workspace/project、Files/file library、managed runner Agent task、provider-neutral Endpoint、audit/usage readback。
3. Files/file library smoke 通过 AFSCP-backed path 验证。
4. Managed runner Agent task smoke 通过 ASBCP + runner image 验证。
5. LLM endpoint smoke 只使用 provider-neutral endpoint config；不绑定特定 SaaS 技能或 credential。
6. Smoke 输出只给 pass/fail、必要 URL、artifact digest 和排障指针，不泄露 secret。
7. Product Readiness 前保留 Files restore continuation focused backend-real gate 作为 runtime pending/readiness 重点证据；首个 sandbox unavailable 后重跑通过归档为 runtime flake，连续出现升级为稳定性 blocker。

验收：

- required post-deploy product smoke 都有 AgentSmith-owned evidence。
- route smoke 四条路径必跑；完整 product smoke 默认至少覆盖一个 online 路径和一个 airgap 路径。若模板、route ownership、substrate strategy 或配置生成有 path-specific 改动，必须升级对应路径 product smoke。
- DeepSeek/其他 provider 只作为 endpoint 配置输入，不成为 runner/provider-specific 成功路径。
- Runtime pending/readiness evidence 必须包含 Files / Agent Task sandbox / AFSCP workspace binding / read export 对 `pending`、`releasing`、`offline`、`not_found` 的收口规则；`AGENT_SANDBOX_UNAVAILABLE` 证据必须记录 API、pod manager、ASBCP create/status 调用摘要、request id、workload id、phase 和错误码；gate 等待连续 non-terminal 后使用递增间隔，不固定每分钟轮询。

### P5: 文档 GA cut

目标：实施/运维人员只看最少文档即可完成工作。

读者路由：

| 读者 | 默认入口 | 不需要读 |
| --- | --- | --- |
| Developer | `DEVELOPMENT.md` | release-kit producer catalog、历史计划 |
| Release maintainer | 本 GA plan + release-kit maintainer appendix | operator copy/paste runbook 之外的产品说明 |
| Operator / implementer | release-kit runbook 总入口 | AgentSmith 工程计划、manifests、schema 细节、surface/adoption/candidate report |
| Owner diagnostic | diagnostic catalog / owner runbook | operator 主路径文档 |

需要改的文档：

| 文件 | GA 改造 |
| --- | --- |
| `docs/CURRENT_BASELINE.md` | GA 当前事实路由；隐藏 pre-GA 主叙事 |
| `docs/README.md` | 指向 GA 计划和 operator 文档，不让读者先读历史计划 |
| `docs/engineering/README.md` | 本计划为 active；pre-GA split plan 为 reference |
| `docs/contracts/unified-deploy-contract.md` | release-kit 是 final GA verdict authority；deployment/package/operator evidence 只作为 final GA 输入 |
| `docs/user-guides/release-readiness-checklist.md` | 只讲 AgentSmith product readiness，不混部署 runbook |
| `docs/user-guides/unified-deploy-operations.md` | local-kind/existing-cluster 降为 maintainer diagnostic |
| `docs/user-guides/file-library-access-model.md` | `release:ready` 改为 `product:ready` 或部署后 smoke |
| `docs/user-guides/identity-and-permission-model.md` | 移除 MVP/pre-GA 语气，只保留 GA 支持行为 |
| `docs/user-guides/workspace-isolation-model.md` | 移除 pre-GA baseline 语气 |
| `docs/user-guides/personal-connections.md` | 移除 pre-GA baseline 语气 |
| `docs/user-guides/audit-usage-reports.md` | 删除未被合约支撑的 retention/tamper-proof/export 过度承诺 |
| `docs/user-guides/alert-center.md` | 删除未实现的 email/webhook/auto-dismiss/预算平台化承诺 |
| release-kit `README.md` | 从 bootstrap/focused 改为 GA operator contract |
| release-kit `docs/RELEASE_GATES.md` | 定义 final GA gate |
| release-kit `docs/runbooks/README.md` | 成为 operator runbook 总入口 |
| runner `README.md` / `docs/RELEASE_GATES.md` | runner publish manifest -> AgentSmith lock -> release contract 成为正式链路 |

最小 operator 文档包：

1. GA 部署总览。
2. online/use_existing runbook。
3. online/install_substrates runbook。
4. airgap bundle runbook。
5. airgap/use_existing runbook。
6. airgap/install_substrates runbook。
7. 基础运维和排障 runbook。
8. 基础功能说明：身份/权限、workspace/project、Files、Agent tasks、Endpoints、Audit/Usage。

### P6: GA release rehearsal

目标：做一次完整发布演练，证明 release 工具和文档可以交付团队执行。

顺序：

1. 确认 llmup / AFSCP / ASBCP pinned releases 是否需要升级；不需要则只验证 current lock。
2. AgentSmith product readiness。
3. Runner artifact/image/manifest/adoption。
4. AgentSmith app image + release contract。
5. Release-kit 四路径部署证据。
6. Release-kit final `--ga-release`。
7. 创建 GitHub Releases/tags：
   - `agentsmith`
   - `agentsmith-runner`
   - `agentsmith-release-kit`
   - 必要时升级并发布 `llm-universal-proxy`
   - 必要时升级并发布 `agentsmith-fs-control-plane`
   - 必要时升级并发布 `agentsmith-sandbox-control-plane`
   - 若不升级，记录 current lock verification evidence
8. 归档 GA evidence index。

验收：

- 所有 required workflow success。
- 所有 required artifacts 未过期。
- 所有 images digest-pinned。
- Airgap 包不依赖公网下载。
- Operator 文档可以按 copy/paste 执行。

## 6. 开发团队切片建议

| Slice | Owner | 写入范围 | 验收 |
| --- | --- | --- | --- |
| GA doc routing | AgentSmith docs owner | AgentSmith docs only | doc governance + targeted doc tests |
| Governance slim cut | AgentSmith + release-kit docs owners | active docs, command/help surfaces, old plan routing | obsolete active docs hidden, duplicate taxonomy reduced |
| Release contract GA profiles | AgentSmith release-boundary owner | `current-release-boundary-schema.ts`、fixtures/tests | release-boundary tests |
| Runner GA adoption chain | Runner + AgentSmith owner | runner manifest docs/tests、AgentSmith lock/adoption checks | runner CI + lock adoption check |
| Release-kit final gate | release-kit gate owner | `verify-release.sh`、new checker、fixtures/tests | focused shell tests + CI |
| Substrate installer | release-kit deploy owner | installer producer/runbook/tests | installer dry-run + apply smoke |
| Airgap package closure | release-kit package owner | bundle/check/load/render tests | airgap bundle consume rehearsal |
| Post-deploy product smoke | AgentSmith integration owner | smoke runner and docs; release-kit only provides deployment endpoint/report refs | auth/profile + workspace/project + Files + Agent task + Endpoint + audit/usage readback |
| Operator docs | release-kit docs owner | runbooks only | runbook acceptance + copy/paste smoke |

代码、checker、contract 改动必须先写最小失败 fixture/test，再改脚本或实现。Docs-only cleanup 只跑 doc/static guard，不要求为删减文档制造 TDD 仪式。

## 7. 风险与处理

| 风险 | 处理 |
| --- | --- |
| release-kit 继续暴露过多 producer 命令 | Operator docs 只暴露 facade 和 final report；producer catalog 留给 maintainer |
| `install_substrates` 变成云资源 provisioning | 明确 namespace-scoped installer；云资源全部 out of scope |
| `kit_provided` / `install_substrates` 双词增加心智负担 | GA 文档只保留一个 operator-facing 词，旧词作为 alias 或删除 |
| `install_substrates` 带来备份、升级、HA 期待 | GA installer 不提供长期 substrate 运维承诺；operator 对持久化、备份、容量和生产 HA 策略负责 |
| kind 被误认为正式发布目标 | 只放 maintainer rehearsal，不进 GA required matrix |
| release evidence 过期或手工拼接 | final `--ga-release` 检查 run id、head sha、artifact freshness、digest |
| 服务商绑定回流 | provider-specific SaaS skills/OAuth/credential 不进入 success path |
| 治理继续膨胀 | 只新增 final GA gate 和必要 source/contract checks；不新增看板/审批/产品治理对象；不新增 `current-*` manifest/gate 家族 |

### 7.1 近十几天治理投入产出复盘

本节记录 2026-05-23 到 2026-06-06 的 team member review 与本地 spot check 结论，用作后续工作取舍指导。它不是新 gate、不是新报告、不是新审批，也不要求以后为“反过度治理”再开独立流程。

观察：

| Repo | 近十几天信号 | 取舍判断 |
| --- | --- | --- |
| `agentsmith` | 约 397 个非 merge commit，集中在 product readiness、release boundary、runner contract、runtime pending/readiness、docs/gates；当前 `package.json` 约 199 个 scripts，`scripts/` 约 550 个文件，其中 `scripts/governance/` 约 136 个、`scripts/contracts/` 约 54 个，`current-*` 家族体量偏高 | 真实 runtime/readiness 收口要继续；新增治理对象、manifest/schema 家族要冻结 |
| `agentsmith-release-kit` | 约 248 个非 merge commit，集中在 operator facade、final GA report、deployment path reports、airgap/offline、provenance；`scripts/` 约 84 个文件，历史 surface/adoption/candidate/signoff/intake/runbook acceptance 面偏多 | final GA authority 必须保留；后续优先合并/隐藏/删除旧 producer 面，而不是新增解释层 |
| `agentsmith-runner` | 约 50 个非 merge commit，多数服务 runner image、secret scrub、source boundary、handoff manifest | 相对健康；runner 只产出 downstream evidence，不升级为第三个 GA verdict |
| `llm-universal-proxy`、AFSCP、ASBCP | 变更少，主要是 pinned image、repo-local gate wording 或真实 runtime 修复 | 保持 repo-local 最小 release gate；不要把它们扩成 AgentSmith 顶层治理矩阵 |

结论：

- 这两周不是单纯治理膨胀：runtime pending/readiness、artifact freshness/provenance、airgap offline closure、secret/redaction、source boundary、post-deploy product smoke 都是在关闭真实 GA 风险。
- 但 AgentSmith 与 release-kit 的工程发布治理成本已经偏高，尤其是脚本入口、`current-*` manifest/schema、历史 surface/adoption/candidate/signoff/intake/report 族。后续新增前必须先考虑合并或删除。
- 这里缩减的是工程发布治理 overhead，不是产品内的资源策略、审计、成员权限等客户可见治理能力。
- 面向 operator 的心智模型保持四件事：deployment path、input/credential refs、one command、final report。任何新概念不能进入这四件事之外的主路径。

后续 ROI 判断尺：

1. 新 evidence 必须服务至少一个真实风险：部署可执行、traceability/provenance、离线可执行、secret/redaction、source boundary、runtime convergence 或 post-deploy product smoke。
2. 新 check 必须能阻止已出现的 GA blocker，或保护高成本 release invariant；只维护命名一致性的检查应合并进现有 doc/vocabulary guard。
3. 新 report 默认并入 Product Readiness、deployment-path-report、ga-release-report 或各仓既有 `verify-release`；除非能证明现有 final consumer 无法表达该事实。
4. 新 root/package script 必须替代一个旧入口，或被 top-level human entrypoint / CI 直接消费；focused diagnostic 不能使用 readiness/verdict/signoff 词汇。
5. 新 `current-*` schema/manifest 默认拒绝；例外必须替换或删除同等真相来源，不能只为治理系统新增治理元数据。
6. 历史 alias 只做兼容，不出现在 operator 主文档、final report 顶层字段或成功判断里。
7. 新文档优先补进 active doc；超过约 150 行的新说明应同时删除、归档或降级等量旧说明。这个数字只是工程判断，不做自动 gate。
8. 新增 guard/report/script 的理由应能在提交说明、PR 摘要或本轮工作总结里顺手说明：它替代、合并或降级了什么；不新增模板、看板或审批。
9. 重 gate 只放在阶段收口、最终交付、合并/发布/部署前；小切片继续用 focused check 和 dry-run/plan 先定位风险。

### 7.2 Runtime pending/readiness 架构反馈采纳边界

2026-06-06 team member review 采纳架构反馈：最近反复阻挡 Product Readiness / gate 的 Files、Agent Task sandbox、AFSCP workspace binding 和 read export 问题，应按 runtime pending/readiness 收口处理，不按单点 Files bug、terminal bug 或 AFSCP bug 打散。

采纳的指导：

- Files runtime access release 必须绑定稳定 release fence / operation id；后续 list、restore continuation、background recheck 观察并推进同一 fence。
- `pending` / `releasing` / `release_pending` 是正常中间态，只递增等待或 recheck；`offline` / `not_found` 先回查 runtime/binding truth，再决定 rebind 或 terminalize。
- 只有 `released` / `revoked` / `deleted` / 明确 terminal 状态才 complete fence，并 invalidate read export。
- `delete_pod` 遇 sandbox unavailable、rate limited 或同类 retryable release debt 时，保留 release fence 并返回 typed pending，不 rollback 后让下一次 Files list 从头释放。
- ASBCP / AFSCP release/revoke 的幂等维度必须围绕 workload、mount binding、generation、operation 稳定生成；AgentSmith 只补 owner boundary 内的 adapter/调用语义，不在前端仓新造控制层。
- Product Readiness 前保留 Files restore continuation focused backend-real gate 作为重点证据；首次 unavailable 后重跑通过记 `runtime_flake`，同 focused gate 连续失败升级为 `stability_blocker`。

明确不做：

- 不新增 canonical `failure_class`、gate/report/dashboard、readiness layer 或 “runtime governance” 命令族。
- 不把 runtime pending/readiness 做成新的产品对象、治理 taxonomy 或独立 dashboard；它只作为既有 evidence path 的 observation / diagnostic fact。
- 不把 focused backend-real gate 写成 Product Readiness 终局 verdict；它只产出重点证据。
- 不为一次 flake 做大重构；连续失败才按稳定性 blocker 推进 owner 修复。
- 不把 ASBCP / AFSCP owner repo 的幂等缺口用 AgentSmith wrapper 长期掩盖；AgentSmith 只做最小调用收口和证据补强。

### 7.3 项目集 runtime readiness owner 边界

2026-06-07 project-set team observation 复核了 `agentsmith`、`agentsmith-fs-control-plane`、`mbos-sandbox-v1` 和 `agentsmith-runner` 的职责边界。结论是：当前 Files restore continuation focused backend-real 在 AgentSmith completed release fence invalidation 修复后通过，证据为 `artifacts/backend-real/current/files-restore-readexport-convergence-20260607T032831Z/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json`，`classification=clean_pass` 且无 runtime readiness signals / call summaries。因此本轮 GA 主线先不启动 AFSCP、ASBCP 或 runner 的多仓功能改造。

2026-06-07 Product Readiness run `27082269204` 又在同一 Files restore continuation 场景复发，focused evidence 记录 `file_library_list_pending_count=6`、`classification=stability_blocker`，且没有 `AGENT_SANDBOX_UNAVAILABLE`。ASBCP v2.0.18 证据显示 pod delete 已收敛，runner 不拥有 Files/read export truth；team member 复核后把 owner 收敛到 AFSCP worker bounded execution：`AFSCP_WORKER_RUN_ONCE_TIMEOUT` 已存在，但历史实现只约束 store open，没有约束实际 JVS restore/export 等 operation 执行，卡住时可能让 same-repo mutation gate 长时间保持 pending。采纳的最小功能增强是 AFSCP repo-local 修复 run-once execution timeout，让超时通过既有 operation failed / writer fence release 路径收口；该修复已发布并通过 `infra/deploy/shared/afscp-image.lock` 采用为 AFSCP `v1.0.8` digest-pinned image。不在 AgentSmith 新增 gate/report/dashboard，也不让 ASBCP 或 runner 代写 AFSCP terminal truth。

后续如果 Product Readiness 或 focused gate 再次复发，按以下 owner 边界处理：

- AgentSmith Files owner：只负责稳定 release fence 观察、typed pending、completed fence 后 invalidate read export、runtime flake / stability blocker evidence 分类，以及不读 stale projection。可以做最小 read-through / invalidation 修复；不得合成 AFSCP terminal truth。
- AFSCP / Files storage owner：当 evidence 显示 workload mount binding 长期 `releasing` / `release_pending`、缺少 `released` / `revoked` terminal fact、read export 已创建但 WebDAV projection 不可见，或 same-repo JVS mutation gate 长时间 pending 时，负责补齐 release/revoke terminal evidence、storage durable barrier、export-visible boundary 和 worker bounded execution。增强应落在运行时事实生产者和 AFSCP contract 实现，不新增 AgentSmith-side governance layer。
- ASBCP owner：仅当新 evidence 再出现 `AGENT_SANDBOX_UNAVAILABLE`、`IDEMPOTENCY_CONFLICT`、`workload_release_incomplete`、`delete_pod` 5xx、pod status stuck，且 API / pod manager / ASBCP create-status summary 指向 sandbox 行为时，做 repo-local 窄修。v2.0.18 已覆盖同 workload delete convergence、stable observed-at 和 release/status idempotency；没有 sandbox 信号时不把 Files pending 回压给 ASBCP。
- Runner owner：不承接 storage、Files retry、read export 或 AFSCP release truth。Runner 只证明 task HOME/workspace path、process lifecycle、terminal close ack、artifact scan 和 managed runner image/manifest handoff。

2026-06-07 broader project-set review 继续核对 `agentsmith-desktop`、`agentsmith-release-kit`、`jvs`、`llm-universal-proxy`、`codex` 和 `business`。结论是：这些项目不承担当前 Files/AFSCP/sandbox runtime readiness blocker 的功能修复。`agentsmith-desktop` 是桌面本地挂载消费方；`agentsmith-release-kit` 只聚合 release / operator evidence，不拥有 Product Readiness 的 runtime truth；`jvs` 只有在 AFSCP evidence 明确指向 JVS typed error 或 direct contract bug 时才进入 owner 修复；`llm-universal-proxy` 的 `/ready` 是模型代理 readiness，不是 AgentSmith Product Readiness；`codex` 的 CLI sandbox 语义不等同于 `AGENT_SANDBOX_UNAVAILABLE`；`business` 只保留商务材料角色。后续不要把这些项目拉进本 blocker 的整改范围，除非新的 typed evidence 明确点名对应项目。

功能增强触发条件：

1. 单次 sandbox unavailable 后重跑通过：记录 runtime flake，不扩大改造。
2. 同一 focused gate 内多次 `file_library_list_pending`，或连续 focused gate 同一 runtime readiness 失败：升级 stability blocker，先按 evidence 定 owner，再做 repo-local 最小修复。
3. 只有当 focused backend-real 仍无法通过，或 Product Readiness 复发并产生稳定性 blocker，才同步启动兄弟项目功能增强；不要用拉长等待、无限重试或新增 report/gate 掩盖 terminal truth 缺口。
4. 兄弟项目修复后的验证顺序是 owner focused test / repo-local gate，然后回 AgentSmith Files restore continuation focused backend-real，最后在阶段收口回 Product Readiness。

## 8. Implementation readiness

本计划已进入开发实施。实施前置条件：

1. Team review 同意 repo 清单。
2. Team review 记录了 `install_substrates` 可作为功能裁剪项；当前计划按用户要求保留，并同意其 KISS 边界。
3. Team review 同意 final release-kit verdict 归 release-kit，不回流 AgentSmith。
4. Team review 同意最小文档包。
5. Team review 同意治理瘦身方向与近十几天 ROI 复盘：operator 只看输入包、入口命令和最终报告；surface/adoption/candidate/report taxonomy 回到内部证据；新增 guard/report/script 必须替代、合并或降级旧负担。
6. 本计划状态已改为 `implementation-ready`。
