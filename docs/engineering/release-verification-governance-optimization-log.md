# Release Verification Governance Optimization Log

更新时间：2026-05-13
状态：`active_work_log`

这份日志记录本轮测试、gate、发布和部署验证过程中暴露出的治理问题、耗时浪费点和边界不清问题。它不是最终优化方案；等本轮测试发布工作完成后，再基于这些记录整理测试/gate/发布治理优化计划。

## 记录原则

- 记录真实发生的问题，不因为最终 gate 通过而抹掉过程中的浪费和不合理处。
- 区分产品/业务缺陷、测试编排缺陷、部署 bootstrap 缺陷和临时环境冲突。
- 不把 workaround 当成解决方案；需要后续结构性修正的，明确写出治理方向。
- 后续继续测试和部署时，发现新问题随时追加。

## 已发现问题

### 1. backend-real / release gate 重复启动 integration deps

现象：

- `gate:release` 内多次执行 `npm run integration:deps:up`。
- 外层 gate 已启动依赖后，内层 `run-integration-e2e-full.sh` 仍重复启动依赖。
- 每次还伴随固定 `25s` wait，即使服务已经 healthy。

影响：

- 大量时间浪费在重复 docker compose up、health wait、Postgres/Keycloak init。
- release gate 日志噪音很大，真实失败信号被淹没。

根因线索：

- gate 编排缺少“依赖已就绪”的运行时 truth。
- 子 lane 不信任父 lane 已准备的依赖状态。
- 固定 sleep 没有被服务 readiness / evidence reuse 替代。

后续治理方向：

- 建立 integration deps readiness evidence，并允许同一 verification campaign 内复用。
- 子 lane 接受父 lane 传入的 `deps_ready` / `skip_deps_bootstrap` 之类受控状态。
- 用健康检查和超时轮询替代固定 sleep。

当前状态：

- 未修正。已确认是主要耗时来源之一。

### 2. 同一 release gate 内重复构建和加载 runner / CSI images

现象：

- 同一次 `gate:release` 中，runner image 多次 build。
- CSI images 多次加载到同一个 kind cluster。
- internal agent-task workspace gate、runner shards、visual review、release user story 各自重复准备相似 runtime。

影响：

- Docker build/cache 检查和 kind image import 累积耗时明显。
- gate 流程体感慢，且重复准备步骤增加不稳定面。

根因线索：

- 各 lane 自己拥有 runtime bootstrap，缺少 campaign 级 runtime/image readiness truth。
- 没有明确区分“需要重新构建验证”和“可以复用已验证镜像”的阶段。

后续治理方向：

- 在同一 release campaign 内记录 runner image digest、CSI readiness 和 kind import evidence。
- 后续 lane 只在输入变化或 evidence 失效时重新 build/load。
- 将 runtime bootstrap 从每条 lane 内部收敛为共享、可验证、可复用的 producer。

当前状态：

- 未修正。已确认是主要耗时来源之一。

### 3. backend-real visual review 很重，应只在收口阶段运行

现象：

- `backend-real visual review` 两条真实视觉场景耗时约 5.9 分钟。
- 它会启动真实 managed sandbox、AFSCP runtime、Web/API，并访问多条真实页面。

影响：

- 如果每次小改动都跑，会严重拖慢开发反馈。
- visual review 与 full visual catalog 都属于重型证据，不适合每个小修正后重复跑。

根因线索：

- 过去治理倾向“多跑重门禁”，没有严格把 heavy evidence 放到阶段收口。

后续治理方向：

- 保持 AGENTS.md 中的新原则：小改动先 focused tests，阶段收口再跑 real/visual/release gate。
- release campaign 内避免重复运行 full visual 和 backend-real visual review。

当前状态：

- 原则已记录到 AGENTS.md；编排层仍需继续收敛。

### 4. substrate deploy lane 与 integration deps 端口冲突

现象：

- `lane:unified-deploy:substrate` 首次失败。
- 失败原因是 unified substrate MongoDB 需要绑定 `27027`，但 `mbos-mongo` integration deps 仍占用该端口。

影响：

- 部署 lane 失败不是业务部署能力问题，而是前序 gate 残留和端口预检缺失。
- 容易误判为 substrate 部署失败。

根因线索：

- release gate 后没有统一清理 integration deps。
- substrate lane reset 前没有检测端口 owner，也没有给出“先停止 integration deps”的结构化诊断。

后续治理方向：

- substrate lifecycle reset 前做端口 owner preflight。
- 当端口被 `mbos-*` integration deps 占用时，输出明确的治理诊断和推荐命令。
- release/deploy campaign 切换阶段应有统一 cleanup step。

当前状态：

- 已手动执行 `npm run integration:deps:down` 后重跑，`lane:unified-deploy:substrate` 通过。
- 结构化脚本增强未完成。

### 5. local-kind app image Dockerfile 存在过时 COPY 路径

现象：

- `lane:unified-deploy:local-kind:images` 失败。
- `Dockerfile.agentsmith-app` 执行 `COPY messages ./messages`，但仓库根目录已没有 `messages/`。
- 当前 i18n 文件位于 `src/messages/`。

影响：

- unit/render/dry-run 都未捕获 Dockerfile COPY 源路径过时问题。
- 直到真实 image build 才暴露，浪费较多部署验证时间。

根因线索：

- 缺少 Dockerfile build-context contract test。
- Dockerfile 与 Next app 目录演进没有被测试守住。

后续治理方向：

- 增加 focused test：解析 `Dockerfile.agentsmith-app` 的 `COPY` source path，并验证源路径存在。
- 修正过时 COPY 路径，并检查其他 Dockerfile 是否有同类风险。

当前状态：

- 已交给 subagent 深挖和修复中。

### 6. verification report 直接运行时缺少前置 evidence

现象：

- `test:unified-deploy:verification-report` 在 local-kind smoke/product-flow evidence 尚未生成前运行会失败。
- 报告显示缺少 existing-cluster/local-kind smoke evidence 和各 product focused evidence。

影响：

- 这是正确的阻断，但直接运行时用户心智不够清晰：它依赖前置 lane，而不是独立 smoke。

根因线索：

- verification report 是 aggregator，却容易被当成 standalone check。

后续治理方向：

- 文档和 CLI 输出中明确它是 evidence aggregator。
- 当缺少 evidence 时，给出下一步应运行的 lane 名称。

当前状态：

- 未修正。当前按正确顺序继续跑 unified deploy lanes。

### 7. JVS 边界曾在文档中过度暴露

现象：

- AgentSmith 产品/业务逻辑不应直接感知或调用 JVS；统一部署只按 AFSCP deployment contract 声明 AFSCP runtime 需要的 env/volume。
- 但工程计划文档曾把 JVS 写成 AgentSmith 的里程碑、gate 或验收对象，并一度把部署 contract 与业务边界混在一起。

影响：

- 容易误导后续开发，把 AFSCP 内部实现细节扩散到 AgentSmith 产品/业务心智；部署层也容易被误读为拥有 JVS 生命周期。

根因线索：

- AFSCP/JVS 是 sibling project，计划文档没有清晰区分上游实现证据和 AgentSmith 业务边界。

后续治理方向：

- AgentSmith 只消费 AFSCP API、AFSCP image/release evidence 和 redacted operation projection。
- AgentSmith 部署模板只声明 AFSCP contract 要求的 runtime env/volume；JVS 生命周期和内部语义仍由 AFSCP 负责。
- JVS 下载只允许作为 local-real AFSCP sibling runtime bootstrap 细节。
- 中长期由 AFSCP image/release 自带并校验 JVS。

当前状态：

- 已修正文档和 guard。
- 已通过 `scripts/afscp-jvs-boundary-guard.test.ts` 与 doc governance focused test。

### 8. AFSCP mount policy 字段契约曾与 AgentSmith 不一致

现象：

- release user story 曾失败为 `PROJECT_STORAGE_BLOCKED`。
- 根因是 AFSCP 仍要求旧字段 `workload_mount_requires_jvs_external_control_root`，而 AgentSmith 已按新边界发送通用字段。

影响：

- 项目文件存储 bootstrap 被 AFSCP 拒绝，导致 task workspace 初始化失败。

根因线索：

- AgentSmith 与 AFSCP sibling repo 的 schema/handler/test 没有同步演进。
- 旧字段名泄漏了 JVS 实现细节。

后续治理方向：

- sibling contract change 必须同步跑 AFSCP focused Go tests 和 AgentSmith AFSCP client/bootstrap tests。
- AFSCP 对外字段保持 storage-control 语义，不泄漏内部工具名。

当前状态：

- 已修正 AFSCP 和 AgentSmith 双边契约。
- release user story 和 `gate:release` 已通过。

### 9. next-intl timeZone fallback warning 暴露在 real visual 日志中

现象：

- backend-real visual review 期间，workspace login 页面日志出现 `ENVIRONMENT_FALLBACK: There is no timeZone configured`。
- 页面返回 200，没有阻断本次 gate。

影响：

- 当前不是发布阻断，但可能造成 SSR/CSR markup mismatch 风险。

根因线索：

- next-intl 全局 timeZone 配置缺失或 real visual 环境未注入。

后续治理方向：

- 评估是否在全局 i18n 配置设置默认 timeZone。
- 如果已有约定，补一个 focused test 或 runtime config check。

当前状态：

- 未修正。记录为非阻断治理债务。

### 10. gate 通过后仍可能留下环境残留影响下一阶段

现象：

- `gate:release` 通过后，integration deps 仍占用端口，影响 substrate deploy lane。
- 部分 AFSCP/local runtime 会自行清理，但 docker compose deps 与端口状态没有 campaign-level closure。

影响：

- 阶段之间互相污染。
- 后续部署测试可能因为残留失败，而不是代码失败。

根因线索：

- Operational closure 不完整，缺少“阶段完成后环境状态”检查。

后续治理方向：

- 每个重 gate 完成后输出 environment closure evidence。
- deploy lane 启动前统一端口和容器 owner preflight。
- 对必须保留的环境和必须清理的环境做显式区分。

当前状态：

- 未修正。本次已手动清理 integration deps 后继续。

### 11. local-kind AFSCP pod 使用了不被 JuiceFS CSI 支持的 inline ephemeral volume

现象：

- `lane:unified-deploy:local-kind` 失败在 `rollout:afscp-api`。
- `afscp-api`、`afscp-worker`、`afscp-export-gateway` 都卡在 `ContainerCreating`。
- Kubernetes events 显示：`MountVolume.SetUp failed ... volume mode "Ephemeral" not supported by driver csi.juicefs.com (only supports ["Persistent"])`。

影响：

- AFSCP 在集群内无法启动，导致 unified deploy rollout 失败。
- render/dry-run/unit 没有发现，因为它们没有验证 CSI driver 的 volume lifecycle mode 约束。

根因线索：

- 统一部署模板为 AFSCP default volume 使用了 CSI inline volume。
- 当前 JuiceFS CSI driver 只支持 Persistent volume mode，需要用 PV/PVC 或受支持的持久卷模型表达。

后续治理方向：

- 部署模板应使用符合 JuiceFS CSI driver 的 PersistentVolume/PersistentVolumeClaim 模型。
- 增加 unified deploy contract test：AFSCP pod 不得使用 unsupported inline ephemeral CSI volume。
- rollout 失败时 evidence 应收集 pod events/describe，让根因无需人工再跑 kubectl 才能看见。

当前状态：

- 已从 inline CSI 改为 PV/PVC 模型。
- 继续 local-kind rollout 后又发现 CSI secret 地址真相问题，见下一条。

### 12. AFSCP PV/PVC 修正后仍因 CSI 挂载上下文 DNS 不同失败

现象：

- `lane:unified-deploy:local-kind` 再次失败在 `rollout:afscp-api`。
- AFSCP PV/PVC 已经 `Bound`，但 `afscp-api`、`afscp-worker`、`afscp-export-gateway` 仍卡在 `ContainerCreating`。
- `kubectl describe pod` 显示 JuiceFS CSI mount 失败：`lookup substrate-postgresql on 10.96.0.10:53: no such host`。
- 同时 apply 阶段出现 `storage: 10Pi` 的 Kubernetes quantity warning，需要确认并消除。

影响：

- 这是部署模板地址 truth 问题，不是 AFSCP 业务逻辑问题。
- AFSCP pod 内部运行时可以解析同 namespace 短服务名，但 JuiceFS CSI mount 在节点/CSI driver 上下文执行，不能假设短服务名可解析。
- 这类问题 unit/render/dry-run 容易漏掉，只有真实 local-kind rollout 才暴露，导致部署验证耗时被拉长。

根因线索：

- AFSCP runtime DSN 和 JuiceFS CSI Secret `metaurl` 混用了相同的短服务名心智。
- CSI Secret 属于 node publish/mount 输入，应该使用 cluster DNS FQDN，例如 `substrate-postgresql.<namespace>.svc.cluster.local`。
- Render contract 只检查了 secret 指向 `substrate-postgresql:5432`，没有区分“pod 内部应用连接”和“CSI driver 挂载连接”。

后续治理方向：

- 将 JuiceFS CSI Secret 的 `metaurl` 改为 namespace FQDN；bucket 已经按 FQDN 思路处理，也需要测试守住。
- 增加 render/check-render contract：CSI secret 不允许使用短服务名，必须使用从 CSI driver 上下文也可解析的服务 FQDN。
- 检查并修正 `storage` quantity，避免部署 apply 出现非阻断 warning。
- rollout evidence 应自动收集失败 pod 的 describe/events，减少人工定位时间。

当前状态：

- 已修正：JuiceFS CSI Secret 的 PostgreSQL `metaurl` 改为 namespace FQDN。
- 已增加 render/check-render/local-kind contract，防止回退到短服务名。
- 真实 `lane:unified-deploy:local-kind` 已通过。

### 13. local-kind rollout 重跑时旧失败副本会污染当前判断

现象：

- 修复模板后直接重跑 `lane:unified-deploy:local-kind`，日志仍会出现 `old replicas are pending termination`。
- 旧 ReplicaSet/Pod 来自前一次失败的 AFSCP inline CSI 部署。

影响：

- 当根因已经改变后，旧失败资源仍可能让 rollout 日志和等待逻辑变复杂。
- 如果没有清晰区分“当前版本新 pod 失败”和“旧失败副本清理中”，排障会变慢。

根因线索：

- local-kind lane 支持 reset，但对上一次失败 rollout 后的 namespace/deployment 残留没有形成明确 closure evidence。
- 部署验证脚本没有在重跑前输出旧资源归属和清理状态。

后续治理方向：

- local-kind rollout 前增加 previous failed rollout preflight，至少输出 namespace/deployment/pod 残留摘要。
- 如果 lane 定义为从干净 local-kind app 环境开始，应结构化清理上一次失败部署资源，而不是依赖人工判断。
- 清理动作必须是 lane 语义的一部分，不能变成临时 workaround。

当前状态：

- 已结构性增强：local-kind lane 在 app dry-run 前检查自己拥有的 AFSCP static PV/PVC drift。
- 当发现 owned 旧 PV/PVC 与新模板不一致时，会先删除 AFSCP workloads，再删除 owned PVC/PV，之后重新 apply。
- 非 owned 资源仍拒绝删除，避免误伤用户集群资源。
- 真实 `lane:unified-deploy:local-kind` 已通过。

### 14. PV/PVC storage quantity 修正触发本地重跑 shrink 限制

现象：

- 将 AFSCP default volume 从 `10Pi` 改为 `8Pi` 后，focused render/unit 通过。
- 但重跑 `lane:unified-deploy:local-kind` 时，server-side dry-run 失败：`PersistentVolumeClaim "afscp-default-volume" is invalid: spec.resources.requests.storage: Forbidden: field can not be less than status.capacity`。
- 旧失败环境中 PVC 已经以 `10Pi` 创建，新的 `8Pi` 被 Kubernetes 识别为 shrink。

影响：

- 修复 apply warning 时，如果没有考虑已有集群状态，会制造重跑/升级失败。
- 这是部署治理的问题：模板 quantity 既要合法无 warning，也不能让同一验证环境从已存在 PVC 降容。

根因线索：

- `8Pi` 可以避免当前 API server 对 `10Pi` 的 fractional-byte warning，但它小于已存在的 `10Pi` PVC。
- local-kind lane 没有在这类模板语义变化前做“不可变/不可降级字段”兼容检查或结构化 reset。

后续治理方向：

- 选择一个 Kubernetes 接受且不小于旧 `10Pi` 的容量表达，避免 shrink。
- 为 PV/PVC storage quantity 增加 contract test：不能回退到会触发 warning 的表达，也不能低于已发布/已验证的默认容量基线。
- 对不可变或不可降级 K8s 字段增加 rollout preflight，提前解释，而不是等 apply/dry-run 报错。

当前状态：

- 已进一步确认：static PVC 不能 resize，不论 shrink 还是 expand。
- 修复方向调整为：fresh 模板使用合法且高于旧基线的 `12P`；local-kind lane 在 reset 语义下结构化清理自己拥有的旧 AFSCP PV/PVC 后再 apply。
- 已通过 app dry-run/app apply 和真实 local-kind rollout。
- 继续暴露过 AFSCP runtime config 缺口，见下一条。

### 15. AFSCP runtime 启用 repo recovery 但缺少 JVS cwd 配置

现象：

- `lane:unified-deploy:local-kind` 继续失败在 `rollout:afscp-api`。
- 这次 AFSCP pod 已能成功挂载 PV/PVC 并启动容器，但 API/export gateway/worker 都 CrashLoop。
- 容器日志显示：`AFSCP_JVS_CWD is required when AFSCP_REPO_CREATE_RECOVERY_ENABLED is true`。

影响：

- 说明 AFSCP 在集群内部部署的 runtime contract 没有被完整表达。
- 这不是 AgentSmith 业务层应感知 JVS，而是 AgentSmith 部署模板作为 AFSCP runtime consumer 必须给 AFSCP 自己的内部运行时提供完整配置。

根因线索：

- 当前 unified deploy config 开启了 `AFSCP_REPO_CREATE_RECOVERY_ENABLED=true` 等恢复能力。
- AFSCP sibling repo 的配置契约要求启用这些能力时提供 `AFSCP_JVS_CWD`，并可能还要求 JVS binary/checksum 由 AFSCP image 默认或显式配置提供。
- render/check-render 只守住了 AFSCP feature flags，没有守住“开启能力所需 runtime env 完整性”。

后续治理方向：

- 按 AFSCP 正式配置契约为 API、worker、export gateway 提供 JVS cwd 等 runtime 内部配置。
- 如果 JVS cwd 需要可写 scratch，使用明确的 AFSCP runtime scratch volume，而不是把该细节扩散到 AgentSmith 业务配置。
- 增加 render/check-render/local-kind tests：开启 repo recovery 时必须渲染完整 AFSCP runtime env 和挂载。
- 仍保持 AgentSmith 业务代码不直接调用或管理 JVS；JVS 只存在于 AFSCP runtime 边界内。

当前状态：

- 已修正：AFSCP runtime ConfigMap 显式提供 `AFSCP_JVS_CWD=/var/lib/afscp/jvs-cwd`。
- API、worker、export gateway 都挂载 `afscp-jvs-cwd` `emptyDir` 作为 AFSCP 内部 scratch cwd。
- `AFSCP_JVS_BINARY_PATH` 和 `AFSCP_JVS_BINARY_SHA256` 继续由 AFSCP image 默认提供，AgentSmith manifest 不显式覆盖。
- 已增加 render/check-render/local-kind/JVS boundary guard 测试。
- 真实 `lane:unified-deploy:local-kind` 已通过。

### 16. local-kind rollout 证明了 pod Ready，但没有证明 AFSCP schema/operation ready

现象：

- `lane:unified-deploy:local-kind` 通过后，`lane:unified-deploy:product-flows` 失败。
- files flow 创建文件库时 15s 后返回 `409 PROJECT_STORAGE_PENDING`。
- AFSCP worker 日志持续出现 `relation "export_runtime_requests" does not exist` 和 `relation "workload_mount_bindings" does not exist`。
- 说明 AFSCP pod 已 Ready，但控制面 PostgreSQL migrations 没有执行或没有被部署验证等待。

影响：

- rollout smoke 给出了过早的“部署成功”信号，后续真实产品流才发现 AFSCP 操作不可用。
- project storage pending 被误当成普通等待问题，实际底层是 AFSCP schema 未初始化。

根因线索：

- unified deploy 模板部署了 AFSCP API/worker/export gateway，但没有明确的 AFSCP DB migration/schema bootstrap Job。
- local-kind rollout evidence 只等待 Deployment rollout 和 ingress route，没有证明 AFSCP metadata store schema ready。
- product-flow 也没有把 `PROJECT_STORAGE_PENDING` 作为 typed pending 做有界 retry 和证据记录。

后续治理方向：

- AFSCP 自身应该提供正式 migration/bootstrap command 或等价 schema readiness 机制；AgentSmith 不应手写 AFSCP SQL。
- unified deploy 应在 AFSCP runtime 之前或 rollout 过程中运行并等待 AFSCP migration/schema bootstrap。
- local-kind/existing-cluster smoke 必须证明 AFSCP operation readiness，而不仅是 pod ready。
- product-flow 的 file library create 对 `PROJECT_STORAGE_PENDING` 做 bounded retry，持续 pending 到上限时输出清晰 evidence。

当前状态：

- 已定位，交给 subagent 深挖并修正。

### 17. AFSCP schema bootstrap Job 失败后缺少可直接消费的失败证据

现象：

- 引入 `afscp-migrate` 和 `afscp-schema-bootstrap` Job 后，`lane:unified-deploy:local-kind` 失败在 `afscp-schema-bootstrap:wait`。
- Kubernetes 只返回 `timed out waiting for the condition on jobs/afscp-schema-bootstrap`。
- Job 进入 `Failed`，但失败 Pod 在排障时已经被删除或没有被 lane evidence 捕获，导致第一时间拿不到 `afscp-migrate` 的真实 stderr/stdout。

影响：

- gate 失败后仍需要人工二次运行 `kubectl describe/logs` 才能定位根因。
- 如果失败 Pod 被清理，根因证据会丢失，只剩下超时和 BackoffLimitExceeded 这类低信息量信号。
- 这会让测试/发布验证时间被诊断流程吞掉，而不是被真正的修复工作使用。

根因线索：

- local-kind rollout lane 对 Deployment rollout 的 evidence 较完整，但对一次性 Job 的失败证据收集不足。
- `wait --for=condition=complete job/...` 失败时没有立即抓取 Job describe、Pod describe、Pod logs 和相关 events。
- schema bootstrap 是发布链路关键前置条件，不能只用一个 timeout 作为最终诊断。

后续治理方向：

- 对所有关键 bootstrap Job 增加统一失败采集：Job YAML/describe、owned Pod describe/logs、namespace events、container termination reason。
- Job 等待失败时先采集 evidence 再返回非零。
- 对 schema/bootstrap 类 Job 优先使用低 backoff、保留失败 Pod 或在脚本层主动抓取 logs，避免诊断证据被 controller 清理掉。

当前状态：

- 已记录。当前继续先定位 `afscp-schema-bootstrap` 的真实失败原因，再补齐 lane evidence。

### 18. AFSCP migration 能力进入发布链路后，缺少更早的 image/runtime contract 验证

现象：

- AFSCP Go focused tests 已通过，AgentSmith render/unit/product-flow unit 也通过。
- 但把新 AFSCP image 放入 local-kind 后，schema bootstrap 仍在真实 Job runtime 失败。
- 说明“二进制存在、能启动、能读取部署 env、能连接同一 Postgres 并完成 schema check”的 contract 没有在 image build 后被快速验证。

影响：

- 真实 rollout 才暴露 migration runtime 问题，反馈位置太晚。
- 每次失败都需要完整 local-kind app apply/rollout，耗时远高于一个 focused image contract check。

根因线索：

- AFSCP sibling repo 与 AgentSmith unified deploy 之间缺少“image-level smoke”。
- 现有 `local-kind:images` 只证明 image build/load 成功，不证明镜像内关键命令和默认 runtime contract 正确。

后续治理方向：

- 在 image build/load 后增加 focused smoke：检查 `/usr/local/bin/afscp-migrate` 存在且 `--help`/dry check 可运行。
- 对需要数据库的检查，使用最小 Postgres fixture 或部署前 bootstrap Job dry run，尽早失败。
- AgentSmith 仍只依赖 AFSCP image/API；migration 细节归 AFSCP image 负责，但 deploy gate 要验证这个 image contract。

当前状态：

- 已记录。待本轮修复完成后，纳入测试/gate/发布治理优化计划。

### 19. AFSCP schema bootstrap wait 失败证据已收敛到 local-kind rollout evidence

现象：

- `afscp-schema-bootstrap` Job wait 失败时，原先只留下 `kubectl wait` timeout/stderr。
- 失败 Pod 可能在下一次 lane reset 或 Job 生命周期变化后消失，导致第一时间看不到 `afscp-migrate` 输出。

修正：

- `check-local-kind-rollout.ts` 在 `afscp-schema-bootstrap` wait 失败后立即采集诊断 evidence operations。
- 采集内容包括 Job YAML、Job describe、Job-owned Pod 列表、Pod logs、Pod previous logs、Pod describe、Pod events、Job events 和 namespace events。
- 诊断命令失败不会额外改变 gate 结论；它们只作为失败 evidence 保留在 local-kind rollout report 中。
- `afscp-schema-bootstrap` Job 调整为 `backoffLimit: 0`、`restartPolicy: Never`、`ttlSecondsAfterFinished: 86400`，让 schema bootstrap fail fast，并保留失败 Pod/Job 供 lane 采集。

当前状态：

- 已补充 focused unit 覆盖：wait 失败时必须调用诊断采集并阻止后续 app rollout。
- 已同步 render guard 和 render unit 对 Job fail-fast/保留策略的断言。

### 20. AFSCP schema readiness 把非 PostgreSQL 对象误列为必需表

现象：

- `afscp-migrate --check` 显示所有 migrations 都已记录，但仍报告 `missing_required_tables:["save_points"]`。
- 深挖后确认 AFSCP migrations 没有创建 `save_points` 表，保存点历史由 JVS history / API JSON 表达，PostgreSQL 侧只持久化 `operations` 的 save point operation 结果和 `restore_plans.source_save_point_id` 等引用。

影响：

- local-kind rollout 被一个并不存在、也不应存在的 PostgreSQL 表阻断。
- 如果用“补建空表”的方式让 gate 通过，会把错误的数据模型固化成产品事实，后续保存点/恢复逻辑更难治理。

根因线索：

- AFSCP 的 `RequiredTables()` 是手写清单，缺少与 embedded SQL `CREATE TABLE` 集合的 contract guard。
- readiness contract 混入了 API/JVS 领域对象名，没有严格限制为 PostgreSQL durable runtime tables。

后续治理方向：

- AFSCP `RequiredTables()` 必须只包含 embedded migrations 创建的持久表。
- 增加 contract test，让 `RequiredTables()` 与 migrations 内 permanent `CREATE TABLE` 集合精确匹配。
- 对 JVS/API 概念对象另走 operation/API readiness，不进入 DB table readiness。

当前状态：

- 已由 AFSCP subagent 修正：移除 `save_points` required table，并补充 contract test 防止回退。

### 21. product-flow 暴露 project storage pending 的真实阻塞证据不足且上游 operation 未终结

现象：

- schema bootstrap 修复后，`lane:unified-deploy:local-kind` 已通过。
- 随后 `lane:unified-deploy:product-flows` 的 files flow 仍失败：8 次创建文件库均返回 `409 PROJECT_STORAGE_PENDING`。
- AFSCP worker 日志显示 `namespace_volume_binding_put` recovery 失败：`operation lease unavailable ... sql: no rows in result set`。

影响：

- product-flow 只报告 project storage pending，没有直接把底层 AFSCP operation id/status 带入 evidence。
- managed runner flow 失败是 files flow 未 ready 的级联，但现有 aggregate 输出容易让排障者同时追两个方向。
- 如果继续简单增加 retry，会掩盖 operation 无法终结的真实缺陷。

根因线索：

- 当前阻塞点已经不是 AFSCP schema 缺失，而是 namespace volume binding operation 被 worker claim 后提交条件不满足。
- AgentSmith 的 project storage bootstrap 和 AFSCP operation 状态之间缺少更直接的失败 evidence 关联。

后续治理方向：

- AFSCP 侧按 TDD 修正 `namespace_volume_binding_put` intake/recovery/commit 的状态、phase、lease predicate 一致性。
- AgentSmith product-flow evidence 应尽量记录 project storage bootstrap operation id、最后一次 AFSCP status/error，避免只留下 `PROJECT_STORAGE_PENDING`。
- managed runner flow 在 files flow 未 ready 时继续明确标记为依赖阻断，不误判为 runner 自身失败。

当前状态：

- 已记录。已交给 AFSCP worker 深挖并修正，同时由 AgentSmith explorer 只读审查 evidence 是否需要补强。

### 22. product-flow 失败链路确认是 AFSCP operation 未终结，但 evidence 没有把内部状态带出来

现象：

- 只读审查确认，AgentSmith project storage mapping 当前为 `status=pending`、`stage=volume_binding`、`next_action=wait`。
- `namespace_upsert_operation_id` 已 `succeeded`。
- `volume_binding_operation_id` 仍为 `operation_state=running`、`phase=validate_namespace_volume_binding_put`、`attempt=3`、`finished_at=null`。
- product-flow artifact 里只有 `create_attempts`、`create_last_error_code=PROJECT_STORAGE_PENDING` 和最后一次 409 body。

影响：

- 现有 evidence 不能直接回答“到底卡在哪个 AFSCP operation”，必须人工查数据库或日志。
- 对发布 gate 来说，这会把结构性失败伪装成普通 pending/retry 问题，拖慢定位。
- 排障者容易误以为 AgentSmith Files 创建链路没有等够，而不是上游 operation 没有终结。

根因线索：

- AgentSmith 的产品 API 不暴露 storage 内部 operation id 是合理边界，但测试/发布 evidence 需要有受控的内部投影。
- product-flow 缺少发布验证专用的 operation inspector evidence producer。

后续治理方向：

- product-flow 在最终 pending 失败时，记录 project storage mapping 的 `status/stage/generation/next_action/retryable/last_error_code/operation_id/updated_at`。
- 如果 AFSCP operation inspector 可用，追加 redacted operation projection：`operation_type/state/phase/attempt/error_code/updated_at`。
- 不把这些内部 id 加入普通产品响应；只作为 release verification evidence。

当前状态：

- 已记录。等待后续按 focused evidence producer 方式补强，而不是扩大产品 API。

### 23. 默认 AFSCP volume 只有配置，没有进入 AFSCP 数据库 runtime truth

现象：

- AFSCP runtime ConfigMap 存在 `AFSCP_VOLUME_ROOTS=vol_agentsmith_default=/var/lib/afscp/volumes/default`。
- 但 AFSCP `volumes` 表为空。
- `namespace_volume_binding_put` commit SQL 要求 `volumes.volume_id=vol_agentsmith_default AND status=active`，所以 operation recovery 报 `sql: no rows in result set` 并持续 running。

影响：

- 部署看起来配置了 default volume，但真实运行时没有 active volume 记录。
- project storage bootstrap 卡在 volume binding，随后 Files、managed runner product-flow 都被阻断。
- 这是部署 bootstrap/runtime truth 断裂，不应通过延长 product-flow retry 解决。

根因线索：

- `AFSCP_VOLUME_ROOTS` 是进程配置，不能自动等价为 AFSCP metadata store 中的 active volume。
- AgentSmith 项目级 storage bootstrap 直接做 namespace 和 binding，却假设部署级 default volume 已经存在。
- 当前 unified deploy 缺少“确保默认 volume 已 active”的正式 bootstrap 步骤或 readiness gate。

后续治理方向：

- 明确边界：默认 volume 是 AFSCP 部署级 runtime truth，应该由 AFSCP image/command 或 AgentSmith unified deploy 的 AFSCP bootstrap 阶段结构化确保。
- 不允许手工插数据库行；不把缺失 volume 当成 product-flow retry 问题。
- local-kind/existing-cluster rollout smoke 应在 product-flow 前证明 default volume active 或 volume ensure operation completed。

当前状态：

- 已记录。正在由 AFSCP/AgentSmith team 深挖最小结构性修正方案。

### 24. product-flow 依赖性失败没有被清楚标记，容易造成重复排障

现象：

- files flow 因 project storage pending 失败后，managed runner flow 继续进入依赖路径。
- aggregate evidence 中 managed runner 被记录为失败/跳过依赖，但根因呈现不够突出。

影响：

- 排障时可能同时追 Files 和 Runner 两条线，浪费时间。
- 实际上 runner full task execution 需要 ready file library；files 未 ready 时 runner 不应被当成独立失败根因。

根因线索：

- product-flow orchestration 缺少明确的 `blocked_by=<flow>` 语义。
- 依赖失败和自身失败没有在 artifact 和 summary 中充分区分。

后续治理方向：

- product-flow aggregate report 中明确标记依赖性阻断，例如 `agent_task_managed_runner.blocked_by=files`。
- 当上游依赖未 ready 时，停止执行高成本下游动作，只产出 dependency-blocked evidence。
- summary 中把 root cause flow 置顶，降低无效排障。

当前状态：

- 已记录。待后续治理优化时补强 product-flow 编排。

### 25. JVS bootstrap 细节仍会在测试/发布链路中制造 AgentSmith 心智噪音

现象：

- 本轮排障过程中出现了下载/准备 JVS 的动作。
- 从产品和业务边界看，AgentSmith 不应该直接关心 JVS；JVS 是 AFSCP 的内部基础工具。
- 当前出现 JVS 下载，是本地拉起 AFSCP sibling runtime 或 image contract 时的 bootstrap 细节。

影响：

- 容易让后续开发误以为 AgentSmith 业务侧需要理解或管理 JVS。
- 如果每次 gate 都临时下载/装配 JVS，会增加网络不稳定和耗时浪费。
- 工程日志和 gate 输出里如果不区分边界，会污染长期架构心智。

根因线索：

- AFSCP image/release 还没有完全把 JVS 生命周期封装为自身内部能力。
- AgentSmith 测试脚本为了跑通 AFSCP sibling runtime，临时承担了部分 bootstrap 工作。

后续治理方向：

- AgentSmith 只声明并启动/连接 AFSCP 版本，不管理 JVS 下载地址、binary path 或 checksum。
- 短期如果本地 sibling runtime 仍需下载 JVS，必须限定在 AFSCP bootstrap helper，并做稳定缓存和校验。
- 中长期由 AFSCP image/release 包内自带并校验匹配版本 JVS，让 AgentSmith gate 只验证 AFSCP image/API contract。

当前状态：

- 已记录。后续发布治理优化时需要把 JVS 生命周期完全收敛到 AFSCP 内部。

### 26. AFSCP default volume metadata 需要部署级 bootstrap 证据

现象：

- AFSCP schema bootstrap ready 后，默认 volume 的 Kubernetes PV/PVC 和 runtime env 已存在，但 AFSCP metadata store 中仍可能没有 `status=active` 的 default volume 记录。
- Files / managed runner product-flow 会继续卡在 project storage pending，根因是部署级 default volume runtime truth 未激活。

修正：

- unified deploy app 模板新增 `afscp-volume-bootstrap` Job，使用同一 AFSCP image、runtime ConfigMap 和 Secret。
- runtime ConfigMap 显式渲染 default volume 的 `id/backend/isolation_class/status/root_path/capabilities`，由 AFSCP image 内的 `/usr/local/bin/afscp-volume-bootstrap` 负责写入/校验 AFSCP metadata store。
- local-kind rollout 复用 schema bootstrap 的 Job reset / wait / diagnostics 机制：先等待 `afscp-schema-bootstrap` 完成，再等待 `afscp-volume-bootstrap` 完成，之后才进入 app rollout 和 product-flow 证据链。
- render/check-render/local-kind focused tests 已覆盖 Job 存在、fail-fast/ttl、AFSCP image/env/secrets、等待顺序和失败诊断。

当前状态：

- 已按 AgentSmith/AFSCP 边界修正：不在 AgentSmith API project storage 请求路径 ensure volume，不手写 AFSCP SQL。

### 27. AFSCP bootstrap command 参数契约没有被跨仓库测试守住

现象：

- AFSCP 新增 `afscp-volume-bootstrap` command 后，命令实际支持 `--ensure` / `--check`。
- AgentSmith unified deploy 模板最初按 schema bootstrap 心智复用了 `--apply --check`。
- AFSCP focused tests 和 AgentSmith render/local-kind focused tests 都能单独通过，但真实 Job 会因为未知 `--apply` flag 失败。

影响：

- 这是典型的跨仓库 image command contract 漏测：单侧测试绿，不代表部署链路可运行。
- 如果等到真实 local-kind rollout 才发现，会再次浪费完整 build/load/apply/rollout 时间。

根因线索：

- AFSCP command contract 没有形成可被 AgentSmith render/check-render 直接消费的稳定断言。
- AgentSmith deploy 模板测试只验证 Job 存在和大体结构，没有严格验证命令参数与 AFSCP command 实现一致。

后续治理方向：

- AgentSmith render/check-render 必须断言 `afscp-volume-bootstrap` Job 使用正式参数，例如 `--ensure --check --timeout=60s`。
- AFSCP image-level smoke 应检查关键命令存在，并至少验证 `--help` 或 dry-run 参数契约。
- 对跨仓库命令入口建立轻量 contract fixture，避免模板靠复制相似 Job 参数。

当前状态：

- 已记录。正在修正 AgentSmith deploy 模板和 focused tests。

### 28. AFSCP bootstrap Jobs 需要结构化 apply、固定名重建和 fail-fast wait

现象：

- existing-cluster smoke 还没有覆盖新增固定名 `afscp-schema-bootstrap` / `afscp-volume-bootstrap` Jobs 的二次部署行为。
- local-kind 先 apply 整个 app manifest 再等 Jobs，只保证脚本命令顺序，不阻止 Deployment controller 提前创建 Pod。
- `kubectl wait --for=condition=complete` 对 Failed Job 不够快，可能等满 timeout。
- `AFSCP_API_SERVICE_TOKENS` 是逗号分隔的 `service=token` 复合字符串，只整体 redaction 不足以覆盖单个 token 泄漏。

修正：

- 新增共享 Kubernetes YAML split helper 和 AFSCP bootstrap split/status helper，local-kind 与 existing-cluster 共用拆分逻辑。
- local-kind rollout 改为：admin preflight -> AFSCP 固定名 Job delete -> AFSCP bootstrap prereq/Jobs dry-run/apply -> Job JSON 状态短轮询 -> remaining app dry-run/apply -> Deployment rollout。
- existing-cluster smoke 改为：namespace check -> AFSCP 固定名 Job delete -> AFSCP bootstrap prereq/Jobs dry-run/apply -> Job JSON 状态短轮询 -> remaining app dry-run/apply -> Deployment rollout。
- Job wait 识别 `status.conditions[type=Failed,status=True]` 并 fail-fast；local-kind 失败时继续收集既有 Job/Pod diagnostics。
- redaction 收集 `AFSCP_API_SERVICE_TOKENS` 内每个 `key=value` 的 token，保证 kubectl diagnostics/report 中单 token 也被遮蔽。

当前状态：

- 已补 focused TDD 覆盖 local-kind/existing-cluster bootstrap apply 顺序、Failed condition fail-fast、composite token redaction。
- 已通过 focused unit：`npm run test:unified-deploy:local-kind:unit`、`npm run test:unified-deploy:existing-cluster-smoke:unit`。

### 29. AFSCP bootstrap command 缺少 action flag 时曾会假绿

现象：

- `afscp-migrate` 没有 `--apply` / `--check` 时原本返回 0。
- `afscp-volume-bootstrap` 没有 `--ensure` / `--check` 时原本返回 0。

影响：

- k8s Job 如果模板参数遗漏，会显示成功但没有执行 schema 或 volume bootstrap。
- 这是发布验证里最危险的一类假阳性。

修正：

- 两个命令都改为缺 action flag 返回非零，并更新测试移除 no-op success 断言。
- AFSCP runtime readiness 额外补强：storage ready 但 API volume roots 为空时 fail closed。

当前状态：

- 已由 AFSCP worker 修正并通过 focused Go tests。

### 30. default volume bootstrap 通过后 Files provisioning 进入新的 502 阶段失败

现象：

- 重建镜像并通过真实 `lane:unified-deploy:local-kind` 后，`lane:unified-deploy:product-flows` 不再返回 `PROJECT_STORAGE_PENDING`。
- files flow 现在失败为 `502 FILE_LIBRARY_PROVISIONING_FAILED`，message 为 `file_library_operation_failed`。
- managed runner flow 仍是依赖 files flow 未 ready 的级联失败。

影响：

- 说明部署级 schema/default volume bootstrap 已推进到下一阶段，但 file library repo/provisioning 链路仍有真实缺陷。
- 如果 product-flow artifact 不带 AFSCP repo operation 细节，仍需要人工查日志/DB，影响定位效率。

根因线索：

- 当前失败不再是 project storage readiness，而是 file library provisioning operation 失败。
- 需要继续深挖 AgentSmith Files service 与 AFSCP repo lifecycle operation 的错误映射、operation state 和 worker logs。

后续治理方向：

- 用 team 继续定位 AFSCP/AgentSmith provisioning operation 根因。
- 补 product-flow / Files e2e evidence，让 502 能关联到具体 repo operation id、state、error code。
- 不要把 managed runner 级联失败当作独立根因。

当前状态：

- 已记录。继续深挖和修复中。

### 31. AFSCP image 内 JVS 动态链接依赖缺失导致 repo_create 假装成业务 provisioning 失败

现象：

- `lane:unified-deploy:local-kind` 已通过，AFSCP schema/default volume bootstrap Job 均成功。
- `lane:unified-deploy:product-flows` files 场景仍失败为 `502 FILE_LIBRARY_PROVISIONING_FAILED`。
- AFSCP DB 中对应 operation 为 `repo_create`，state=`operator_intervention_required`，phase=`validate_repo_create`，error code=`JVS_COMMAND_FAILED`。
- AFSCP worker 日志只持续输出 `operation recovery incomplete: unsupported=0 manual=1 failed=0`，没有直接指向镜像/JVS loader 问题。

根因线索：

- AFSCP image 中 `/usr/local/bin/jvs` 存在且 checksum 正确。
- 但 `docker run --entrypoint /usr/local/bin/jvs ... --help` 返回 `exec /usr/local/bin/jvs: no such file or directory`。
- 将 binary 从 image 中拷出后，`file` 显示它是动态链接 ELF，interpreter 为 `/lib64/ld-linux-x86-64.so.2`。
- AFSCP Dockerfile final stage 使用 `gcr.io/distroless/static-debian12:nonroot`，该镜像不提供动态 loader/glibc。

影响：

- 部署/rollout 可以假绿，直到产品级 files flow 才暴露。
- 用户看到的是 AgentSmith 文件库 provisioning 失败，真实根因却在 AFSCP runtime image。
- AFSCP repo_create operation 和 worker summary 对这个错误的可诊断性不足，导致人工查 DB、查 image、拷 binary 才能定位。

后续治理方向：

- AFSCP image/release 必须自带可运行的 JVS runtime，且 Dockerfile contract 要防止回退到不支持动态 JVS 的 base image。
- product-flow evidence 要能关联到 AFSCP operation id/state/error，避免只留下泛化 502。
- AFSCP worker/recovery 日志最好输出 redacted operation id/code 级诊断摘要，避免只有 `manual=1` 计数。

当前状态：

- 已记录。AFSCP image 修复与 AgentSmith product-flow evidence 增强已分派给 team 并行处理。

### 32. JVS runtime 修复后 product-flow 暴露 Files folder create 与 Agent task workspace mode 新失败

现象：

- 修复 AFSCP image 并重新 rollout 后，集群内 `/usr/local/bin/jvs --help` 已可正常执行。
- `lane:unified-deploy:product-flows` 不再失败在 `FILE_LIBRARY_PROVISIONING_FAILED/JVS_COMMAND_FAILED`。
- files flow 新失败为：`FILE_LIBRARY_FOLDER_CREATE_FAILED`，message=`file_library_object_not_found`。
- managed runner flow 新失败为：`AGENT_TASK_WORKSPACE_MODE_INVALID`，field=`workspace_mode`，workspace_mode=`create_new`。

影响：

- JVS/runtime 根因已推进，但 product-flow 继续暴露文件库对象路径与 Agent task workspace binding 规则的真实不一致。
- `agent_task_managed_runner` 失败看起来是测试脚本/产品流仍带旧心智：脚本把 Files flow 里创建的普通 file library 作为 task workspace 复用，却没有显式声明 `workspace_mode=use_existing`；当前用户默认创建 task 的业务心智仍应是独立 `create_new` task HOME。
- files folder create 失败说明 repo/create succeeded 之后，WebDAV/export 或 payload root 的可见对象状态仍没有被产品流正确验证，可能是 AFSCP payload root 初始化、路径前缀、ready 判断或 AgentSmith Files adapter 的 object existence 语义问题。

后续治理方向：

- 继续用 team 分别定位 Files object_not_found 与 Agent task workspace_mode invalid。
- product-flow 不应把“创建库成功/ready”当作文件对象路径真正可写的充分证据；需要明确覆盖 folder/upload/list/download 的 ready 证据。
- Agent task product-flow 需要跟随当前 task workspace binding 真相：默认创建 task 时不应复用 Files flow 的普通 file library；如需验证复用，必须显式走 released task workspace 的 `use_existing` 场景。

当前状态：

- 已修复并通过 `lane:unified-deploy:product-flows` 验证。
- Files 根因是 WebDAV public base 被渲染成带 `/e` 的地址，AFSCP API 再追加 `/e/{exportId}/` 后形成 `/e/e/export...`，gateway 在路径解析阶段 404。
- Agent task 根因是 product-flow 脚本复用 Files flow 普通 file library 创建 task，但没有显式 `workspace_mode=use_existing`；修正为默认 task flow 独立 `create_new` task HOME，不再复用 Files flow 的 library。
- 补充了 render 检查防止 `/e/e/` 配置回归，补充了 product-flow unit 防止非法 workspace payload 回归。

### 33. Product-flow 把半成功的跨 flow 状态作为后续前提，导致失败级联和误判

现象：

- Files flow 在 folder create 阶段失败，但其 earlier state 已经写入 `state.libraryId`。
- 后续 managed runner flow 继续读取这个普通 file library，并尝试用它创建 Agent task。
- 结果出现 `AGENT_TASK_WORKSPACE_MODE_INVALID`，容易被误判成 task API/UX 的独立缺陷。

影响：

- 一个 flow 的半成功状态污染另一个 flow，导致定位路径变长。
- 产品流验证没有表达清楚“默认创建 task”与“复用已有 task workspace”是两个不同用户故事。

后续治理方向：

- product-flow 之间共享状态必须只共享已通过验收的稳定对象；半成功对象不能作为后续 flow 的隐含前提。
- 默认 task 创建 flow 应独立验证 `create_new` task HOME；复用已有 workspace 应单独建 released task workspace 的专门场景。
- flow artifact 应记录关键 payload 语义，例如 `workspace_mode` 和是否传 `workspace_file_library_id`。

当前状态：

- 已修复 managed runner flow：显式 `workspace_mode=create_new`，不传 `workspace_file_library_id`，并记录 task response 中的 `workspace_file_library_id` 作为 evidence。
- 已补单测，确保不会再出现默认 create_new 与 existing library payload 的非法组合。

### 34. WebDAV base 与 gateway prefix 契约没有被 render gate 覆盖

现象：

- AFSCP export gateway 的真实访问路径是 `/e/{exportId}/...`。
- unified-deploy 曾把 `AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL` 配成 `http://...:8080/e`。
- AFSCP API 生成 export access URL 时再拼接 `/e/{exportId}/`，最终变成 `/e/e/{exportId}/...`。
- AFSCP repo、export operation 都成功，但 WebDAV request 在 gateway 路径解析阶段直接 404；AgentSmith 上层只看到 `file_library_object_not_found`。

影响：

- rollout 和 AFSCP operation 均可显示成功，真实 Files I/O 却失败。
- product-flow 原 artifact 在 folder create 失败时缺少 config/path 级线索，需要人工跨 ConfigMap、AFSCP DB 和 logs 定位。

后续治理方向：

- render gate 必须覆盖跨组件 URL 拼接契约，尤其是“base URL 是否含 path prefix”这类容易重复拼接的配置。
- 文件库 ready 不应只等 catalog ready；至少 product-flow 必须覆盖 folder/upload/list/download 的真实 I/O 闭环。
- 后续可以考虑在 Files create ready closure 中加入轻量 WebDAV access probe，但要注意不要把产品创建逻辑变成重型测试流程。

当前状态：

- 已修正 manifest 模板，使 `AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL` 只指向 export gateway service origin，不带 `/e`。
- 已补 render diagnostic 和 render unit，显式拒绝会产生 `/e/e/` 的配置。
- 已重新 rollout local-kind，并通过 product-flow Files 用户故事验证。

### 35. `verify --goal=real` 在 backend-real 阶段才暴露 Docker 端口冲突，前置验证时间被浪费

现象：

- `npm run verify -- --goal=real --run` 已完成 fast/default/full visual 等大量验证后，进入 backend-real dependencies 启动。
- `infra/integration/docker-compose.yml` 启动 MongoDB 时失败：`Bind for 0.0.0.0:27027 failed: port is already allocated`。
- 占用端口的是此前 unified substrate stack 的 `agentsmith-unified-substrate-mongodb-1`，而 integration deps 已经部分启动了 postgres、redis、minio、keycloak。

影响：

- 端口冲突属于可预检环境问题，却在耗时约半小时后才暴露。
- 失败后还留下部分 integration deps，需要人工清理后才能继续。
- 这类失败不是产品/业务缺陷，但会污染 gate 结论并消耗大量发布验证时间。

后续治理方向：

- backend-real / release-ready 在启动依赖前应有 fail-fast 端口与容器占用 preflight，至少覆盖已知固定端口。
- unified substrate stack 与 integration deps 的端口规划应避免默认冲突，或者 release 脚本应显式声明互斥并自动给出清理命令。
- verify runner 应支持复用同一报告内已经通过的 fast/default/visual evidence，避免环境问题修复后重跑所有重型阶段。
- integration deps 启动失败时应自动回滚本次已创建容器，避免留下半启动环境。

当前状态：

- 已记录。准备清理本轮 integration deps 残留与 unified substrate 冲突容器后，重跑 backend-real 失败段。

### 36. Heavy gate 噪音与空跑会降低失败诊断效率

现象：

- full visual catalog 输出提示单文件 163 个场景耗时 17.1 分钟，并建议并行。
- `verify --goal=real` 中 fast/default/backend-real 路径重复执行 contracts、render、workspace/project mock lane 等前置检查。
- 一些 Vitest grep 命令启动完整进程后全部 skipped。
- 多个已知预期 stderr（Radix Dialog description 警告、sandbox teardown 失败路径测试日志）混在 gate 输出里。

影响：

- 真实失败信号被大量可预期噪音淹没。
- 非 UI/视觉变更也被 full visual 拖慢，发布反馈时间过长。
- skipped-only 测试进程和重复 preflight 不产生有效 evidence，却增加等待时间。

后续治理方向：

- 按改动影响面区分 release/deploy 脚本变更、业务 UI 变更、视觉系统变更的 visual 证据要求。
- 把 expected stderr 收敛到测试断言或静默捕获，避免误导人工 review。
- grep-only 测试应先做 test list 预检，空匹配时直接记录 skipped evidence，不启动完整 Vitest。
- verify report 应能识别同一轮已通过的等价 producer evidence，减少重复执行。

### 37. 兄弟项目 AFSCP 版本发布证据没有随 schema/bootstrap 变更同步

现象：

- AgentSmith 部署示例已指向 `ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.4`。
- 修正前，当时 AFSCP 远端最新 tag 仍是 `v1.0.3`。
- 本轮 AFSCP 增加 schema migration/default volume bootstrap 命令后，运行 `bash scripts/verify-ga-release.sh` 失败：
  `selector.identity_digest_mismatch: schema_migration_set_digest mismatch`。

影响：

- 当时 AgentSmith 可以用本地 kind registry 镜像通过测试，但正式部署引用的 AFSCP tag 还不存在。
- 当时如果不在兄弟项目同步 release evidence 并发布新 image，后续用户/CI 使用 `v1.0.4` 会失败。
- 这说明跨 repo 变更需要 release evidence checklist：AgentSmith manifest/version 更新必须绑定 AFSCP tag 发布状态。

后续治理方向：

- 修改 AFSCP schema/migration/runtime image 内容时，必须同步 AFSCP release evidence，并等待 tag CI/image 发布完成。
- AgentSmith release gate 可以增加外部 image tag 可解析检查，避免只验证本地 kind digest。
- 跨 repo 变更应在最终 review 中列出“sibling repo commit/tag/image digest”。

当前状态：

- 已修正 AFSCP release selector evidence。
- 已提交并推送 AFSCP `main`，创建并推送 `v1.0.4` tag。
- GitHub release workflow 已通过，发布了 `ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.4`。
- workflow annotation 提示 GitHub Actions Node.js 20 action runtime 将在 2026-06-02 起默认迁移到 Node.js 24，后续需要维护 release workflow action 版本或显式 runtime 策略。

### 38. AFSCP CLI evidence 修复发布状态补记

当前状态：

- 本轮 AFSCP CLI `afscp-migrate --apply --check` evidence 修复已推送 `main`，创建并推送 `v1.0.5` tag。
- GitHub release workflow `Release Container Image` run `25835587653` 已成功，发布了 `ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.5`。
- workflow 仍有 Node.js 20 actions deprecation annotation，后续作为 release workflow action/runtime 策略治理优化记录。

## 后续追加区

后续继续测试、gate、发布或部署验证时，如发现新的失败、耗时浪费、编排不合理或边界污染，继续追加到这里。
