# Engineering Governance Developer Flow Optimization v2

更新时间：2026-04-27
状态：`analysis_for_implementation`
适用范围：AgentSmith 工程治理、测试验证、real lane、发布前验证、本地 demo / cluster 部署演练

## 0. 文档地位

本文是 [`governance-simplification-analysis-v1.md`](./governance-simplification-analysis-v1.md) 之后的 v2 改进方案。

v1 主要解决“人类入口和叙事如何收敛”。v2 继续解决“执行平台如何少做重复工作、如何安全复用证据、如何解释长流程状态、如何缩短部署演练反馈”。两者不是替代关系：

| 文档 | 关注点 | 不变约束 |
| --- | --- | --- |
| v1 | 入口收敛、story/risk/level 模型、evidence claim 方向、governance runner 初步分层 | 不降低 release readiness 证据要求 |
| v2 | 增量验证、内容键构建、session 化 real lane、rehearsal world 复用、operator projection、阶段化诊断 | 不绕过 producer-owned evidence 和 terminal aggregate |

本文不是新的 authoritative truth。当前工程真相仍然以以下对象为准：

1. 产品范围与术语：[`docs/项目宪法.md`](../项目宪法.md)、[`docs/contracts/product-terminology.md`](../contracts/product-terminology.md)
2. 工程治理方法论：[`docs/design/agentsmith-product-engineering-governance-methodology-v1.md`](../design/agentsmith-product-engineering-governance-methodology-v1.md)
3. v1 治理收敛计划：[`governance-simplification-analysis-v1.md`](./governance-simplification-analysis-v1.md)
4. 机器可读治理真相：`scripts/governance/current-gate-manifest.ts`、`current-workflow-manifest.ts`、`current-verification-campaign-manifest.ts`、`current-runtime-line-manifest.ts`
5. 当前证据与运行计划模型：`current-evidence-claim-schema.ts`、`current-job-metadata-manifest.ts`、`current-resource-lock-manifest.ts`、`governance-run-plan.ts`

本文中的新对象进入实现前，必须同步 contracts、manifests、docs、tests 和 release gate。若本文与 current truth 冲突，以 current truth 为准，并优先修正文档或 manifests，不允许靠口头约定补齐。

### 0.1 执行者只读合约

普通开发、测试、部署、发布执行者只需要记住下面入口。v2 的新增能力必须藏在这些入口背后，不能新增公开 muscle memory。

| 场景 | 唯一公开入口 | 不应该要求普通执行者调用 |
| --- | --- | --- |
| 前端 / mock 开发 | `npm run dev` | `gate:*`、`lane:*` |
| 日常验证计划 | `npm run verify` | 直接挑 `test:*` 或 `verify:*` |
| 日常验证执行 | `npm run verify -- --goal=<debug|pr|visual|real> --run` | `backend-real:*`、`release:campaign:*` |
| 真实本地环境 | `make local-real-up/status/down/reset` | substrate/local-manual 低层组合命令 |
| 发布前验收 | `npm run release:ready` | `release:campaign:*`、`gate:release:*` |
| 发布状态查看 | `npm run release:status` | 直接读多处 artifacts 后自行判断 |
| 本地演练 | `npm run rehearse:demo` / `npm run rehearse:cluster` | demo/cluster 分阶段低层命令 |

`verify --run` 的公开语义必须在 P0 锁定：

1. 默认 `npm run verify` 只做 dry-run 计划，不执行 heavy runtime checks。
2. `--run` 只执行当前 goal 下的安全推荐集。
3. real、release、rehearsal 等重型验证必须通过显式 goal 或对应 clean entrypoint 触发。
4. 任何自动跳过都必须在报告中说明证据来源；无法证明时 fail-closed。

### 0.2 v2 对 v1 的扩展关系

开发团队不需要自行合并 v1 和 v2。实施时按以下规则理解：

| 主题 | v1 保持不变 | v2 新增要求 |
| --- | --- | --- |
| 人类入口 | v1 clean entrypoints 是唯一公开入口 | v2 不新增公开入口，只增强 status/projection 和底层执行 |
| release verdict | 只来自 campaign-scoped producer evidence + terminal aggregate | projection 只能引用 aggregate result，不产生 verdict |
| evidence claim | 是可复用证据索引，不是 verdict source | claim 只索引 producer-owned result/evidence，不承载 session/build cache |
| rehearsal | demo/cluster rehearsal 是本机排演 | standalone `release-fidelity` 是 release-compatible diagnostic；只有 campaign step 内产物才是 V4 release evidence |
| 旧命令 | 只能作为 internal adapter / maintainer diagnostic | v2 P0 必须继续保证 help/docs/quick path 不把旧命令当普通入口 |

### 0.3 v2 硬前置

任何实现切片开始前，必须先确认：

1. clean human entrypoints 已经是唯一公开叙事。
2. projection/status 是只读 pointer，不是第二套 verdict。
3. `goal` 与 `runtime_line` 分开建模，不发明未注册的 runtime line。
4. stage 诊断使用 `diagnostic_reason_code` 或 `stage_failure_reason`；只有 registered result writer 能写 `failure_class`。
5. failure bundle 只能写 redacted env、presence booleans、profile digest，禁止落 token、ticket、API key、OAuth token、managed credential value。

## 1. 背景

近期一次完整的治理、测试、修复、验证和部署演练任务耗时过长。复盘显示，慢的原因不是“测试太多”或“治理过严”，而是执行层存在系统性重复成本：

1. 同一层验证被多次完整启动环境。
2. mock / backend-real / runner backend-real 按 spec 或 grep 重新启动服务、初始化数据和 warm routes。
3. demo / cluster rehearsal 多次执行全量 build、save、load、push、kind image import。
4. release campaign 已有 DAG 结构，但实际执行仍偏串行。
5. evidence claim 还没有成为运行时缓存、复用和 resume 的核心机制。
6. 日志和报告分散在 scenario state、native result、campaign summary、release status 等多个层级，用户难以判断主阻塞点。

这是一类工程治理平台问题。解决方向不是降低 gate，也不是减少 user story 覆盖，而是把执行平台升级为 evidence-driven incremental governance。

## 2. 北极星目标

v2 的目标是：在不降低治理能力的前提下，大幅降低开发、测试、部署人员的等待时间和心智负担。

具体目标：

1. 高质量验证仍然保留，特别是 contract、unit、mock e2e、visual、backend-real、release campaign、demo rehearsal、cluster rehearsal。
2. 日常开发默认只跑与改动相关的最小必要验证，但风险不明时 fail-closed 升级验证级别。
3. 可复用结果必须由 evidence claim 证明，不能因为文件存在就复用。
4. 长流程必须能解释“现在在哪、为什么卡、下一步做什么、证据在哪、恢复是否安全”。
5. 发布级 V4 仍必须由 campaign-scoped producer-owned evidence 和 terminal aggregate 给出结论。
6. 本地 rehearsal 可以更快，但正式发布证据仍必须来自 campaign step 内的 release-grade evidence。

预期效果：

| 场景 | v1 / 当前痛点 | v2 目标 |
| --- | --- | --- |
| 基础配置错误 | 常在长时间 build/e2e 后才暴露 | 1-2 分钟内由 sentinel preflight 失败快停 |
| 同源码重复 rehearsal | 仍可能重建 app/llmup、全量 save/load/push/import | 内容键命中后跳过昂贵构建和镜像搬运 |
| backend-real 多 spec | 多次启动 deps/API/Web/Keycloak | 同一 real session 内按 shard 执行 |
| 失败恢复 | 用户不知道该重跑哪条命令 | status projection 给出 primary blocker 和 safe next action |
| release 证据 | 不能降低可信度 | 保持 campaign-scoped evidence 和 terminal aggregate |

## 3. 非目标

本文明确不做：

1. 不减少 release readiness 必需证据。
2. 不删除 user story 覆盖来换速度。
3. 不把 diagnostic command 的成功当作 release verdict。
4. 不把缓存文件、summary、report 或 artifact index 当作 evidence truth。
5. 不让 visual automated pass 替代人工 UX review。
6. 不把本地 fast rehearsal 当作正式离线交付或发布验收。
7. 不把 release / deploy / rehearsal 实现细节提升为产品功能范围。
8. 不要求开发者理解全部 gate/lane/backend-real 内部命令。
9. 不做兼容旧治理叙事的双轨设计；v2 实施时应干净收敛，避免继续扩大心智负担。

## 4. 设计原则

### 4.1 Evidence first

所有验证结果复用、resume 和 status 判断都必须基于 current evidence claim schema 或 producer-owned canonical result。没有可校验证据就不能复用。

允许跳过的唯一理由是：输入、环境、产物和 producer identity 都被证明未变，且 claim freshness 允许当前 scope 复用。

`stage-events.jsonl`、`performance.json`、`skip-decisions.ndjson` 是审计和诊断产物，不是 gate evidence truth。它们不得声明 `passed`、`reusable`、`verdict`、`claim_id`，也不能满足 release verdict。

### 4.2 Fail closed

无法分类、无法证明、缺少 artifact、secret profile 不明、provider profile 不明、story fingerprint 不一致时，默认升级验证或要求重新执行。

### 4.3 Sessionize fixed cost

固定成本应一次支付，多次消费。典型固定成本包括：

1. Next mock server 启动和 route warm。
2. backend-real deps/API/Web/Keycloak/proxy 启动。
3. runner image / CSI / kind preload。
4. buildx cache、Cargo cache、Next build cache。

### 4.4 Separate release fidelity from local speed

本地调试可以复用健康 rehearsal world。发布前验证仍必须保留 campaign-scoped release path。fast 不是降低标准，而是更快发现问题；standalone `release-fidelity` 只是 release-compatible diagnostic rehearsal。只有在 release campaign step 内写入 campaign root、绑定 campaign id / run id / step id 并被 terminal aggregate 消费时，才算 V4 release evidence。

### 4.5 One operator projection

人不应在多个 artifact root 之间猜真相。v2 必须提供一个只读状态投影，将当前权威证据指向清楚，而不是创建新的 verdict source。

### 4.6 Keep old complexity internal

旧 `gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 可以继续作为内部 adapter 或 maintainer diagnostic，但普通开发、测试、发布路径应只暴露 v1 定义的 clean human entrypoints。

## 5. v2 总体架构

v2 由六个协作模块组成：

| 模块 | 职责 | 是否产生 verdict |
| --- | --- | --- |
| Verification Planner | 根据 diff、story、risk、goal 生成 required levels 和 run plan | 否 |
| Evidence Claim Store | 记录、校验、查询可复用证据 | 否 |
| Build Artifact Broker | 管理内容键镜像、release alias、build/cache/load/push/import skip | 否 |
| Real Session Runner | 管理 mock/backend-real/session 内 shard 执行 | 否 |
| Rehearsal World Manager | 管理 demo/cluster world、reset level、stage evidence | 否 |
| Operator Projection | 汇总状态、阻塞点、下一步、证据路径 | 否 |

正式 release verdict 仍只能来自：

1. campaign-scoped producer-owned evidence。
2. delegated terminal aggregate。
3. current verification campaign manifest 声明的 membership。

## 6. Verification Planner

### 6.1 目标

Planner 把“我改了代码，应该跑什么”从人工猜命令改为 story/risk/level 驱动。

输入：

1. git diff 和 changed files。
2. canonical user stories。
3. product surface mapping。
4. current gate / workflow / campaign manifests。
5. risk policy。
6. 最近失败 evidence 的 failure class。

输出：

1. affected stories。
2. affected surfaces。
3. required levels：V0-V4。
4. recommended jobs。
5. required evidence owners。
6. run plan DAG。
7. explainable why。

### 6.2 风险策略

Planner 不允许自动降级高风险验证。首版只允许自动升级，不允许自动下调 required levels。

| 改动类型 | 默认风险 | 必选验证 |
| --- | --- | --- |
| contracts、types、unit-only helpers | R2/R3 | V0，必要时 V1 |
| UI 页面、Design token、visual scene | R1/R2 | V0 + V1，视觉相关加 V2 |
| Chat / Notebook 状态同步 | R0/R1 | V0 + V1 + V3，发布前 V4 |
| runner、Context Store、ticket、managed credential | R0 | V0 + V1 + V3，发布前 V4 |
| Files、审计、用量、权限、成员治理 | R0/R1 | V0 + V1 + V3 |
| release/deploy/rehearsal scripts | R0 | V0 + V4 或对应 rehearsal |
| evidence writer、gate manifest、claim schema | R0 | V0 + governance contract + release dry-run / aggregate tests |

### 6.3 Planner 验收

1. 改 `src/` UI 文件能推荐 V1/V2，而不是默认全量 V4。
2. 改 runner / Context Store 能推荐 V3。
3. 改 release/deploy/rehearsal 能推荐 rehearsal 和 V4。
4. 未映射文件必须 fail-closed，输出“未知影响面，需要提高验证级别”。
5. 推荐计划必须解释每个 job 为什么被选中。

## 7. Evidence Claim Store

### 7.1 目标

Evidence claim 从 schema 走向运行时复用能力。它不是 verdict source，而是“某个 producer 在某个输入和环境下产出了可验证证据”的索引。

v2 不新增平行 claim truth。实现必须先对齐 `scripts/governance/current-evidence-claim-schema.ts`。若字段不足，必须 bump schema、更新 validator 和 tests，而不是在文档或脚本里临时扩展。

### 7.2 必须绑定的维度

可复用 claim 至少绑定：

| 维度 | 说明 |
| --- | --- |
| subject | 证明对象，例如 `backend_real.chat_runner` |
| scope | debug / pr / visual / real / release |
| campaign id | release claim 所属 campaign；非 release 可为 null |
| run id | producer run id |
| step id | campaign step id 或 producer step id |
| git sha | 源码版本 |
| input digest | 相关源码、lockfile、配置、tool versions |
| artifact digest | result、trace、screenshots、logs、manifest 的 digest |
| result digest | canonical result digest |
| result status | current gate result status |
| producer | command adapter、CI/local、Node/Playwright/Docker versions |
| gate id | current gate manifest 中的 stable id |
| gate adapter | current schema 中的 `gate_adapter.npm_script` |
| line kind | mock / visual / backend-real / rehearsal / release |
| evidence dir | producer-owned evidence 目录 |
| secret profile | backend-real/provider/credential profile digest |
| campaign root | release-grade claim 必须绑定 campaign root |
| freshness | 是否允许跨 commit、跨 branch、跨 profile |
| validator | 校验器名称和版本 |

### 7.3 复用规则

允许：

1. 同一 commit、同一 env profile、同一 stable gate/check identity 的 producer-owned evidence 复用。
2. release aggregate 复核同一 campaign root 下 producer-owned evidence。
3. stable check identity、path globs、cache policy 和 input digest 规则齐备后，再允许 pure checks 进入 claim reuse。

不属于 evidence claim 的复用：

1. mock / backend-real session 固定成本复用属于 lease / session state。
2. 内容键镜像构建复用属于 build manifest / content digest。
3. docker load、registry push、kind preload、K8s rollout skip 属于 operational skip audit。

禁止：

1. 复用 failed claim。
2. 复用缺少 artifact digest 的 claim。
3. backend-real 跨 provider profile 或 secret profile 复用。
4. visual automated result 直接替代人工 UX acceptance。
5. 当前 checkout 重造旧 story trace 的语义。
6. artifact index 扫目录后自行声明 passed / reusable / verdict。
7. 用 session state、build manifest 或 skip decision 冒充 claim。

### 7.4 Claim Store 验收

1. claim validator 与 current schema 对齐。
2. stable gate/check identity 不存在时，pure check 不能启用 reuse，只能输出 shadow recommendation。
3. secret profile 变化时 backend-real claim 必须失效。
4. artifact digest 缺失时 claim 不可复用。
5. release scope claim 必须带 campaign root、campaign id、run id、step id，否则不能作为 verdict candidate。
6. 所有 claim reuse 都写入 audit summary。

## 8. Build Artifact Broker

### 8.1 目标

把构建从“每个 release id 全量重做”改为“内容键构建 + release alias”。

核心模型：

```text
agentsmith-app:ck-<app_image_key>          # 内容键镜像
agentsmith-app:release-<release_id>        # release alias，只做 retag
llm-universal-proxy:ck-<llmup_key>
llm-universal-proxy:release-<release_id>
```

release id 的权威来源必须收敛：当 `RELEASE_ROOT/VERSION` 存在时，`VERSION.release_id` 是 release id 真相；显式 override 必须写入状态和证据，并校验 `state.release.id == VERSION.release_id`。`RELEASE_ID` 可以作为环境变量承载该真相，但不能在脚本内部静默生成一个与 bundle 不一致的新 id。

`RELEASE_ID` 仍然是发布、证据和报告主键，但不再强制导致基础镜像层和应用镜像层重建。

### 8.2 内容键建议

| Target | 内容键输入 |
| --- | --- |
| app deps | platform、node base digest、Dockerfile base、package-lock、workspace package manifests |
| app image | app deps key、src、public、messages、packages、scripts needed by build、Next/Tailwind/PostCSS/TS config、build-time `NEXT_PUBLIC_*` |
| runner base | platform、node base digest、runner base Dockerfile、package-lock、runner package manifests、Codex/JuiceFS versions |
| runner image | runner base key、runner src、chat/notebook runner src、builtin skills |
| llmup | Cargo.toml、Cargo.lock、rust-toolchain、src、release profile、Rust/runtime base digests |
| sandbox | manager-service tree、Dockerfile、go.mod/go.sum、base image digests |
| verify image | test deps、Playwright version、e2e config、scripts needed by verification |

llmup 的 runtime image key 不应包含 `tests/`，除非构建的是 test image。这样改测试不会重建 release runtime image。若当前 Dockerfile 仍 `COPY tests`，必须先拆 runtime target 和 test target，或从 runtime Dockerfile 移除 tests，再启用该验收。

### 8.2.1 `build-manifest.json`

每次 build / bundle / rehearsal 都必须产出 `build-manifest.json`，至少记录：

| 字段 | 说明 |
| --- | --- |
| release_id | 来自 `VERSION.release_id` 或显式 override |
| version_path | VERSION 文件路径 |
| target | app / runner / llmup / sandbox / verify |
| content_ref | `ck-*` 内容键镜像 ref |
| release_alias_ref | `release-*` alias ref |
| image_digest | 本地构建或远端 registry digest |
| input_digest | 内容键输入 digest |
| base_image_digest | base / dependency image digest |
| producer | 构建脚本、版本和运行环境 |
| generated_at | 生成时间 |

`VERSION` 不应只存 tag。进入 v2 后，VERSION 或 companion manifest 必须能追溯 tag + digest，否则 release alias 无法证明指向正确内容。

### 8.3 跳过策略

| 操作 | 跳过条件 |
| --- | --- |
| Docker build | 内容标签存在，label key 匹配，base digest 未变，未设置 `FORCE_REBUILD=1` |
| Docker save / archive | `fast` 模式允许跳过；`release-fidelity` 必须有 build-manifest digest 证明；`offline-package` 强制执行 |
| Docker load | 本地 image digest 已存在 |
| Registry push | 远端 manifest digest 已匹配 |
| kind preload | control-plane containerd 中 ref/digest 已存在 |
| K8s rollout | manifest hash 未变，rollout healthy，且 mode 允许 skip |

所有 skip 必须写入 `skip-decisions.ndjson`，包含：

1. target。
2. operation。
3. input digest。
4. existing artifact digest。
5. skip reason。
6. validator。
7. generated_at。

`SKIP_BUNDLED_IMAGE_LOAD=1`、跳过 archive 生成、跳过 push/import 这类开关只能在 `fast` mode 或有 digest 证明的 `release-fidelity` 中生效。`offline-package` 禁止使用人工 skip 开关绕过离线包完整性证明。

### 8.4 BuildKit cache

建议：

1. Next build 使用 `.next/cache` cache mount。
2. Cargo 使用 registry/git/target cache mount。
3. Go 使用 module/build cache mount。
4. buildx bake 或脚本 DAG 按 target 并行，默认 `BUILD_PARALLELISM=2`。
5. base/dependency image digest 固化到 lock 文件，不允许 `latest` 静默漂移。

第三方镜像必须有 `thirdparty-images.lock` 或等价 lock 文件，记录 tag 到 digest。`latest` 只能在显式 refresh 流程里解析，解析结果必须进入 content key。

### 8.5 Broker 验收

1. 同源码第二次 demo/cluster rehearsal 不触发 Next build。
2. 同源码第二次不触发 llmup Cargo release build。
3. 同源码第二次不触发 docker save/load/push/kind import。
4. 改 chat runner 只重建相关 runner image。
5. 改 llmup `src` 只重建 llmup。
6. 改 llmup `tests` 不重建 runtime image。
7. `offline-package` 仍能强制验证离线包完整性。

## 9. Real Session Runner

### 9.1 目标

把 backend-real 和 mock e2e 从“每个 spec/grep 重启完整世界”改成“一次 session，多 shard 执行”。

session 化必须先建立协议，再改 wrapper。不能只把多个 grep 拼到一个命令里。

### 9.1.1 Session CLI 协议

mock 和 backend-real session runner 必须提供稳定三段式接口：

```bash
session start --kind=<mock|backend-real> --run-root=<path> --port-family=<id>
session run-shard --session-root=<path> --shard=<id>
session finish --session-root=<path>
```

协议字段：

| 字段 | 说明 |
| --- | --- |
| `session_id` | 当前 session 唯一 id |
| `session_root` | session 产物根目录 |
| `pid_file` | API/Web/runner/server pid 记录 |
| `port_family` | 分配的端口族 |
| `secret_profile_digest` | redacted profile digest |
| `started_at` / `finished_at` | 生命周期 |
| `shards/<id>/result.json` | shard canonical result |
| `shards/<id>/evidence/` | shard-owned evidence |
| `aggregate.json` | session 聚合状态，不替代 gate verdict |

退出码聚合规则：

1. `session start` 失败表示基础设施失败，不执行 shards。
2. `run-shard` assertion 失败只标记该 shard failed，不重跑已通过 shard。
3. `finish` 必须尽力收集 evidence 和清理进程；清理失败单独记录 diagnostic，不覆盖原始失败。
4. session aggregate 不能作为 release verdict，只能被 owning producer wrapper 消费并写 canonical result。

### 9.1.2 当前覆盖映射要求

实施前必须生成并维护“current gate/spec/grep -> shard -> evidence owner”映射。任何现有 real/runner gate 未归属时，contract test 必须失败。

最小映射表字段：

| 字段 | 说明 |
| --- | --- |
| current npm script | 例如 `test:skills:backend-real` |
| current gate id | current gate manifest id |
| spec / grep | 当前 Playwright spec 或 grep |
| proposed shard | v2 shard id |
| isolation level | process / workspace / db-checkpoint / serialized |
| mutable resources | workspace、project、Context Store、runner task、files、usage/audit |
| evidence owner | canonical result / trace bundle owner |
| merge allowed | 是否允许与其他 shard 同 session |

未映射项默认不能合并，必须继续走原有独立 wrapper。

### 9.2 Mock lane session

目标：

1. 一次启动 mock Next server。
2. 一次 route warm。
3. 在同一 server 生命周期内跑 smoke、chromium、chromium-serial、targeted visual。
4. serial 项仍保持串行，但不重复启动 server。

注意：

1. visual baseline update 仍必须独占。
2. assertion failure 不应靠自动 retry 隐藏。
3. server listener lost 这类基础设施错误可以由 wrapper retry。

### 9.3 Backend-real session

目标：

1. 一次 deps up / bootstrap。
2. 一次 API/Web/Keycloak/proxy 启动。
3. 一次 route warm。
4. 多个 shard 顺序或安全并行执行。
5. shard 之间通过 DB reset、seed checkpoint 或 workspace isolation 保证隔离。

建议 shard：

| Shard | 覆盖 |
| --- | --- |
| identity-governance | 登录、成员、工作区/项目权限 |
| files | 文件库、中文文件名、mount sync、资源恢复 |
| external-chat-runner | chat external runner、endpoint credential、proxy |
| external-notebook-context | notebook task、Context Store、cancel/terminate/resync |
| usage-audit | audit、usage、trace、governance report |
| internal-k8s | internal agent、terminal pod、CSI、sandbox lifecycle |

internal-k8s 首阶段保持单并发。只有 namespace、ports、image cache、CSI 状态全部隔离后，才允许并行。

### 9.3.1 Shard 隔离契约

每个 shard 必须声明隔离级别：

| 隔离级别 | 说明 | 默认并发 |
| --- | --- | --- |
| process | 需要独立 API/Web/runner 进程 | 不并发 |
| db-checkpoint | 可共享进程，但 shard 前后恢复数据 checkpoint | 有锁后可并发 |
| workspace | 使用独立 workspace/project/user 数据隔离 | 有锁后可并发 |
| serialized | 可共享 session，但必须串行 | 串行 |

如果 shard 修改 `ws_default`、固定用户、Context Store、project creator、runner mount、usage/audit 等共享资源，且未声明隔离和清理策略，默认 `serialized`。

runner backend-real 的 grep 合并必须保留：

1. runner log。
2. workspace mount cleanup evidence。
3. Context Store ownership / isolation evidence。
4. ticket / managed credential redaction evidence。
5. force stop / cancel / status resync 相关 trace。

### 9.4 Timeout 和诊断

所有长 `expect.poll` 和 agent wait 必须带 phase id：

1. `phase_id`
2. workspace/project/task/agent id
3. last HTTP status
4. truncated response body
5. elapsed time
6. latest trace id
7. next diagnostic hint

失败 bundle 至少包含：

1. redacted resolved env。
2. API/Web log tail。
3. Playwright trace。
4. console/pageerror/network summary。
5. runner log。
6. sandbox readyz。
7. kubectl pods/events/describe。
8. docker ps 和 image ids。

redacted env 只能包含 key presence、profile digest、public endpoint、port family，不得写入 token、ticket、API key、OAuth token、managed credential value。

retry 必须基于结构化结果分类：

1. infra/bootstrap failure 可以重跑未开始或 infra-failed shard。
2. assertion failure、visual diff、contract drift 不自动 retry。
3. session retry 不能重跑已通过 shard，除非其 evidence 被标记 stale 或 corrupted。

### 9.5 Session Runner 验收

1. mock full lane 不再重复启动多个 mock server。
2. backend-real 多 shard 不再重复 deps/API/Web/Keycloak 启动。
3. runner backend-real 不再按 10 个 grep 启动 10 次 wrapper。
4. 每个 shard 仍有独立 evidence。
5. 失败时能定位到 stage 和最深层日志，而不是只看到超时。
6. 当前 gate/spec/grep 覆盖映射 contract test 通过。
7. shard 污染哨兵测试通过，证明共享 session 没有串状态。

## 10. Rehearsal World Manager

### 10.1 目标

demo/cluster rehearsal 应同时支持快反馈和发布可信度。v2 使用独立 `REHEARSAL_MODE` 明确区分。不要复用 `DEMO_DEPLOY_MODE` 或 `CLUSTER_DEPLOY_MODE` 表达 rehearsal 语义，避免部署模式和演练可信度模式混淆。

| Mode | 使用场景 | 行为 |
| --- | --- | --- |
| `fast` | 本地开发/修复后快速确认 | 可复用健康 world，跳过未变化 build/load/rollout |
| `release-fidelity` | 发布前 rehearsal 兼容诊断 | clean reset + 内容缓存 + deploy/bootstrap/verify/report；standalone 结果不能替代 V4 |
| `offline-package` | 离线交付包验证 | 强制 archive、load、publish、kind import、完整 verify |

只有 `release-fidelity` 在 `release:campaign:full` 对应 step 内运行、写入 campaign root、绑定 campaign id / run id / step id，并被 terminal aggregate 消费时，才是 V4 release evidence。

### 10.2 Reset levels

提供清晰 reset level，避免“一卡住就全删”：

| Level | 说明 |
| --- | --- |
| `none` | 只读 status，不改环境 |
| `soft` | 重启失效服务，不清数据 |
| `data` | 重置业务数据和 seed，不重建 kind/registry |
| `substrate` | 重建 local substrate，但保留 image cache |
| `world` | 重建 kind cluster、registry、scenario world |

release-fidelity 默认至少 `data` 或按 current release policy clean reset。offline-package 可以强制 `world`。`world` 级 reset 是 destructive recovery，必须在 status/projection 中明确标记，不能作为默认自动恢复动作。

### 10.3 Stage evidence

每个 rehearsal 必须按 stage 产出证据：

```text
reset
up
bootstrap
verify
report
```

每个 stage 写入：

1. `stage-events.jsonl`
2. `performance.json`
3. `skip-decisions.ndjson`
4. stage log path
5. stage input digest
6. stage artifact digest
7. `diagnostic_reason_code` 或 `stage_failure_reason`

stage 产物不得写 `failure_class`，除非该 stage 本身是 registered canonical result writer。`failure_class` 仍属于 current gate result schema。

### 10.4 World reuse 条件

fast mode 允许复用 world，但必须同时满足：

1. scenario world id 匹配。
2. public base、port family、DNS policy、registry env 匹配。
3. kind config 匹配。
4. image manifest digest 匹配或可完成无 diff rollout。
5. deploy scripts digest 未变，或变化不影响当前 stage。
6. health check 通过。
7. 没有 active destructive command。

否则 fail-closed，要求更高 reset level。

### 10.5 Rehearsal 验收

1. `fast` 重跑同源码时不重建 world，不全量导入镜像。
2. standalone `release-fidelity` 仍执行 deploy/bootstrap/verify/report，并产出 release-compatible diagnostic evidence。
3. `offline-package` 能证明离线 bundle 完整。
4. 所有 skip 都可审计。
5. 失败后 status 能明确 safe reset level。
6. campaign 内的 rehearsal evidence 绑定 campaign id / run id / step id，并能被 terminal aggregate 复核。

## 11. Operator Projection

### 11.1 目标

降低开发、测试、部署人员的心智负担。用户只看一个入口，就能知道当前治理状态。

只允许一个 projection schema，但通过既有 clean entrypoints 展示：`release:status`、`npm run verify -- --status`、`npm run rehearse:demo -- --status`、`npm run rehearse:cluster -- --status`、`make local-real-status`。不要新增公开 `ops-status` 入口。

第一屏固定回答：

```text
Goal: release-ready / demo-rehearsal / cluster-rehearsal / verify
Phase: reset -> up -> bootstrap -> verify -> report
Aggregate status ref: <campaign-root>/gate-release-full/result.json or null
Presentation status: passed / failed / not-started / running / unknown / stale
Primary blocker: <owning producer or stage>
Deepest reason: <diagnostic reason code and summary>
Next action: <one command>
Recovery: <safe action and destructive action if needed>
Freshness: current git sha, evidence git sha, run age
Locks: active lock owner / pid if any
Manual sign-off: covered / not-covered / required
Evidence: <summary/report/result/log paths>
Authority: <which artifact is authoritative for aggregate/stage/evidence>
```

### 11.2 权威分层

Projection 不创造新真相，只指向权威来源：

| 问题 | 权威来源 |
| --- | --- |
| release aggregate status | `<campaign-root>/gate-release-full/result.json` + aggregate evidence digest |
| latest release pointer | release summary / latest pointer，仅用于 presentation |
| scenario phase | scenario deploy-state / stage-events |
| evidence completeness | canonical result / evidence contract validator |
| gate failure class | current gate result schema，仅 canonical result writer 可写 |
| stage diagnostic reason | stage event / producer diagnostic |
| next action | diagnostic reason + owning producer mapping |
| recovery safety | scenario lock / world mutated / active pid |

### 11.3 Failure owner chain

失败定位按 owner chain 展示：

```text
campaign result
-> native result
-> scenario state/report
-> stage event
-> service/preflight log
-> runner/playwright/kubectl/docker log
```

如果最深层证据缺失，应分类为 `evidence_missing`，不要泛化成 product regression。

Projection 必须提供 owner map：

| 输入 | 输出 |
| --- | --- |
| failure class or diagnostic reason | owning producer |
| owning producer | safe command |
| destructive recovery needed | destructive command and warning |
| unknown reason | escalation owner |

`evidence_missing` 如果来自 canonical result，可以作为 `failure_class` 展示；如果只来自 stage/log，则只能作为 `diagnostic_reason_code` 展示。

### 11.4 Projection 验收

1. 失败后第一屏能看到 primary blocker。
2. downstream skipped 与 primary blocker 明确区分。
3. status 输出 safe next command 和 destructive recovery command。
4. 所有 evidence paths 都能打开。
5. `--json` 输出有稳定 schema，可用于 CI 或后续 UI。
6. projection 不写 release verdict，只引用 aggregate result。
7. passed、stale、running、blocked、evidence_missing 至少有 fixture tests。

## 12. DAG Scheduling 和资源锁

### 12.1 当前问题

current manifests 已经表达了部分依赖关系，但实际执行仍偏串行。v2 应逐步把 run plan 变成真正 scheduler。

### 12.2 并行原则

可以优先并行：

1. pure checks：contracts、openapi、lint、typecheck、unit。
2. `gate-default` 与 full visual，在 `gate-fast` 之后作为潜在并行组。
3. mock shards，在同一 session 或隔离 session 内。
4. demo / cluster rehearsal，在 port family、kind cluster、registry、runtime root 完全隔离后。

现阶段 current lock truth 仍可能把 `gate-default`、visual、shared local substrate 标记为本机互斥。v2 scheduler 首先只能在 plan-only 中展示潜在并行和阻塞锁原因。只有引入独立 port family、current alias、runtime root，并更新 `current-resource-lock-manifest.ts` 后，才能启用实际并行。

暂不并行：

1. shared substrate lifecycle。
2. destructive reset/down/reseed。
3. visual baseline update。
4. provider quota 未建模的 backend-real LLM calls。
5. internal-k8s CSI/image-load 共享路径。

### 12.3 资源锁细化

现有 lock 偏粗。v2 应把锁从 local host 级逐步拆为：

| Lock | Scope key |
| --- | --- |
| campaign root writes | campaign run id |
| release latest pointer | repo + pointer name |
| scenario world | line + world id |
| port family | line + allocated port family |
| provider profile quota | provider profile digest |
| secret profile | secret profile digest |
| visual baseline | baseline root |
| artifact current pointer | runtime line + alias |

细化锁必须先 shadow 观察，再启用并发。不能为了并行牺牲隔离。

### 12.4 Scheduler 验收

1. plan-only 输出显示可并行组和锁原因。
2. 非 release 目标在锁允许时可安全并行 pure checks。
3. release 目标的 terminal aggregate 仍等待所有 producer evidence。
4. 锁冲突时输出等待的 lock owner 和 safe action。
5. 任何并行失败都不会覆盖其他 producer evidence。

## 13. 执行阶段计划

### P0：观测、状态投影、失败快停

目标：先让慢流程变得可解释，并把基础错误前移暴露。P0 同时继承 v1 P0：clean human entrypoints 必须保持唯一公开叙事。

交付：

1. help/docs/quick path 只暴露 clean human entrypoints。
2. `verify --run` CLI contract 锁定：默认 dry-run，heavy checks 必须显式 goal。
3. `stage-events.jsonl` 通用格式。
4. `performance.json` 通用阶段耗时。
5. `skip-decisions.ndjson` 通用审计记录，不作为 evidence truth。
6. projection schema 通过既有 clean entrypoints 展示，不新增公开 `ops-status`。
7. Sentinel preflight：
   - internal execution WS base URL correctness
   - proxy data token / ticket auth
   - Keycloak redirect bases
   - DNS and gateway reachability
   - provider profile / secret profile presence
   - kind / registry / docker availability
8. failure owner chain 和 wrapper diagnostic taxonomy 改进。
9. read-only `REHEARSAL_MODE` / reset level / world identity schema，先定义 skip invalidation 字段。
10. minimal lease/status shadow model：active run、destructive command lock、port family、secret profile lock，只读展示，不执行 lease acquisition。

验收：

1. 基础配置错误在 1-2 分钟内失败。
2. 用户能从 status 第一屏知道下一步。
3. `wrapped command exited with status 1` 不再是主要诊断原因。
4. 所有长流程都有阶段耗时报告。
5. failure bundle redaction contract test 通过。
6. projection 不产生 release verdict，只引用 aggregate result。
7. minimal lease/status shadow model 能解释 P3 session runner 的前置锁和状态。

### P1：Evidence claim 运行时复用

目标：先让低风险 pure checks 安全复用，但必须先补 stable gate/check identity。

交付：

1. stable check identity 或 owning gate/job mapping。
2. job metadata `path_globs`、cache policy、input digest 规则。
3. Claim Store 最小实现。
4. pure checks input digest。
5. artifact digest validator。
6. claim reuse audit。
7. non-release shadow mode，对比命中率和误判风险。

验收：

1. stable identity 缺失时只输出 shadow recommendation，不启用 reuse。
2. contracts/openapi/lint/typecheck/unit 同 commit 可复用。
3. artifact digest 缺失时拒绝复用。
4. claim reuse 出现在 summary 中。
5. release scope 暂不复用跨 campaign claim。

### P2：内容键构建和镜像跳过

目标：消除 demo/cluster rehearsal 的重复 build/save/load/push/import。

交付：

1. `VERSION.release_id` truth 校验。
2. base/dependency image digest lock。
3. 内容键计算器。
4. image label / content tag。
5. release alias retag。
6. registry digest probe。
7. kind containerd digest probe。
8. BuildKit cache mount。
9. `build-manifest.json`。
10. llmup runtime/test Docker target 拆分或移除 runtime `tests` copy。

验收：

1. 同源码第二次 rehearsal 不触发 app/llmup build。
2. 同源码第二次不做全量 image import。
3. 改不同 target 只重建受影响镜像。
4. skip decisions 可审计，但不满足 gate evidence。
5. `release-fidelity` / `offline-package` 禁止无 digest 证明的人工 skip。

### P3：Session 化 real lane

目标：消除 backend-real 和 mock e2e 的重复启动。P3 开始前必须已有 minimal lease/status：active run、destructive command lock、port family、secret profile lock。

交付：

1. current gate/spec/grep -> shard -> evidence owner 映射。
2. session start/run-shard/finish CLI。
3. shard isolation contract。
4. mock lane shared server session。
5. backend-real session runner。
6. runner backend-real shard 合并。
7. shard-level evidence。
8. phase-aware poll helper。
9. failure bundle 标准化。

验收：

1. mock full 不重复启动服务。
2. backend-real 多 shard 共享 deps/API/Web/Keycloak。
3. runner backend-real wrapper 次数显著减少。
4. 每个 shard evidence 仍独立可追溯。
5. 未映射 current gate/spec/grep 会导致 contract test 失败。
6. retry 不吞 assertion failure。

### P4：Rehearsal modes 和 world manager

目标：区分本地快反馈、发布可信度、离线包验证。

交付：

1. 独立 `REHEARSAL_MODE=fast|release-fidelity|offline-package`。
2. reset levels。
3. world health snapshot。
4. manifest hash driven rollout。
5. no-diff rollout skip evidence。

验收：

1. fast mode 同源码重跑显著加快。
2. standalone release-fidelity 不降低 release-compatible diagnostic 证据。
3. offline-package 保留完整离线交付证明。
4. campaign step 内 release-fidelity 产物可被 terminal aggregate 复核。

### P5：DAG scheduler 和 CI 收口

目标：让治理 runner 真正调度，而不是 shell 串行包装。

交付：

1. executing DAG scheduler。
2. lease acquisition / renewal / release。
3. parallel groups。
4. resume plan。
5. CI 入口收敛。
6. campaign-scoped aggregate integration。

验收：

1. `gate-default` 和 visual 在 lock manifest 允许后可安全并行；允许前只做 plan-only shadow。
2. 失败后 resume plan 指出需要补跑的 producers 和 downstream aggregate。
3. CI 与本地共用 run plan。
4. release verdict 仍来自 terminal aggregate。

## 14. TDD 与验证策略

v2 实施必须继续 TDD。建议按层补测试：

| 层 | 测试 |
| --- | --- |
| Planner | fixture diff -> affected stories / required levels / selected jobs |
| Claim Store | valid/invalid claim、digest mismatch、secret profile mismatch、scope mismatch |
| Build Broker | content key、retag、skip decisions、llmup tests 不影响 runtime key |
| Session Runner | current coverage mapping、wrapper invocation count、shard evidence、failure bundle、state pollution sentinel |
| Rehearsal Manager | mode/reset matrix、world reuse fail-closed、stage events |
| Operator Projection | passed/stale/running/blocked/evidence_missing fixture -> primary blocker / next action |
| Scheduler | DAG ordering、lock conflict、parallel group shadow、resume plan |

强制防回归用例：

1. 当前 real/runner gate 覆盖归属测试：任何 current npm script / spec / grep 未映射到 shard 时失败。
2. wrapper invocation count fixture：证明 session 化减少启动次数，但不减少 shard 数。
3. 跨 shard 污染哨兵：共享 session 下 Context Store、workspace、runner mount、usage/audit 不串状态。
4. failure bundle schema + redaction 测试：不得出现 token、ticket、API key、OAuth token、managed credential value。
5. retry 不吞 assertion 测试：assertion failure 不因 infra retry 变绿。
6. runner log / mount cleanup evidence 测试。
7. parallel lock shadow 测试：只报告潜在并行，不越过 current locks。
8. `VERSION.release_id` 与 deploy state 一致性测试。
9. `SKIP_BUNDLED_IMAGE_LOAD` 在 release-fidelity/offline-package 下的 fail-closed 测试。

每个阶段至少需要：

1. unit tests。
2. contract/schema tests。
3. shell smoke 或 fixture integration。
4. 对影响 real lane 的改动，跑对应 backend-real targeted gate。
5. 对影响 rehearsal 的改动，跑 demo/cluster rehearsal 对应 mode smoke。

## 15. 报告和产物约定

建议统一 projection 产物，但不要发明未注册 runtime line。`goal` 与 `runtime_line` 必须分开：

| 类型 | 建议位置 |
| --- | --- |
| release status | `artifacts/release-runs/<campaign-run-id>/status.json` 和 latest pointer |
| governance verify/run status | governance run root，例如 `artifacts/governance-runs/<run-id>/status.json` |
| registered runtime line status | `artifacts/runtime/lines/<runtime-line>/current/status.json` |
| demo/cluster scenario 历史产物 | 可以继续留在 `artifacts/runtime/scenario/<line>`，由 status pointer 指向 |

只有 `current-runtime-line-manifest.ts` 中已注册的 runtime line 才能出现在 `artifacts/runtime/lines/<runtime-line>`。

`local-real` 是人类入口 goal，不是新的 runtime line。实现层必须映射到已注册的 `local-manual` runtime line。

建议统一 run-scoped 产物：

```text
<run-root>/status.json
<run-root>/status.md
<run-root>/stage-events.jsonl
<run-root>/performance.json
<run-root>/skip-decisions.ndjson
<run-root>/build-manifest.json
<run-root>/evidence-claims.jsonl
```

如果历史 scripts 仍写入 `artifacts/runtime/scenario/<line>` 或 release campaign root，`current/status.json` 只做 pointer，不移动重 artifacts。

`status.json` 最小字段：

| 字段 | 说明 |
| --- | --- |
| schema | projection schema |
| goal | verify / release-ready / demo-rehearsal / cluster-rehearsal / local-real，runtime-line-only status 可为 null |
| runtime_line | 已注册 runtime line，若不适用则为 null |
| run_id | 当前 run |
| current_git_sha | 当前源码版本 |
| evidence_git_sha | evidence 对应源码版本 |
| run_age_seconds | run age |
| phase | 当前或最终阶段 |
| aggregate_status_ref | aggregate result path 和 digest，若不适用则为 null |
| presentation_status | passed / failed / not-started / running / unknown / stale |
| primary_blocker | 主阻塞点 |
| downstream_skipped | 下游未执行项 |
| deepest_reason | 最深层原因 |
| safe_next_command | 安全下一步 |
| destructive_recovery_command | 如需要，明确标注 destructive |
| lock_owner | active lock owner / pid |
| manual_signoff_status | covered / not-covered / required |
| evidence_paths | 权威证据路径 |
| authority_paths | aggregate/stage/evidence 对应权威来源 |

## 16. 开发切片建议

推荐顺序：

1. status projection fixture tests。
2. stage-events/performance/skip-decisions schema。
3. sentinel preflight。
4. wrapper diagnostic taxonomy。
5. read-only rehearsal mode/reset/world identity schema。
6. minimal lease/status shadow model。
7. stable check identity and job metadata cache policy。
8. pure check claim store。
9. claim reuse audit summary。
10. build content key calculator。
11. `VERSION.release_id` truth and base image digest lock。
12. app/llmup image content tag + release alias。
13. docker/registry/kind digest probes。
14. current gate/spec/grep coverage mapping。
15. mock shared session。
16. backend-real session runner。
17. runner backend-real shard consolidation。
18. rehearsal mode/reset/world health。
19. manifest-hash rollout skip。
20. executing DAG scheduler。
21. CI 收口。

原则：每个切片都必须可独立验收，并且不能要求开发者先理解未来完整平台才能使用。

## 17. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| claim 误复用 | 放过真实回归 | digest、secret profile、artifact validator、fail-closed |
| 过度并行 | 端口、数据、provider quota 冲突 | 先 shadow lock，后启用并行 |
| fast rehearsal 掩盖部署问题 | 发布前漏问题 | campaign-scoped release evidence 和 offline-package 保留完整路径 |
| status projection 变成第二套真相 | 用户误判 verdict | projection 只读，并显示 authority paths |
| session 化导致测试串状态 | 假阳性/假阴性 | shard isolation、DB checkpoint、workspace isolation |
| Build cache 隐藏基础镜像漂移 | 发布不可复现 | base digest lock、FORCE_REFRESH、build manifest |
| 文档过度复杂 | 增加心智负担 | 人类入口保持 v1 clean entrypoints，v2 复杂度只在 maintainer 文档 |

## 18. 完成定义

v2 不能只看脚本通过。完成必须满足：

1. 人类入口没有增加，仍以 `npm run verify`、`npm run release:ready/status`、`npm run rehearse:*`、`make local-real-*` 为主。
2. 同源码重复 rehearsal 明显减少昂贵 build/image 操作。
3. backend-real 和 mock lane 的重复启动次数明显下降。
4. verification reuse 都有 valid evidence claim；operational skip 都有 skip decision audit。
5. 失败后 status 能明确 primary blocker 和 safe next action。
6. standalone release-fidelity 产出 release-compatible diagnostic evidence；V4 release evidence 只来自 campaign-scoped producer evidence。
7. CI 与本地复用同一 run plan 或同一 projection schema。
8. 文档、manifests、contracts、tests 同步更新，没有并行叙事。

## 19. 推荐首批落地范围

为了最快降低下一次长任务风险，建议首批只做四件事：

1. 完整 P0：clean entrypoints/help/docs、`verify --run` CLI contract、status projection、stage timing、sentinel preflight、minimal lease/status shadow。
2. P1 stable check identity + pure check evidence claim shadow/reuse。
3. P2 app/llmup 内容键镜像、VERSION truth、digest skip。
4. P3 current coverage mapping + backend-real session runner 的最小 shard 化。

这四项风险最低、收益最高，并且不会影响 release verdict 权威边界。后续再进入 rehearsal mode、world manager、executing DAG scheduler。
