# 发布前检查体验简化计划 v3

<!-- markdownlint-disable MD013 -->

Status: `team_reviewed_handoff_ready`
Date: 2026-05-16
Owner: Engineering governance maintainers

## 1. 目标

这份计划用于下一轮治理收口开发。目标不是增加新治理体系，而是在不降低发布质量和检查证据要求的前提下，让开发、测试和部署人员更快、更少心智负担地完成检查。

成功标准：

1. 普通开发者只需要知道少数入口：`npm run verify`、`npm run verify -- --goal=<pr|real|visual> --run`、`npm run release:ready`、`npm run release:status`、`make local-real-up`、`make local-real-status`、`make local-real-down`、`make local-real-reset`。
2. `release:ready` 的发布级检查不减项，但同一次命令内不重复启动真实服务、不重复初始化依赖、不重复准备同一批镜像。
3. 检查结束后，摘要直接告诉人：结论、能否继续、主要阻塞项、原因、下一步、最慢步骤、报告位置。
4. 内部诊断命令仍保留给维护者，但普通流程不再要求人复制这些命令。

## 2. 当前基线

最近一次完整发布前检查：

- Run: `release-ready-20260516T160306Z`
- Commit: `18c333d4d353bc4a818d5a1b4870614ed973b74d`
- 报告目录：`artifacts/release-runs/release-ready-20260516T160306Z`
- 自动化结果：通过
- 人工发布签署：未覆盖
- 总耗时：约 90 分 27 秒

主要耗时来源：

| 部分 | 近似耗时 | 观察 |
| --- | ---: | --- |
| 发布前早失败检查 | 约 18 分 15 秒 | 名义是早失败检查，但实际包含真实服务启动、浏览器场景和 Agent task 重检查 |
| 全量视觉检查 | 约 16 分 51 秒 | 发布级必须保留；非发布小改动不应误触发 |
| 真实后端发布检查 | 约 46 分 08 秒 | 多个真实会话串行，包含 Runner、Files、Agent task、视觉复核、发布用户故事 |
| 部署检查 | 约 2 分 43 秒 | 时间不长，但入口和命名分裂，容易误解 |

判断：

- 治理本身有价值，本轮确实发现过发布阻断问题。
- 需要改的是重复启动、重复初始化、摘要不透明和内部术语外溢。

## 3. 我现在该运行哪个命令

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 不确定要检查什么 | `npm run verify` | 只生成检查建议，不代表通过 |
| 普通代码改动收口 | `npm run verify -- --goal=pr --run` | 执行默认正式检查 |
| 真实后端相关改动收口 | `npm run verify -- --goal=real --run` | 执行真实后端检查 |
| 视觉/UI 相关改动收口 | `npm run verify -- --goal=visual --run` | 执行视觉检查 |
| 发布前自动化验收 | `npm run release:ready` | 唯一普通发布级自动化入口 |
| 查看上一次发布前检查 | `npm run release:status` | 只读查看，不重新检查、不修复 |
| 拉起本机真实服务环境 | `make local-real-up` | 用于手测和局部真实环境验证 |
| 查看本机真实服务环境 | `make local-real-status` | 不作为发布结论 |
| 停止本机真实服务环境 | `make local-real-down` | 不作为发布结论 |
| 重置本机真实服务环境 | `make local-real-reset` | 不作为发布结论 |

禁止新增新的普通入口，例如 `release:fast`、`release:lite`、`gate:v3`、`campaign:v2`。

## 4. 公开词汇

公开文档和 CLI 摘要优先使用：

| 公开词汇 | 含义 |
| --- | --- |
| 检查建议 | 系统根据改动建议该跑什么 |
| 执行检查 | 按建议实际运行检查 |
| 发布前总检查 | 发布级自动化验收，由 `npm run release:ready` 给结论 |
| 发布状态 | 只读查看上一次发布前总检查 |
| 本机真实服务环境 | 本机 API/Web/任务/文件服务 |
| 诊断命令 | 排查问题的小范围命令，不代表最终通过 |
| 检查报告和日志 | 本次检查留下的报告、截图、日志和机器可读结果 |
| 阻塞项 | 当前不能继续的主要原因 |
| 下一步 | 用户现在应执行的唯一推荐动作 |

公开文档和用户可见 CLI 摘要不得出现下面词汇，除非是在“维护者实现约束”或机器可读报告中：

- `gate`
- `lane`
- `campaign`
- `producer`
- `adapter`
- `aggregate`
- `substrate`
- `readiness`
- `verdict`
- `line_kind`
- `V0/V1/V2/V3/V4`

如果必须解释实现细节，先给直白解释，再写内部名。

## 5. 发布摘要模板

发布前总检查通过时：

```text
AgentSmith 发布前总检查

结论：可以继续
自动化检查：通过
人工发布签署：未覆盖
总耗时：58m 12s
最慢步骤：
  1. 真实后端发布检查：27m 40s
  2. 全量视觉检查：16m 30s
  3. 部署检查：2m 45s
下一步：完成发布说明和人工签署清单。
报告：artifacts/release-runs/<run-id>/summary.md
日志：artifacts/release-runs/<run-id>
```

发布前总检查失败时：

```text
AgentSmith 发布前总检查

结论：不能继续
自动化检查：失败
主要阻塞项：本机真实服务环境残留占用端口
原因：MongoDB 端口 27027 已被当前检查以外的本机服务占用
建议处理：make local-real-status，确认归属后运行 make local-real-down
下一步：处理后重新运行 npm run release:ready
报告：artifacts/release-runs/<run-id>/summary.md
日志：artifacts/release-runs/<run-id>
```

规则：

- 摘要突出一个主要阻塞项，但机器可读报告必须保留全部失败项。
- `release:status` 只能读取已有报告，不执行新检查。
- 自动化通过不等于人工发布批准；人工发布签署状态必须继续展示。
- 新增摘要字段必须脱敏，禁止写入 token、Project secrets、OAuth managed credentials、runner ticket、原始 env dump 或凭据路径。

## 6. 发布证据边界

发布结论仍只来自本次 `release:ready` 报告目录中被发布流程正式引用的检查报告。单独手跑出来的日志和报告只能用于诊断，不能当发布结论。

| 内容 | 能否进入发布结论 | 说明 |
| --- | --- | --- |
| `release:ready` 报告目录内的最终汇总结果 | 是 | 自动化发布前检查的唯一普通结论 |
| 发布流程正式引用的视觉检查报告 | 是 | 发布收口必须包含 |
| 发布流程正式引用的真实后端 UX trace | 是 | 不能被全量视觉检查替代 |
| 发布流程正式引用的部署检查报告 | 是 | 必须保留部署可用性证据 |
| 发布流程内的早失败检查报告 | 部分 | 可说明是否进入发布检查；不能替代业务检查 |
| 同一次命令内的运行状态描述 | 否 | 只用于少重复启动，不是发布证据 |
| 单独手跑的诊断报告 | 否 | 只用于排障，不能作为发布放行依据 |
| `release:status` 输出 | 否 | 只读投影，不重新验收 |

## 7. 不变的质量边界

下面内容不得为了提速而删除：

- 发布级检查项不减项。
- 全量视觉检查和真实后端 UX trace 不能互相替代。
- 部署检查必须保留真实部署、镜像、路由和产品流证据。
- 先做基础路由检查，再做高成本产品流。
- 不明归属的端口、容器、集群、镜像仓库只能提示检查，不能自动清理。
- 同一次命令内的运行状态描述不能跨命令复用，不能成为发布结论。
- 内部结果分层保留，方便定位到底是外层流程失败还是某个诊断命令失败。

## 8. 实施阶段

### 阶段 A0. 证据归属盘点

目标：在减重早失败检查之前，先证明被移出的检查仍然有正式发布证据承接，避免为了提速误删覆盖。

必须产出一张映射表：

| 被移出早失败检查的内容 | 正式检查归属 | 报告路径 | 验收测试 |
| --- | --- | --- | --- |
| 浏览器产品场景 | `release-full/gate-release` 的 backend-real UX trace 必须运行并声明这 5 个 spec：`e2e/integration-system-admin-entry.spec.ts`、`e2e/integration-workspace-public-login.spec.ts`、`e2e/integration-workspace-entry.spec.ts`、`e2e/integration-workspace-publish-usable.spec.ts`、`e2e/integration-workspace-settings-directory.spec.ts`；`release-full/lane-unified-deploy-product-flows` 仍保留 `workspace_project` product flow | `<campaign-root>/gate-release/backend-real-visual/ux-traces`；`<campaign-root>/unified-deploy/product-flows` | `scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts` |
| Agent task 发布级检查 | `release-full/gate-release` 必须通过 `npm run backend-real:run` → `npm run test:agent-task:backend-real:runner` → `scripts/run-backend-real-session-shards.sh --skills-runtime` 保留 internal Agent Task skills runtime 断言；`release-full/lane-unified-deploy-product-flows` 仍保留 `agent_task_managed_runner` product flow | `<campaign-root>/gate-release/backend-real-visual/ux-traces`；`<campaign-root>/unified-deploy/product-flows` | `scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts` |
| Files/Runner 业务断言 | `release-full/gate-release` 的 backend-real UX trace；`release-full/lane-unified-deploy-product-flows` 的 `files` / `agent_task_managed_runner` product flows | `<campaign-root>/gate-release/backend-real-visual/ux-traces`；`<campaign-root>/unified-deploy/product-flows` | `scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts` |

完成标准：

- 每个准备移出早失败检查的项目都有正式检查归属。
- 每个正式检查归属都有报告路径和测试守护；浏览器场景必须守护具体 spec，Agent Task 必须守护 `--skills-runtime` source assertion。
- 找不到正式归属的项目不能移出早失败检查。

停止条件：

- 如果发现某项检查只存在于早失败检查中，停止，先补正式发布证据。

先失败测试：

- 测试早失败检查减重前必须存在证据归属映射。
- 测试映射中的正式报告路径、UX trace membership、owner 脚本 spec 调用或 `--skills-runtime` source assertion 缺失时，发布流程不能把该检查视为已覆盖。

建议命令：

```bash
npm run test:run -- scripts/governance/__tests__/release-readiness-entrypoints.test.ts
```

### 阶段 A1. 发布前早失败检查减重

目标：早失败检查只回答“是否可以开始发布前总检查”，不再偷偷跑一轮小 release。

改动方向：

- 只保留 git 工作区是否干净检查（只读，不自动清理）、资源冲突检查、依赖服务可用检查、API/Web 最小可用检查、认证 token smoke。
- 移出浏览器产品场景、Agent task 发布级检查、Files/Runner 业务断言。
- 同步更新 `scripts/contracts/check-engineering-governance.ts`，把旧的 heavy precheck 要求改为轻量 precheck 边界和证据归属映射守护。
- 成功后的检查报告保留在本次发布目录中。
- 后续步骤可以读取同一次命令内的运行状态描述以避免重复启动，但不能把它当发布结论。

完成标准：

- 早失败检查不再运行 Playwright 产品场景。
- 早失败检查不再运行 Agent task 发布级检查。
- 失败摘要只给一个主要阻塞项和一个公开下一步命令。
- 观测目标小于 5 分钟；首次启动依赖服务超过目标时，摘要必须展示慢点，不能因此降低检查覆盖。

停止条件：

- 如果移出某个检查会导致发布流程没有等价正式证据，立即停止，先补正式证据归属。
- 如果早失败检查需要理解内部命令才能处理失败，立即停止，先修摘要。

先失败测试：

- 正向测试仍保留 git 工作区只读检查、资源冲突、依赖服务可用、API/Web 最小可用、认证 token smoke。
- 测试早失败检查不调用浏览器产品场景。
- 测试早失败检查不调用 Agent task 发布级检查。
- 测试 Files/Runner 业务断言不在早失败路径里。
- 测试失败摘要只返回公开入口。

建议命令：

```bash
npm run test:run -- scripts/governance/__tests__/release-readiness-entrypoints.test.ts scripts/governance/__tests__/sentinel-preflight.test.ts
```

### 阶段 B. 运行状态和耗时摘要最小契约

目标：先把“能复用什么、能展示什么、不能当什么”定义清楚，再做真正复用。

改动方向：

- 定义同一次命令内的运行状态描述，写入本次报告目录下的 `state/readiness.json`。
- 运行状态描述只记录服务是否已启动、输入摘要、镜像摘要、集群身份、时间戳、本次命令 nonce、git sha、allowlisted env 摘要。
- 计数来源必须明确：真实服务启动次数、API/Web 启动次数、真实后端检查会话数、镜像导入次数都必须由父流程统一记录，不能由子检查猜测。
- 运行状态描述只能由父流程写，子检查只读。
- 子检查必须通过 nonce、input digest、git sha、env digest 校验后才能读取；校验失败必须 fail closed。
- 运行状态描述必须脱敏，不记录原始 env、token、secret、ticket、凭据路径。
- 发布摘要增加总耗时、最慢步骤、真实服务启动次数、API/Web 启动次数、真实后端检查会话数、轮询/重试次数、报告大小。
- `release:status` 只读展示这些信息。

完成标准：

- 发布摘要包含总耗时和前三个最慢步骤。
- 发布摘要包含“真实服务启动次数”“API/Web 启动次数”“真实后端检查会话数”。
- 同一次命令内的运行状态描述不能被下一次命令复用。
- 运行状态描述不会进入发布结论字段。
- 子检查不能写运行状态描述，只能读取父流程传入的已校验状态。

停止条件：

- 如果需要跨命令缓存或续跑才能实现，停止，不做。
- 如果新增字段可能泄漏凭据或原始环境变量，停止，先做脱敏 contract。

先失败测试：

- 测试 nonce 不匹配时不能复用运行状态。
- 测试 input digest、git sha、env digest 不匹配时不能复用运行状态。
- 测试摘要能渲染最慢步骤。
- 测试 `release:status` 不触发新检查。
- 测试敏感字段不会进入报告。
- 测试子检查尝试写运行状态时被阻止或不被采信。

建议命令：

```bash
npm run test:run -- scripts/governance/__tests__/run-readiness-state.test.ts scripts/governance/__tests__/status-projection.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts
```

### 阶段 C. 文档和输出表面隔离

目标：普通人只看到公开入口，内部诊断命令不再被写成默认流程。

必须检查的输出和文档：

- `make quick-help`
- `DEVELOPMENT.md`
- `docs/user-guides/release-readiness-checklist.md`
- `docs/testing/diagnostic-catalog-v1.md`
- `npm run verify` 输出
- `npm run release:ready` 输出
- `npm run release:status` 输出

改动方向：

- 默认流程只展示公开入口。
- 内部诊断命令只能保留在明确标为“诊断”或“维护者排障”的章节，并明确“不代表最终通过”。
- 所有 `Rerun` 只允许公开入口。
- 如果需要展示内部命令，字段名使用 `诊断命令`，不能使用 `下一步`。

完成标准：

- 上面文档和输出全量检查通过。
- 普通流程不要求复制 `test:*`、`gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*`。
- 失败摘要中的 `Rerun` 不出现内部命令。
- 内部命令只允许出现在 `诊断命令`、`维护者排障` 或机器可读报告上下文。

停止条件：

- 如果某个内部命令仍是唯一可恢复路径，停止，先补公开入口或公开摘要。

先失败测试：

- 测试 quick help 只展示公开入口。
- 测试发布失败摘要 `Rerun` 只展示公开入口。
- 测试工作流文档中的内部命令只出现在诊断上下文。

建议命令：

```bash
npm run contracts:check-current-workflows
npm run contracts:check-engineering-governance
```

### 阶段 D. 真实后端检查单命令复用

目标：同一次 `release:ready` 内，真实后端发布检查复用同一套已启动服务，减少重复启动和重复初始化。

改动方向：

- 由发布前总检查流程统一管理真实服务生命周期。
- 子检查只读消费阶段 B 定义的运行状态描述。
- 依赖服务初始化、API/Web 启动、Runner 镜像准备、本机 Kubernetes 预热在输入不变时不重复做。
- 每个业务场景仍保留自己的报告和失败归属。

数据隔离要求：

- 优先通过当前 run 可证明归属的 workspace/project/task/file-library reset 做隔离。
- 必须覆盖 Keycloak 用户、Project secrets、audit/usage、runner ticket/session、AFSCP volume/file-library、background jobs 的隔离风险。
- 无法证明隔离时，必须回退到独立命名空间、独立数据前缀或重启服务，不能为了快而共享污染状态。

必须补充隔离矩阵：

| 对象 | reset 方式 | 证明报告 | 失败 fallback | 对应测试 |
| --- | --- | --- | --- | --- |
| Keycloak 用户/会话 | 当前 run 专属用户或可证明清理 | 待实现时填写 | 独立 realm/client 或重启服务 | 待实现时填写 |
| Project secrets | 当前 run 专属 project 或可证明清理 | 待实现时填写 | 独立 project 前缀 | 待实现时填写 |
| audit/usage | 当前 run 专属 workspace/project 前缀 | 待实现时填写 | 独立数据库前缀或重启服务 | 待实现时填写 |
| runner ticket/session | 当前 run 专属 task/session | 待实现时填写 | 重启 runner/session 服务 | 待实现时填写 |
| AFSCP volume/file-library | 当前 run 专属 file-library 或可证明清理 | 待实现时填写 | 独立 volume 前缀或重启服务 | 待实现时填写 |
| background jobs | 当前 run job owner 可证明 | 待实现时填写 | 等待/终止 owned jobs 或重启服务 | 待实现时填写 |

完成标准：

- 同一次发布前总检查中，依赖服务初始化次数不超过 1。
- 同一次发布前总检查中，API/Web 启动次数不超过 1。
- Runner 镜像和本机 Kubernetes 预热在摘要匹配时不重复做。
- 真实后端发布检查观测目标小于 30 分钟；超过目标时必须在摘要中标记慢点，但不能因此降低检查覆盖。
- 任一子检查失败时，摘要能定位业务场景和共享服务状态。
- 隔离矩阵中的每一类对象都有证明报告、fallback 和测试。

停止条件：

- 如果需要改变发布证据权威边界，停止。
- 如果 reset 隔离无法证明安全，停止，不共享该部分运行环境。
- 如果实现开始变成通用调度器或跨命令缓存，停止。

先失败测试：

- 新增或扩展 focused test，断言同一次命令内依赖服务初始化次数和 API/Web 启动次数不超过 1。
- 测试运行状态描述只能只读消费。
- 测试隔离失败时回退而不是继续共享污染环境。
- 测试隔离矩阵缺项时不能启用共享运行环境。

建议命令：

```bash
npm run test:run -- scripts/governance/__tests__/release-readiness-entrypoints.test.ts scripts/governance/__tests__/run-readiness-state.test.ts scripts/governance/__tests__/pure-check-runtime-shadow.test.ts
npm run test:agent-task:runner:fast
```

### 阶段 E. 部署检查面向人分组，证据权威不合并

目标：降低部署检查的命名心智和重复准备成本，但不合并发布证据权威。

改动方向：

- 对人展示为一个“部署检查”分组。
- 内部仍保留本地依赖服务、镜像准备、本机 Kubernetes 部署、产品流验证四类子报告。
- 允许共享镜像摘要、本机镜像仓库状态、本机 Kubernetes 状态、AFSCP 命令 smoke 结果。
- 不新增一个新的部署总结果来替代现有子结果。

完成标准：

- 摘要里用户看到一个部署检查分组和子结果。
- 子结果仍能分别定位依赖服务、镜像、部署、产品流失败。
- 同一次发布前总检查不重复导入同一个本机 Kubernetes 镜像。
- 部署检查观测目标不高于当前 3 分钟基线；超过目标时必须展示慢点，但不能因此降低检查覆盖。

停止条件：

- 如果需要合并或替代现有子证据，停止。
- 如果需要新增公开命令，停止。
- 如果只为节省少量时间却明显增加实现复杂度，停止。

先失败测试：

- 测试部署摘要展示分组但保留子结果。
- 测试重复镜像导入会被同命令运行状态拦截。
- 测试发布汇总仍引用原有子结果。

建议命令：

```bash
npm run test:unified-deploy:unit
npm run test:unified-deploy:local-kind:images:unit
npm run test:run -- scripts/governance/__tests__/release-readiness-entrypoints.test.ts
```

## 9. 暂不实施的想法

有限并行暂不作为本计划 handoff 内容。它可能减少 wall-clock 时间，但会引入写竞争、端口隔离、报告目录隔离、失败归并和资源锁矩阵。

只有同时满足下面条件，才允许单独立项：

- 不新增公开命令。
- 不新增跨命令状态。
- 每个并行步骤有独立报告目录，不争抢 `latest.json`。
- 端口、BASE_URL、环境变量和本地服务归属可证明隔离。
- 多失败时机器可读报告保留全部失败项，摘要只突出主要阻塞项。
- 实现不发展成通用调度器。

## 10. 推荐顺序

1. 阶段 A0：先做证据归属盘点，证明准备移出的检查仍有正式发布证据承接。
2. 阶段 B：补齐运行状态和耗时摘要契约。
3. 阶段 A1：在证据归属清楚后，让早失败检查变轻。
4. 阶段 C：收敛文档和 CLI 心智。
5. 阶段 D：复用真实后端运行环境。
6. 阶段 E：部署检查面向人分组。

这个顺序故意把“证据归属、观测契约、语言收敛”放在重构复用之前，避免团队先删覆盖、再补证据，也避免复用边界不清导致返工。

## 11. 验证策略

每个阶段必须先补失败测试，再实现。

开发中使用 focused tests，不要每个小改动后跑重检查：

- CLI 输出和文档心智：运行 governance unit/contract tests。
- 运行状态和复用：运行 `run-readiness-state`、`release-readiness-entrypoints`、`pure-check-runtime-shadow` 相关测试。
- 真实后端运行环境：先跑 fast diagnostics，再按风险升级到 `npm run verify -- --goal=real --run`。
- 部署检查：先跑 unified deploy unit，再收口时跑对应 focused diagnostic。

阶段收口时运行：

```bash
npm run contracts:check
npm run verify -- --goal=pr --run
```

发布链路行为改变后，最终必须运行：

```bash
npm run release:ready
```

不要把 `npm run release:ready` 变成每个小改动的内循环。

## 12. 完成标准

短期基线：

- `release:ready`: 约 90 分钟
- 真实后端发布检查：约 46 分钟
- 全量视觉检查：约 17 分钟
- 部署检查：约 3 分钟

本计划目标：

- `release:ready` 观测目标小于 60 分钟。
- 真实后端发布检查观测目标小于 30 分钟。
- 早失败检查观测目标小于 5 分钟。
- 全量视觉检查不降低覆盖；发布收口必须包含，发布外只在检查建议要求视觉检查时触发。
- 部署检查不新增人类入口，观测目标不高于当前 3 分钟基线。

性能目标说明：

- 这些数字是本地开发机发布前检查的回归告警线，不是降低覆盖的理由。
- 冷启动、首次拉镜像、系统 OOM 后恢复等情况可以超过目标，但摘要必须展示慢点和原因。
- 如果连续两次正常环境都超过目标 10% 以上，需要记录治理回归并分析根因。

功能性完成标准：

- 开发者从 quick help 和 DEVELOPMENT 能看到清晰公开入口。
- 发布失败时只看到一个主要阻塞项和一个公开下一步命令。
- 机器可读报告保留全部失败项。
- 发布通过时 summary 展示总耗时和最慢步骤。
- 同一次命令内不重复启动/初始化同一套真实后端依赖。
- 诊断命令通过不会被写成发布通过。
- 自动化通过不会被写成人工发布签署已完成。

## 13. 明确禁止

- 不新增公开命令家族。
- 不做跨命令 cache、resume 或智能续跑。
- 不做通用调度器。
- 不把同命令运行状态描述当发布证据。
- 不把单独手跑的诊断报告当发布放行依据。
- 不为了提速跳过全量视觉检查、真实后端 UX trace 或部署产品流。
- 不自动清理归属不明的容器、端口、kind cluster 或镜像仓库。
- 不把内部术语重新写回普通开发流程。

## 14. 交接检查

- 计划没有引入新的公开命令。
- 每个阶段都有完成标准、停止条件和先失败测试。
- 每个性能优化都有对应观测指标。
- 所有发布结论仍来自 `release:ready` 报告目录中被正式引用的检查报告。
- 所有用户可见失败输出都回到公开入口。
- 文档以低心智词汇描述流程，内部术语仅在维护者上下文出现。
- 如果某个阶段需要明显增加复杂度，优先停止并回到“收敛和简化”目标。
