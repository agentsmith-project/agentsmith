# ASBCP 与 AgentSmith 边界可靠性和简化收敛计划 v1

<!-- markdownlint-disable MD013 -->

状态：`handoff_ready`
日期：2026-05-19
目标读者：后续开发团队、ASBCP 内部任务执行服务运行时实现维护者、AgentSmith 部署与 Agent task 主链维护者

## 适用范围

本计划用于收敛 AgentSmith 与 ASBCP 边界、可靠性、部署心智和 release 采纳问题。它是中文 handoff 草案，不是新的产品范围说明，也不是 ASBCP 长期架构纲领。

跨 repo 责任固定如下：

| Repo | 本轮负责 | 本轮不负责 |
| --- | --- | --- |
| AgentSmith | ASBCP consumer adoption、image lock 消费、部署 wiring、existing-cluster prerequisite gate、UI/audit 产品文案映射、内部 launcher artifact 脱敏、最终 Agent task 主链验证 | ASBCP API/schema 真相、ASBCP workload 生命周期实现、ASBCP release evidence、AFSCP 文件系统能力 |
| ASBCP | API contract、workload/workspace-binding 生命周期、Kubernetes workload lifecycle implementation baseline、配置合同、release manifest、fake/real evidence 口径、release runbook | AgentSmith 产品治理、用户 UI、AI 资源策略、AgentSmith deploy 心智、AFSCP/JVS 存储实现 |
| AFSCP | 作为现有 mount plan 与文件系统能力依赖被 ASBCP 消费 | 不纳入本轮改造；除非删除/flush 语义必须新增或澄清 mount plan 合同，否则不修改 AFSCP |

术语约束：

- 普通用户 UI、普通用户文档和 audit 主视图只使用“任务执行环境”。
- “内部任务执行服务”只用于 operator/developer/runbook/诊断视图，用来解释 ASBCP 作为内部后端服务的职责。
- `ASBCP`、K8s 内部 URL、service key、secret、internal runtime raw code 不进入普通用户 UI 或 audit 主视图。

## 非目标

- 不引入大而全的 control plane、orchestrator、policy engine、multi-runtime selector 或跨 repo 治理平台。
- 不把 ASBCP 暴露成产品用户概念，不新增用户可配置的 ASBCP/K8s/JuiceFS 选项。
- 不在本轮重写 Agent task 产品对象、文件库模型、AFSCP/JVS 存储能力或 UI 信息架构。
- 不做兼容旧 ASBCP contract 的双轨适配；当前 pre-GA，允许 clean cut，但必须有硬 gate 防止误采纳。
- 不把所有 review 议题放进同一阶段。P0 只修会误判成功、误删、误采纳、泄漏 secret 或运行期硬失败的 blocker。

## 一句话目标

用最小必要改动把 ASBCP 做成可靠、可采纳、可发布的内部任务执行服务依赖，让 AgentSmith 只承担 consumer/deploy/UI-audit 心智，并降低用户、部署者和开发者的理解成本。

## 当前判断

设计方向合理的部分：

- ASBCP 独立 repo、独立 image、独立 release manifest，AgentSmith 只 pin digest 并消费，这是正确边界。
- AgentSmith 负责产品语义、任务入口、部署消费和 UI/audit 映射；ASBCP 负责 workload 生命周期实现和 API/runtime contract，这是低心智边界。
- AFSCP 只作为文件系统与 mount plan 依赖被 ASBCP 调用，不把 AFSCP/JVS 拉进本轮改造，可以避免范围蔓延。
- pre-GA 允许 contract clean cut，不必为已知漂移保留兼容分支。

必须先修的 P0 blocker：

- Workload DELETE/release 缺少 durable terminal truth，AgentSmith 可能把 ASBCP 404 或中间态误判成删除成功。
- Workspace-binding DELETE 与 workload terminal facts 不一致时，可能误删仍未 release 的存储绑定。
- Workload create 等待 Pod Ready 可能超过 HTTP write timeout，产生客户端失败但服务端继续创建的不可追踪状态。
- ASBCP API contract version 与 breaking changes adoption gate 不足，AgentSmith 可能误采纳不兼容 image。
- Existing-cluster 缺少 live prerequisite check，权限问题可能拖到 workload create 时才爆。
- Service key/token 可能写入 launcher state、报告、日志或 `.artifacts`。
- Route tail 宽松匹配可能把危险尾段误派发到 DELETE；K8s id/name/label 映射可能导致运行期失败或碰撞。

放入 P1/P2 的内容：

- Exec output cap 与一般 unknown field hardening 放 P1，除非后续证据证明已经能触发 secret 泄漏、内存耗尽或危险写操作。
- AgentSmith deploy/env/Makefile、UI/audit 文案和 projection sanitizer 放 P1。
- ASBCP 剩余 config 简化、release evidence claim 清理和历史文档口径放 P2；但 P0 如新增或改变 runtime contract/config，必须同步更新最小 schema、docs 和 tests。

## 阶段总览

| 阶段 | 优先级 | 主题 | 收口方式 |
| --- | --- | --- | --- |
| P0 | adoption/reliability blocker | DELETE durable truth、workspace-binding 安全删除、PUT ensure 快速 create、contract version adoption gate、existing-cluster live preflight、secret artifact 禁写、route 与 K8s id 边界 | ASBCP focused lifecycle/runtime implementation tests + AgentSmith adoption/deploy focused gates；阶段末再升级正式验证 |
| P1 | simplification | AgentSmith deploy/env/site env、Makefile sandbox targets、UI/audit sanitizer、exec/unknown-field 边界、operator checklist | AgentSmith unified deploy render/preflight tests + UI/i18n/audit focused tests + redaction/static guards |
| P2 | cleanup | ASBCP 剩余 config 清理、release evidence 诚实性、历史文档口径 | ASBCP quick governance check (`bash scripts/verify-release.sh --quick`) + authoritative/full ASBCP release gate (`bash scripts/verify-release.sh`) + AgentSmith docs/contract consistency checks |

## P0：采纳与可靠性 blocker

### P0-1. Workload DELETE/release durable terminal truth

| 项 | 内容 |
| --- | --- |
| 问题 | Workload DELETE 在 release、pod 删除、terminal mark/status 任一步失败后，重试可能把半完成状态误判为成功；AgentSmith 也可能把 ASBCP 404 当成删除成功。 |
| 不变量 | DELETE 成功前必须能证明三类事实：release 完成事实、pod 删除事实、terminal mark/status 事实。缺任一事实时，DELETE 不得返回成功语义。 |
| 持久化原则 | 优先复用 ASBCP 现有事实源。只有现有事实无法区分“未见过、处理中、已 release、已删除、已 terminal”时，才引入最小 ASBCP-owned durable record。不要先设计新的完整状态机，也不要规定具体状态名。 |
| 改动范围 | ASBCP DELETE 重试按 durable facts 恢复执行，不因 pod 不存在或 workload 404 单独判成功。AgentSmith 删除路径遇到 404 时必须通过 ASBCP GET/status runtime contract，或 ASBCP-owned durable terminal record 中定义的 terminal fact 语义确认，不把 404 直接映射为成功。Release manifest 只表达 contract version、breaking changes 与 adoption 语义，不作为运行期 terminal fact 来源。 |
| 具体产物 | ASBCP DELETE contract fixture；failure-injection tests 覆盖 release 失败、pod delete 失败、terminal mark 失败、DELETE 后 GET 404；AgentSmith 404 mapping test。 |
| 验收标准 | 只有 release 完成事实、pod 删除事实、terminal mark/status 事实同时成立时，ASBCP DELETE 才返回成功；任一步失败后重复 DELETE 继续执行或返回同一个未完成错误；AgentSmith 不把缺少 terminal facts 的 404 展示为删除成功。 |
| 最小测试/gate | ASBCP lifecycle unit tests；fake Kubernetes failure-injection integration；AgentSmith ASBCP 404 semantic focused test；ASBCP quick governance check (`bash scripts/verify-release.sh --quick`)。 |

### P0-2. Workspace-binding DELETE 与 workload terminal facts 一致

| 项 | 内容 |
| --- | --- |
| 问题 | Workspace-binding DELETE 如果只看 binding/PV/PVC 当前查询结果，可能误删仍有关联 workload、仍未 release 的存储绑定。 |
| 不变量 | 目标 binding 只有在 binding-scoped workload fact source/index，或等价稳定 label + durable record，证明不存在未 release workload，且相关 workload 都有 terminal facts 时，才可进入存储绑定删除。 |
| 改动范围 | ASBCP workspace-binding DELETE 先从 binding-scoped fact source/index 检查 workload terminal facts，再清理绑定资源。binding 已不存在时，只有确认无未 release workload 才返回成功。fact source 不可用、权限缺失、PV/PVC 清理失败或 terminal facts 不完整时 fail closed，返回可重试错误；不能只看当前 Pod/PV/PVC 查询结果决定成功。 |
| 具体产物 | Workspace-binding DELETE contract fixture；binding-scoped fact source/index fixture；active/unreleased workload fixture；PV/PVC cleanup failure fixture；fact source unavailable fail-closed fixture；retry idempotency tests。 |
| 验收标准 | 有未 release workload 或 fact source 不可用时不删除存储绑定、不返回成功；第一次删除成功后第二次删除成功且无副作用；清理中断后重试继续；权限缺失错误只面向 operator/developer 诊断。 |
| 最小测试/gate | ASBCP binding lifecycle unit tests；fake K8s PV/PVC cleanup failure tests；workspace-binding DELETE contract check；ASBCP quick governance check (`bash scripts/verify-release.sh --quick`)。 |

### P0-3. Workload create 使用 PUT ensure 快速返回

| 项 | 内容 |
| --- | --- |
| 问题 | Workload create 同步等待 Pod Ready 可能超过 HTTP write timeout，导致客户端超时但服务端继续创建，AgentSmith 无法可靠追踪。 |
| 合同方向 | 保留 `PUT ensure` 语义，不改成 POST。PUT 只做幂等 ensure、最小同步校验和快速返回，不长等 Pod Ready。 |
| 改动范围 | ASBCP PUT ensure response 必须在 write timeout 前返回可追踪 `workload_id`、operation/correlation id 和文档化状态，例如 `pending`、`running`、`offline`、`failed`。Pod Ready 通过 GET workload poll 确认。AgentSmith create path 改为按 GET poll 追踪，不把 PUT timeout 当最终业务失败。 |
| 具体产物 | ASBCP OpenAPI PUT ensure contract fixture；slow Pod Ready fake test；AgentSmith GET poll adoption test；timeout bound test 明确 handler 上限小于 server write timeout。 |
| 验收标准 | PUT ensure 不等待超过 HTTP write timeout；每个成功 response 都有可追踪 id 和状态；服务端不会创建无 workload id 的孤儿 Pod；Pod 慢时 AgentSmith 能显示“任务执行环境准备中”并继续 GET poll。 |
| 最小测试/gate | ASBCP create timeout unit/integration tests；slow Pod Ready fake test；AgentSmith Agent task backend-real focused smoke；ASBCP API contract fixture。 |

### P0-4. API contract version 与 breaking changes adoption gate

| 项 | 内容 |
| --- | --- |
| 问题 | ASBCP API contract 与实现可能漂移；AgentSmith 只更新 image digest 时可能误采纳 breaking change。 |
| 真相源 | `api_contract_version` 真相只在 ASBCP 权威 release asset `asbcp-final-manifest.json`。`infra/deploy/shared/asbcp-image.lock` 只 pin image identity，不作为 contract version 真相。 |
| 改动范围 | ASBCP release manifest 必须生成/发布权威 release asset `asbcp-final-manifest.json`，包含 `api_contract_version`、breaking changes 列表、image digest、tag、commit、manifest schema version。AgentSmith adoption gate 当前必须显式读取权威 manifest：`npm run contracts:check-asbcp-manifest-lock -- --manifest <downloaded-asbcp-final-manifest.json>`，或 `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`。无 manifest input 时 `contracts:check-asbcp-adoption` 必须失败；checked-in fixture 只能作为 checker unit fixture，不能作为 adoption proof。Checker 校验 supported versions、breaking change ID allowlist、allowlist expiry、digest/tag/commit 自洽；summary 保留为非空说明，不作为脆弱 exact-match 门禁；过期 allowlist 或未知 breaking change ID 必须失败。Lock adoption PR 必须把 lock 与权威 manifest 作为同一采纳单元，lock-only 更新直接失败。当前 `npm run contracts:check` 只覆盖通用合同和 ASBCP image-only lock 形状，不提供 ASBCP release adoption proof。 |
| 具体产物 | ASBCP `asbcp-final-manifest.json` JSON schema；AgentSmith manifest checker unit fixture；stable manifest input 或 official `asbcp-final-manifest.json` release asset；supported-version allowlist 文件或常量；expiry test；lock update test。 |
| 验收标准 | ASBCP handler payload 与 OpenAPI/schema 一致；AgentSmith 不能只改 lock digest 跳过 manifest checker；unsupported `api_contract_version`、未知 breaking change、过期 allowlist、digest mismatch、缺失 manifest input 或 `asbcp-final-manifest.json` release asset 校验失败都让 adoption gate 失败。 |
| 最小测试/gate | ASBCP OpenAPI/schema conformance tests；release manifest schema tests；AgentSmith manifest checker focused diagnostic（当前显式命令：`ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`，或 `npm run contracts:check-asbcp-manifest-lock -- --manifest <path>`）；checker unit fixtures；`npm run contracts:check-openapi`、`npm run openapi:check-generated`。 |

### P0-5. Existing-cluster 只做 live prerequisite check

| 项 | 内容 |
| --- | --- |
| 问题 | Existing-cluster profile 如果把 ASBCP 所需集群权限留到运行期才发现，会让 workload create 失败且排障成本高。 |
| 边界 | AgentSmith 不把 ASBCP ClusterRole 塞进 app manifest。Existing-cluster 只检查 operator 是否已完成前置准备。 |
| 改动范围 | AgentSmith deploy preflight 使用 `kubectl auth can-i` 或 SelfSubjectAccessReview 检查 ASBCP ServiceAccount 的 namespace 权限、PV/PVC 所需权限、Secret 可读投影、`ASBCP_AFSCP_*` env/Secret 投影、AFSCP allowed caller、orchestrator token、`orchestrator_mount` 角色和 no-public-ingress 前置条件。ASBCP repo 维护 Kubernetes workload lifecycle 最小 RBAC/Secret/AFSCP caller 需求文档或可机读清单。 |
| 具体产物 | Existing-cluster preflight script/fixture；missing-RBAC fixture；missing `ASBCP_AFSCP_*` projection fixture；AFSCP allowed caller / orchestrator token / `orchestrator_mount` role fixture；SelfSubjectAccessReview 或 `kubectl auth can-i` 输出解析 test；operator-only runbook 链接。 |
| 验收标准 | 缺 PV/PVC、namespace 权限、`ASBCP_AFSCP_*` 投影、AFSCP caller、orchestrator token 或 `orchestrator_mount` 角色时，deploy/preflight 阶段失败；AgentSmith app manifest 不新增 ASBCP ClusterRole；错误信息面向 operator，输出必须脱敏，普通用户 UI 不出现 ASBCP/RBAC/secret 细节。 |
| 最小测试/gate | AgentSmith unified deploy render/preflight tests；existing-cluster missing-RBAC fixture；K8s dry-run focused diagnostic；阶段收口按风险运行 `npm run verify -- --goal=real --run`。 |

### P0-6. Service key/token artifact 禁写

| 项 | 内容 |
| --- | --- |
| 问题 | Service key/token 可能被写入 state、launcher env/log、backend-real/local-real reports 或 `.artifacts`。 |
| 禁写对象 | `run-integration-release-user-story.sh` state；`internal-sandbox-real-control.sh` launcher env/log；backend-real/local-real reports；用户可见 `.artifacts`；失败摘要；JSON copy/export 产物。 |
| 改动范围 | AgentSmith 只允许保存非敏感 release identity，例如 image digest、contract version、runtime diagnostic code、correlation id、namespace、host。Service key/token 只能来自请求级 env、ignored secret env、K8s Secret 或只读 managed credential 投影，不写入 HOME、workspace、report、JSON state、日志摘要。ASBCP service logs/error envelope 不回显 key。 |
| 具体产物 | Focused grep/redaction tests 覆盖上述真实路径/对象；fixture 中注入假 token 并断言输出只含 redacted fingerprint；ASBCP error envelope redaction test。 |
| 验收标准 | 任何成功、失败、debug、导出路径都不包含 service key/token 原值；secret 缺失或不匹配时错误不泄漏 secret；需要定位时只显示固定格式 redacted fingerprint。 |
| 最小测试/gate | AgentSmith artifact redaction tests；secret grep guard over reports/artifacts fixtures；ASBCP log/error redaction tests；focused backend-real launcher smoke。 |

### P0-7. Route tail 与 K8s id/name/label 边界

| 项 | 内容 |
| --- | --- |
| 问题 | Route tail 宽松匹配可能把 `/workloads/{id}/extra` 误派发到 workload DELETE；workspace/project id 到 K8s name/label 的映射可能因非法字符、长度或碰撞导致运行期失败。 |
| 改动范围 | ASBCP router 严格匹配路径和方法，危险尾段返回 404 或 405，不能命中 DELETE handler。ASBCP 定义单一 K8s name/label/annotation 映射函数：稳定、可回查、长度受限、非法字符处理明确、碰撞使用 hash suffix。AgentSmith 继续在 URL 层使用 `validateWorkspaceParam()` / `validateProjectParam()`，不把 K8s name 暴露给产品面。 |
| 具体产物 | Router table tests；dangerous tail DELETE fixture；id mapping table/property tests；collision fixture；K8s label/name length tests。 |
| 验收标准 | 多余尾段不触发 DELETE；所有合法 AgentSmith workspace/project id 都得到稳定且不碰撞的 K8s identity；非法或超长输入返回明确错误或稳定 hash 映射，不在运行期由 Kubernetes 拒绝。 |
| 最小测试/gate | ASBCP router tests；id mapping tests；AgentSmith URL validation focused tests；ASBCP quick governance check (`bash scripts/verify-release.sh --quick`)。 |

### P0 本阶段不做

- 不实现新的完整删除状态机，不规定具体状态名，不引入消息队列或跨 repo 分布式事务。
- 不把 create 从 `PUT ensure` 改成 POST，不保留长等 Pod Ready 的同步合同。
- 不把 ClusterRole 写进 AgentSmith app manifest。
- 不做 AgentSmith UI 视觉改版，不新增用户可见 ASBCP 设置页。
- 不把 exec output cap、一般 unknown field rejection、Makefile sandbox target 下沉作为 P0 blocker，除非出现明确高危证据。
- 不等 P2 才更新 P0 涉及的 config/schema/docs/tests；P0 只更新本阶段新增或改变的最小 runtime contract/config。

### P0 阶段通过标准

- ASBCP DELETE 成功必须有 release 完成事实、pod 删除事实、terminal mark/status 事实；AgentSmith 404 语义只能通过 ASBCP GET/status runtime contract 或 ASBCP-owned durable terminal record 确认，不能误判成功。
- Workspace-binding DELETE 必须依赖 binding-scoped workload fact source/index，或等价稳定 label + durable record；存在未 release workload 或 fact source 不可用时不删除存储绑定。
- PUT ensure 在 write timeout 前返回可追踪状态，AgentSmith 使用 GET poll。
- ASBCP 权威 release asset `asbcp-final-manifest.json` 提供 `api_contract_version` 和 breaking changes；AgentSmith 当前通过 `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`，或 `npm run contracts:check-asbcp-manifest-lock -- --manifest <path>` 稳定读取 manifest input，checker 有 supported versions、breaking change ID allowlist、expiry 和 image identity 规则，lock-only 更新失败；checked-in fixtures 不作为 adoption proof。
- Existing-cluster preflight 用 live check 在部署前发现缺权限、缺 `ASBCP_AFSCP_*` 投影、AFSCP caller、orchestrator token 或 `orchestrator_mount` 角色问题，输出脱敏，AgentSmith app manifest 不包含 ASBCP ClusterRole。
- Focused grep/redaction tests 证明 service key/token 不写入指定 state、log、report、`.artifacts`。
- Route tail 和 K8s id/name/label mapping 有 fixture 或 table/property tests。

## P1：AgentSmith 心智简化与安全展示

### P1-1. Site env、deploy render 和 image lock 迁移落点

| 项 | 内容 |
| --- | --- |
| 问题 | AgentSmith 部署/env 暴露 ASBCP image、service key、K8s/JuiceFS 细节，普通部署者心智成本高。 |
| 改动范围 | Render 在 `ASBCP_IMAGE` 未显式给出时，从 `infra/deploy/shared/asbcp-image.lock` 派生 image digest。Tracked `site.env.example` 不再要求 `ASBCP_SERVICE_KEY` 明文。Secret 进入 ignored secret env，或由部署流程生成/注入 K8s Secret。 |
| 具体产物 | Lock parser/render test；`site.env.example` static guard；ignored secret env 文档；K8s Secret injection render fixture；tag-only image rejection test。 |
| 验收标准 | 普通 deploy 文档不要求手填 ASBCP image mutable tag 或 service key；未设置 `ASBCP_IMAGE` 时 render 使用 lock digest；tracked env example 不出现 `ASBCP_SERVICE_KEY=` 示例值；AgentSmith 不 build ASBCP 源码。 |
| 最小测试/gate | AgentSmith lock parser/image producer tests；unified deploy render tests；site env example guard；old source build path guard。 |

### P1-2. Makefile sandbox targets 下沉

| 项 | 内容 |
| --- | --- |
| 问题 | `sandbox-preflight`、`sandbox-api-dev`、`sandbox-joint-smoke` 容易被当作普通开发入口，放大 ASBCP/K8s 内部心智。 |
| 改动范围 | 这些 target 从普通开发入口、README、DEVELOPMENT 和复制型文档中下沉为 owner diagnostics，或迁移到 internal scripts。不要新增新的公共命令家族。 |
| 具体产物 | Make help/current workflow surface 更新；docs static guard；owner diagnostic runbook；如迁移脚本，保留旧 target 的 owner-only 提示或移除引用。 |
| 验收标准 | 普通开发文档不推荐 sandbox target；owner runbook 仍能定位对应 diagnostics；新增入口不超过现有 public command family。 |
| 最小测试/gate | `npm run contracts:check-doc-governance`；current workflow check；Make help/docs reference guard。 |

### P1-3. Audit/UI projection sanitizer

| 项 | 内容 |
| --- | --- |
| 问题 | Audit/UI 可能直接展示 ASBCP/internal URL/internal runtime raw code，增加普通用户心智负担并泄漏内部实现。 |
| 改动范围 | Audit table、detail drawer、JSON copy/export 全部经过统一 projection sanitizer。普通用户只看到“任务执行环境”相关文案。维护者诊断视图允许显示非敏感 release identity，例如 digest、runtime diagnostic code、correlation id；普通用户不显示 ASBCP、internal URL、secret、K8s name。 |
| 具体产物 | Projection sanitizer function；audit table fixture；detail drawer fixture；JSON copy/export fixture；i18n forbidden terminology guard。 |
| 验收标准 | 普通用户 UI、audit 主视图和 JSON export 不出现 `ASBCP`、internal URL、service key、secret、K8s name；维护者诊断视图有 correlation id 和 runtime diagnostic code 可用于排障；所有文案纳入 next-intl。 |
| 最小测试/gate | AgentSmith i18n key tests；audit payload mapping tests；focused UI tests 或 affected visual scenario；forbidden terminology static guard。 |

### P1-4. Exec output cap 与 unknown field hardening

| 项 | 内容 |
| --- | --- |
| 问题 | Exec 输出无界和一般 unknown field 宽松解析会增加排障与安全风险，但当前不作为 P0 blocker。 |
| 改动范围 | ASBCP exec response 设置 stdout/stderr 单次与总量上限、截断标记和 timeout。JSON decoder 对对外 API 开启 unknown field rejection，并补齐 error envelope fixture。 |
| 具体产物 | Exec output bound tests；truncation marker fixture；unknown field rejection fixture；error envelope contract test。 |
| 验收标准 | 大输出不会撑爆内存、日志或 response；截断结果带固定字段；payload 多余字段返回文档化 4xx error；AgentSmith 不把 ASBCP raw error 直接展示给普通用户。 |
| 最小测试/gate | ASBCP exec output bound tests；strict JSON decoder tests；AgentSmith ASBCP error mapping tests。 |

### P1-5. Existing-cluster operator checklist 收敛

| 项 | 内容 |
| --- | --- |
| 问题 | P0 有 live preflight 后，operator 仍可能需要在多个文档中拼 namespace、Secret、PV 权限和 no-public-ingress 前置条件。 |
| 改动范围 | AgentSmith 保留一个 existing-cluster operator checklist，说明需要预装什么、如何 dry-run、缺什么会失败。ASBCP repo 提供 Kubernetes workload lifecycle baseline 清单；AgentSmith 文档只链接并消费，不复制全部 Kubernetes workload lifecycle 配置。 |
| 具体产物 | Operator checklist；preflight command 示例；失败输出到 runbook 的链接；docs link guard。 |
| 验收标准 | Operator 按一个 checklist 可完成前置准备；失败输出指向同一个 runbook；普通用户文档不出现 ASBCP 作为产品概念。 |
| 最小测试/gate | Docs contract check；existing-cluster preflight fixture；unified deploy dry-run；operator runbook link guard。 |

### P1 本阶段不做

- 不新增 drift guard 长期治理线；相关检查只并入 P0 adoption gate、P0/P1 deploy preflight 和 render tests。
- 不新增公共 Makefile 命令家族。
- 不改变 ASBCP API contract 主语义，除 P1-4 的边界 hardening。
- 不把维护者诊断视图扩展成普通用户功能。

### P1 阶段通过标准

- `ASBCP_IMAGE` 未显式设置时，render 从 `infra/deploy/shared/asbcp-image.lock` 派生。
- Tracked `site.env.example` 不要求或示例化 `ASBCP_SERVICE_KEY` 明文。
- `sandbox-preflight`、`sandbox-api-dev`、`sandbox-joint-smoke` 不再作为普通开发入口出现。
- Audit table、detail drawer、JSON copy/export 均通过同一个 projection sanitizer。
- 普通用户 UI/audit 主视图只使用“任务执行环境”；维护者诊断视图只显示非敏感 release identity。
- Exec output cap、unknown field rejection 和 ASBCP error mapping 有 fixture 或 focused tests。

## P2：剩余配置和 release 治理 cleanup

### P2-1. ASBCP 剩余 config cleanup

| 项 | 内容 |
| --- | --- |
| 问题 | ASBCP config docs 与 implementation 可能仍有历史 alias、过度开关或未被测试覆盖的配置项。 |
| P0 约束 | 如果 P0 新增或改变 runtime contract/config，P0 同步更新最小 schema、docs 和 tests；P2 只处理剩余简化和治理诚实性 cleanup。 |
| 改动范围 | ASBCP 定义最小 config contract：必需 runtime inputs、可选 tuning、内部常量。删除 pre-GA 不需要兼容的旧 env alias 和过度开关。AgentSmith 只暴露 consumer 必需输入，不复制 ASBCP config 全量说明。 |
| 具体产物 | Config schema/table；docs-vs-config guard；old env alias forbidden guard；AgentSmith public env example guard。 |
| 验收标准 | ASBCP docs 中列出的每个配置都被实现读取或明确废弃；实现读取的每个外部配置都在 docs/schema 中；旧 env alias 被删除或进入历史 allowlist；local-kind 和 existing-cluster 最小路径有默认值或明确必填项。 |
| 最小测试/gate | ASBCP config schema tests；docs-vs-config guard；old env alias forbidden guard；AgentSmith public env example guard。 |

### P2-2. ASBCP release evidence 诚实性

| 项 | 内容 |
| --- | --- |
| 问题 | Fake fixture、image identity、runtime behavior、release readiness 的证明边界可能写混，导致 release claim 不诚实。 |
| 改动范围 | ASBCP 保留一个 authoritative/full release gate (`bash scripts/verify-release.sh`) 和权威 release asset `asbcp-final-manifest.json`。Fake fixture 只能证明 contract behavior，不宣称真实 K8s/runtime 已验证。Image digest proof 只证明发布身份，不证明容器行为。真实 release claim 只能来自实际运行过的 gate。 |
| 具体产物 | `asbcp-final-manifest.json` schema；release notes claim checklist；evidence type allowlist；release workflow static test。 |
| 验收标准 | Release notes、manifest、readiness docs 对每类 evidence 的 claim 一致；fake evidence 不写成真实运行证明；authoritative/full ASBCP release gate (`bash scripts/verify-release.sh`) 失败项阻塞发布，不降级为 warning；AgentSmith 只消费 final manifest，不维护 ASBCP release implementation 细节。 |
| 最小测试/gate | ASBCP release workflow static tests；final manifest schema tests；evidence claim consistency tests；ASBCP quick governance check (`bash scripts/verify-release.sh --quick`) 和 authoritative/full ASBCP release gate (`bash scripts/verify-release.sh`)。 |

### P2-3. 文档和历史口径清理

| 项 | 内容 |
| --- | --- |
| 问题 | AgentSmith 与 ASBCP 迁移文档中可能残留旧名、过期配置、过度治理说明或把 ASBCP 写成产品对象的表达。 |
| 改动范围 | AgentSmith active truth 收敛到合同、deploy runbook 和本计划引用的少量 handoff 文档；历史计划只保留 exact allowlist。ASBCP 同步清理旧 config/docs/release 口径。 |
| 具体产物 | Active docs allowlist；historical docs allowlist；forbidden terminology guard；docs link check。 |
| 验收标准 | Active docs 指向一致；旧名只出现在明确历史文档 allowlist；产品面 docs 不出现 ASBCP 作为用户概念；developer/operator docs 首次出现 ASBCP 时说明它是内部任务执行服务。 |
| 最小测试/gate | Docs link check；forbidden terminology guard；AgentSmith `npm run contracts:check`；ASBCP docs/config guard。 |

### P2 本阶段不做

- 不把 P2 cleanup 变成当前 P0/P1 交付阻塞。
- 不新增 ASBCP 长期治理平台、release dashboard 或跨 repo policy engine。
- 不用 fake fixture 补真实集群验证缺口。
- 不重构 AFSCP/JVS。

### P2 阶段通过标准

- ASBCP config docs/schema/implementation 一致，旧 alias 和过度开关已清理或进入历史 allowlist。
- Release manifest、release notes、readiness docs 的 evidence claim 与实际执行 gate 一致。
- AgentSmith active docs 不把 ASBCP 写成普通用户概念。
- P2 仅当当前 release claim 不诚实、或 active docs 会误导发布/采纳决策时阻塞发布。

## 推荐执行顺序和风险控制

1. 先在 ASBCP repo 建 P0 failing tests，覆盖 DELETE durable facts、workspace-binding DELETE、PUT ensure timeout、route tail、K8s id mapping 和 contract manifest。
2. 修 ASBCP P0 runtime implementation 行为，发布包含 `api_contract_version`、breaking changes、digest、tag、commit 和 manifest schema version 的权威 release asset `asbcp-final-manifest.json`。
3. AgentSmith 更新 adoption checker 和 `asbcp-image.lock` 消费路径，lock adoption PR 同步提供 `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption` 可稳定读取的 manifest input，或显式运行 `npm run contracts:check-asbcp-manifest-lock -- --manifest <path>`；先让缺失 manifest input 或 contract mismatch 明确失败，再采纳新 ASBCP release。
4. P0 结束后再做 AgentSmith deploy/env/UI-audit 简化，避免 API/runtime contract 未稳定前改 operator 心智。
5. P1 完成并跑过 focused deploy/UI/audit 证据后，再做 ASBCP 剩余 config 和 release evidence cleanup。
6. 每个阶段先跑最小相关 focused diagnostics；阶段收口、跨 repo lock 更新、发布候选或部署前再升级到 `npm run verify -- --goal=real --run`、`npm run release:ready` 或 authoritative/full ASBCP release gate (`bash scripts/verify-release.sh`)。

风险控制要求：

- 任何“删除成功”“释放完成”“采纳成功”“发布成功”的结论必须有对应事实，不允许靠 best effort 日志或 warning。
- 所有 secret 只允许请求级 env、ignored secret env、K8s Secret 或只读 managed credential 投影，不写入可持久化 artifact。
- 所有用户可见失败都先经过 AgentSmith 产品语义映射；内部 runtime diagnostic code 只进入维护者诊断。
- 跨 repo 改动采用先 ASBCP release、再 AgentSmith lock/adoption 的顺序，不同时修改两个 repo 后直接宣布完成。

## Definition of Done

P0 adoption/reliability DoD：

- ASBCP workload DELETE 和 workspace-binding DELETE 在故障注入与重试场景下不误判成功、不误删未 release 存储绑定；workspace-binding DELETE 的 binding-scoped fact source/index 不可用时 fail closed。
- ASBCP PUT ensure 不超过 HTTP write timeout 长等 Pod Ready，AgentSmith 能按 GET poll 追踪 pending/running/offline/failed 等状态。
- ASBCP route tail 和 K8s id/name/label mapping 有硬边界和测试。
- ASBCP 权威 release asset `asbcp-final-manifest.json` 提供 API contract version 与 breaking changes；AgentSmith adoption checker 当前通过 `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`，或 `npm run contracts:check-asbcp-manifest-lock -- --manifest <path>` 校验 stable manifest input、supported versions、breaking change ID allowlist、expiry 和 image identity，lock-only 更新不能绕过，checked-in fixtures 不能代表采纳事实。
- AgentSmith existing-cluster 在缺少 PV/RBAC/operator prerequisite、`ASBCP_AFSCP_*` 投影、AFSCP caller、orchestrator token 或 `orchestrator_mount` 角色时部署前失败，输出脱敏，且 app manifest 不包含 ASBCP ClusterRole。
- AgentSmith launcher state、reports、logs、`.artifacts` 不保存 service key/token。
- P0 涉及的新 runtime contract/config 已同步最小 schema、docs 和 tests。

P1 simplification DoD：

- AgentSmith deploy render 在 `ASBCP_IMAGE` 未显式给出时从 `infra/deploy/shared/asbcp-image.lock` 派生。
- Tracked `site.env.example` 不要求 `ASBCP_SERVICE_KEY` 明文；secret 进入 ignored secret env 或由部署流程生成/注入 K8s Secret。
- `sandbox-preflight`、`sandbox-api-dev`、`sandbox-joint-smoke` 已下沉为 owner diagnostics 或迁移到 internal scripts。
- Audit table、detail drawer、JSON copy/export 经过统一 projection sanitizer。
- 普通用户 UI/audit 主视图只使用“任务执行环境”，不暴露 ASBCP、internal URL、secret 或 K8s identity。
- Exec output cap、unknown field rejection 和 ASBCP error mapping 有 focused tests。

P2 cleanup DoD：

- ASBCP config docs/schema/implementation 一致，过度配置和旧 alias 已清理或进入历史 allowlist。
- ASBCP release evidence claim 与实际 gate 匹配，fake fixture、image identity 和真实 runtime behavior 的边界清楚。
- AgentSmith 与 ASBCP active docs 不把 ASBCP 写成普通用户概念。
- AFSCP 未被纳入本轮改造，除非有单独记录的最小 mount plan contract 必要变更。
- P2 不阻塞当前交付；只有当前 release claim 不诚实或 active docs 会误导发布/采纳决策时，P2 才阻塞发布。

## Appendix：主题覆盖映射

| 主题 | 来源 | Owner repo | 阶段 |
| --- | --- | --- | --- |
| Workload DELETE runtime terminal facts 与 AgentSmith 404 语义 | Delete/release reliability review | ASBCP + AgentSmith | P0 |
| Workspace-binding DELETE 与 binding-scoped workload terminal facts 一致 | Storage binding lifecycle review | ASBCP | P0 |
| PUT ensure 快速返回与 GET poll | Create timeout review | ASBCP + AgentSmith | P0 |
| API contract version、manifest input 与 breaking changes adoption gate | Contract adoption review | ASBCP + AgentSmith | P0 |
| Existing-cluster AFSCP/orchestrator live prerequisite check | Deploy reliability review | AgentSmith + ASBCP | P0 |
| Service key/token artifact 禁写 | Secret handling review | AgentSmith + ASBCP | P0 |
| Route tail 与 K8s id/name/label 映射 | Input boundary review | ASBCP + AgentSmith | P0 |
| Site env、image lock 与 secret 注入 | Deploy simplification review | AgentSmith | P1 |
| Makefile sandbox targets 下沉 | Developer workflow review | AgentSmith | P1 |
| Audit/UI projection sanitizer | Product terminology and audit review | AgentSmith | P1 |
| Exec output cap 与 unknown field hardening | API hardening review | ASBCP + AgentSmith | P1 |
| Existing-cluster operator checklist | Operator experience review | AgentSmith + ASBCP | P1 |
| Config docs/implementation cleanup | Config simplification review | ASBCP + AgentSmith | P2 |
| Release evidence 诚实性 | Release governance review | ASBCP + AgentSmith | P2 |
| 历史文档口径清理 | Documentation review | AgentSmith + ASBCP | P2 |
