# AgentSmith Sandbox Control Plane (ASBCP) 独立发布改造计划 v1

状态：已按用户补充与 team review 修订，可 handoff 给开发团队；ASBCP repo 文档落地后，本文件降级为历史迁移计划与 AgentSmith consumer-side 边界说明，不作为 ASBCP release/config 长期权威
日期：2026-05-18
目标读者：后续开发团队、发布治理负责人、跨仓库集成负责人

## 1. 目标

把当前兄弟项目 `../mbos-sandbox-v1` 整理为公开 GitHub 项目 `agentsmith-sandbox-control-plane`，正式缩写为 `ASBCP`。ASBCP 后续像 AFSCP 一样独立开发、独立治理、独立构建、独立 CI、独立发布镜像；AgentSmith 只消费 ASBCP 发布的 image digest，不再构建、启动、发布或治理 ASBCP 源码。

最终交付形态：

- GitHub repo：`https://github.com/agentsmith-project/agentsmith-sandbox-control-plane`
- 正式缩写：`ASBCP`
- GHCR source image：`ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`
- AgentSmith lock：`infra/deploy/shared/asbcp-image.lock`
- AgentSmith deploy image input：`ASBCP_IMAGE`
- AgentSmith server/internal API env：`ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY`
- ASBCP 职责：只负责 Agent task sandbox workload lifecycle 这个内部后端服务链路，不承接 AgentSmith 产品治理、审计、AI 资源策略、system 管理侧、用户访问入口或 UI 范围

ASBCP 是内部后端服务和部署依赖，不是用户访问入口、system 管理侧或 AgentSmith 产品治理入口。AgentSmith UI、i18n 文案、product-facing user docs 和用户侧失败路径不应直接暴露 `ASBCP`、`control plane`、`workload lifecycle`、`sandbox` 或 `sandbox workload` 这类工程术语；产品侧统一描述为“任务执行环境”或“托管运行环境”，例如“任务执行环境暂不可用，请稍后重试或联系管理员”。用户侧失败路径也不得泄漏 ASBCP 名称、`control plane`、`workload lifecycle`、`sandbox`、`sandbox workload`、internal URL 或 key。ASBCP repo docs 与 developer/operator/deployment docs 可以使用工程名，但必须先说明 ASBCP 是内部后端服务；部署配置细节只进入这些允许路径。

## 2. 需求评价与原则

用户要求“不要保留随意的 `SANDBOX_MANAGER` 历史名，兄弟项目命名、代码风格、配置风格要一致”是合理的，并且在 pre-GA 阶段符合最佳实践。

推荐做法不是机械全局替换，而是结构化 clean cut：

- 先定义唯一 identifier matrix。
- 再迁移 repo、image、Go module、binary、K8s resource、AFSCP caller/actor、AgentSmith env、tests、docs。
- 不保留旧 env alias，不做 `SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` 及其常见变体与 `ASBCP_*` 双轨兼容。
- 用静态 guard 阻止旧名回流。
- API 业务语义不因改名而扩大：ASBCP 仍只管 workload lifecycle。
- canonical active forbidden list 固定为：`mbos-sandbox-v1`、`../mbos-sandbox-v1`、`sandbox-manager`、`agentsmith-sandbox-manager`、bare prefix `SANDBOX_MANAGER`、prefix env names `SANDBOX_MANAGER_...`、bare prefix `SANDBOX_CONTROL_PLANE`、prefix env names `SANDBOX_CONTROL_PLANE_...`、常见旧名/中间符号变体 `sandboxManager` / `SandboxManager` / `sandbox_manager` / `sandbox-manager` / `sandboxControlPlane` / `SandboxControlPlane` / `sandbox_control_plane`、`SANDBOX_SERVICE_KEY`、`SANDBOX_SOURCE_DIR`、`--sandbox-source-dir`、`cmd/manager`、`./cmd/manager`、`go run ./cmd/manager`、`mbos/sandbox-manager`、`github.com/sandbox/manager`、`/etc/asbcp/config.yaml`、`/etc/sandbox-manager/manager-config.yaml`、旧 `sandbox-manager` image lock/template 文件名，例如 `sandbox-manager-image.lock`、`sandbox-manager-pv-rbac.yaml.tpl`。
- 旧名 guard 对 `SANDBOX_CONTROL_PLANE` 系列只禁 env bare/prefix 和代码符号形态，不得用裸 `sandbox-control-plane` substring pattern 匹配；`agentsmith-sandbox-control-plane` 作为 canonical repo/image/K8s/AFSCP caller 名必须允许。
- 旧名 guard 必须检查 active 内容和路径名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。本文件可作为 historical migration plan 被 exact allowlist：`docs/engineering/agentsmith-sandbox-control-plane-release-independence-plan-v1.md`，reason 为记录 pre-GA clean-cut 迁移背景；如果后续归档，必须迁到固定历史路径并更新 exact allowlist。

ASBCP 可以借鉴 AFSCP 的治理方法论，但不能复制 AFSCP 的业务内容。AFSCP 是 filesystem/storage control plane；ASBCP 是 sandbox workload lifecycle service。两者缩写相近，更需要在文档和代码中保持职责清晰。

## 3. 命名矩阵

| 层级 | 目标名称 | 说明 |
| --- | --- | --- |
| 正式全称 | `AgentSmith Sandbox Control Plane` | 工程组件名 |
| 正式缩写 | `ASBCP` | 仅 ASBCP repo docs、developer/operator/deployment docs、治理、release、配置可使用；不进入 product-facing user docs |
| GitHub repo | `agentsmith-project/agentsmith-sandbox-control-plane` | 公开项目 |
| Go module | `github.com/agentsmith-project/agentsmith-sandbox-control-plane` in `manager-service/go.mod` | 本轮不迁到 repo root；保留 `manager-service` 为 Go module root，清除旧 module path |
| Binary / command | `asbcp` | 固定短名，避免继续使用 `manager` |
| GHCR image | `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>` | AgentSmith 只消费 immutable digest |
| AgentSmith image lock | `infra/deploy/shared/asbcp-image.lock` | 取代 `sandbox-manager-image.lock` |
| Lock keys | `asbcp_version`、`asbcp_source_image`、`asbcp_release_url`、`asbcp_commit_sha` | `asbcp_version` 固定为带 `v` 的 `vX.Y.Z`；`asbcp_source_image` 内必须同时包含同一个 `vX.Y.Z` tag 与 immutable digest；不额外拆出重复字段 |
| AgentSmith deploy image env | `ASBCP_IMAGE` | 只允许 deploy render、local-kind image producer、backend-real/local-real internal container launcher、K8s manifest wiring 使用，不是 ASBCP API 调用凭据或 server API 配置 |
| AgentSmith server/internal API env | `ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` | 只允许 server-side API deps、local/backend-real internal diagnostics 和 Kubernetes Secret/ConfigMap wiring 使用 |
| Web/Next/browser env | none | 禁止 `NEXT_PUBLIC_ASBCP_*`，禁止将 ASBCP URL/key 或 service key 打进 web/Next/browser runtime、client bundle、frontend route payload |
| K8s Deployment/Service/ServiceAccount/RoleBinding | `agentsmith-sandbox-control-plane` | pre-GA clean cut，不保留旧 runtime identity；consumer 侧只验证 dedicated ServiceAccount identity、RoleBinding 指向和无 legacy/public RBAC 残留 |
| Container name / labels | `asbcp` / `app.kubernetes.io/component=asbcp` | 统一观测和 selector 心智 |
| AFSCP caller/actor | `agentsmith-sandbox-control-plane` | allowed caller、service token、actor id 必须同名一致 |
| ASBCP config path | `/etc/asbcp/asbcp-config.yaml` | canonical path；禁止漂移到 `/etc/asbcp/config.yaml` 或旧 `/etc/sandbox-manager/manager-config.yaml` |
| ASBCP container env | `ASBCP_CONFIG_PATH`、`ASBCP_SERVICE_KEYS`、`ASBCP_WORKLOAD_NAMESPACE`、`ASBCP_AFSCP_INTERNAL_BASE_URL`、`ASBCP_AFSCP_ORCHESTRATOR_TOKEN`、`ASBCP_AFSCP_CALLER_SERVICE`、`ASBCP_AFSCP_ACTOR_TYPE`、`ASBCP_AFSCP_ACTOR_ID` | ASBCP repo 自己定义和校验 |
| 开发者/运维可见表达 | “ASBCP internal sandbox execution service” / “Agent task sandbox execution backend” | 只用于 ASBCP repo docs 与 developer/operator/deployment docs，且必须先说明它是内部后端服务；不进入 AgentSmith UI/i18n/product-facing user docs 或用户侧失败路径 |

禁止新增中间命名，例如 `SANDBOX_CONTROL_PLANE`、`SANDBOX_CONTROL_PLANE_...`、`sandboxControlPlane`、`SandboxControlPlane`、`sandbox_control_plane` 这类 env prefix 或代码符号形态。`agentsmith-sandbox-control-plane` 是 canonical repo/image/K8s/AFSCP caller 名，不属于中间命名。本轮目标是从旧 `SANDBOX_MANAGER` clean cut 到 `ASBCP`。

## 4. 三方职责

| 项目 | 负责 | 不负责 |
| --- | --- | --- |
| AgentSmith | 产品授权、Agent task 输入与文件库绑定、符合合同的 runner/image 解析、ASBCP image digest lock、部署消费、focused integration diagnostics、consumer wiring 验证 | 构建 ASBCP 源码、发布 ASBCP image、维护 ASBCP release gate、维护 ASBCP canonical provider schema/contract、新增用户可见 repo/runner image 选择入口 |
| AFSCP/JVS | 文件系统真相、workspace binding、mount plan、版本/恢复能力 | 创建 Agent task Pod、选择 runner image、维护 ASBCP lifecycle |
| ASBCP | 消费 AFSCP mount plan，管理 PV/PVC/Pod/exec/keepalive/release/delete，维护自身 API contract、runbook、risk/readiness evidence、release gate | AgentSmith 产品治理、AI 资源配额、用户 UI、AFSCP/JVS 存储真相、raw storage credential 管理 |

ASBCP repo 是 ASBCP 治理唯一来源，并拥有 canonical schema/contract。AgentSmith 只保留消费者侧说明、image lock 更新流程、部署 wiring 和必要集成证据；AgentSmith 仍必须验证自身部署模板中的 image、internal Service URL、`ASBCP_SERVICE_KEY` -> `ASBCP_SERVICE_KEYS` 映射、AFSCP caller/token、dedicated ServiceAccount identity、RoleBinding 指向、无 legacy/public RBAC 残留、无 public ingress 等 consumer wiring，不维护或校验 ASBCP provider RBAC capability schema。

AgentSmith 对 ASBCP 的消费分两层：`ASBCP_IMAGE` 是部署 image 输入，也可供 backend-real/local-real internal container launcher 启动同一 image-only 路径；`ASBCP_INTERNAL_BASE_URL` 与 `ASBCP_SERVICE_KEY` 是 server/internal API 调用输入。后两者不得进入 `NEXT_PUBLIC_*`、web/Next/browser runtime、frontend route payload、MSW public fixture、UI 文案或 i18n namespace。前端只看到后端整理后的 Agent task 状态或错误码。AgentSmith 不新增用户可见 repo selector 或 runner image selector。

## 5. 当前实现真相

本节是计划创建时（2026-05-18）的基线快照，用于说明为什么需要 clean cut，不是执行时必须重复清理的固定返工清单。每个 slice 开始前必须以当前 guard、测试和 evidence 为准，先确认漂移仍存在，再处理仍命中的项。

AgentSmith 当前存在直接 sibling source 和旧命名依赖：

- `scripts/unified-deploy/check-local-kind-images.ts` 默认读取 `../mbos-sandbox-v1/manager-service`，执行 sandbox-manager Docker build。
- `scripts/run-internal-agent-task-real-gate.sh`、`scripts/run-integration-release-user-story.sh`、`scripts/local-manual/internal-common.sh`、`scripts/lib/internal-sandbox-real-control.sh` 仍会定位 `../mbos-sandbox-v1`，部分路径直接 `go run ./cmd/manager`。
- `scripts/backend-real-full-gate.sh` 会串起 release/full gate 路径；如果不覆盖，它可能继续间接使用旧 source 启动链路。
- `infra/deploy/unified/templates/app/workloads.yaml.tpl`、`config.yaml.tpl`、`afscp.yaml.tpl`、`rbac.yaml.tpl`、`sandbox-manager-pv-rbac.yaml.tpl` 中仍存在 `sandbox-manager` / `agentsmith-sandbox-manager` / `SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` / `SANDBOX_SERVICE_KEY` surface。
- `infra/deploy/unified/env/site.env.example` 如果仍使用 mutable sandbox image tag，会让 render 默认输入绕开 image lock。
- `workloads.yaml.tpl` 和 `internal-sandbox-real-control.sh` 仍有 JuiceFS/storage endpoint/access/secret 等 raw storage env 漂移，需要迁出 ASBCP 运行合同。
- `check-render.ts`、`render.test.ts` 仍在 AgentSmith 内校验部分 ASBCP provider config/env/RBAC 细节；这些应迁入 ASBCP repo，AgentSmith 只保留消费者 wiring 检查。

`../mbos-sandbox-v1` 当前独立发布能力不足：

- Go module 布局是 `manager-service` 子目录 module。为了减少返工，本轮保持 `manager-service` 为 Go module root，只把 module path/import/ldflags clean cut 到 `github.com/agentsmith-project/agentsmith-sandbox-control-plane`；不做 repo root Go module 迁移。
- Git remote 仍指向 Gitee 的 `mbos-sandbox-v1`。
- 缺少公开项目所需的治理骨架，例如 `LICENSE`、`NOTICE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`SECURITY.md`、PR template、release gate、risk/readiness evidence、runbooks。
- GitHub Actions 存在漂移：workflow 使用 Go `1.24`，但 `go.mod` 声明 `1.25.6`；部分 CI target 或脚本路径已经不存在。
- `release-gate` 只覆盖部分 Go 检查和 binary build，不足以证明 image、K8s render、active API smoke 可发布。
- 当前 repo 有 service + `images/runner` 双镜像/离线包痕迹，但 AgentSmith active 合同只需要 ASBCP 服务镜像；`images/runner` 本轮只能作为非 active fixture，不进入 ASBCP release/GHCR/product-facing user docs。
- 一些旧 smoke/e2e 仍引用过时 `/v1/sandboxes` 或旧执行模型，需要收敛到当前 `/v1/workspaces/.../workloads` 合约。

## 6. 范围

必须做：

- 将 sibling project 整理并发布为 `agentsmith-sandbox-control-plane` GitHub public repo。
- 建立 ASBCP 自己的公开项目治理骨架、CI、release gate、GHCR image 发布。
- 全面迁移旧名：canonical active forbidden list 不得留在 active code/config/docs/tests 或 active 路径名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。
- AgentSmith 标准路径只消费 `ASBCP_IMAGE` digest，不再 build 或 go run sibling source。
- `ASBCP_IMAGE` 与 `ASBCP_INTERNAL_BASE_URL`/`ASBCP_SERVICE_KEY` 边界拆开：前者只做部署 image 输入和 backend-real/local-real internal container launcher，后两者只做 server/internal API 调用输入；禁止新增 `NEXT_PUBLIC_ASBCP_*` 或任何 web/Next/browser runtime 暴露。
- AgentSmith 中属于 ASBCP provider 的治理、schema、release、runbook、config/env/RBAC 能力说明迁到 ASBCP repo。
- AgentSmith 只保留 ASBCP consumer adoption 验证/diagnostics：image lock、Deployment/Service wiring、无 public ingress、ASBCP URL/key、Agent task 主链 smoke；最终收口仍回到现有 `npm run verify -- --goal=... --run` 或 `npm run release:ready`，不新增独立 gate 名称。
- 删除 AgentSmith 传给 ASBCP 的 raw storage credential 漂移，让 ASBCP 只消费 AFSCP mount plan。
- 用 TDD 补上 ASBCP clean cut、image-only 消费、旧名禁用、AFSCP caller 一致性的测试和静态守卫。

不做：

- 不重写 Agent task 产品对象、文件库、JVS/AFSCP 语义。
- 不复制 AFSCP 的业务内容、存储对象、GA selector 复杂度或 evidence taxonomy。
- 不新增 `SANDBOX_CONTROL_PLANE`、`SANDBOX_CONTROL_PLANE_...` 或其 camel/Pascal/snake 代码符号变体这种第二套中间配置；不得把 canonical `agentsmith-sandbox-control-plane` repo/image/K8s/AFSCP caller 名误判为此类中间配置。
- 不保留 `SANDBOX_MANAGER`、`SANDBOX_MANAGER_...` 或其 camel/Pascal/snake/kebab 变体到 `ASBCP_*` 的兼容 alias。
- 不把旧 `/v1/sandboxes`、旧 SSE sandbox session、raw storage credential 或 direct pod-deleting cleaner 带回 active surface。
- 不把 `dangerous-system-tools` 纳入常规发布链路。
- 不把 `images/runner` 作为本轮 ASBCP release artifact、GHCR package 或 product-facing user docs 内容；runner 若要发布，另起计划。
- 不在 AgentSmith UI/i18n/product-facing user docs/用户侧失败路径中直接暴露 `ASBCP`、`control plane`、`workload lifecycle`、`sandbox`、`sandbox workload` 或 ASBCP internal URL/key；产品侧统一说“任务执行环境/托管运行环境”。

## 7. ASBCP 治理模型

ASBCP 采用 “AFSCP-lite” 治理：只借鉴方法论，不复制业务内容。

repo-local 治理资产按首轮 required/minimal 与 later/optional 分层；首轮只交付 required/minimal，later/optional 不作为本轮 release 阻塞项，避免复制 AFSCP 级流程。

| 层级 | 资产 | 边界 |
| --- | --- | --- |
| 首轮 required/minimal | `README.md` | 说明 ASBCP 独立演进、职责边界、快速验证、image 消费方式 |
| 首轮 required/minimal | `CONTRIBUTING.md`、`SECURITY.md`、`NOTICE`、Apache-2.0 `LICENSE`、`CHANGELOG.md` | 公开项目基础治理，不扩展成 AFSCP 级流程；`CHANGELOG.md` / release notes 只记录变更摘要并引用 `asbcp-final-manifest.json`，不复制 digest/runtime evidence |
| 首轮 required/minimal | `.github/pull_request_template.md` | 要求列出 contract、security、operation、test evidence、docs impact |
| 首轮 required/minimal | `docs/DEVELOPER_GUIDE.md` | 开发、测试、构建、发布入口 |
| 首轮 required/minimal | `docs/RELEASE_GATES.md` | 唯一权威 release gate 定义 |
| 首轮 required/minimal | release manifest schema/说明、`docs/READINESS_EVIDENCE.md` | docs 中只保留 schema/说明；`asbcp-final-manifest.json` 由 release workflow 生成并作为 GitHub Release asset canonical evidence |
| 首轮 required/minimal | `docs/contracts/` | 只覆盖 active API、auth、AFSCP mount-plan dependency、operation/error contract |
| 首轮 required/minimal | `docs/runbooks/` | 只覆盖 local dev、release、rollback/rollforward、K8s operations、diagnostics 的必要路径 |
| later/optional | `docs/DEVELOPMENT_GOVERNANCE.md`、扩展版 `docs/RISK_REGISTER.md`、`docs/adr/` | 后续确有维护需要再补；不把 ADR/risk 流程做成本轮发布前置重流程 |

唯一权威 release gate：

- 权威脚本/唯一入口：`scripts/verify-release.sh`。
- 可有 wrapper，但唯一权威入口仍是 `scripts/verify-release.sh`；wrapper 名不作为合同。
- `scripts/verify-release.sh` 是发布前阻塞检查，只在 tag/release workflow 或手动 release readiness 运行；不能放进每个 PR/main 默认 gate。
- release workflow 必须在 push image 前调用 `scripts/verify-release.sh`，不能绕过它调用零散测试；push 后还必须对 exact `image:tag@digest` 运行最小 health/ready/API smoke，除非 workflow 以可审计方式证明 `scripts/verify-release.sh` 验证的镜像 digest 与被 push 的 digest 完全相同。
- PR/main CI 默认只运行 lighter required guards，例如 `make verify` + `make image-build` + old-name guard、module layout/version guard、active API contract guard、runner non-active guard、raw storage env 禁用 guard；lighter CI 不能当作 release readiness。
- workflow hardening test 必须证明 release workflow 调用了权威 gate，并证明 push 前调用 `scripts/verify-release.sh`、push 后 fresh Docker config 匿名 pull/inspect、push 后 exact `image:tag@digest` 最小 health/ready/API smoke（或同 digest 证明）、随后生成 `asbcp-final-manifest.json` 的顺序关系。
- 人工审批、AgentSmith 集成状态、兄弟项目状态不能成为 ASBCP release gate 条件。
- release gate 必须是阻塞式证据 gate：image build、image smoke、K8s render、`/healthz`、`/readyz`、AFSCP mount-plan fixture、workspace binding、workload create/keepalive/exec/release/delete 任一必需证据失败即失败，不允许降级为 warning 或“后续补证据”。
- release workflow 只发布 ASBCP service image；`scripts/verify-release.sh` 不发布 image，只证明 release readiness。`images/runner` 非 active fixture 不参与 gate、GHCR release 或 release notes。

轻量 evidence manifest：

- docs 中只保留 release manifest schema/说明，不把 `docs/release-evidence/release-manifest.json` 写成需要随 tag commit 预先提交的固定 evidence。
- `asbcp-final-manifest.json` 由 release workflow 在 image push 成功，并用 fresh Docker config 匿名 `image:tag@digest` pull/inspect 成功后生成，并附加为 GitHub Release asset；workflow artifact 只能作为可选副本。
- `asbcp-final-manifest.json` 使用固定 schema id `https://agentsmith.dev/schemas/asbcp/final-manifest.v1.json`，最小必填字段及来源为：`asbcp_version` / `git_tag` 来自 root `VERSION` 与 Git tag，`commit_sha` 来自 release workflow checkout，`image_ref` / `image_digest` 来自 build-push output，`anonymous_pull` 来自 fresh Docker config `image:tag@digest` inspect/pull，`post_push_smoke` 来自 push 后 exact digest health/ready/API smoke 或同 digest 证明，`api_contract_version` 来自 ASBCP contract/version truth，`runtime_evidence` 来自 release gate 与 post-push smoke，`known_breaking_changes` 来自 release workflow input，`old_name_guard` / `raw_storage_credential_guard` / `runner_non_active_guard` 来自 release gate guard output。
- `asbcp-final-manifest.json` 记录 health/ready、workspace binding fixture、workload create/keepalive/exec/release/delete、AFSCP mount plan fixture、K8s render、image smoke、匿名 GHCR `image:tag@digest` inspect/pull、旧名禁用、raw storage credential 禁用、runner 非 active 归类、version/tag/digest/commit 对齐。
- `docs/READINESS_EVIDENCE.md`、GitHub Release body、`CHANGELOG.md` / release notes 和 handoff 文档只能从 `asbcp-final-manifest.json` 派生或引用，不做第二本 evidence 账；digest/runtime evidence 以 `asbcp-final-manifest.json` 为准，`known_breaking_changes` 如需发布说明可纳入该 manifest。
- 不引入 AFSCP 的 optional capability selector 复杂度，除非 ASBCP 未来确实需要。

## 8. 目标架构

跨 repo flow：

- ASBCP repo 自己构建、测试、发布 `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- AgentSmith 只 pin `asbcp-image.lock`，部署时把该 image mirror/tag/push 到目标 registry。
- AFSCP/JVS 负责文件系统版本与挂载能力；ASBCP 只消费 AFSCP workload mount plan 并管理 K8s workload lifecycle。

AgentSmith 消费合同：

- 新增 `infra/deploy/shared/asbcp-image.lock`。
- lock 至少记录 `asbcp_version`、`asbcp_source_image`、`asbcp_release_url`、`asbcp_commit_sha`。
- `asbcp_source_image` 必须是 `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- `asbcp_version`、image tag、GitHub Release tag 和 `asbcp_release_url` 中的 tag 都固定为同一个带 `v` 的 `vX.Y.Z`。
- AgentSmith lock 不记录 API contract version；API contract version 只出现在 ASBCP `asbcp-final-manifest.json`，CHANGELOG/release notes 只能引用该 manifest。
- lock 内容只做离线静态自洽校验：`asbcp_version`、image tag、digest、release URL tag 和 commit SHA 格式必须一致；不证明真实发布 provenance。
- flow 固定为：`lock -> local-kind image producer -> generated site env -> render -> rollout`。
- render 继续只消费 site env；不要让 render 直接读 lock，以免破坏 existing-cluster operator site env 模型。
- release/render 验证必须显式使用 image producer 生成的 site env，或使用同等 digest fixture；不能依赖含 mutable dev tag 的默认 `site.env.example`。
- `site.env.example` 中的 `ASBCP_IMAGE` 必须是 digest 示例或不可直接运行的占位说明。
- local-kind target repo 使用 `mbos/agentsmith-sandbox-control-plane`，不得继续 `mbos/sandbox-manager`。
- 任何进入 rendered Deployment 的 active `ASBCP_IMAGE` 必须是 `@sha256` digest ref；local-kind 可使用 mirrored target digest，existing-cluster 可使用 source digest 或目标 registry digest。tag-only 只能出现在非 active 示例，且不能通过 render/release 验证。
- `ASBCP_IMAGE` 只用于 deploy render、local-kind image producer、backend-real/local-real internal container launcher 和 K8s image wiring；不得被当作 server API 配置。
- `ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只能存在于 server-side API deps、internal diagnostics env 和 Kubernetes Secret/ConfigMap wiring；禁止 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、frontend bundle、browser logs、i18n messages、product-facing user guides troubleshooting steps 或用户侧失败路径暴露这些值。
- external `ASBCP_INTERNAL_BASE_URL` 只证明 API wiring/smoke 可连通，不证明 image lock adoption；consumer adoption 验证仍必须保留 digest lock、generated site env、render manifest、rollout/Pod image digest 证据。
- AgentSmith lock parser 只做离线静态校验：字段存在、`vX.Y.Z` 一致、canonical repo、digest、release URL tag、commit SHA 格式、no-v negative fixture。consumer adoption 验证不调用 GitHub API/PAT 证明 provenance；真实 provenance 由 ASBCP GitHub Release asset `asbcp-final-manifest.json` 证明。

backend-real/local-real 运行合同：

- 标准路径：如果需要本地 ASBCP 服务，使用发布 image 以 container 形式启动，或使用外部提供的 `ASBCP_INTERNAL_BASE_URL`。
- container 模式必须显式处理 `ASBCP_CONFIG_PATH=/etc/asbcp/asbcp-config.yaml`、`ASBCP_SERVICE_KEYS`、KUBECONFIG/volume、AFSCP token/base URL、namespace、日志、container cleanup、readyz 等待和失败保留策略。
- 不允许标准 diagnostics/release path 默认 `cd ../mbos-sandbox-v1/manager-service && go run ./cmd/manager`。
- `make local-real-up/status/reset/down` 继承同一 ASBCP image-only 路径：只能使用 `ASBCP_IMAGE` container launcher 或 external `ASBCP_INTERNAL_BASE_URL`，不得访问 sibling source、`SANDBOX_SOURCE_DIR` 或 `go run ./cmd/manager`。
- raw JuiceFS/MinIO/storage credential 不应作为 ASBCP 必需 env 继续传入；ASBCP 应从 AFSCP workload binding/mount plan 获得文件挂载信息。

## 9. 迁移 / 删除 / 保留边界

| 类别 | 内容 |
| --- | --- |
| 迁到 ASBCP repo | `asbcp-config.yaml` schema/defaults、canonical config path `/etc/asbcp/asbcp-config.yaml`、ASBCP container env contract、health/ready/provider API smoke、ASBCP 所需 RBAC capabilities、API/OpenAPI/schema、错误码、首轮 required/minimal release/readiness evidence 与必要诊断、release workflow、GHCR publish、Dockerfile contract tests；later/optional 按第 7 节，不作为本轮阻塞 |
| AgentSmith 删除 | `../mbos-sandbox-v1` source build、`SANDBOX_SOURCE_DIR`、`--sandbox-source-dir`、`cmd/manager`、`./cmd/manager`、`go run ./cmd/manager`、旧 Go command package path `cmd/manager`（迁为 `cmd/asbcp`，不得继续 `go build -o asbcp ./cmd/manager`）、`SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` 及常见 camel/Pascal/snake/kebab 变体、`SANDBOX_CONTROL_PLANE` / `SANDBOX_CONTROL_PLANE_...` 及常见 camel/Pascal/snake 代码符号变体、`SANDBOX_SERVICE_KEY`、`agentsmith-sandbox-manager` K8s identity、`mbos/sandbox-manager` local-kind repo、`/etc/sandbox-manager/manager-config.yaml`、ASBCP raw storage credential env、`NEXT_PUBLIC_ASBCP_*` 或任何 web/Next/browser ASBCP 配置 |
| AgentSmith 保留 | `ASBCP_IMAGE` digest lock consumption、server/internal-only `ASBCP_INTERNAL_BASE_URL` + `ASBCP_SERVICE_KEY` API client wiring、Deployment/Service wiring、无 public ingress 检查、AFSCP caller/token wiring、Agent task 主链 consumer smoke |

## 10. 当前漂移矩阵

本矩阵同样是计划创建时（2026-05-18）的基线快照。执行前先跑当前静态 guard、focused tests 或读取最新 evidence；已经被后续提交收敛的行不应重复返工。

| 当前漂移 | 目标状态 | Owner | Gate |
| --- | --- | --- | --- |
| `../mbos-sandbox-v1/manager-service` source build | AgentSmith pull ASBCP GHCR digest image | AgentSmith image dependency worker | local-kind image producer unit + static guard |
| `SANDBOX_SOURCE_DIR` / `--sandbox-source-dir` | 删除 | AgentSmith image dependency worker | static guard |
| `go run ./cmd/manager` in real/full diagnostics | 发布 image container 或外部 `ASBCP_INTERNAL_BASE_URL` | AgentSmith runtime worker | backend-real/full diagnostics focused tests |
| `SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` / `SANDBOX_SERVICE_KEY` 及常见旧名变体 | `ASBCP_*` | AgentSmith runtime worker | API deps/env preflight tests |
| `agentsmith-sandbox-manager` K8s identity | `agentsmith-sandbox-control-plane` | AgentSmith runtime worker | render/address/RBAC tests |
| AFSCP caller/actor 旧值 | `agentsmith-sandbox-control-plane` | AgentSmith runtime worker + cross-repo contract reviewer | render + AFSCP caller smoke |
| `site.env.example` mutable sandbox tag | `ASBCP_IMAGE` digest 示例或明确占位 | AgentSmith image dependency worker | render tests |
| raw JuiceFS/storage env 传给 ASBCP | 删除；只消费 AFSCP plan | AgentSmith runtime worker + ASBCP contract worker | render tests + ASBCP contract guard |
| `sandbox-manager`/`sandbox-runner` 双镜像 | 本轮只发布 ASBCP 服务镜像；`images/runner` 只作为非 active fixture，若发布另起计划 | ASBCP governance worker | release workflow tests + `asbcp-final-manifest.json` |
| old smoke `/v1/sandboxes` | 当前 `/v1/workspaces/.../workloads` | ASBCP smoke worker | API smoke |
| mutable ASBCP image tag | digest lock | AgentSmith image dependency worker | lock parser test |
| AgentSmith 内 ASBCP provider governance | 迁入 ASBCP repo | Docs/governance worker | doc guard + ownership review |
| `NEXT_PUBLIC_ASBCP_*` 或 web/Next/browser ASBCP 暴露 | 禁止；ASBCP URL/key 只限 server/internal API 与 internal diagnostics | AgentSmith runtime worker + frontend guard reviewer | env preflight + bundle/static guard |
| Go module root 迁移歧义 | 保留 `manager-service` 为 Go module root，只改 module path/import | ASBCP naming worker | module layout guard + `cd manager-service && go test` |
| ASBCP config path 漂移 | `/etc/asbcp/asbcp-config.yaml` | ASBCP runtime worker + AgentSmith render worker | Docker/K8s contract tests |

## 11. 实施阶段

### P0. 冻结 ASBCP 命名、缩写与 active contract

目标：先确认“改名不扩范围”。

工作：

- 在 ASBCP README 顶部写明：`AgentSmith Sandbox Control Plane (ASBCP)` 是 internal sandbox workload lifecycle backend service，不是 AgentSmith 产品控制面，也不是 AFSCP 子模块。
- 在 AgentSmith consumer/docs 顶部写明：ASBCP 不是用户访问入口、system 管理侧或产品治理入口；AgentSmith UI/i18n/product-facing user docs/用户侧失败路径不直接暴露 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload，产品侧统一说“任务执行环境/托管运行环境”。
- 写入命名矩阵：repo/module/image/binary/env/K8s/AFSCP caller 都采用 ASBCP canonical identifiers。
- 梳理 active API：health/ready、workspace binding、workload create/keepalive/exec/release/delete。
- 梳理 active request fields：`workspace_binding_id`、`image`、`command`、`env`、`resources`、`timeouts` 等；ASBCP 不拥有 managed runner image 选择权，AgentSmith 本轮也不新增用户可见 repo/runner image selector。
- 梳理 active env：service key、K8s namespace、AFSCP base URL、AFSCP caller/actor identity。
- 明确 `images/runner` 状态：本轮只作为非 active fixture；从 release workflow、GHCR release、release notes、product-facing user docs 中排除。runner 若要发布，另起计划。
- 对旧文档/旧脚本中的非 active surface 不只做标记；必须证明它们不能从 Make/npm/GitHub Actions/release/local-real/backend-real wrapper 间接调用。

验收：

- P0 输出 identifier matrix。
- active contract guard 覆盖旧名、旧 API、旧 storage credential 模型。
- `ASBCP` 和 `AFSCP` 的职责边界在 README 和 contracts 中清晰分开。
- consumer docs / product-facing user guides / i18n guard 证明 ASBCP、control plane、workload lifecycle、sandbox/sandbox workload 不作为用户可见产品概念出现；只允许 ASBCP repo docs 与开发者/运维/部署文档出现，且这些允许路径必须先说明 ASBCP 是内部后端服务。
- non-active 旧文档/旧脚本有不可达证据：不会被 Make/npm/GitHub Actions/release/local-real/backend-real wrapper 间接调用。

### P1. ASBCP repo 公开项目化与 clean rename

目标：把 `../mbos-sandbox-v1` 整理成可公开维护的 ASBCP repo。

工作：

- 创建 GitHub public repo `agentsmith-project/agentsmith-sandbox-control-plane`。
- 本地 repo 默认 remote `origin` 指向 GitHub；旧 Gitee remote 如需保留只能命名为 `gitee`，且 release/handoff 前 `origin` 必须指向 canonical GitHub，release path 不得依赖旧 remote。
- 添加 Apache-2.0 `LICENSE`、`NOTICE`、`CONTRIBUTING.md`、`SECURITY.md`、`CHANGELOG.md`。
- 添加 `.github/pull_request_template.md`。
- 更新 README、docs、`manager-service/go.mod` module path、imports、Dockerfile ldflags、build scripts、Kustomize image 名。
- 保留 `manager-service` 作为 Go module root；不把 `go.mod` 移到 repo root，不新增第二个 root module。repo root 承担公开治理、release gate、release evidence、version truth 和 workflow wrapper。
- binary/command 固定为 `asbcp`，Go command package path 迁为 `cmd/asbcp`，避免继续 `go build -o asbcp ./cmd/manager`。
- 使用 root `VERSION` 作为单一版本真相，内容可以是不带 `v` 的 `X.Y.Z`；旧 `manager-service/VERSION` 应删除或由 root version 生成。
- Kustomize `app.kubernetes.io/version`、Docker ldflags、GitHub Release tag 都从同一版本真相派生。
- 清理硬编码区域镜像/代理默认值；如需国内镜像，只作为可选 build arg，不作为公开 release 默认行为。

验收：

- `cd manager-service && go test ./...` 能在新 module path 下通过。
- repo root 不存在 `go.mod`；module layout guard 证明 Go module root 是 `manager-service`，release scripts/workflows 在需要 Go 命令时显式 `cd manager-service`。
- canonical active forbidden list 不命中 active 内容和路径名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。
- remote guard 证明 release/handoff 前 `origin` 指向 `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane` 或等价 canonical GitHub remote；release workflow、tag push 和 handoff 文档不依赖 `gitee` remote。
- README 第一屏能解释 ASBCP 边界、快速验证、发布镜像和 AgentSmith 消费方式。

### P2. ASBCP 独立治理、CI 与发布 workflow

目标：ASBCP repo 自己证明“可以发布”。

工作：

- 按第 7 节分层建立 ASBCP-lite 治理文档：首轮只交付 required/minimal；later/optional 不作为本轮 release 阻塞项。
- 建立唯一权威 release gate：`scripts/verify-release.sh`。
- `make verify`、`make image-build`、`make image-smoke` 等 wrapper 可以存在，但唯一权威入口仍是 `scripts/verify-release.sh`，wrapper 名不作为合同。
- ASBCP release gate 只证明 ASBCP repo 自身 release readiness；AgentSmith consumer adoption 验证/diagnostics 只证明 AgentSmith 消费该 image，不反向纳入 ASBCP release gate。
- 修正 GitHub Actions：
  - `.github/workflows/ci.yml`：PR/main 默认调 lighter `make verify` + `make image-build` + old-name guard、module layout/version guard、active API contract guard、runner non-active guard、raw storage env 禁用 guard，不默认调用 `scripts/verify-release.sh`。
  - `.github/workflows/release.yml`：tag `v*` 触发，必须先调 `scripts/verify-release.sh`，然后发布 GHCR image 与 GitHub Release。
- release workflow 最小要求：
  - permissions 包含 `contents: write`、`packages: write`。
  - 使用 `docker/login-action` 登录 GHCR。
  - 使用 `docker/metadata-action` 生成 tag/label。
  - 使用 `docker/build-push-action` build/push ASBCP service image。
  - 从 build output 提取 digest。
  - 用 fresh Docker config 验证匿名 public pull：创建临时 `DOCKER_CONFIG`，不登录 GHCR，执行 `docker manifest inspect ghcr.io/...:vX.Y.Z@sha256:<digest>` 或 `docker pull ghcr.io/...:vX.Y.Z@sha256:<digest>`。
  - 首发 public 采用最小预置/两阶段流程：tag release 前按 runbook 预确认 package public；如果首次 push 后 package 仍为 private，则暂停 release，不生成 `asbcp-final-manifest.json`，人工设为 public 后只重跑同一 `image:tag@digest` 匿名 inspect/pull 与后续步骤。
  - 对 push 后 exact `image:tag@digest` 做最小 health/ready/API smoke；如果不重复 smoke，必须证明 `scripts/verify-release.sh` 产物就是被 push 的同一 digest。
  - 匿名 pull/inspect 与 post-push smoke/同 digest 证明成功后生成 `asbcp-final-manifest.json`。
  - Release body/notes 只记录变更摘要并引用 `asbcp-final-manifest.json`；digest/runtime evidence 和 known breaking changes 以 `asbcp-final-manifest.json` 为准；workflow artifact 只能作为可选副本。
  - 禁止用 GitHub Packages visibility API、PAT、已登录 Docker config 或仓库权限检查兜底替代匿名 `image:tag@digest` inspect/pull。
- 添加 workflow hardening test，证明 release workflow 调用了唯一权威 release gate，并证明 push 前调用 `scripts/verify-release.sh`、push 后 fresh Docker config 匿名 pull/inspect、push 后 exact digest smoke/同 digest 证明、随后生成 `asbcp-final-manifest.json` 的顺序关系。
- 统一 Go 版本，CI 与 `go.mod` 保持一致。
- 删除或重写漂移的 CI target，例如不存在的 `make build`、`docker-compose-up`、旧 `wait-for-minio.sh`。
- active API smoke 应先通过 fixture/fake AFSCP 准备 `workspace_binding_id`，再覆盖 create/keepalive/exec/release/delete；不能只测 health/ready。
- release gate 必须阻塞式覆盖 image build、image smoke、K8s render、readiness、AFSCP mount-plan fixture、workspace binding 和 workload lifecycle；不能把这些 evidence 留给后续人工检查。

验收：

- PR/main lighter required guards 绿。
- tag dry-run 或首个正式 tag 能产出 image digest。
- `asbcp-final-manifest.json` 包含 version、tag、commit SHA、image digest、API contract version、known breaking changes；release notes 只记录摘要并引用该 manifest。
- ASBCP release gate 不依赖 AgentSmith local-kind/backend-real 或任何 consumer adoption 验证/diagnostics。

### P3. ASBCP image 发布

目标：形成 AgentSmith 可以消费的稳定发布物。

工作：

- P3 不新增第二套 release gate；只执行 P2 定义的 tag release workflow。
- 使用 root `VERSION` 作为 release truth，内容可以是不带 `v` 的 `X.Y.Z`；Git tag、image tag、GitHub Release tag 和 AgentSmith lock 的 `asbcp_version` 必须是 `v$(cat VERSION)`，digest、`asbcp-final-manifest.json` 和 release body 必须对应同一个 commit。
- GHCR 发布 image：`ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z`。
- GitHub Release 引用 `asbcp-final-manifest.json` 中的 digest：`ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- `asbcp-final-manifest.json` 写入 commit SHA、API contract version、image digest 和 known breaking changes；AgentSmith lock 不记录 API contract version。
- GHCR 首发 public 按 runbook 做最小预确认；如首次 push 后 package 为 private，暂停 release 且不生成 `asbcp-final-manifest.json`，人工设为 public 后只重跑同一 `image:tag@digest` 匿名 inspect/pull 与后续步骤，匿名 pull/inspect 仍是最终证据。
- 使用 fresh Docker config 匿名验证 GHCR `image:tag@digest` 可 inspect/pull，并对 exact digest 做最小 health/ready/API smoke 或同 digest 证明；禁止 Packages visibility API/PAT 兜底。
- 不发布 `latest` 作为 AgentSmith 消费入口；如保留 convenience tag，AgentSmith 也不得引用。
- `images/runner` 本轮固定为非 active fixture，不发布第二个 GHCR image，不写入 release notes，不进入 product-facing user docs。

验收：

- 任意干净环境可以 `docker pull ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- push 后 exact `image:tag@digest` 启动后 `/healthz`、`/readyz`、active API smoke 可通过，或 `asbcp-final-manifest.json` 证明 release gate 验证的是被 push 的同一 digest。
- GitHub Release asset `asbcp-final-manifest.json` 能证明匿名 public pull、digest、tag、commit、API contract version 和 post-push smoke/同 digest 证明一致。

### P4. AgentSmith 切换为 ASBCP image-only 消费

目标：AgentSmith 不再需要 sandbox sibling repo，也不再承载 ASBCP provider governance。

工作：

- 新增 `infra/deploy/shared/asbcp-image.lock`，pin P3 发布的 GHCR digest。
- 修改 unified deploy image producer：ASBCP image 不再 `docker build` sibling source，而是读取 lock 后 pull/tag/push。
- local-kind target repo 改为 `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@sha256:<digest>`。
- 删除或废弃 `SANDBOX_SOURCE_DIR`、`--sandbox-source-dir`、`siblingSandboxSourceDir()` 等标准路径。
- 更新 `infra/deploy/unified/env/site.env.example`：使用 `ASBCP_IMAGE` digest 示例或明确占位。
- 替换 AgentSmith env 并拆清边界：`ASBCP_IMAGE` 只用于 deploy image 输入与 backend-real/local-real internal container launcher；`ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只用于 server/internal API 调用。
- 强制 rendered Deployment 中的 active `ASBCP_IMAGE` 为 `@sha256` digest ref；local-kind 可使用 mirrored target digest，existing-cluster 可使用 source digest 或目标 registry digest，tag-only 只能作为非 active 示例。
- 加 guard：禁止 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、frontend bundle、browser/client code、UI route payload、MSW public fixtures、i18n 文案、product-facing user guides 或用户侧失败路径暴露 ASBCP URL/key，或把 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload 作为用户可见产品概念。
- 替换 Node API deps/client wiring 中的旧 env key，不保留兼容 alias。
- K8s 资源 clean cut：Deployment、Service、ServiceAccount、Role、RoleBinding、ConfigMap、container name、component label、selector、checksum annotation、mount path、local-kind PV RBAC 全部迁到 `agentsmith-sandbox-control-plane` / `asbcp`。
- AFSCP allowed caller、service token map、ASBCP pod env、AgentSmith bootstrap tests 全部使用 `agentsmith-sandbox-control-plane`。
- 更新 `scripts/run-internal-agent-task-real-gate.sh`、`scripts/run-integration-release-user-story.sh`、`scripts/backend-real-full-gate.sh`、`scripts/lib/internal-sandbox-real-control.sh`、`scripts/local-manual/internal-common.sh` 与 `make local-real-up/status/reset/down`：标准路径使用发布 image container 或外部 `ASBCP_INTERNAL_BASE_URL`；external base URL 只证明 API wiring/smoke，不替代 digest/render/rollout image adoption 证据。
- 删除 AgentSmith 传给 ASBCP 的 raw storage env；保留 AgentSmith 自身 substrate MinIO/AFSCP 配置，但不能作为 ASBCP 运行合同。
- 将 ASBCP canonical schema/contract、provider config/env/RBAC/schema/release/runbook 治理迁到 ASBCP repo；AgentSmith render/check 仍验证自身部署模板中的 image、internal Service URL、`ASBCP_SERVICE_KEY` -> `ASBCP_SERVICE_KEYS` 映射、AFSCP caller/token、dedicated ServiceAccount identity、RoleBinding 指向、无 legacy/public RBAC 残留、无 public ingress 等 consumer wiring，不维护或校验 ASBCP provider RBAC capability schema。
- 加 cleanup/prune 计划：pre-GA 环境中删除旧 `agentsmith-sandbox-manager` Deployment/Service/ConfigMap/RBAC/local-kind PV RBAC/checksum annotation 相关残留，避免双资源残留。

验收：

- 在没有 `../mbos-sandbox-v1` 的环境中，AgentSmith image producer、backend-real/full diagnostics 计划路径、`make local-real-up/status/reset/down` 和 render tests 仍能通过，且不会访问 sibling source。
- `npm run test:unified-deploy:local-kind:images:unit` 覆盖 ASBCP digest lock 与禁止 source build。
- `npm run test:unified-deploy:render`、`npm run test:unified-deploy:address-truth` 通过，并证明 rendered Deployment 只接受 digest ref。
- 新增或更新 focused tests 覆盖：
  - `run-integration-release-user-story`
  - `run-internal-agent-task-real-gate`
  - `backend-real-full-gate`
  - `internal-sandbox-real-control`
  - `local-manual/internal-common`
  - API deps/env preflight
  - AFSCP caller/token 一致性
  - canonical active forbidden list 静态 guard

### P5. Consumer adoption 验证

目标：证明 AgentSmith 能消费 ASBCP 发布物。该阶段不是 ASBCP 未来 release gate，也不新增 AgentSmith 独立 gate 名称。

工作：

- ASBCP repo 先完成 `scripts/verify-release.sh`，发布 GHCR image。
- P5 是 AgentSmith consumer adoption 验证/diagnostics，不是 ASBCP release gate；每个 AgentSmith slice 只跑受影响 focused diagnostics，最终收口回到现有 `npm run verify -- --goal=... --run` 或 `npm run release:ready`。
- AgentSmith 更新 `asbcp-image.lock` 后，每个 slice 默认只运行轻量 lock/render focused diagnostics：
  - `npm run test:unified-deploy:local-kind:images:unit`
  - `npm run test:unified-deploy:render`，但必须使用 generated site env 或等价 digest fixture
  - `npm run test:unified-deploy:address-truth`
- standalone local-kind rollout diagnostics 仅用于阶段 rehearsal 或失败排障，不作为发布前每次必跑项：
  - `npm run test:unified-deploy:local-kind:images`
  - `npm run test:unified-deploy:local-kind`
- 如改动影响 Agent task runner/terminal runtime，再补：
  - 运行覆盖 `test:agent-task:runner:fast` 与 `test:skills:fast` alias 的一个物理 producer，并在 evidence 中注明覆盖 alias；除非需要分别验证 npm alias wiring，不要求重复物理执行。
  - 必要时 `npm run test:skills:backend-real`
- P5 focused diagnostics 或 release:ready campaign-scoped evidence 必须覆盖 `scripts/run-integration-release-user-story.sh` 和 `scripts/backend-real-full-gate.sh` 所在路径，证明它们不再访问 sibling source。
- 发布签署只看现有 `npm run release:ready` campaign-scoped evidence；不要在每个小 slice 重复跑 standalone heavy diagnostics。

验收：

- AgentSmith release rehearsal 不会访问 `../mbos-sandbox-v1`。
- ASBCP source digest -> target digest 的映射有证据；generated site env、部署 manifest、运行中 Pod image 对同一个 target digest 一致。
- ASBCP lock 中 `asbcp_version`、image tag、GitHub Release tag 和 release URL tag 都是同一个 `vX.Y.Z`；真实 version/tag/digest/commit provenance 以 ASBCP GitHub Release asset `asbcp-final-manifest.json` 为准。
- Agent task 创建、workspace binding、workload create/keepalive/exec/release/delete 主链通过。
- ASBCP release gate 与 AgentSmith consumer adoption 验证/diagnostics 分离清楚；最终收口回到现有 `verify` / `release:ready`。

### P6. 文档与 handoff

目标：避免未来开发回到历史心智。

工作：

- AgentSmith 唯一 consumer doc 入口固定为 `docs/contracts/unified-deploy-contract.md` 的 ASBCP deployment/internal backend dependency 小节；本文件只保留历史迁移计划与边界说明。
- 该入口只说明：ASBCP 是外部发布 image 依赖；如何更新 `asbcp-image.lock`；需要跑哪些 consumer adoption 验证/diagnostics，最终如何回到现有 `verify` / `release:ready`。
- AgentSmith product-facing user docs、UI 文案和 i18n 不直接出现 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload；只有 ASBCP repo docs 与 developer/operator/deployment docs 可以使用 ASBCP canonical names，且必须先说明它是内部后端服务。
- ASBCP repo 文档落地后，本文件降级为历史迁移计划与 AgentSmith consumer-side 边界说明；ASBCP release/config 长期权威只看 ASBCP repo。
- ASBCP README 说明：如何运行 `scripts/verify-release.sh`、如何发布、AgentSmith 如何消费。
- 删除或归档旧 `mbos-sandbox-v1`、`SANDBOX_SOURCE_DIR`、本地 source build、`SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` 文档；如果保留为历史材料，必须是 exact path + reason allowlist，并证明不能被 Make/npm/GitHub Actions/release/local-real/backend-real wrapper 间接调用。
- AgentSmith 内 ASBCP 研发治理内容迁出或降级为消费者说明；首轮 required/minimal release/readiness evidence 与必要诊断迁到 ASBCP repo，later/optional 按第 7 节，不作为本轮阻塞。
- 在两个 repo 都补一段“不要做什么”：
  - 不要在 AgentSmith release lane 构建 ASBCP source。
  - 不要让 ASBCP 承担 AgentSmith 产品治理。
  - 不要把 AFSCP 业务内容或存储对象复制到 ASBCP。
  - 不要用 mutable tag 做发布依赖。
  - 不要把 raw storage credential 作为 ASBCP 运行合同。

验收：

- 新人只读 ASBCP README 和 release 文档即可完成 ASBCP image 发布。
- 新人只读 `docs/contracts/unified-deploy-contract.md` 的 ASBCP consumer 入口即可完成 image lock 更新和集成验证。
- 文档里没有 active 指引要求开发者回到 `mbos-sandbox-v1` sibling source build 或 `SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` 配置。

## 12. TDD 与验证策略

先写或调整测试，再改实现：

- ASBCP repo：
  - module layout + module path/import path guard：`manager-service/go.mod` 是唯一 Go module root，module path 为 `github.com/agentsmith-project/agentsmith-sandbox-control-plane`。
  - old name guard：canonical active forbidden list 不得出现在 active 内容和路径名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。
  - active API contract guard。
  - release workflow hardening test。
  - image health/ready smoke。
  - workspace binding + workload create/keepalive/exec/release/delete API smoke。
  - AFSCP mount-plan fixture smoke。
  - K8s render test。
  - Dockerfile contract test：OCI labels、version/revision/created、非 root、root `VERSION` 可以不带 `v`、image/Git tag 带 `v`、canonical config path `/etc/asbcp/asbcp-config.yaml`。
  - release evidence guard：GitHub Release asset `asbcp-final-manifest.json` 中 schema id、version、tag、digest、commit、匿名 GHCR `image:tag@digest` inspect/pull、post-push smoke/同 digest 证明、API contract version 全部存在且一致；workflow artifact 只能作为可选副本。
  - runner fixture guard：`images/runner` 不进入 release workflow、GHCR publish、release notes 或 product-facing user docs。
- AgentSmith：
  - ASBCP image lock parser test，离线静态校验字段存在、`vX.Y.Z` 一致、canonical repo、digest、release URL tag、commit SHA 格式、no-v negative fixture；不记录 API contract version，不调用 GitHub API/PAT 证明 provenance。
  - local-kind image producer test，断言 ASBCP 走 pull/tag/push，不走 docker build source。
  - render test，断言 `ASBCP_IMAGE` 从 generated site env 进入 manifest 且为 `@sha256` digest ref。
  - address truth test，断言 ASBCP 不暴露 public ingress。
  - API deps/unit：server-side `ASBCP_INTERNAL_BASE_URL` + `ASBCP_SERVICE_KEY` 成对校验；旧 key 不再生效或触发明确失败。
  - frontend/static guard：禁止 `NEXT_PUBLIC_ASBCP_*`，禁止 ASBCP URL/key 进入 web/Next/browser runtime、client bundle、UI route payload、MSW public fixture、i18n 文案、product-facing user guides 或用户侧失败路径；operator/deployment guides 属于允许路径，但必须先说明 ASBCP 是内部后端服务。
  - backend-real/full diagnostics script tests，断言不再依赖 sibling source，且 `make local-real-up/status/reset/down` 走同一 image-only 路径。
  - AFSCP caller/token consistency test。
  - static guard，禁止 canonical active forbidden list、active source build、旧 env、旧 K8s identity、旧 image repo 回退路径、`/etc/asbcp/config.yaml` 或 `/etc/sandbox-manager/manager-config.yaml` config path 漂移。
  - focused local-kind rollout，证明 source digest -> target digest 映射存在，且 Pod 实际使用 target digest。

门禁原则：

- 每个 slice 只跑最小相关 focused diagnostics。
- ASBCP release gate 与 AgentSmith consumer adoption 验证/diagnostics 分离。
- 跨 repo 集成完成后按阶段 rehearsal 或失败排障需要再跑 standalone local-kind rollout；发布签署只看现有 `release:ready` campaign-scoped evidence。
- 最终发布前才跑 AgentSmith `npm run release:ready`。

## 13. 风险与处理

ASBCP/AFSCP 缩写混淆：

- 风险：ASBCP 和 AFSCP 太接近，后续文档可能把职责混在一起。
- 处理：首次出现必须展开全称；ASBCP 管 workload lifecycle，AFSCP 管 filesystem/storage truth；禁止把 ASBCP 写成 AFSCP 子模块或 AgentSmith 产品控制面。

机械全局替换：

- 风险：字符串替换破坏 API 语义、测试 fixture 或历史迁移说明。
- 处理：按 identifier matrix 分层迁移；active 内容和路径名必须通过 canonical active forbidden list guard；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。

AFSCP caller/token 不一致：

- 风险：allowed caller、service token map、ASBCP pod env、AgentSmith bootstrap tests 不同名会导致 mount plan 调用 403。
- 处理：P4 同一 slice 修改并测试 AFSCP caller/token identity。

K8s 资源残留：

- 风险：`kubectl apply` 不会自动删除旧 `agentsmith-sandbox-manager` 资源，形成双 Deployment/Service/RBAC。
- 处理：pre-GA 环境使用 clean-cluster 或显式 prune；计划中列出旧资源清理。

发布镜像不可拉取：

- 风险：GHCR package 默认 private、digest 记录错误，或验证复用了已登录凭据导致 public 可访问性没有被证明。
- 处理：GHCR 首发 public 采用最小预置/两阶段流程：tag release 前按 runbook 预确认 package public；如首次 push 后 package 仍为 private，则暂停 release，不生成 `asbcp-final-manifest.json`，人工设为 public 后只重跑同一 `image:tag@digest` 匿名 inspect/pull 与后续步骤。release workflow 必须用 fresh Docker config 匿名验证 `image:tag@digest` 可 inspect/pull，禁止 Packages visibility API/PAT 兜底；AgentSmith lock 必须包含 digest。

API contract 漂移：

- 风险：ASBCP release 后 AgentSmith client 调用失败。
- 处理：ASBCP `asbcp-final-manifest.json` 写 API contract version，release notes 只引用该 manifest；AgentSmith lock 不记录 API contract version，consumer adoption 验证必须覆盖 workspace binding 与 workload 主链。

raw storage env 回流：

- 风险：ASBCP 继续背负 JuiceFS/MinIO/storage credential，和 AFSCP plan consumer 模型冲突。
- 处理：P4 删除 AgentSmith 侧 raw storage env 传递，ASBCP contract guard 禁止 raw storage credential 成为运行合同。

过度治理：

- 风险：为了学习 AFSCP，复制太多存储控制面业务文档和复杂 selector。
- 处理：采用 ASBCP-lite，只借鉴唯一 release gate、`asbcp-final-manifest.json`、contract/docs guard、PR 模板、security/runbook、workflow hardening。

ASBCP 暴露到浏览器或 product-facing user docs：

- 风险：`ASBCP_SERVICE_KEY` / `ASBCP_INTERNAL_BASE_URL` 被做成 `NEXT_PUBLIC_ASBCP_*`、进入 web/Next/browser runtime、MSW public fixture、UI 文案、product-facing user guides 或用户侧失败路径，造成内部拓扑/密钥泄露，并把工程后端服务误写成用户访问入口。
- 处理：`ASBCP_IMAGE` 只走部署 image 输入和 backend-real/local-real internal container launcher，`ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 只走 server/internal API；增加 env/static/bundle/i18n/product-facing-user-guides/failure-path guard。用户侧只看到 Agent task 状态和可操作错误，产品侧统一说“任务执行环境/托管运行环境”，不看到 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload/internal URL/key。

Go module root 返工：

- 风险：一边迁到 repo root，一边保留 `manager-service` module，会产生双 module、CI 路径漂移和 import/ldflags 反复修改。
- 处理：本轮选择最小返工路径：保留 `manager-service` 为唯一 Go module root，repo root 只放治理、release wrapper、VERSION、evidence 和 workflows。未来若需要 root module，另起计划。

runner 发布范围蔓延：

- 风险：`images/runner` 被顺手纳入 ASBCP release/GHCR，导致 release gate、product-facing user docs 和 AgentSmith 消费合同扩大。
- 处理：本轮 runner 固定为非 active fixture；release workflow、release notes、GHCR publish、readiness evidence 和 product-facing user docs 都不得发布 runner。runner 发布另起计划。

config path 漂移：

- 风险：`/etc/asbcp/config.yaml`、旧 `/etc/sandbox-manager/manager-config.yaml` 和 `/etc/asbcp/asbcp-config.yaml` 混用，导致 Docker/K8s/runbook/test 互相打架。
- 处理：canonical path 固定为 `/etc/asbcp/asbcp-config.yaml`；ASBCP Docker/K8s/contract tests 与 AgentSmith render guard 同时校验。

release digest 不可追溯：

- 风险：只有 mutable tag 或缺少 public pull 证据，AgentSmith lock 无法证明消费的是同一个可追溯发布物。
- 处理：ASBCP release 必须输出 version/tag/digest/commit/API contract version，用 fresh Docker config 真实验证匿名 GHCR `image:tag@digest` inspect/pull，并对 push 后 exact digest 做最小 health/ready/API smoke 或同 digest 证明；`asbcp-final-manifest.json` 固定为 GitHub Release asset。AgentSmith lock 只记录并离线静态校验 version/tag/digest/release URL tag/commit SHA 格式，真实 provenance 以该 manifest 为准。

## 14. 开发任务拆分

建议按以下顺序分配给 team：

1. ASBCP naming worker：负责 repo identity、`manager-service` module path/import/binary/docs/license/changelog 的 clean rename；不得把 Go module 迁到 repo root。
2. ASBCP governance worker：负责 ASBCP-lite 文档、release gate、CI、release workflow、GHCR service image 发布、`asbcp-final-manifest.json`/public pull evidence 和 `images/runner` 非 active fixture 归类。
3. ASBCP contract/smoke worker：负责 active API contract、image smoke、K8s render、AFSCP mount-plan fixture 与旧 smoke 清理。
4. AgentSmith image dependency worker：负责 `asbcp-image.lock`、`asbcp_version` 与 image/GitHub Release tag/release URL tag 同为 `vX.Y.Z` 的一致性校验、image producer、render/local-kind tests、static guard。
5. AgentSmith runtime integration worker：负责 `ASBCP_IMAGE` 部署输入/internal container launcher 与 `ASBCP_INTERNAL_BASE_URL`/`ASBCP_SERVICE_KEY` server/internal API 输入拆分、禁止 `NEXT_PUBLIC_ASBCP_*`、K8s/RBAC/AFSCP caller clean cut、backend-real/full diagnostics、local manual、raw storage env 移除、focused rollout，并拉 cross-repo contract reviewer 校验 AFSCP caller/token 一致性。
6. Docs/governance migration worker：负责把 ASBCP provider governance 从 AgentSmith 迁到 ASBCP repo，AgentSmith 只保留 `docs/contracts/unified-deploy-contract.md` 这个 developer/operator/deployment consumer 入口；UI/product-facing user docs/i18n 不直接暴露 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload。
7. Review worker：只读审查跨 repo 命名矩阵、ASBCP/AFSCP 边界、旧名 guard、是否还有 source build 回退路径。

每个 worker 必须先补测试或守卫，再改实现；不得用 fallback 把 sibling source build 或旧 env 留在 release path。

## 15. 完成定义

ASBCP 独立发布完成时必须满足：

- `agentsmith-sandbox-control-plane` GitHub repo public 可访问。
- repo 使用 Apache-2.0 license，并有公开项目治理骨架。
- ASBCP repo PR/main lighter required guards 绿。
- `scripts/verify-release.sh` 是唯一权威 release gate。
- ASBCP repo tag release 能发布 GHCR service image，并在 `asbcp-final-manifest.json` 记录 version、tag、digest、commit SHA、API contract version；CHANGELOG/release notes 只记录变更摘要并引用 manifest。
- release workflow 用 fresh Docker config 真实验证匿名 GHCR `image:tag@digest` inspect/pull，对 push 后 exact digest 做最小 health/ready/API smoke 或同 digest 证明，生成并附加 GitHub Release asset `asbcp-final-manifest.json`；workflow artifact 只能作为可选副本，禁止 Packages visibility API/PAT 兜底。
- ASBCP release gate 不依赖 AgentSmith 或任何 consumer adoption 验证/diagnostics。
- ASBCP repo 已成为 ASBCP release/governance/docs 的长期权威来源。
- ASBCP repo old-name/static guard 覆盖 canonical active forbidden list；active code/config/docs/tests 和路径名不再使用旧命名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。
- ASBCP Go module root 是 `manager-service`，repo root 无 `go.mod`；release scripts/workflows 对 Go 命令显式进入 `manager-service`。
- canonical config path 是 `/etc/asbcp/asbcp-config.yaml`。
- `images/runner` 未进入本轮 release/GHCR/release notes/product-facing user docs。

AgentSmith consumer 迁移完成时必须满足：

- AgentSmith 不再从 `../mbos-sandbox-v1` 构建或启动 ASBCP。
- AgentSmith 通过 `asbcp-image.lock` 消费 GHCR digest image，并只做离线静态校验：`asbcp_version`、image tag、GitHub Release tag、release URL tag 同为 `vX.Y.Z`，canonical repo、digest、commit SHA 格式一致；API contract version 不进入 lock，真实 provenance 以 ASBCP GitHub Release asset `asbcp-final-manifest.json` 为准。
- AgentSmith 使用 `ASBCP_IMAGE` 作为部署 image 输入和 backend-real/local-real internal container launcher，使用 `ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 作为 server/internal API 输入，不再使用 `SANDBOX_MANAGER` / `SANDBOX_MANAGER_...` 或其常见变体 / `SANDBOX_SERVICE_KEY`。
- `ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 不出现在 `NEXT_PUBLIC_*`、web/Next/browser runtime、client bundle、UI route payload、MSW public fixture、i18n 或 product-facing user docs。
- K8s runtime identity、AFSCP caller/actor、image repo、tests、docs 均迁到 ASBCP canonical names。
- AgentSmith local-kind rehearsal、backend-real/full diagnostics 与 release:ready campaign 能在无 sibling sandbox repo 的环境中完成。
- AgentSmith old-name/static guard 覆盖 canonical active forbidden list；active code/config/docs/tests 和路径名不再使用旧 sandbox-manager / mbos-sandbox-v1 命名；任何旧名放行必须是 exact path + reason，禁止目录级或 glob 级 allowlist。
- raw storage credential 不再作为 ASBCP 运行合同。
- AgentSmith 无 ASBCP 源码构建和发布治理残留。

## 16. Team Review 记录

调研与 review 已覆盖：

- AgentSmith dependency review：计划创建时的历史基线风险包括 unified deploy、本地 real gate、integration user story 中的 sibling source build 和 `go run` 路径。
- ASBCP repo readiness review：计划创建时的历史基线风险包括 Go module、CI、release gate、smoke、license/changelog/governance docs 的公开发布前缺口。
- Naming/scope review：用户明确 `SANDBOX_MANAGER` 历史名不应保留后，计划改为 pre-GA clean cut 到 `ASBCP`。
- AFSCP governance reference review：只借鉴治理方法，不复制 AFSCP 业务内容；采用 ASBCP-lite。
- Delivery-mindset review：确认 ASBCP 是内部后端服务，不是用户访问入口、system 管理侧或 AgentSmith 产品治理入口；AgentSmith UI/product-facing user docs/i18n/用户侧失败路径不直接暴露 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload。
- Security exposure review：确认 `ASBCP_IMAGE` 是部署 image 输入和 backend-real/local-real internal container launcher，`ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只允许 server/internal API 和 internal diagnostics 使用，禁止 `NEXT_PUBLIC_ASBCP_*` 和 web/Next/browser runtime 暴露。
- Module layout review：为减少返工，本轮保留 `manager-service` 作为 Go module root，repo root 只放治理、release wrapper、VERSION 和 evidence。
- Release evidence review：release gate 必须阻塞式证明 image、K8s、readiness、active API smoke；release workflow push 后必须匿名 GHCR `image:tag@digest` inspect/pull，并对 push 后 exact digest 做最小 health/ready/API smoke 或同 digest 证明；GitHub Release body 等说明只能从 GitHub Release asset `asbcp-final-manifest.json` 派生或引用。

实现前最后检查重点：

- 是否还有 canonical active forbidden list 出现在 active 内容或路径名，且未被 exact path + reason allowlist 覆盖。
- 是否还有 mutable ASBCP image tag。
- 是否还有 raw storage credential 被当作 ASBCP 运行合同。
- 是否有文档把 ASBCP 写成用户访问入口、system 管理侧、AgentSmith 产品治理入口、AFSCP 子模块或存储控制面。
- 是否有 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、UI/i18n/product-facing user guides 或用户侧失败路径直接暴露 ASBCP URL/key，或 ASBCP/control plane/workload lifecycle/sandbox/sandbox workload 概念。
- 是否仍有人把 Go module 迁到 repo root，或新增了 root `go.mod`。
- 是否把 `images/runner` 带入本轮 ASBCP release/GHCR/release notes/product-facing user docs。
- 是否出现 `/etc/asbcp/config.yaml` 或旧 `/etc/sandbox-manager/manager-config.yaml` 漂移。
- 是否缺少 fresh Docker config 匿名 GHCR `image:tag@digest` inspect/pull、GitHub Release asset `asbcp-final-manifest.json`、push 后 exact digest smoke/同 digest 证明、version/tag/digest/commit 一致性证据。
