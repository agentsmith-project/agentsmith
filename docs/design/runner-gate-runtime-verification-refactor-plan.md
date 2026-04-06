# Runner / Gate / Deploy Runtime Verification 重构任务计划

## 1. 背景与目标

当前 runner 的 task-root / HOME / external bwrap / internal workspace 挂载语义已经开始收敛，但测试脚本、backend-real gate、deploy verify、rehearsal 线仍然在分别维护各自的“运行时真相”。

这导致几个持续性问题：

- 地址与端口真相分散，`localhost` / `127.0.0.1` / public URL / pod callback URL 混用。
- runner 里的路径真相与 e2e / verify / deploy 中的路径真相没有统一建模。
- real gate 失败时，环境问题、认证问题、产品逻辑问题混在一起，诊断成本高。
- deploy verify、rehearsal、backend-real 都在重复实现相似逻辑，维护成本高，容易漂移。
- 证据产物没有标准结构，报告和排障依赖人工理解脚本细节。

本任务的目标是把以下几类能力统一成一个可治理、可发布、可排障的体系：

- runner 运行时模式与路径真相
- gate 运行时地址与依赖真相
- backend-real / rehearsal / deploy verify 的校验分层
- workspace access 协议中的路径语义
- 标准化 evidence bundle

最终目标：

- 开发 agent 不需要关心当前是 host external、docker external、k8s internal、demo rehearshal 还是 cluster deploy。
- gate / verify 能稳定复用同一套 runtime contract。
- 失败时可以明确分辨是 infra、auth、workspace、runner、provider 还是 scenario 问题。

---

## 2. 当前问题总结

### 2.1 运行时地址真相分散

以下脚本都在自行定义一套环境：

- `scripts/run-integration-e2e-full.sh`
- `scripts/run-internal-notebook-real-gate.sh`
- `scripts/backend-real-full-gate.sh`
- `scripts/demo-deploy/verify.sh`
- `scripts/cluster-deploy/verify.sh`
- `scripts/local-manual/*`

主要问题：

- 默认地址规则不统一。
- 变量优先级不稳定。
- 同一概念有多套变量名。
- browser-facing URL 和 host-local service URL 没有强制分层。

### 2.2 Workspace 路径语义不够明确

现在代码和测试里至少有三种不同语义：

- pod / container 内工作目录
- file library 根目录
- 本地挂载后用于校验和下载的相对路径

当前 `task_root_path` 信息量不足，容易把容器 mount point 误当作 file library 相对根。

### 2.3 Gate 失败分层不清晰

最近真实失败覆盖过：

- Keycloak cookie / callback 异常
- universal proxy 未就绪
- Docker build 代理异常
- stale image / stale base image
- JuiceFS CSI 未就绪
- sandbox manager 启动超时
- provider capacity
- API 生命周期抖动

这些问题在现有 gate 中容易表现为同一类“spec failed”。

### 2.4 Deploy / Rehearsal / Backend-real 存在重复实现

当前文档中已经把 runtime lines 统一描述，但代码没有真正共用一套 verification architecture。

表现为：

- deploy verify 既做环境确认，又做产品行为验证。
- rehearsal 线和 backend-real 线重复实现基础能力。
- 本地、demo、cluster 三条线都在重复写同类逻辑。

### 2.5 证据产物不标准化

日志和 artifact 虽然逐步补起来了，但仍然没有统一结构。

问题表现为：

- 不同 gate 的 artifact 目录布局不同。
- 失败时缺少统一的 env summary / runtime summary。
- 无法快速判断这是哪一层失败。

---

## 3. 重构原则

### 3.1 Runtime Truth 统一

所有运行线必须复用同一套运行时描述，而不是各自推导。

### 3.2 Contract First

先明确：

- URL 语义
- workspace 路径语义
- runner 模式语义
- evidence 语义

再修改脚本和测试。

### 3.3 Gate 分层

必须把以下层次分开：

- infra preflight
- auth/browser preflight
- scenario gate

### 3.4 Deploy Verify 复用标准 Gate

deploy verify 不再成为另一套平行的测试逻辑，而应组合标准 gate。

### 3.5 Evidence First

每条运行线都必须输出标准化证据，支持失败分类和报告生成。

---

## 4. 目标架构

### 4.1 引入统一 Runtime Descriptor

定义一套统一的 runtime descriptor，用来表达当前这一条运行线的真相。

建议字段：

- `line_id`
- `line_kind`
  - `local_manual`
  - `backend_real`
  - `demo_rehearsal`
  - `cluster_rehearsal`
  - `demo_deploy_verify`
  - `cluster_deploy_verify`
- `runner_modes`
  - external host / external docker / internal k8s
- `browser_urls`
  - web
  - keycloak
- `host_local_urls`
  - api
  - web
  - keycloak
  - proxy
- `container_or_pod_urls`
  - ws callback
  - sandbox callback
- `workspace_model`
  - library root semantics
  - container workspace semantics
- `image_refs`
  - runner image
  - verify image
  - sandbox image

这份 descriptor 应该由统一 resolver 生成，所有 gate / verify 只消费结果。

### 4.2 引入统一 Runtime Env Resolver

建立一套统一的 env 解析逻辑，替代各脚本分散定义默认值。

规则建议：

- browser-facing web / keycloak 默认用 `localhost`
- host-local API / health polling 默认用 `127.0.0.1`
- container / pod callback 地址必须显式定义
- public URL 和 host-local URL 必须分开
- deploy verify 使用 public URL 进行最终访问验证，使用 host-local URL 做本机 readiness 和 API 校验

### 4.3 重构 Workspace Access 协议

把路径语义拆清楚。

建议对外明确两个字段：

- `container_workspace_path`
  - runner / terminal / pod 内使用
- `library_root_path`
  - file library 相对根，用于本地挂载、下载、artifact 检查

约束：

- internal task 的 file library 直接 mount 到 `/workspace/<task_id>`
- 但 `library_root_path` 仍然是 `.`
- `container_workspace_path` 和 `library_root_path` 不允许再混用

### 4.4 引入标准 Gate 分层

每条 real gate 统一拆成三段：

1. `infra_preflight`
- postgres / mongo / redis / minio / keycloak / universal proxy readiness
- docker / kind / kubectl / juicefs / bwrap / image availability
- CSI / sandbox manager / external runner availability

2. `auth_preflight`
- Keycloak login bootstrap
- callback 完成
- cookie / session / token 持久化检查
- workspace login 可达性检查

3. `scenario_gate`
- notebook external
- notebook docker external
- notebook internal workspace
- notebook internal reclaim
- files smoke
- deploy preset release journey

### 4.5 引入标准 Evidence Bundle

每条 gate 输出统一的 evidence 目录结构：

- `runtime.json`
- `resolved-env.json`
- `preflight.json`
- `workspace-access.json`
- `failure-classification.json`
- `logs/`
- `runner/`
- `playwright/`
- `mount-tree.txt`
- `task-summary.json`
- `service-status.json`

deploy verify / rehearsal report 统一消费这套结构。

---

## 5. 分阶段开发任务

## Phase A：Runtime Env Resolver 与 Descriptor

### 开发内容

- 抽出统一的 runtime descriptor 生成逻辑。
- 抽出统一的 env resolver。
- 收口 backend-real、internal real gate、deploy verify、rehearsal 线中重复的地址与端口拼装逻辑。
- 明确 browser-facing / host-local / public / pod callback 四类地址。

### 重点修改对象

- `scripts/lib/backend-real-env.sh`
- `scripts/run-integration-e2e-full.sh`
- `scripts/run-internal-notebook-real-gate.sh`
- `scripts/backend-real-full-gate.sh`
- `scripts/demo-deploy/verify.sh`
- `scripts/cluster-deploy/verify.sh`

### 验收标准

- 所有相关脚本不再各自定义 URL 默认值。
- 显式传入变量时不再被内部默认值覆盖。
- `localhost` / `127.0.0.1` 语义固定且一致。

## Phase B：Workspace Access Contract 重构

### 开发内容

- 为 workspace-access 增加明确的路径字段。
- 更新 API 返回结构。
- 更新 e2e helper、integration helper、deploy verify helper。
- 移除对“internal 返回 task.id 路径”的旧假设。

### 重点修改对象

- `packages/api-entry-node/src/task-route-handler.ts`
- notebook / files / real helper 相关代码
- 使用 workspace-access 的 integration / e2e 测试

### 验收标准

- external / internal 对 file library 相对路径的语义完全一致。
- local mount、download、Files UI、artifact 检查都基于 `library_root_path`。
- runner / terminal / pod 内 cwd 始终基于 `container_workspace_path`。

## Phase C：Gate Preflight 分层

### 开发内容

- 新增 infra preflight 阶段
- 新增 auth/browser preflight 阶段
- scenario gate 仅负责业务行为验证
- 为每条失败输出失败分类

### 建议失败分类

- `infra_dependency_unready`
- `identity_bootstrap_failed`
- `workspace_contract_failed`
- `runner_launch_failed`
- `sandbox_startup_failed`
- `provider_capacity_or_upstream_failed`
- `scenario_assertion_failed`

### 验收标准

- 失败报告中可以明确看到属于哪一层。
- 同一 scenario 不再需要手工读多个日志才能知道失败类型。

## Phase D：Deploy Verify / Rehearsal 复用标准 Gate

### 开发内容

- demo / cluster verify 改为组合标准 gate，而不是继续维护单独的验证逻辑。
- rehearsal 线改为使用与 deploy verify 同一套 runtime descriptor + gate primitives。
- 保留部署环境特有的 readiness / image / kubeconfig 校验，但不重复实现 scenario 断言。

### 验收标准

- `demo-rehearsal` 与 `demo-deploy verify` 共享 scenario gate。
- `cluster-rehearsal` 与 `cluster-deploy verify` 共享 internal / external scenario gate。
- deploy verify 输出统一 evidence bundle。

## Phase E：Evidence Bundle 与 Report

### 开发内容

- 定义统一 evidence 结构。
- gate 执行结束后标准化产出 metadata。
- report 脚本统一消费 evidence，而不是现场解析分散日志。

### 验收标准

- 每条 gate 的 artifact 结构统一。
- backend-real / rehearsal / deploy report 输出风格统一。

---

## 6. 测试与验证计划

## 6.1 Contract / Unit

### Runtime Env Resolver

- 显式 env 优先级正确
- localhost / 127.0.0.1 默认规则正确
- browser-facing / host-local / public URL 分层正确

### Workspace Access Contract

- internal / external 返回正确的 `container_workspace_path`
- internal / external 返回正确的 `library_root_path`
- 不再泄露容器 mount point 到 file library 相对路径

### Runner Capability / Path Semantics

- host external 无 bwrap 时允许 fallback
- docker external 无 bwrap 时失败
- execution credentials 不进入 workspace
- `credentialDir` 必须位于 runner-local state root

## 6.2 Integration

- notebook task workspace-access 响应字段完整
- 本地 mount + Files UI + download path 一致
- internal workspace orchestration 使用 `/workspace/<task_id>`
- file library 根路径与容器路径正确分层
- builtin skills / `.codex` / `.artifacts` 语义不变

## 6.3 Backend-real / Real e2e

### External

- host external notebook real lane
- docker external notebook real lane
- terminal real smoke

### Internal

- notebook workspace real lane
- notebook reclaim real lane
- sandbox startup / CSI preflight

### Auth / Identity

- workspace login real preflight
- callback cookie sanity
- token persist 和 workspace redirect

## 6.4 Deploy / Rehearsal Verify

### Demo

- `demo-rehearsal-up/bootstrap/verify/report`
- `demo-deploy verify`
- external-only 与 full mode 的行为正确

### Cluster

- `cluster-rehearsal-up/bootstrap/verify/report`
- `cluster-deploy verify`
- sandbox manager / CSI / external runner / public URLs 正确

## 6.5 Regression Matrix

重点建立以下防回归项：

- execution credentials 不得进入 workspace 下载结果
- internal `library_root_path` 必须是 `.`
- `container_workspace_path` 与 `library_root_path` 不得互换
- `run-integration-e2e-full.sh` 不得再吞掉显式传入端口
- browser-facing web / keycloak URL 不得默认回退为不兼容 cookie 的地址组合

---

## 7. 实施顺序建议

建议按以下顺序推进：

1. 先做 Runtime Env Resolver
2. 再做 Workspace Access Contract 拆分
3. 再做 Gate Preflight 分层
4. 然后重构 deploy verify / rehearsal 复用关系
5. 最后统一 evidence bundle 与 report

原因：

- 第 1、2 步先修正“真相定义”
- 第 3 步修正“失败如何分类”
- 第 4 步减少重复实现
- 第 5 步解决长期治理和报告问题

---

## 8. 风险与注意事项

### 8.1 不要把 deploy verify 重构成另一套测试框架

目标是复用标准 gate，不是复制一套“verify 专用逻辑”。

### 8.2 不要继续扩大模糊字段

例如 `task_root_path` 这种混合语义字段不应继续叠加兼容逻辑。

### 8.3 先统一 env resolver，再批量改脚本

否则脚本改一半时会出现大量临时态漂移。

### 8.4 保持 local-manual、rehearsal、deploy 的语义清晰

- `local-manual` 是日常真实开发手测线
- `rehearsal` 是部署排演线
- `deploy verify` 是最终目标环境验证线

三者可以复用实现，但不能混淆职责。

---

## 9. 最终交付物

本次重构最终应交付：

- 统一 runtime descriptor / env resolver
- 新版 workspace-access 路径协议
- 分层后的 real gate 体系
- deploy / rehearsal 复用的标准 gate 入口
- 标准化 evidence bundle
- 对应 contract / unit / integration / backend-real / deploy verify 覆盖
- 更新后的 runbook / deploy guide / runtime line 文档

---

## 10. 完成判定

满足以下条件后，任务视为完成：

- backend-real、rehearsal、deploy verify 不再各自拼运行时真相
- internal / external workspace 路径语义完全统一
- gate 失败可以自动分类到明确层级
- deploy verify 与 rehearsal 复用标准 gate
- evidence bundle 结构统一
- 所有关键真实链路能稳定复跑并提供一致证据
