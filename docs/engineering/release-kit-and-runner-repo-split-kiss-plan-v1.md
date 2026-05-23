# Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1

<!-- markdownlint-disable MD013 -->

Status: `team_reviewed_handoff_ready`
Date: 2026-05-23
Owner: Product + Engineering

## 1. 目标

把 AgentSmith 当前的发布执行能力和 runner 执行进程拆成更清晰的工程制品边界，同时不扩大 AgentSmith 产品范围。

最终目标：

1. AgentSmith repo 负责产品代码、产品合同、产品验证、前后端 image 和本地完整测试。
2. `agentsmith-release-kit` repo 负责在线部署、离线包、发布包校验、operator runbook 和部署证据；真实 Kubernetes / 云端托管 Kubernetes 是一等目标，kind 只是本机演练目标。
3. `agentsmith-runner` repo 负责 runner 执行进程、builtin skills runtime、runner image 和 runner 侧测试；runner 协议包由 AgentSmith 合同/共享合同流程发布，runner repo 只消费。
4. `npm run release:ready` 仍是 AgentSmith 唯一普通发布前自动化结论；release summary 可以分区展示 AgentSmith 产品证据和 release kit 分发/部署证据，但不新增命令、gate 或发布状态。

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
- 当前 release campaign 直接绑定 visual、backend-real、unified deploy 和 product flows，见 [current-verification-campaign-manifest.ts](../../scripts/governance/current-verification-campaign-manifest.ts)。
- Unified deploy 只有一个部署模型，`local-kind` 和 `existing-cluster` 只是 profile，不是两个产品，见 [unified-deploy-contract.md](../contracts/unified-deploy-contract.md)。
- Runner 协议核心在 `TaskExecutionContext`、WS frame、runner spec 和路径/env 约束，见 [agent-execution-protocol.md](../contracts/agent-execution-protocol.md) 与 [protocol.ts](../../packages/agent-runner/src/protocol.ts)。
- 当前 runner 执行进程在 [packages/agent-task-runner](../../packages/agent-task-runner)，AgentSmith API 编排、Context Store、Files 与 execution ticket 仍在 [packages/api-entry-node](../../packages/api-entry-node)。

工程判断：

1. 发布执行适合拆，产品验收不适合拆。
2. Runner 进程适合拆，Agent task / Files / Context Store / 调度真相不适合拆。
3. Airgap 必须做成真实离线包；当前只有部分 archive/load helper，不是完整离线发布能力。

## 4. Repo 职责

| Repo | 负责 | 不负责 |
| --- | --- | --- |
| `agentsmith` | 产品代码、产品合同、OpenAPI/AsyncAPI、前后端 image、产品验证、本地完整测试、产品证据、外部 image/manifest adoption | operator 安装包、离线包、发布平台、runner 执行进程长期实现 |
| `agentsmith-release-kit` | 在线部署、离线包、image bundle、Kubernetes render/apply/smoke、可选 substrate 安装、外部 substrate 连接校验、发布包校验、operator runbook、部署/分发证据 | visual、backend-real、产品 DB/bootstrap 语义、产品 UI/e2e 真相、发布管理 UI、云资源 provisioning |
| `agentsmith-runner` | runner 执行进程、Codex/terminal/artifact/skills runtime、runner image、runner CI、contract conformance tests | runner contract source of truth、Agent task API、Agent Runners API、runner key、presence/heartbeat、Context Store、Files/file library、managed credential、审计/用量、前端管理面 |

补充说明：

1. AgentSmith 拥有产品 schema、初始化代码和 bootstrap 语义。
2. Release kit 可以打包、渲染、执行和等待 bootstrap workload，并产出部署证据；它不解释产品 schema，也不改 bootstrap 业务逻辑。
3. Runner repo 可以实现 builtin skills 的本地 runtime 和请求级投影消费；Context Store 权限、scope 和 managed credential 解析语义仍由 AgentSmith 定义。
4. 新 repo 本地目录固定与 `agentsmith` 同级：`/home/percy/works/mbos-v1/agentsmith-release-kit`、`/home/percy/works/mbos-v1/agentsmith-runner`；canonical remote 固定为 `https://github.com/agentsmith-project/<repo>.git`。
5. `agentsmith-runner` 是唯一 canonical runner repo；当前同级目录已有的 `agentsmith-codex-runner` 只能作为迁移输入或归档对象，不能成为第二条 runner 真相。

ASBCP / AFSCP / LLMUP 继续作为外部 provider image 被消费。AgentSmith 只 pin digest 和验证 adoption，不拥有这些 provider 的 release gate。

## 5. 不做

本计划明确不做：

1. 不新增发布控制台、发布 dashboard、DevOps 编排产品。
2. 不新增普通用户 runner picker、runner marketplace、运行时切换、runner image selector。
3. 不把 ASBCP、K8s、image digest、internal URL/key、sandbox/control plane 等内部细节暴露给普通用户。
4. 不把 `check-product-flows.ts`、visual、backend-real、story/e2e 迁到 release kit。
5. 不把 Context Store、Files/file library、managed credential、execution ticket 迁到 runner repo。
6. 不做 API 多副本、execution gateway、离线队列、Keycloak operator、Kubernetes substrate、云集群/数据库/bucket/IAM/network 自动创建。
7. 不为旧字段、旧路径、旧 env 做长期双轨兼容；pre-GA 改动优先 fail fast。
8. 不为小概率环境做厚重兜底；缺合同、缺 digest、缺镜像、缺权限就快速失败。

## 6. 部署模式矩阵

Release kit 的部署模式由三根正交轴组成。三根轴是为了降低实施心智负担，不是新增产品线。

| 轴 | 值 | 含义 |
| --- | --- | --- |
| `target_cluster` | `existing_kubernetes` | 真实 Kubernetes 目标，包括私有 Kubernetes 和云端托管 Kubernetes。 |
| `target_cluster` | `kind_rehearsal` | 本机或 CI 演练目标。kind 是可选工具，不是用户部署前提。 |
| `substrate_source` | `kit_installed` | release kit 安装当前声明的 compatible substrates，并产出连接真相和 readiness evidence。初始 KISS 只支持当前 Docker/compose substrate pack；是否适合真实集群由 routability preflight 决定。 |
| `substrate_source` | `external_declared` | operator 提供 PostgreSQL/pgvector、MongoDB、Redis、S3-compatible object storage、Keycloak/OIDC 等连接真相；release kit 只校验，不创建云资源。 |
| `distribution` | `online` | 从 GHCR 或 operator 指定 registry 拉取 digest-pinned images。 |
| `distribution` | `airgap` | 使用离线包、OCI layout 或 image archives，不联网拉镜像、工具或模板。 |

允许的最小组合：

| 组合 | 是否一等支持 | 用途 |
| --- | --- | --- |
| `existing_kubernetes + external_declared + online` | 是 | 常规真实部署主路径。 |
| `existing_kubernetes + external_declared + airgap` | 是 | 真实离线部署主路径；外部依赖作为 operator prerequisite 记录和校验。 |
| `existing_kubernetes + kit_installed + online/airgap` | 是，但需显式 preflight | 自包含或受控环境；release kit 安装 substrate pack，但不把它伪装成云资源管理。 |
| `kind_rehearsal + kit_installed + online/airgap` | 是，演练用途 | 本机/CI/离线包自测。 |
| `kind_rehearsal + external_declared + online/airgap` | 可选诊断 | 验证连接真相和镜像包，不作为主要用户路径。 |

心智模型：

1. 用户先选目标：真实 Kubernetes，或本机 kind 演练。
2. 再选依赖：release kit 安装，或连接已有/云端依赖。
3. 最后选分发：在线拉镜像，或离线包导入。

Release kit 对云端的支持只表示“部署到 operator 已提供的 Kubernetes 和依赖服务”。它不创建云集群、数据库、bucket、Keycloak realm/client、IAM 或网络资源。

## 7. 最小合同

### 7.1 AgentSmith Release Contract v1

AgentSmith CI 产出一个机器可读 release contract，给 release kit 消费。

最小字段：

- `schema_version`
- `product: "agentsmith"`
- `release_id`
- `git_sha`
- `images`
- `deploy_template_digest`
- `openapi_digest`
- `asyncapi_digest`
- `required_product_flows`
- `prerequisite_images`
- `target_profiles`
- `substrate_connection_schema`
- `min_release_kit_version`

规则：

1. 所有正式 image 必须是 immutable digest，优先 `image:tag@sha256:<digest>`。
2. tag-only image 直接失败。
3. release contract 只描述产品制品和必要验证，不描述发布流程细节。
4. release kit 不 import AgentSmith 源码，只读 contract 和部署模板包。
5. `images` 是 component-to-image map，例如 `web`、`api`、`product_schema_bootstrap`、`managed_runner`、`asbcp`、`afscp`、`llmup`、`ingress_controller`、`ingress_certgen`。多个 component 可以指向同一个 digest。
6. `prerequisite_images` 只声明 release kit 需要 mirror/load 但不由 AgentSmith 构建的底座或集群组件镜像。所有会被 pull/load/apply 的 image 都必须能追溯到 digest。
7. `required_product_flows` 当前最小集合是 `workspace_project`、`files`、`agent_task_managed_runner`。其他流程只有在 release scope 明确要求时才加入。
8. `target_profiles` 声明支持的 `target_cluster`、`substrate_source`、`distribution` 组合，以及每个组合的 namespace/RBAC/ingress/TLS/storage class/registry/pull secret prerequisites。
9. `substrate_connection_schema` 使用中性连接真相命名，例如 `agentsmith.substrate-connection.truth/v1`；旧 `docker-substrate.truth/v1` 只能作为 `kit_installed` 的内部 installer truth，不得用于 `external_declared`。

### 7.2 Substrate Connection Truth v1

目标：让真实 Kubernetes / 云端部署不被 Docker-only 语义卡住，同时不引入 cloud provider framework。

最小字段：

- `SUBSTRATE_SOURCE=kit_installed|external_declared`
- PostgreSQL/pgvector：host、port、database、user/password 或 secret ref、sslmode、required extension check
- MongoDB：host、port、database、user/password 或 secret ref、TLS mode
- Redis：host、port、password 或 secret ref、TLS mode
- object storage：S3-compatible endpoint、bucket、access key/secret 或 secret ref、scheme/TLS、path/virtual-host style
- Keycloak/OIDC：public issuer、realm/client id、JWKS/metadata reachability、read-only validation mode
- redacted fingerprint

规则：

1. `external_declared` 允许 DNS/FQDN 和 TLS；不能 fallback 到 Docker defaults。
2. `external_declared` 不创建或修改云资源、bucket、DB user/database、Keycloak realm/client、IAM 或网络资源；只允许连接校验、能力校验，以及在 operator 已提供的数据库内运行 AgentSmith-owned product schema/bootstrap。
3. `kit_installed` 必须产出同一份中性 connection truth，供 render/apply/smoke 消费。
4. 缺 endpoint、凭据、issuer、bucket、extension、TLS/sslmode 或可达性时 fail fast。

### 7.3 Release Kit Evidence v1

Release kit 产出部署证据，AgentSmith adapter 再映射回当前 release summary。

所有 evidence 都必须绑定本次输入制品，至少包含 `release_contract_digest`、`release_id`、`git_sha`、`release_kit_version`、`target_cluster`、`substrate_source`、`distribution`、`target`、`status`、`failure_class` 和 evidence root。缺这些字段时 AgentSmith adapter 必须拒绝映射，避免 stale evidence 混入当前 release summary。

通用输出：

- `deploy-result.json`
- `image-map.json`
- `render-report.json`
- `rollout-report.json`

Airgap 输出：

- `bundle-manifest.json`
- `registry-mirror-map.json`

规则：

1. evidence 只证明部署和分发，不证明产品功能全部通过。
2. product flows 仍由 AgentSmith 生产。
3. online 与 airgap 共用同一份 image digest policy。
4. online 模式不要求 image archive；airgap 模式缺 archive、digest mismatch、联网访问尝试、生成 manifest 漂移都 fail fast。
5. release kit smoke 只证明部署、路由、镜像 adoption 和基础健康；AgentSmith product flows 必须能指向真实 Kubernetes/cloud base URL，不能只绑定 kind。

### 7.4 Runner Contract v1

Runner contract 从当前 `packages/agent-runner` 收敛为唯一版本化包，例如 `@mbos/agent-runner-contract`。AgentSmith 的协议文档和产品合同仍是来源；contract 包由显式 shared-contract 流程发布，runner repo 只消费，不反向定义 Agent task 产品语义。

v1 冻结：

- WS endpoint/auth/query/envelope；
- `server.hello`、`server.request.start`、`server.request.cancel`、`server.ping`；
- `agent.ready`、`agent.pong`、`agent.response.*`、`agent.terminal.*`；
- `TaskExecutionContext`；
- runner support HTTP contract：execution ticket、workspace access/release、Context Store 请求级投影、managed credential 只读投影、resource proxy；
- `TASK_HOME` / `HOME` / `workspace_path` / `.artifacts` 路径约束；
- negative contract：旧字段和旧路径直接拒绝。

规则：

1. AgentSmith 和 runner repo 都依赖同一个 contract 包。
2. 不手工复制类型。
3. breaking change 升 major。
4. 不支持的 protocol version fail fast。

## 8. 分阶段计划

### P0. 边界冻结，不搬代码

目标：先让所有人对边界达成一致。

工作：

1. 在 AgentSmith 增加 repo ownership matrix。
2. 增加 Repo Bootstrap Contract：本地 bootstrap 校验新 repo 位于 `/home/percy/works/mbos-v1/` 下与 `agentsmith` 同级，且本地 `origin` 指向 `https://github.com/agentsmith-project/<repo>.git`；GitHub Actions / repo CI 只校验 GitHub org/repo identity、artifact provenance、contract 和 image digest，不校验 Percy 机器路径。
3. 固定 runner repo 命名：`agentsmith-runner` 是唯一 canonical repo，`agentsmith-codex-runner` 只作为迁移输入或归档对象。
4. 同步更新权威合同和入口文档：`docs/contracts/unified-deploy-contract.md`、`docs/contracts/product-terminology.md`、runtime lines / unified deploy operations docs 必须从 Docker-only/local-kind 主线收敛到 deployment mode matrix 和 substrate connection truth。
5. 定义 deployment mode matrix：`target_cluster`、`substrate_source`、`distribution` 三轴，以及允许组合。
6. 定义 `agentsmith-release-contract/v1` schema。
7. 定义中性 `substrate-connection truth/v1` schema。
8. 定义 release kit evidence schema。
9. 定义 runner contract package 的 v1 冻结范围。
10. 定义 release kit 如何读取 deploy template package；模板源码可以逐步迁到 release kit，但在迁移完成前必须由 AgentSmith 明确产出 template package，不允许 release kit 猜 repo 路径。
11. 增加 fail-fast contract tests：tag-only image、缺 digest、缺 required flow、旧 runner 字段、release kit 误 import AgentSmith 产品源码、kind 被当成必需部署目标、external substrate 使用 Docker truth。

验收：

- 计划和 schema 能回答“谁负责、谁不负责、失败在哪里停”。
- 没有新增用户可见产品入口。
- 没有移动 runtime 代码。
- kind 被明确为 rehearsal，不是用户部署前提。

建议验证：

```bash
npm run contracts:check
npm run contracts:check-current-verification-campaigns
```

### P1. AgentSmith 产出可消费 release contract

目标：AgentSmith 先成为清晰的制品提供方。

工作：

1. AgentSmith CI 发布 component image digest，至少覆盖 `web`、`api` 和 `product_schema_bootstrap`。当前它们可以指向同一个 app image digest。
2. 在 runner 拆出前，AgentSmith 临时继续发布 managed runner image digest。
3. 生成 `agentsmith-release-contract.json`。
4. release summary 记录 release contract 路径和 digest。
5. 保持 `npm run release:ready` 不变，避免同时改验收和部署工具。

验收：

- contract 中每个 image 都有 digest。
- contract 与当前 OpenAPI/AsyncAPI 和 deploy template digest 对齐。
- `release:ready` 仍使用当前产品证据闭环。

### P2. Release Kit Online MVP

目标：独立 repo 先跑通真实 Kubernetes online deploy，不碰产品验收；kind 只作为可选 rehearsal。

工作：

1. 新建 `agentsmith-release-kit`。
2. 迁入不依赖 AgentSmith 产品源码的 deploy 工具：manifest/render、Kubernetes apply/dry-run、substrate install/status/connection truth verify、address truth、API single-replica、route smoke。
3. 所有路径参数化，禁止默认读 AgentSmith repo root。
4. 提供 `target preflight`、`render/check`、`images mirror`、`apply`、`rollout`、`smoke`。
5. `images mirror` 只 pull/mirror digest-pinned images，不从 AgentSmith 或 runner repo source build image；目标 registry 由 operator 指定，不能写死 `kind-registry`。
6. API single-replica 等规则来源仍是 AgentSmith release contract / deploy contract；release kit 只执行检查，不独立定义产品部署规则。
7. 支持 `existing_kubernetes + external_declared + online` 作为在线部署主路径。
8. 支持 `kind_rehearsal + kit_installed + online` 作为本机/CI 证明工具。
9. AgentSmith 保留 thin adapter，把 release kit evidence 映射回当前 release campaign。

不迁：

- `check-product-flows.ts`
- visual
- backend-real
- story/e2e
- product DB/bootstrap 语义

验收：

- online deploy 能从 GHCR/digest 或 operator 指定 registry 拉取 image。
- `existing_kubernetes + external_declared + online` 能产出 preflight、render、apply、rollout、route probe、image adoption evidence。
- `kit_installed` 模式的 substrate lifecycle/truth evidence 在 release-ready deploy snapshot 中可见；如果 P2 早期暂留 AgentSmith，不能宣称 release kit 已完整拥有 online deploy。
- kind rehearsal 产出 images、rollout、route probe evidence，但不能作为用户真实部署前提。
- real Kubernetes/cloud smoke 只证明目标集群安装和路由，不声称 product flows 通过。
- AgentSmith `release:ready` deploy snapshot 仍有 dependencies/images/rollout/product flows 四段，其中 product flows 仍来自 AgentSmith。
- release kit CI 至少覆盖 contract schema、render/dry-run、digest-only、no source import；真实 Kubernetes/cloud smoke 可以是手动或 scheduled，需要 secrets/kubeconfig 时必须产出同一 evidence schema。

### P3. Release Kit Airgap MVP

目标：产出可部署到真实 Kubernetes 的离线发布包；kind 只是可选断网演练目标。

工作：

1. 先实现 `bundle verify` 覆盖 online deploy 产物，再实现 `bundle create`、`bundle load`、`bundle apply`、`bundle smoke`。
2. 离线包包含所有实际会被安装触达的 images、deploy templates、profile-specific env/schema、scripts、runbook、checksums。
3. image bundle 使用统一 manifest，记录 source image、archive sha256、target registry digest。
4. 增加 target registry mirror map，支持真实集群使用 operator 指定的离线 registry。
5. 增加断网演练：不允许运行时联网拉 image、下载 tool 或访问在线 registry。

image 范围由 rendered manifests 和 operator prerequisite 声明共同生成/校验，避免手写清单漂移。最小类别：

- AgentSmith components：`web`、`api`、`product_schema_bootstrap`；
- managed runner；
- ASBCP、AFSCP、LLMUP；
- ingress controller / certgen；
- `kit_installed` bundle 需要的 substrate images：PostgreSQL/pgvector、MongoDB、Redis、MinIO、MinIO client、Keycloak；
- `kind_rehearsal` 需要的 registry/kind node/CSI 相关 images；
- `existing_kubernetes + external_declared` app bundle 可以把外部依赖列为 operator prerequisite，但必须有明确 prerequisite/evidence，不静默在线拉取。

验收：

- 缺任一 image archive 失败。
- digest mismatch 失败。
- tag-only image 失败。
- `existing_kubernetes + external_declared + airgap` 在断网环境 `verify/load/render/apply/smoke` 通过。
- `kind_rehearsal` 可以作为可选离线包自测，不是 airgap 定义本身。
- 手工 operator signoff 仍单独记录，不能被自动化冒充。

### P4. AgentSmith 发布 Runner Contract 包

目标：先由 AgentSmith 合同/共享合同流程把 runner 协议发布成稳定包，再迁执行进程。

工作：

1. 从 `packages/agent-runner` 提取唯一正式 contract 包 `@mbos/agent-runner-contract`，source of truth 仍是 AgentSmith 合同和协议文档。
2. 加 machine-readable schema 和 fixtures。
3. AgentSmith API 和 runner repo 都只依赖这个包。
4. 增加 protocol 和 runner support HTTP conformance tests。

验收：

- AgentSmith 不再直接依赖 runner 实现类型。
- 旧字段和旧路径 negative tests 通过。
- protocol version 不匹配时 fail fast。
- execution ticket、workspace access/release、Context Store 请求级投影、managed credential 只读投影都有 fixtures。

### P5. Runner Runtime Repo

目标：把 runner 执行进程和 image 构建迁出。

工作：

1. 新建 `agentsmith-runner`。
2. 迁入 `packages/agent-task-runner`、builtin skills runtime、runner Dockerfile 和 runner 单测。
3. Runner repo CI 覆盖 typecheck、unit、builtin skill tests、fake WS contract tests、invalid JSON、unsupported protocol version、missing HOME/TASK_HOME、forbidden persisted credential、Docker build、启动缺 env fail-fast smoke。
4. Runner repo 发布 image 到 GHCR，release manifest 包含 image digest、source commit、contract version、Codex version、breaking changes/compat policy。
5. AgentSmith 新增 `agent-task-runner-image.lock`，并用 runner release manifest 校验 image digest、contract version、Codex version 和兼容策略。
6. Runner adoption 顺序固定为：runner repo release manifest/image digest -> AgentSmith 更新 lock -> AgentSmith release contract 输出锁定 digest -> release kit 消费 release contract。

验收：

- AgentSmith 不从 monorepo source build 正式 runner image。
- AgentSmith backend-real / managed runner 主链可用。
- 本地开发可以保留 override，但不能作为 release proof。
- lock-only 更新不能算采纳成功；release contract 的 runner digest 与 lock/runner manifest 不一致时失败。
- 真实 Kubernetes smoke 校验 managed runner 运行中 pod `imageID` 与 release contract digest 一致。

### P6. 清理和防回流

目标：删除重复路径，避免新旧双轨。

工作：

1. 在 release-kit / runner 集成面上，AgentSmith 只保留 thin adapters、contract checker、docs 指向和产品集成测试；AgentSmith 的产品合同、OpenAPI/AsyncAPI、验证入口和产品代码继续保留。
2. 只有 release kit adapter 完成 parity、`release:ready` 已消费新 evidence、回滚路径明确后，才删除或降级旧 unified deploy standalone 实现；不得删除当前 unified deploy contract/model。
3. 删除 runner runtime 源码，保留必要 shim 或迁移说明。
4. 增加 static guard，防止正式路径重新 import 外部 repo 源码、tag-only image、旧 runner 字段、release kit import 产品源码。

验收：

- `npm run verify -- --goal=pr --run` 通过。
- runner/skills 相关改动按范围跑 `npm run test:skills:fast` 或 `npm run test:agent-task:runner:fast`。
- 发布收口跑 `npm run release:ready`。

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

它从 GHCR 或配置的在线 registry 拉取 digest-pinned images。它不 build AgentSmith 或 runner 源码。正式输入不能使用含 mutable tag 的 `site.env.example`；必须由 release contract 和 profile-specific env/schema 生成。

### Airgap

离线发布包包含：

- online 包的全部内容；
- `images/` 或 OCI layout；
- `bundle-manifest.json`；
- checksums；
- load/import scripts；
- offline smoke runbook；
- 必要工具或明确的 operator prerequisite。

airgap 的判断标准很简单：在断网环境里，包内内容足够完成 load、render、apply 和 smoke；如果选择 `external_declared`，外部 substrate / 云端依赖是 operator prerequisite，release kit 只校验连接和证据，不尝试离线创建这些云资源。

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

开始实现前必须确认：

1. Product 同意不新增发布产品面和 runner 产品面。
2. Engineering 同意 AgentSmith 仍拥有产品验收证据。
3. Release kit 团队同意只做部署/分发证据。
4. Runner 团队同意只拆执行进程和 contract，不搬产品 API。
5. Release kit 团队同意 kind 是 rehearsal，不是用户部署前提。
6. 每个阶段都有明确 fail-fast tests。
7. 每个阶段都能独立回滚或停止，不要求一次性大爆炸迁移。

阶段收口必须回答：

1. 这次改动有没有新增用户概念？
2. 有没有把产品证据搬出 AgentSmith？
3. 有没有引入 tag-only image？
4. 有没有让 release kit import AgentSmith 产品源码？
5. 有没有让 runner repo 解释 Context Store、Files 或 managed credentials 权限？
6. 有没有把本地开发 override 当成 release proof？
7. 有没有把 release kit 产物当成新的 release verdict？
8. 有没有把 kind 当成部署必需条件？
9. 有没有把云端支持写成云资源管理产品？
10. 有没有新增 substrate provider abstraction？

任一答案为“有”，停止并回到边界评审。

## 11. 成熟度判断

这份计划成熟的标准不是“覆盖所有未来可能”，而是：

1. 每个 repo 的职责能一句话说清楚。
2. 每个阶段都能 fail fast。
3. 每个阶段都能交付可验证结果。
4. 每个复杂点都回到已有合同，而不是发明新体系。
5. AgentSmith 产品范围没有变大。

推荐执行顺序：P0-P1 -> P2 online -> P3 airgap -> P4 runner contract -> P5 runner runtime -> P6 收口。P4 可以提前做只读设计，但在 release kit image inventory 稳定前，不进入 runner runtime 迁移；P5 完成前也不能删除 monorepo runner build 或宣称最终发布包闭环完成。
