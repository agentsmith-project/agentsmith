# AgentSmith Sandbox Control Plane (ASBCP) 独立发布改造计划 v1

状态：已按用户补充与 team review 修订，可 handoff 给开发团队
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
- ASBCP 职责：只负责 Agent task sandbox workload lifecycle 这个后端工程服务链路，不承接 AgentSmith 产品治理、审计、AI 资源策略、system 管理侧、用户访问入口或 UI 范围

ASBCP 是工程后端服务和部署依赖，不是用户访问入口、system 管理侧或 AgentSmith 产品治理入口。AgentSmith UI、user guides、i18n 文案不应直接暴露 `ASBCP`、`control plane` 或 `workload lifecycle` 这类工程术语；必要时只描述用户动作，例如“Agent task 执行环境不可用 / 请联系管理员检查部署配置”。ASBCP 名称和缩写只在开发者文档、运维文档、release evidence、deployment contract、internal gate 和 server-side 配置中出现。

## 2. 需求评价与原则

用户要求“不要保留随意的 `SANDBOX_MANAGER` 历史名，兄弟项目命名、代码风格、配置风格要一致”是合理的，并且在 pre-GA 阶段符合最佳实践。

推荐做法不是机械全局替换，而是结构化 clean cut：

- 先定义唯一 identifier matrix。
- 再迁移 repo、image、Go module、binary、K8s resource、AFSCP caller/actor、AgentSmith env、tests、docs。
- 不保留旧 env alias，不做 `SANDBOX_MANAGER_*` 与 `ASBCP_*` 双轨兼容。
- 用静态 guard 阻止旧名回流。
- API 业务语义不因改名而扩大：ASBCP 仍只管 workload lifecycle。

ASBCP 可以借鉴 AFSCP 的治理方法论，但不能复制 AFSCP 的业务内容。AFSCP 是 filesystem/storage control plane；ASBCP 是 sandbox workload lifecycle service。两者缩写相近，更需要在文档和代码中保持职责清晰。

## 3. 命名矩阵

| 层级 | 目标名称 | 说明 |
| --- | --- | --- |
| 正式全称 | `AgentSmith Sandbox Control Plane` | 工程组件名 |
| 正式缩写 | `ASBCP` | 文档、治理、release、配置可使用 |
| GitHub repo | `agentsmith-project/agentsmith-sandbox-control-plane` | 公开项目 |
| Go module | `github.com/agentsmith-project/agentsmith-sandbox-control-plane` in `manager-service/go.mod` | 本轮不迁到 repo root；保留 `manager-service` 为 Go module root，清除旧 module path |
| Binary / command | `asbcp` | 固定短名，避免继续使用 `manager` |
| GHCR image | `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>` | AgentSmith 只消费 immutable digest |
| AgentSmith image lock | `infra/deploy/shared/asbcp-image.lock` | 取代 `sandbox-manager-image.lock` |
| Lock keys | `asbcp_version`、`asbcp_source_image`、`asbcp_release_url`、`asbcp_commit_sha` | `asbcp_version` 固定为带 `v` 的 `vX.Y.Z`；`asbcp_source_image` 内必须同时包含同一个 `vX.Y.Z` tag 与 immutable digest；不额外拆出重复字段 |
| AgentSmith deploy image env | `ASBCP_IMAGE` | 只允许 deploy render、local-kind image producer、K8s manifest wiring 使用，不是 ASBCP API 调用凭据 |
| AgentSmith server/internal API env | `ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` | 只允许 server-side API deps、local/backend-real internal gates 和 Kubernetes Secret/ConfigMap wiring 使用 |
| Web/Next/browser env | none | 禁止 `NEXT_PUBLIC_ASBCP_*`，禁止将 ASBCP URL/key 或 service key 打进 web/Next/browser runtime、client bundle、frontend route payload |
| K8s Deployment/Service/SA/RBAC | `agentsmith-sandbox-control-plane` | pre-GA clean cut，不保留旧 runtime identity |
| Container name / labels | `asbcp` / `app.kubernetes.io/component=asbcp` | 统一观测和 selector 心智 |
| AFSCP caller/actor | `agentsmith-sandbox-control-plane` | allowed caller、service token、actor id 必须同名一致 |
| ASBCP config path | `/etc/asbcp/asbcp-config.yaml` | canonical path；禁止漂移到 `/etc/asbcp/config.yaml` 或旧 manager path |
| ASBCP container env | `ASBCP_CONFIG_PATH`、`ASBCP_SERVICE_KEYS`、`ASBCP_WORKLOAD_NAMESPACE`、`ASBCP_AFSCP_INTERNAL_BASE_URL`、`ASBCP_AFSCP_ORCHESTRATOR_TOKEN`、`ASBCP_AFSCP_CALLER_SERVICE`、`ASBCP_AFSCP_ACTOR_ID` | ASBCP repo 自己定义和校验 |
| 开发者/运维可见表达 | “ASBCP internal sandbox execution service” / “Agent task sandbox execution backend” | 只用于工程、部署、release 和运维文档；不进入 AgentSmith UI/user guides/i18n |

禁止新增中间命名，例如 `SANDBOX_CONTROL_PLANE_*`。本轮目标是从旧 `SANDBOX_MANAGER` clean cut 到 `ASBCP`。

## 4. 三方职责

| 项目 | 负责 | 不负责 |
| --- | --- | --- |
| AgentSmith | 产品授权、task/repo 选择、runner image 选择、ASBCP image digest lock、部署消费、focused integration gate | 构建 ASBCP 源码、发布 ASBCP image、维护 ASBCP release gate、维护 ASBCP provider config/env/RBAC schema |
| AFSCP/JVS | 文件系统真相、workspace binding、mount plan、版本/恢复能力 | 创建 Agent task Pod、选择 runner image、维护 ASBCP lifecycle |
| ASBCP | 消费 AFSCP mount plan，管理 PV/PVC/Pod/exec/keepalive/release/delete，维护自身 API contract、runbook、risk/readiness evidence、release gate | AgentSmith 产品治理、AI 资源配额、用户 UI、AFSCP/JVS 存储真相、raw storage credential 管理 |

ASBCP repo 是 ASBCP 治理唯一来源。AgentSmith 只保留消费者侧说明、image lock 更新流程、部署 wiring 和必要集成证据。

AgentSmith 对 ASBCP 的消费分两层：`ASBCP_IMAGE` 是部署 image 输入；`ASBCP_INTERNAL_BASE_URL` 与 `ASBCP_SERVICE_KEY` 是 server/internal API 调用输入。后两者不得进入 `NEXT_PUBLIC_*`、web/Next/browser runtime、frontend route payload、MSW public fixture、UI 文案或 i18n namespace。前端只看到后端整理后的 Agent task 状态或错误码。

## 5. 当前实现真相

本节是计划创建时（2026-05-18）的基线快照，用于说明为什么需要 clean cut，不是执行时必须重复清理的固定返工清单。每个 slice 开始前必须以当前 guard、测试和 evidence 为准，先确认漂移仍存在，再处理仍命中的项。

AgentSmith 当前存在直接 sibling source 和旧命名依赖：

- `scripts/unified-deploy/check-local-kind-images.ts` 默认读取 `../mbos-sandbox-v1/manager-service`，执行 sandbox-manager Docker build。
- `scripts/run-internal-agent-task-real-gate.sh`、`scripts/run-integration-release-user-story.sh`、`scripts/local-manual/internal-common.sh`、`scripts/lib/internal-sandbox-real-control.sh` 仍会定位 `../mbos-sandbox-v1`，部分路径直接 `go run ./cmd/manager`。
- `scripts/backend-real-full-gate.sh` 会串起 release/full gate 路径；如果不覆盖，它可能继续间接使用旧 source 启动链路。
- `infra/deploy/unified/templates/app/workloads.yaml.tpl`、`config.yaml.tpl`、`afscp.yaml.tpl`、`rbac.yaml.tpl`、`sandbox-manager-pv-rbac.yaml.tpl` 中仍存在 `sandbox-manager` / `agentsmith-sandbox-manager` / `SANDBOX_MANAGER_*` / `SANDBOX_SERVICE_KEY` surface。
- `infra/deploy/unified/env/site.env.example` 如果仍使用 mutable sandbox image tag，会让 render 默认输入绕开 image lock。
- `workloads.yaml.tpl` 和 `internal-sandbox-real-control.sh` 仍有 JuiceFS/storage endpoint/access/secret 等 raw storage env 漂移，需要迁出 ASBCP 运行合同。
- `check-render.ts`、`render.test.ts` 仍在 AgentSmith 内校验部分 ASBCP provider config/env/RBAC 细节；这些应迁入 ASBCP repo，AgentSmith 只保留消费者 wiring 检查。

`../mbos-sandbox-v1` 当前独立发布能力不足：

- Go module 布局是 `manager-service` 子目录 module。为了减少返工，本轮保持 `manager-service` 为 Go module root，只把 module path/import/ldflags clean cut 到 `github.com/agentsmith-project/agentsmith-sandbox-control-plane`；不做 repo root Go module 迁移。
- Git remote 仍指向 Gitee 的 `mbos-sandbox-v1`。
- 缺少公开项目所需的治理骨架，例如 `LICENSE`、`NOTICE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`SECURITY.md`、PR template、release gate、risk/readiness evidence、runbooks。
- GitHub Actions 存在漂移：workflow 使用 Go `1.24`，但 `go.mod` 声明 `1.25.6`；部分 CI target 或脚本路径已经不存在。
- `release-gate` 只覆盖部分 Go 检查和 binary build，不足以证明 image、K8s render、active API smoke 可发布。
- 当前 repo 有 service + `images/runner` 双镜像/离线包痕迹，但 AgentSmith active 合同只需要 ASBCP 服务镜像；`images/runner` 本轮只能作为非 active fixture，不进入 ASBCP release/GHCR/用户文档。
- 一些旧 smoke/e2e 仍引用过时 `/v1/sandboxes` 或旧执行模型，需要收敛到当前 `/v1/workspaces/.../workloads` 合约。

## 6. 范围

必须做：

- 将 sibling project 整理并发布为 `agentsmith-sandbox-control-plane` GitHub public repo。
- 建立 ASBCP 自己的公开项目治理骨架、CI、release gate、GHCR image 发布。
- 全面迁移旧名：`mbos-sandbox-v1`、`sandbox-manager`、`agentsmith-sandbox-manager`、`SANDBOX_MANAGER_*`、`SANDBOX_SERVICE_KEY`、`github.com/sandbox/manager` 不得留在 active code/config/docs/tests。
- AgentSmith 标准路径只消费 `ASBCP_IMAGE` digest，不再 build 或 go run sibling source。
- `ASBCP_IMAGE` 与 `ASBCP_INTERNAL_BASE_URL`/`ASBCP_SERVICE_KEY` 边界拆开：前者只做部署 image 输入，后两者只做 server/internal API 调用输入；禁止新增 `NEXT_PUBLIC_ASBCP_*` 或任何 web/Next/browser runtime 暴露。
- AgentSmith 中属于 ASBCP provider 的治理、schema、release、runbook、config/env/RBAC 能力说明迁到 ASBCP repo。
- AgentSmith 只保留 ASBCP consumer adoption gate：image lock、Deployment/Service wiring、无 public ingress、ASBCP URL/key、Agent task 主链 smoke。
- 删除 AgentSmith 传给 ASBCP 的 raw storage credential 漂移，让 ASBCP 只消费 AFSCP mount plan。
- 用 TDD 补上 ASBCP clean cut、image-only 消费、旧名禁用、AFSCP caller 一致性的测试和静态守卫。

不做：

- 不重写 Agent task 产品对象、文件库、JVS/AFSCP 语义。
- 不复制 AFSCP 的业务内容、存储对象、GA selector 复杂度或 evidence taxonomy。
- 不新增 `SANDBOX_CONTROL_PLANE_*` 这种第二套中间配置。
- 不保留 `SANDBOX_MANAGER_*` 到 `ASBCP_*` 的兼容 alias。
- 不把旧 `/v1/sandboxes`、旧 SSE sandbox session、raw storage credential 或 direct pod-deleting cleaner 带回 active surface。
- 不把 `dangerous-system-tools` 纳入常规发布链路。
- 不把 `images/runner` 作为本轮 ASBCP release artifact、GHCR package 或用户文档内容；runner 若要发布，另起计划。
- 不在 AgentSmith UI/user guides/i18n 中直接暴露 `ASBCP`、`control plane`、`workload lifecycle` 或 ASBCP internal URL/key。

## 7. ASBCP 治理模型

ASBCP 采用 “AFSCP-lite” 治理：只借鉴方法论，不复制业务内容。

repo-local 治理资产按首轮 required/minimal 与 later/optional 分层；首轮只交付 required/minimal，later/optional 不作为本轮 release 阻塞项，避免复制 AFSCP 级流程。

| 层级 | 资产 | 边界 |
| --- | --- | --- |
| 首轮 required/minimal | `README.md` | 说明 ASBCP 独立演进、职责边界、快速验证、image 消费方式 |
| 首轮 required/minimal | `CONTRIBUTING.md`、`SECURITY.md`、`NOTICE`、Apache-2.0 `LICENSE`、`CHANGELOG.md` | 公开项目基础治理，不扩展成 AFSCP 级流程 |
| 首轮 required/minimal | `.github/pull_request_template.md` | 要求列出 contract、security、operation、test evidence、docs impact |
| 首轮 required/minimal | `docs/DEVELOPER_GUIDE.md` | 开发、测试、构建、发布入口 |
| 首轮 required/minimal | `docs/RELEASE_GATES.md` | 唯一权威 release gate 定义 |
| 首轮 required/minimal | `docs/release-evidence/release-manifest.json`、`docs/READINESS_EVIDENCE.md` | machine-readable manifest 是 canonical；说明文档只派生或引用 |
| 首轮 required/minimal | `docs/contracts/` | 只覆盖 active API、auth、AFSCP mount-plan dependency、operation/error contract |
| 首轮 required/minimal | `docs/runbooks/` | 只覆盖 local dev、release、rollback/rollforward、K8s operations、diagnostics 的必要路径 |
| later/optional | `docs/DEVELOPMENT_GOVERNANCE.md`、扩展版 `docs/RISK_REGISTER.md`、`docs/adr/` | 后续确有维护需要再补；不把 ADR/risk 流程做成本轮发布前置重流程 |

唯一权威 release gate：

- 权威脚本/唯一入口：`scripts/verify-release.sh`。
- `make release:ready` 可以作为 wrapper，但不能成为第二个权威入口。
- 完整 `scripts/verify-release.sh` 只在 tag/release workflow 或手动 release readiness 运行；不能放进每个 PR/main 默认 gate。
- release workflow 必须调用 `scripts/verify-release.sh`，不能绕过它调用零散测试。
- PR/main CI 默认只运行 lighter required guards，例如 `make verify` + `make image-build` + required contract guards；lighter CI 不能当作 release readiness。
- workflow hardening test 必须证明 release workflow 调用了权威 gate。
- 人工审批、AgentSmith 集成状态、兄弟项目状态不能成为 ASBCP release gate 条件。
- release gate 必须是阻塞式证据 gate：image build、image smoke、K8s render、`/healthz`、`/readyz`、AFSCP mount-plan fixture、workspace binding、workload create/keepalive/exec/release/delete 任一必需证据失败即失败，不允许降级为 warning 或“后续补证据”。
- release gate 只发布 ASBCP service image；`images/runner` 非 active fixture 不参与 gate、GHCR release 或 release notes。

轻量 evidence manifest：

- 单一 machine-readable manifest 是 canonical evidence；建议固定为 `docs/release-evidence/release-manifest.json`。
- 记录 health/ready、workspace binding fixture、workload create/keepalive/exec/release/delete、AFSCP mount plan fixture、K8s render、image smoke、匿名 GHCR `image:tag@digest` inspect/pull、旧名禁用、raw storage credential 禁用、runner 非 active 归类、version/tag/digest/commit 对齐。
- `docs/READINESS_EVIDENCE.md`、GitHub Release body、CHANGELOG 和 handoff 文档只能从该 manifest 派生或引用，不做第二本 evidence 账。
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
- `asbcp_version`、image tag、digest、release commit 必须来自同一个 ASBCP GitHub Release；AgentSmith lock parser 必须拒绝 mutable tag、缺 digest、缺 release URL、缺 commit、`asbcp_version` 不带 `v` 或 tag/version/release URL tag 不一致。
- flow 固定为：`lock -> local-kind image producer -> generated site env -> render -> rollout`。
- render 继续只消费 site env；不要让 render 直接读 lock，以免破坏 existing-cluster operator site env 模型。
- release/render gate 必须显式使用 image producer 生成的 site env，或使用同等 digest fixture；不能依赖含 mutable dev tag 的默认 `site.env.example`。
- `site.env.example` 中的 `ASBCP_IMAGE` 必须是 digest 示例或不可直接运行的占位说明。
- local-kind target repo 使用 `mbos/agentsmith-sandbox-control-plane`，不得继续 `mbos/sandbox-manager`。
- `ASBCP_IMAGE` 只用于 deploy render、local-kind image producer 和 K8s image wiring；不得被当作 server API 配置。
- `ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只能存在于 server-side API deps、internal gate env 和 Kubernetes Secret/ConfigMap wiring；禁止 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、frontend bundle、browser logs、i18n messages 或 user guide troubleshooting steps 暴露这些值。

backend-real/local-real 运行合同：

- 标准路径：如果需要本地 ASBCP 服务，使用发布 image 以 container 形式启动，或使用外部提供的 `ASBCP_INTERNAL_BASE_URL`。
- container 模式必须显式处理 `ASBCP_CONFIG_PATH=/etc/asbcp/asbcp-config.yaml`、`ASBCP_SERVICE_KEYS`、KUBECONFIG/volume、AFSCP token/base URL、namespace、日志、container cleanup、readyz 等待和失败保留策略。
- 不允许标准 gate 默认 `cd ../mbos-sandbox-v1/manager-service && go run ./cmd/manager`。
- raw JuiceFS/MinIO/storage credential 不应作为 ASBCP 必需 env 继续传入；ASBCP 应从 AFSCP workload binding/mount plan 获得文件挂载信息。

## 9. 迁移 / 删除 / 保留边界

| 类别 | 内容 |
| --- | --- |
| 迁到 ASBCP repo | `asbcp-config.yaml` schema/defaults、canonical config path `/etc/asbcp/asbcp-config.yaml`、ASBCP container env contract、health/ready/provider API smoke、ASBCP 所需 RBAC capabilities、API/OpenAPI/schema、错误码、runbooks、risk/readiness evidence、release workflow、GHCR publish、Dockerfile contract tests |
| AgentSmith 删除 | `../mbos-sandbox-v1` source build、`SANDBOX_SOURCE_DIR`、`--sandbox-source-dir`、`go run ./cmd/manager`、`SANDBOX_MANAGER_*`、`SANDBOX_SERVICE_KEY`、`agentsmith-sandbox-manager` K8s identity、`mbos/sandbox-manager` local-kind repo、ASBCP raw storage credential env、`NEXT_PUBLIC_ASBCP_*` 或任何 web/Next/browser ASBCP 配置 |
| AgentSmith 保留 | `ASBCP_IMAGE` digest lock consumption、server/internal-only `ASBCP_INTERNAL_BASE_URL` + `ASBCP_SERVICE_KEY` API client wiring、Deployment/Service wiring、无 public ingress 检查、AFSCP caller/token wiring、Agent task 主链 consumer smoke |

## 10. 当前漂移矩阵

本矩阵同样是计划创建时（2026-05-18）的基线快照。执行前先跑当前静态 guard、focused tests 或读取最新 evidence；已经被后续提交收敛的行不应重复返工。

| 当前漂移 | 目标状态 | Owner | Gate |
| --- | --- | --- | --- |
| `../mbos-sandbox-v1/manager-service` source build | AgentSmith pull ASBCP GHCR digest image | AgentSmith image dependency worker | local-kind image producer unit + static guard |
| `SANDBOX_SOURCE_DIR` / `--sandbox-source-dir` | 删除 | AgentSmith image dependency worker | static guard |
| `go run ./cmd/manager` in real/full gate | 发布 image container 或外部 `ASBCP_INTERNAL_BASE_URL` | AgentSmith runtime worker | backend-real/full gate focused tests |
| `SANDBOX_MANAGER_*` / `SANDBOX_SERVICE_KEY` | `ASBCP_*` | AgentSmith runtime worker | API deps/env preflight tests |
| `agentsmith-sandbox-manager` K8s identity | `agentsmith-sandbox-control-plane` | AgentSmith runtime worker | render/address/RBAC tests |
| AFSCP caller/actor 旧值 | `agentsmith-sandbox-control-plane` | AgentSmith runtime worker + cross-repo contract reviewer | render + AFSCP caller smoke |
| `site.env.example` mutable sandbox tag | `ASBCP_IMAGE` digest 示例或明确占位 | AgentSmith image dependency worker | render tests |
| raw JuiceFS/storage env 传给 ASBCP | 删除；只消费 AFSCP plan | AgentSmith runtime worker + ASBCP contract worker | render tests + ASBCP contract guard |
| `sandbox-manager`/`sandbox-runner` 双镜像 | 本轮只发布 ASBCP 服务镜像；`images/runner` 只作为非 active fixture，若发布另起计划 | ASBCP governance worker | release workflow tests + evidence manifest |
| old smoke `/v1/sandboxes` | 当前 `/v1/workspaces/.../workloads` | ASBCP smoke worker | API smoke |
| mutable ASBCP image tag | digest lock | AgentSmith image dependency worker | lock parser test |
| AgentSmith 内 ASBCP provider governance | 迁入 ASBCP repo | Docs/governance worker | doc guard + ownership review |
| `NEXT_PUBLIC_ASBCP_*` 或 web/Next/browser ASBCP 暴露 | 禁止；ASBCP URL/key 只限 server/internal API 与 internal gate | AgentSmith runtime worker + frontend guard reviewer | env preflight + bundle/static guard |
| Go module root 迁移歧义 | 保留 `manager-service` 为 Go module root，只改 module path/import | ASBCP naming worker | module layout guard + `cd manager-service && go test` |
| ASBCP config path 漂移 | `/etc/asbcp/asbcp-config.yaml` | ASBCP runtime worker + AgentSmith render worker | Docker/K8s contract tests |

## 11. 实施阶段

### P0. 冻结 ASBCP 命名、缩写与 active contract

目标：先确认“改名不扩范围”。

工作：

- 在 ASBCP README 顶部写明：`AgentSmith Sandbox Control Plane (ASBCP)` 是 sandbox workload lifecycle service，不是 AgentSmith 产品控制面，也不是 AFSCP 子模块。
- 在 AgentSmith consumer/docs 顶部写明：ASBCP 不是用户访问入口、system 管理侧或产品治理入口；AgentSmith UI/user guides/i18n 不直接暴露 ASBCP/control plane/workload lifecycle。
- 写入命名矩阵：repo/module/image/binary/env/K8s/AFSCP caller 都采用 ASBCP canonical identifiers。
- 梳理 active API：health/ready、workspace binding、workload create/keepalive/exec/release/delete。
- 梳理 active request fields：`workspace_binding_id`、`image`、`command`、`env`、`resources`、`timeouts` 等；ASBCP 不拥有 managed runner image 选择权。
- 梳理 active env：service key、K8s namespace、AFSCP base URL、AFSCP caller/actor identity。
- 明确 `images/runner` 状态：本轮只作为非 active fixture；从 `release:ready`、GHCR release、release notes、用户文档中排除。runner 若要发布，另起计划。
- 标记旧文档/旧脚本中的非 active surface，避免后续开发误用。

验收：

- P0 输出 identifier matrix。
- active contract guard 覆盖旧名、旧 API、旧 storage credential 模型。
- `ASBCP` 和 `AFSCP` 的职责边界在 README 和 contracts 中清晰分开。
- consumer docs / user guides / i18n guard 证明 ASBCP 不作为用户可见产品概念出现；只允许开发者/运维/部署文档出现。

### P1. ASBCP repo 公开项目化与 clean rename

目标：把 `../mbos-sandbox-v1` 整理成可公开维护的 ASBCP repo。

工作：

- 创建 GitHub public repo `agentsmith-project/agentsmith-sandbox-control-plane`。
- 本地 repo 默认 remote `origin` 指向 GitHub；旧 Gitee remote 改为 `gitee`。
- 添加 Apache-2.0 `LICENSE`、`NOTICE`、`CONTRIBUTING.md`、`SECURITY.md`、`CHANGELOG.md`。
- 添加 `.github/pull_request_template.md`。
- 更新 README、docs、`manager-service/go.mod` module path、imports、Dockerfile ldflags、build scripts、Kustomize image 名。
- 保留 `manager-service` 作为 Go module root；不把 `go.mod` 移到 repo root，不新增第二个 root module。repo root 承担公开治理、release gate、release evidence、version truth 和 workflow wrapper。
- binary/command 固定为 `asbcp`。
- 使用 root `VERSION` 作为单一版本真相，内容可以是不带 `v` 的 `X.Y.Z`；旧 `manager-service/VERSION` 应删除或由 root version 生成。
- Kustomize `app.kubernetes.io/version`、Docker ldflags、GitHub Release tag 都从同一版本真相派生。
- 清理硬编码区域镜像/代理默认值；如需国内镜像，只作为可选 build arg，不作为公开 release 默认行为。

验收：

- `cd manager-service && go test ./...` 能在新 module path 下通过。
- repo root 不存在 `go.mod`；module layout guard 证明 Go module root 是 `manager-service`，release scripts/workflows 在需要 Go 命令时显式 `cd manager-service`。
- `rg "github.com/sandbox/manager|mbos-sandbox-v1|sandbox-manager|SANDBOX_MANAGER|SANDBOX_SERVICE_KEY"` 不命中 active 代码与 active 文档；迁移说明可 allowlist。
- README 第一屏能解释 ASBCP 边界、快速验证、发布镜像和 AgentSmith 消费方式。

### P2. ASBCP 独立治理、CI 与发布 workflow

目标：ASBCP repo 自己证明“可以发布”。

工作：

- 按第 7 节分层建立 ASBCP-lite 治理文档：首轮只交付 required/minimal；later/optional 不作为本轮 release 阻塞项。
- 建立唯一权威 release gate：`scripts/verify-release.sh`。
- `make verify`、`make image-build`、`make image-smoke`、`make release:ready` 可以存在，但 `make release:ready` 只能包装 `scripts/verify-release.sh`。
- ASBCP release gate 只证明 ASBCP repo 自身 release readiness；AgentSmith consumer adoption gate 只证明 AgentSmith 消费该 image，不反向纳入 ASBCP release gate。
- 修正 GitHub Actions：
  - `.github/workflows/ci.yml`：PR/main 默认调 lighter `make verify` + `make image-build` + required contract guards，不默认调用 `scripts/verify-release.sh`。
  - `.github/workflows/release.yml`：tag `v*` 触发，必须先调 `scripts/verify-release.sh`，然后发布 GHCR image 与 GitHub Release。
- release workflow 最小要求：
  - permissions 包含 `contents: write`、`packages: write`。
  - 使用 `docker/login-action` 登录 GHCR。
  - 使用 `docker/metadata-action` 生成 tag/label。
  - 使用 `docker/build-push-action` build/push。
  - 从 build output 提取 digest。
  - release body 从 canonical release manifest 派生或引用，写入 image digest、commit SHA、API contract version、breaking changes。
  - workflow 末尾用 fresh Docker config 验证匿名 public pull：创建临时 `DOCKER_CONFIG`，不登录 GHCR，执行 `docker manifest inspect ghcr.io/...:vX.Y.Z@sha256:<digest>` 或 `docker pull ghcr.io/...:vX.Y.Z@sha256:<digest>`。
  - 禁止用 GitHub Packages visibility API、PAT、已登录 Docker config 或仓库权限检查兜底替代匿名 `image:tag@digest` inspect/pull。
- 添加 workflow hardening test，证明 release workflow 调用了唯一权威 release gate。
- 统一 Go 版本，CI 与 `go.mod` 保持一致。
- 删除或重写漂移的 CI target，例如不存在的 `make build`、`docker-compose-up`、旧 `wait-for-minio.sh`。
- active API smoke 应先通过 fixture/fake AFSCP 准备 `workspace_binding_id`，再覆盖 create/keepalive/exec/release/delete；不能只测 health/ready。
- release gate 必须阻塞式覆盖 image build、image smoke、K8s render、readiness、AFSCP mount-plan fixture、workspace binding 和 workload lifecycle；不能把这些 evidence 留给后续人工检查。

验收：

- Pull Request CI 绿。
- tag dry-run 或首个正式 tag 能产出 image digest。
- release notes 从 canonical release manifest 派生或引用，并包含 version、tag、commit SHA、image digest、API contract version、已知 breaking changes。
- ASBCP release gate 不依赖 AgentSmith local-kind/backend-real 或任何 consumer adoption gate。

### P3. ASBCP image 发布

目标：形成 AgentSmith 可以消费的稳定发布物。

工作：

- 使用 root `VERSION` 作为 release truth，内容可以是不带 `v` 的 `X.Y.Z`；Git tag、image tag、GitHub Release tag 和 AgentSmith lock 的 `asbcp_version` 必须是 `v$(cat VERSION)`，digest、canonical release manifest 和 release body 必须对应同一个 commit。
- GHCR 发布 image：`ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z`。
- GitHub Release 写入 digest：`ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- GitHub Release 写入 commit SHA、API contract version 和 image digest，供 AgentSmith lock 引用。
- 使用 fresh Docker config 匿名验证 GHCR `image:tag@digest` 可 inspect/pull，禁止 Packages visibility API/PAT 兜底。
- 不发布 `latest` 作为 AgentSmith 消费入口；如保留 convenience tag，AgentSmith 也不得引用。
- `images/runner` 本轮固定为非 active fixture，不发布第二个 GHCR image，不写入 release notes，不进入用户文档。

验收：

- 任意干净环境可以 `docker pull ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:vX.Y.Z@sha256:<digest>`。
- image 启动后 `/healthz`、`/readyz`、active API smoke 可通过。
- canonical release manifest 能证明匿名 public pull、digest、tag、commit、API contract version 一致。

### P4. AgentSmith 切换为 ASBCP image-only 消费

目标：AgentSmith 不再需要 sandbox sibling repo，也不再承载 ASBCP provider governance。

工作：

- 新增 `infra/deploy/shared/asbcp-image.lock`，pin P3 发布的 GHCR digest。
- 修改 unified deploy image producer：ASBCP image 不再 `docker build` sibling source，而是读取 lock 后 pull/tag/push。
- local-kind target repo 改为 `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@sha256:<digest>`。
- 删除或废弃 `SANDBOX_SOURCE_DIR`、`--sandbox-source-dir`、`siblingSandboxSourceDir()` 等标准路径。
- 更新 `infra/deploy/unified/env/site.env.example`：使用 `ASBCP_IMAGE` digest 示例或明确占位。
- 替换 AgentSmith env 并拆清边界：`ASBCP_IMAGE` 只用于 deploy image 输入；`ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只用于 server/internal API 调用。
- 加 guard：禁止 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、frontend bundle、browser/client code、UI route payload、MSW public fixtures、i18n 文案或 user guides 暴露 ASBCP URL/key 或把 ASBCP 作为用户可见产品概念。
- 替换 Node API deps/client wiring 中的旧 env key，不保留兼容 alias。
- K8s 资源 clean cut：Deployment、Service、ServiceAccount、Role、RoleBinding、ConfigMap、container name、component label、selector、checksum annotation、mount path、local-kind PV RBAC 全部迁到 `agentsmith-sandbox-control-plane` / `asbcp`。
- AFSCP allowed caller、service token map、ASBCP pod env、AgentSmith bootstrap tests 全部使用 `agentsmith-sandbox-control-plane`。
- 更新 `scripts/run-internal-agent-task-real-gate.sh`、`scripts/run-integration-release-user-story.sh`、`scripts/backend-real-full-gate.sh`、`scripts/lib/internal-sandbox-real-control.sh`、`scripts/local-manual/internal-common.sh`：标准路径使用发布 image container 或外部 `ASBCP_INTERNAL_BASE_URL`。
- 删除 AgentSmith 传给 ASBCP 的 raw storage env；保留 AgentSmith 自身 substrate MinIO/AFSCP 配置，但不能作为 ASBCP 运行合同。
- 将 AgentSmith 内 ASBCP provider config/env/RBAC/schema/release/runbook 治理迁到 ASBCP repo；AgentSmith render/check 只保留 consumer wiring、无 public ingress、URL/key、AFSCP caller/token、主链 smoke。
- 加 cleanup/prune 计划：pre-GA 环境中删除旧 `agentsmith-sandbox-manager` Deployment/Service/ConfigMap/RBAC/local-kind PV RBAC/checksum annotation 相关残留，避免双资源残留。

验收：

- 在没有 `../mbos-sandbox-v1` 的环境中，AgentSmith image producer、backend-real/full gate 计划路径和 render tests 仍能通过。
- `npm run test:unified-deploy:local-kind:images:unit` 覆盖 ASBCP digest lock 与禁止 source build。
- `npm run test:unified-deploy:render`、`npm run test:unified-deploy:address-truth` 通过。
- 新增或更新 focused tests 覆盖：
  - `run-integration-release-user-story`
  - `run-internal-agent-task-real-gate`
  - `backend-real-full-gate`
  - `internal-sandbox-real-control`
  - `local-manual/internal-common`
  - API deps/env preflight
  - AFSCP caller/token 一致性
  - 旧名静态 guard

### P5. Consumer adoption 验证

目标：证明 AgentSmith 能消费 ASBCP 发布物。该阶段不是 ASBCP 未来 release gate。

工作：

- ASBCP repo 先完成 `scripts/verify-release.sh`，发布 GHCR image。
- P5 是 AgentSmith consumer adoption gate，不是 ASBCP release gate；每个 AgentSmith slice 只跑受影响 focused gate，阶段收口或最终发布前才跑重门禁。
- AgentSmith 更新 `asbcp-image.lock` 后运行 focused gate：
  - `npm run test:unified-deploy:local-kind:images:unit`
  - `npm run test:unified-deploy:render`，但必须使用 generated site env 或等价 digest fixture
  - `npm run test:unified-deploy:address-truth`
  - `npm run test:unified-deploy:local-kind:images`
  - `npm run test:unified-deploy:local-kind`
- 如改动影响 Agent task runner/terminal runtime，再补：
  - `npm run test:agent-task:runner:fast`
  - `npm run test:skills:fast`
  - 必要时 `npm run test:skills:backend-real`
- 发布收口必须覆盖 `scripts/run-integration-release-user-story.sh` 和 `scripts/backend-real-full-gate.sh` 所在路径，证明它们不再访问 sibling source。
- 最终发布前回到 `npm run release:ready`；不要在每个小 slice 重复跑重门禁。

验收：

- AgentSmith release rehearsal 不会访问 `../mbos-sandbox-v1`。
- ASBCP image digest、AgentSmith lock、generated site env、部署 manifest、运行中 Pod image 五者一致。
- ASBCP lock 中 `asbcp_version`、image tag、GitHub Release tag 和 release URL tag 都是同一个 `vX.Y.Z`，并且 version/tag/digest/commit 与 ASBCP GitHub Release 一致。
- Agent task 创建、workspace binding、workload create/keepalive/exec/release/delete 主链通过。
- ASBCP release gate 与 AgentSmith consumer adoption gate 分离清楚。

### P6. 文档与 handoff

目标：避免未来开发回到历史心智。

工作：

- AgentSmith 文档只说明：ASBCP 是外部发布 image 依赖；如何更新 `asbcp-image.lock`；需要跑哪些 consumer adoption gates。
- AgentSmith 用户文档、UI 文案和 i18n 不直接出现 ASBCP/control plane/workload lifecycle；面向开发者/运维的 consumer docs 可以使用 ASBCP，但必须先说明它是内部后端服务。
- ASBCP README 说明：如何运行 `scripts/verify-release.sh`、如何发布、AgentSmith 如何消费。
- 删除或归档旧 `mbos-sandbox-v1`、`SANDBOX_SOURCE_DIR`、本地 source build、`SANDBOX_MANAGER_*` 文档。
- AgentSmith 内 ASBCP 研发治理内容迁出或降级为消费者说明；ASBCP 的发布、API 合同、运行诊断、风险与证据文档全部迁到 ASBCP repo。
- 在两个 repo 都补一段“不要做什么”：
  - 不要在 AgentSmith release lane 构建 ASBCP source。
  - 不要让 ASBCP 承担 AgentSmith 产品治理。
  - 不要把 AFSCP 业务内容或存储对象复制到 ASBCP。
  - 不要用 mutable tag 做发布依赖。
  - 不要把 raw storage credential 作为 ASBCP 运行合同。

验收：

- 新人只读 ASBCP README 和 release 文档即可完成 ASBCP image 发布。
- 新人只读 AgentSmith ASBCP consumer 文档即可完成 image lock 更新和集成验证。
- 文档里没有 active 指引要求开发者回到 `mbos-sandbox-v1` sibling source build 或 `SANDBOX_MANAGER_*` 配置。

## 12. TDD 与验证策略

先写或调整测试，再改实现：

- ASBCP repo：
  - module layout + module path/import path guard：`manager-service/go.mod` 是唯一 Go module root，module path 为 `github.com/agentsmith-project/agentsmith-sandbox-control-plane`。
  - old name guard：禁止 active `sandbox-manager`、`SANDBOX_MANAGER`、`github.com/sandbox/manager`。
  - active API contract guard。
  - release workflow hardening test。
  - image health/ready smoke。
  - workspace binding + workload create/keepalive/exec/release/delete API smoke。
  - AFSCP mount-plan fixture smoke。
  - K8s render test。
  - Dockerfile contract test：OCI labels、version/revision/created、非 root、root `VERSION` 可以不带 `v`、image/Git tag 带 `v`、canonical config path `/etc/asbcp/asbcp-config.yaml`。
  - release evidence guard：version、tag、digest、commit、匿名 GHCR `image:tag@digest` inspect/pull、API contract version 全部存在且一致。
  - runner fixture guard：`images/runner` 不进入 release workflow、GHCR publish、release notes 或用户文档。
- AgentSmith：
  - ASBCP image lock parser test，要求 `asbcp_version`、image tag、GitHub Release tag 和 release URL tag 都是同一个 `vX.Y.Z` 且 version/tag/digest/commit 一致，拒绝缺 digest、缺 release URL、缺 commit 或 mutable tag。
  - local-kind image producer test，断言 ASBCP 走 pull/tag/push，不走 docker build source。
  - render test，断言 `ASBCP_IMAGE` 从 generated site env 进入 manifest。
  - address truth test，断言 ASBCP 不暴露 public ingress。
  - API deps/unit：server-side `ASBCP_INTERNAL_BASE_URL` + `ASBCP_SERVICE_KEY` 成对校验；旧 key 不再生效或触发明确失败。
  - frontend/static guard：禁止 `NEXT_PUBLIC_ASBCP_*`，禁止 ASBCP URL/key 进入 web/Next/browser runtime、client bundle、UI route payload、MSW public fixture、i18n 文案或 user guides。
  - backend-real/full gate script tests，断言不再依赖 sibling source。
  - AFSCP caller/token consistency test。
  - static guard，禁止 active source build、旧 env、旧 K8s identity、旧 image repo 回退路径、`/etc/asbcp/config.yaml` config path 漂移。
  - focused local-kind rollout，证明 Pod 实际使用 lock digest。

门禁原则：

- 每个 slice 只跑最小相关 focused gate。
- ASBCP release gate 与 AgentSmith consumer adoption gate 分离。
- 跨 repo 集成完成后再跑 local-kind rollout。
- 最终发布前才跑 AgentSmith `npm run release:ready`。

## 13. 风险与处理

ASBCP/AFSCP 缩写混淆：

- 风险：ASBCP 和 AFSCP 太接近，后续文档可能把职责混在一起。
- 处理：首次出现必须展开全称；ASBCP 管 workload lifecycle，AFSCP 管 filesystem/storage truth；禁止把 ASBCP 写成 AFSCP 子模块或 AgentSmith 产品控制面。

机械全局替换：

- 风险：字符串替换破坏 API 语义、测试 fixture 或历史迁移说明。
- 处理：按 identifier matrix 分层迁移；历史文档/迁移说明 allowlist，active code/config/tests/docs 必须通过旧名 guard。

AFSCP caller/token 不一致：

- 风险：allowed caller、service token map、ASBCP pod env、AgentSmith bootstrap tests 不同名会导致 mount plan 调用 403。
- 处理：P4 同一 slice 修改并测试 AFSCP caller/token identity。

K8s 资源残留：

- 风险：`kubectl apply` 不会自动删除旧 `agentsmith-sandbox-manager` 资源，形成双 Deployment/Service/RBAC。
- 处理：pre-GA 环境使用 clean-cluster 或显式 prune；计划中列出旧资源清理。

发布镜像不可拉取：

- 风险：GHCR package 默认 private、digest 记录错误，或验证复用了已登录凭据导致 public 可访问性没有被证明。
- 处理：release workflow 必须用 fresh Docker config 匿名验证 `image:tag@digest` 可 inspect/pull，禁止 Packages visibility API/PAT 兜底；AgentSmith lock 必须包含 digest。

API contract 漂移：

- 风险：ASBCP release 后 AgentSmith client 调用失败。
- 处理：ASBCP release notes 写 API contract version；AgentSmith consumer gate 必跑 workspace binding 与 workload 主链。

raw storage env 回流：

- 风险：ASBCP 继续背负 JuiceFS/MinIO/storage credential，和 AFSCP plan consumer 模型冲突。
- 处理：P4 删除 AgentSmith 侧 raw storage env 传递，ASBCP contract guard 禁止 raw storage credential 成为运行合同。

过度治理：

- 风险：为了学习 AFSCP，复制太多存储控制面业务文档和复杂 selector。
- 处理：采用 ASBCP-lite，只借鉴唯一 release gate、canonical evidence manifest、contract/docs guard、PR 模板、security/runbook、workflow hardening。

ASBCP 暴露到浏览器或用户文档：

- 风险：`ASBCP_SERVICE_KEY` / `ASBCP_INTERNAL_BASE_URL` 被做成 `NEXT_PUBLIC_ASBCP_*`、进入 web/Next/browser runtime、MSW public fixture、UI 文案或 user guides，造成内部拓扑/密钥泄露，并把工程后端服务误写成用户访问入口。
- 处理：`ASBCP_IMAGE` 只走部署 image 输入，`ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 只走 server/internal API；增加 env/static/bundle/i18n/user-guide guard。用户侧只看到 Agent task 状态和可操作错误，不看到 ASBCP/control plane/workload lifecycle。

Go module root 返工：

- 风险：一边迁到 repo root，一边保留 `manager-service` module，会产生双 module、CI 路径漂移和 import/ldflags 反复修改。
- 处理：本轮选择最小返工路径：保留 `manager-service` 为唯一 Go module root，repo root 只放治理、release wrapper、VERSION、evidence 和 workflows。未来若需要 root module，另起计划。

runner 发布范围蔓延：

- 风险：`images/runner` 被顺手纳入 ASBCP release/GHCR，导致 release gate、用户文档和 AgentSmith 消费合同扩大。
- 处理：本轮 runner 固定为非 active fixture；release workflow、release notes、GHCR publish、readiness evidence 和用户文档都不得发布 runner。runner 发布另起计划。

config path 漂移：

- 风险：`/etc/asbcp/config.yaml`、旧 manager path 和 `/etc/asbcp/asbcp-config.yaml` 混用，导致 Docker/K8s/runbook/test 互相打架。
- 处理：canonical path 固定为 `/etc/asbcp/asbcp-config.yaml`；ASBCP Docker/K8s/contract tests 与 AgentSmith render guard 同时校验。

release digest 不可追溯：

- 风险：只有 mutable tag 或缺少 public pull 证据，AgentSmith lock 无法证明消费的是同一个可追溯发布物。
- 处理：ASBCP release 必须输出 version/tag/digest/commit/API contract version，用 fresh Docker config 真实验证匿名 GHCR `image:tag@digest` inspect/pull；AgentSmith lock 必须记录并校验这些字段。

## 14. 开发任务拆分

建议按以下顺序分配给 team：

1. ASBCP naming worker：负责 repo identity、`manager-service` module path/import/binary/docs/license/changelog 的 clean rename；不得把 Go module 迁到 repo root。
2. ASBCP governance worker：负责 ASBCP-lite 文档、release gate、CI、release workflow、GHCR service image 发布、public pull evidence 和 `images/runner` 非 active fixture 归类。
3. ASBCP contract/smoke worker：负责 active API contract、image smoke、K8s render、AFSCP mount-plan fixture 与旧 smoke 清理。
4. AgentSmith image dependency worker：负责 `asbcp-image.lock`、`asbcp_version` 与 image/GitHub Release tag/release URL tag 同为 `vX.Y.Z` 的一致性校验、image producer、render/local-kind tests、static guard。
5. AgentSmith runtime integration worker：负责 `ASBCP_IMAGE` 部署输入与 `ASBCP_INTERNAL_BASE_URL`/`ASBCP_SERVICE_KEY` server/internal API 输入拆分、禁止 `NEXT_PUBLIC_ASBCP_*`、K8s/RBAC/AFSCP caller clean cut、backend-real/full gate、local manual、raw storage env 移除、focused rollout，并拉 cross-repo contract reviewer 校验 AFSCP caller/token 一致性。
6. Docs/governance migration worker：负责把 ASBCP provider governance 从 AgentSmith 迁到 ASBCP repo，AgentSmith 只保留 developer/operator consumer docs；UI/user guides/i18n 不直接暴露 ASBCP/control plane/workload lifecycle。
7. Review worker：只读审查跨 repo 命名矩阵、ASBCP/AFSCP 边界、旧名 guard、是否还有 source build 回退路径。

每个 worker 必须先补测试或守卫，再改实现；不得用 fallback 把 sibling source build 或旧 env 留在 release path。

## 15. 完成定义

ASBCP 独立发布完成时必须满足：

- `agentsmith-sandbox-control-plane` GitHub repo public 可访问。
- repo 使用 Apache-2.0 license，并有公开项目治理骨架。
- ASBCP repo PR/main lighter required guards 绿。
- `scripts/verify-release.sh` 是唯一权威 release gate。
- ASBCP repo tag release 能发布 GHCR service image，并记录 version、tag、digest、commit SHA、API contract version。
- release workflow 用 fresh Docker config 真实验证匿名 GHCR `image:tag@digest` inspect/pull，禁止 Packages visibility API/PAT 兜底。
- ASBCP release gate 不依赖 AgentSmith 或任何 consumer adoption gate。
- ASBCP repo 已成为 ASBCP release/governance/docs 的权威来源。
- ASBCP repo 旧名/static guard 通过，active code/config/docs/tests 不再使用旧命名。
- ASBCP Go module root 是 `manager-service`，repo root 无 `go.mod`；release scripts/workflows 对 Go 命令显式进入 `manager-service`。
- canonical config path 是 `/etc/asbcp/asbcp-config.yaml`。
- `images/runner` 未进入本轮 release/GHCR/release notes/用户文档。

AgentSmith consumer 迁移完成时必须满足：

- AgentSmith 不再从 `../mbos-sandbox-v1` 构建或启动 ASBCP。
- AgentSmith 通过 `asbcp-image.lock` 消费 GHCR digest image，并校验 `asbcp_version`、image tag、GitHub Release tag、release URL tag 同为 `vX.Y.Z`，且 digest、commit 一致。
- AgentSmith 使用 `ASBCP_IMAGE` 作为部署 image 输入，使用 `ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 作为 server/internal API 输入，不再使用 `SANDBOX_MANAGER_*` / `SANDBOX_SERVICE_KEY`。
- `ASBCP_INTERNAL_BASE_URL` / `ASBCP_SERVICE_KEY` 不出现在 `NEXT_PUBLIC_*`、web/Next/browser runtime、client bundle、UI route payload、MSW public fixture、i18n 或用户文档。
- K8s runtime identity、AFSCP caller/actor、image repo、tests、docs 均迁到 ASBCP canonical names。
- AgentSmith local-kind rehearsal、backend-real/full gate 与 release gate 能在无 sibling sandbox repo 的环境中完成。
- AgentSmith 旧名/static guard 通过，active code/config/docs/tests 不再使用旧 ASBCP 命名。
- raw storage credential 不再作为 ASBCP 运行合同。
- AgentSmith 无 ASBCP 源码构建和发布治理残留。

## 16. Team Review 记录

调研与 review 已覆盖：

- AgentSmith dependency review：确认当前 unified deploy、本地 real gate、integration user story 仍存在 sibling source build 和 `go run` 路径。
- ASBCP repo readiness review：确认当前 Go module、CI、release gate、smoke、license/changelog/governance docs 存在公开发布前缺口。
- Naming/scope review：用户明确 `SANDBOX_MANAGER` 历史名不应保留后，计划改为 pre-GA clean cut 到 `ASBCP`。
- AFSCP governance reference review：只借鉴治理方法，不复制 AFSCP 业务内容；采用 ASBCP-lite。
- Delivery-mindset review：确认 ASBCP 是工程后端服务，不是用户访问入口、system 管理侧或 AgentSmith 产品治理入口；AgentSmith UI/user guides/i18n 不直接暴露 ASBCP/control plane/workload lifecycle。
- Security exposure review：确认 `ASBCP_IMAGE` 是部署 image 输入，`ASBCP_INTERNAL_BASE_URL`、`ASBCP_SERVICE_KEY` 只允许 server/internal API 和 internal gate 使用，禁止 `NEXT_PUBLIC_ASBCP_*` 和 web/Next/browser runtime 暴露。
- Module layout review：为减少返工，本轮保留 `manager-service` 作为 Go module root，repo root 只放治理、release wrapper、VERSION 和 evidence。
- Release evidence review：release gate 必须阻塞式证明 image、K8s、readiness、active API smoke、匿名 GHCR `image:tag@digest` inspect/pull、version/tag/digest/commit lock 一致，且 GitHub Release body 等说明从 canonical manifest 派生或引用。

实现前最后检查重点：

- 是否还有 `../mbos-sandbox-v1` active dependency。
- 是否还有 `SANDBOX_MANAGER_*`、`SANDBOX_SERVICE_KEY`、`agentsmith-sandbox-manager`、`sandbox-manager` active surface。
- 是否还有 mutable ASBCP image tag。
- 是否还有 raw storage credential 被当作 ASBCP 运行合同。
- 是否有文档把 ASBCP 写成用户访问入口、system 管理侧、AgentSmith 产品治理入口、AFSCP 子模块或存储控制面。
- 是否有 `NEXT_PUBLIC_ASBCP_*`、web/Next/browser runtime、UI/i18n/user guide 直接暴露 ASBCP URL/key 或 ASBCP/control plane/workload lifecycle 概念。
- 是否仍有人把 Go module 迁到 repo root，或新增了 root `go.mod`。
- 是否把 `images/runner` 带入本轮 ASBCP release/GHCR/release notes/用户文档。
- 是否出现 `/etc/asbcp/config.yaml` 或旧 manager config path 漂移。
- 是否缺少 fresh Docker config 匿名 GHCR `image:tag@digest` inspect/pull、canonical manifest、version/tag/digest/commit 一致性证据。
