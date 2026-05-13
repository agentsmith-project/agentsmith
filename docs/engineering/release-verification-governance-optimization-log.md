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

- AgentSmith 业务代码和统一部署模板已基本不直接依赖 JVS。
- 但工程计划文档曾把 JVS 写成 AgentSmith 的里程碑、gate 或验收对象。

影响：

- 容易误导后续开发，把 AFSCP 内部实现细节扩散到 AgentSmith 产品/业务/部署心智。

根因线索：

- AFSCP/JVS 是 sibling project，计划文档没有清晰区分上游实现证据和 AgentSmith 业务边界。

后续治理方向：

- AgentSmith 只消费 AFSCP API、AFSCP image/release evidence 和 redacted operation projection。
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

## 后续追加区

后续继续测试、gate、发布或部署验证时，如发现新的失败、耗时浪费、编排不合理或边界污染，继续追加到这里。
