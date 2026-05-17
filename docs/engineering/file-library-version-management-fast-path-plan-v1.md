# 文件库版本管理 Fast Path 下一步开发计划 v1

<!-- markdownlint-disable MD013 -->

Status: `team_reviewed_handoff_ready`
Date: 2026-05-16
Owner: Files / Agent task HOME / AFSCP / JVS maintainers
Review: 已根据两轮 reviewer findings 修正 blocker，本文为二轮 review 后 handoff 版。

## 1. 目的

本计划把文件库 save point / restore / template 发布收敛成一个可直接 handoff 给开发团队的下一步开发切口。

目标不是新增一个大而全的文件治理系统，而是解决当前用户已经感知到的慢、闪一下无结果、恢复状态不可理解、入口心智不对、模板可见性不清晰等问题。实现上按 Pre-GA one-cut 处理，允许一次性重构接口、文案和调用方式，不保留 restore preview / restore safety current-state hidden save point / 旧 “文件状态” 心智。

本计划只保护两个产品真相：

- save point / restore 作用于整个 file library HOME。
- 绑定 Agent task 时，file library HOME 就是整个 task HOME。

任何性能优化都不得把范围缩小到 `workspace/`、白名单目录或“用户可见文件”。慢的问题必须回到 AgentSmith 投射、AFSCP operation 生命周期和 JVS / JuiceFS clone fast path 里解决。

## 2. 用户问题复盘

用户最新反馈需要直接进入本轮改动：

- 点击保存恢复点或恢复后仍可能等待几十秒，用户不知道系统是否已接收操作。
- 保存有时只闪一下，没有明确结果。
- 恢复有时显示“恢复需要处理”或“暂未开始恢复”，用户无法判断下一步该等、刷新还是重试。
- “文件状态”入口心智不佳，应改为“版本管理”。
- 不希望用 tabs；保存恢复点和保存为文件库模板应在同一界面。
- 模板应允许设置为当前项目内可访问。
- 细粒度分享给组或用户本版不做。

当前真实证据说明问题不只在文案：

- AFSCP log 里 `repo_flib_cb81aaedb24b` 的 save point / list 连续返回 `409`。
- worker 出现 `operation_recovery.manual=1`。
- Mongo 里一个 restore 用时约 16s 后 `succeeded`，另一个 restore 立刻 `failed` 且 `afscp_operation_id=null`。
- control root 下存在 `pending-cleanups/restore-*` 残留；fresh metadata-referenced cleanup_pending 可以是恢复过程的一部分，但 stale / non-convergent / unreferenced cleanup 或阻塞后续 save / list / restore 的 cleanup 必须被 gate 捕获。

这些证据指向三个必须覆盖的工程面：

- operation admission 和 UI 投射必须快速、持久、可恢复，不能用“无 active restore”假装成功。
- AFSCP worker / recovery 生命周期必须有失败、恢复和 cleanup 的明确终态。
- JVS direct save / restore 必须基于 JuiceFS clone fast path，不允许用 HOME hash、全量遍历或 copy fallback 掩盖问题。

## 3. 产品决策

文件库版本管理的用户心智改为：

- “版本与模板”是入口文案。
- 右侧 Sheet 标题为“文件库版本管理”。
- 不使用 tabs。
- 同屏展示“保存为恢复点”和“保存为任务文件模板”。
- restore 确认只说明未保存为恢复点的文件变更会丢失，不自动保存当前状态。
- template 发布说明为“当前项目内创建 Agent 任务时可用”。
- template 沿用现有 `task-file-templates` / `TaskFileTemplate` 对象、API、OpenAPI、hooks、mock；本版只修正 project-visible 查询 / 过滤 / 发布状态，不新增 `file-library-templates` 或 `FileLibraryTemplate`。
- template 本版主推荐操作是“保存并发布为 project 内可用模板”，同时允许用户选择“仅保存为未发布模板”，用现有 TaskFileTemplate 的 `published` / `unpublished` 或等价状态表达，不做组、用户、跨 project 分享。

保存和恢复的产品范围不变：

- 保存恢复点保存整个文件库内容。
- 恢复恢复点恢复整个文件库内容。
- 绑定 Agent task 时保存和恢复整个 task HOME。
- HOME 下隐藏运行时目录属于预期范围。

操作体验的产品目标：

- 点击保存或恢复后，admission 状态必须快速可见。
- 用户可以看到“已接收并处理中”、“已成功”、“失败原因”、“需要人工恢复处理”这几类明确状态。
- 如果后端尚未真正开始 restore，不应显示成 terminal success。
- AgentSmith 本地 admission operation 在 storage / AFSCP start 前可以短暂持有 `afscp_operation_id=null` 作为 admission fence；普通用户 UI 只消费 AgentSmith public operation id/status，不暴露 raw AFSCP id。禁止的是把下游 AFSCP / JVS `null` operation 当作成功或进度；如果后台无法启动下游 operation，必须转为 failed / recovery_required。

## 4. 非目标

本版明确不做：

- 不做文件级策略、文件级 restore、局部目录 restore。
- 不做按组或用户细粒度分享模板。
- 不做跨 project 模板市场或模板审批流。
- 不做 restore preview、diff preview、restore safety/current-state hidden save point。
- 不做 restore 前自动保存当前状态。
- 不做兼容旧 preview / run / discard contract。
- 不做为了性能把 HOME 缩小到 `workspace/` 或白名单。
- 不做 HOME / payload hash、digest、checksum、内容证明、容量预扫描、全量遍历。
- 不做 JuiceFS clone 不可用时递归 copy fallback。
- 不做“每个小改动都跑 full real / release gate”的重门禁流程。

## 5. 必须删除或禁止的旧逻辑

以下内容不得留在 active UI、active OpenAPI、active MSW mock、active route-kind map、active tests 或用户文案中：

- “文件状态”入口和对应主心智。
- tabs 结构，包括测试里依赖 tabs 的定位方式。
- restore preview、restore safety/current-state hidden save point、restore-run-discard、restore 前自动保存当前 HOME。
- 同步阻塞 30s poll 的用户心智，即点击后长时间等后端终态再给用户反馈。
- HOME hash、payload hash、content hash、全量文件树遍历、容量预扫描、payload tree sync、copy fallback。
- 把 `active restore == null`、`No active restore is running now`、`Restore state refreshed` 当作 terminal success 的 helper 或测试断言。
- `TaskFileTemplate` 列表仅按 `source_library` 过滤的逻辑；project 内可访问模板必须能在同 project 创建 Agent task 时被发现。
- 对用户显示 JVS、JuiceFS、control root、raw command、内部路径、operation_recovery 原始字段。

允许但必须隔离：

- 模板机制所需的内部 source save point 可以继续存在，但它只服务于 TaskFileTemplate create / clone，不得污染用户可恢复 save point 列表，也不得被恢复流程复用成 restore safety hidden save point。

## 6. 目标体验

入口：

- 文件库主界面入口命名为“版本与模板”。
- 打开右侧 Sheet。
- Sheet 标题为“文件库版本管理”。
- Sheet 内不用 tabs，按纵向 sections 组织。

Section 1：保存为恢复点

- 标题：“保存为恢复点”。
- 说明：“保存当前整个文件库内容，用于之后恢复。”
- 可选 note。
- 主按钮：“保存恢复点”。
- admission 成功后立即显示“已开始保存恢复点”或等价处理中状态。
- 后台完成后显示“恢复点已保存”。
- 失败时显示可操作原因，不闪一下就消失。

Section 2：保存为任务文件模板

- 标题：“保存为任务文件模板”。
- 说明：“推荐保存并发布为当前项目内创建 Agent 任务时可选择的模板；也可以仅保存为未发布模板，稍后再发布。”
- 表单字段控制在本版必需范围内：名称、说明、UI checkbox 或 segmented action。
- UI 选择项：“保存并发布为 project 内可用模板（推荐）” / “仅保存为未发布模板”。
- 发布状态落到现有 TaskFileTemplate `published` / `unpublished` 或等价 contract；如果现有 contract 没有对应 body 字段，UI 选择通过现有发布动作表达，不新增 `project_access` 字段。
- 不出现组、用户、跨 project 分享控件。
- 发布后模板列表和创建 Agent task 入口都能看到该模板。

Section 3：恢复点列表

- 列出用户可恢复的恢复点。
- 每个恢复点只有直接 “恢复” action。
- 点击后只打开确认弹窗，不调用 preview。
- 确认文案说明整个文件库会回到该恢复点，当前未保存为恢复点的文件变更会丢失。
- 不承诺自动保存当前状态。

恢复确认建议文案：

```text
恢复到“{savePointLabel}”？

这会把整个文件库内容恢复到该恢复点。当前未保存为恢复点的文件变更会丢失。对话记录和任务日志不会被恢复。
```

恢复运行状态：

- `accepted`：已接收恢复请求。
- `running`：正在恢复文件库。
- `succeeded`：文件库已恢复。
- `failed`：恢复失败，显示可操作原因。
- `recovery_required`：恢复需要处理，普通用户 UI 只提示联系 system 管理侧；operator-facing 视图或日志可以指向内部 runbook，不让用户反复重试制造更多残留。

刷新行为：

- 页面刷新后必须重新投射 active save / restore / TaskFileTemplate save/publish operation。
- 没有 active restore 只能表示“当前没有正在恢复的操作”，不能表示“刚才的恢复成功”。
- restore active 时，破坏性文件写操作需要禁用或提示稍后再试。

## 7. 目标架构与接口

### 7.1 AgentSmith 产品 API

AgentSmith 面向 UI 的接口只表达产品对象，不暴露 JVS、JuiceFS、control root 或内部路径。

保存恢复点：

```http
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/save-points
Idempotency-Key: <uuid>
```

HTTP intake/admission 必须快速返回 operation projection 或 typed failure，不等待 JVS clone 终态，也不为了等待 AFSCP worker/direct execution 终态而阻塞 30s。AFSCP worker 或 direct execution 可以等待 JVS clone 并提交 terminal success / failure；UI 通过 operation projection 消费终态。

直接恢复：

```http
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore
Idempotency-Key: <uuid>

{
  "save_point_id": "flsp_..."
}
```

operation projection：

```http
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/operations/active
```

最小字段：

```json
{
  "operation": {
    "id": "flop_...",
    "kind": "save_point_create",
    "status": "running",
    "created_at": "2026-05-16T00:00:00.000Z",
    "updated_at": "2026-05-16T00:00:03.000Z",
    "message": "正在保存恢复点"
  }
}
```

`operation: null` 只表示当前没有 active operation。前端不得把它解释为上一次操作成功。

`/operations/active` 是 Files 版本管理 UI 的唯一 active operation projection 真相。现有 `GET /restore` active projection 如果保留，必须在同一 cut 中删除或收敛为 thin alias；不能出现双语义、双路径、双轮询来源。

任务文件模板保存 / 发布：

```http
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/task-file-templates
Idempotency-Key: <uuid>

{
  "source_library_id": "flib_...",
  "name": "...",
  "description": "..."
}
```

说明：

- 不新增 `/file-library-templates`，不新增 `FileLibraryTemplate`。
- 统一沿用现有 `task-file-templates` / `TaskFileTemplate` 对象、API、OpenAPI、hooks、mock。
- UI 的“仅保存为未发布模板” / “保存并发布为 project 内可用模板”选择必须映射到现有 TaskFileTemplate `published` / `unpublished` 或等价发布动作。
- 除非现有 contract 已有对应字段，否则不要在 API body 中新增 `project_access`。
- 模板列表必须修正 project-visible 查询 / 过滤 / 发布状态。创建 Agent task 选择模板时，不得只按 `source_library_id` 过滤。

### 7.2 AgentSmith 前端状态

前端不再使用“restore helper 字符串包含成功文案”判断终态。

需要统一成 typed state：

- admission pending：按钮点击后、产品 API 返回前。
- accepted：产品 API 返回 operation id。
- running：operation projection 为 running。
- succeeded：operation projection terminal success。
- failed：operation projection terminal failed 或 admission typed failure。
- recovery_required：后端明确要求人工恢复。

UI 轮询可以存在，但它是后台投射机制，不是用户需要理解的“等待 30s 看是否成功”。轮询超时只能显示“仍在处理，可刷新后继续查看”，不能显示成功。

### 7.3 状态映射

状态映射必须稳定，前端只消费 AgentSmith 产品状态；AFSCP / JVS 内部状态由 adapter 规整，不直接透传到普通用户 UI。

| AgentSmith status | AFSCP status | JVS / cleanup signal | UI 语义 |
| --- | --- | --- | --- |
| `accepted` | `queued` | 无 terminal signal | HTTP intake 已接收，等待 worker / direct execution。 |
| `running` | `running` | clone running，或仍阻塞后续 save / list / restore 的 metadata-referenced fresh `cleanup_pending` | 正在处理；fresh cleanup 必须有收敛窗口和后续状态刷新。 |
| `succeeded` | `succeeded` | clone succeeded，且 cleanup converged，或 metadata-referenced fresh cleanup 已不阻塞后续 save / list / restore | 操作完成；刷新文件树和模板 / 恢复点列表；non-blocking cleanup 只作为 operator-facing evidence 继续收敛。 |
| `failed` | `failed` | JVS terminal failed、clone failed、invalid argument、stale / non-convergent / unreferenced cleanup | 操作失败，显示可操作原因。 |
| `recovery_required` | `operator_intervention_required` | JVS `recovery_required`、journal recovery required、cleanup 阻塞后续 save / list / restore | 普通用户提示联系 system 管理侧；operator-facing 日志指向 runbook。 |

cleanup 判定规则：

- fresh metadata-referenced `cleanup_pending` 在收敛窗口内允许映射为 `running`。
- fresh metadata-referenced cleanup 如果已不阻塞后续 save / list / restore，可以允许 restore / save terminal `succeeded`，cleanup 作为 operator-facing non-blocking cleanup evidence 继续收敛，不让普通用户 UI 长期停在 running。
- stale、non-convergent、unreferenced cleanup 必须映射为 `failed` 或 `recovery_required`。
- journal recovery required 必须映射为 `recovery_required`。
- cleanup 阻塞后续 save / list / restore 时必须让 focused gate 失败。

### 7.4 AFSCP operation 生命周期

AFSCP 必须把 save / list / restore / TaskFileTemplate save/publish 相关 operation 生命周期收敛清楚：

- HTTP intake/admission 要么快速返回可追踪 operation id，要么返回 typed failure；worker/direct execution 可以等待 JVS 并提交 terminal success / failure。
- AgentSmith local pre-start operation 可短暂持有 `afscp_operation_id=null` 作为 admission fence；投射给 UI 时必须使用 AgentSmith public operation id/status。下游 AFSCP operation 仍为 null 且无法启动时，不得继续作为 running / success，必须 failed / recovery_required。
- 连续 `409` 要映射成 active operation conflict、recovery required 或 typed retryable blocker，不能让 UI 闪一下后失联。
- `operation_recovery.manual=1` 必须进入可见的 recovery_required 或内部失败状态，并被 focused gate 捕获。
- `pending-cleanups/restore-*` 必须区分 fresh metadata-referenced cleanup_pending 与 stale / non-convergent / unreferenced cleanup；前者允许在收敛窗口内存在，后者或阻塞后续 save / list / restore 的 cleanup 必须失败。
- save 前如果存在只为“确认当前列表或 repo 状态”的 DirectList 冗余调用，应移除或改成 metadata-only admission check。

如果 AFSCP 缺少上述能力，由负责 team member 直接修改 `../agentsmith-fs-control-plane`，不要在 AgentSmith UI 里做字符串兜底。

### 7.5 JVS direct fast path

JVS save / restore 当前设计应基于 JuiceFS clone。

JVS 和 AFSCP active path 禁止：

- HOME / payload hash。
- 全量遍历或容量预扫描。
- payload tree sync。
- copy fallback。
- restore 前自动保存当前 HOME，或创建 restore safety/current-state hidden save point。
- save / restore 热路径默认 doctor / status 串联。

JVS 只输出 operator-safe 状态、错误码和必要的 clone timing。clone timing 用于工程证据，不进入用户文案。

如果 JVS 缺少 direct clone 能力或 metadata-only status / doctor 能力，由负责 team member 修改 `../jvs`。如果真实环境缺 JuiceFS / mount / sandbox 能力，需要同步修改 `../mbos-sandbox-v1`，但不得因此在 JVS 里增加 copy fallback。

## 8. 跨项目开发 slices

### Slice 0：证据与 contract freeze

Owner：AgentSmith Files + AFSCP + JVS

产物：

- 固化本轮 operation status enum：`accepted`、`running`、`succeeded`、`failed`、`recovery_required`。
- 固化 save、restore、TaskFileTemplate save/publish 的 HTTP intake/admission 语义和 idempotency 要求。
- 把 `repo_flib_cb81aaedb24b` 连续 `409`、`operation_recovery.manual=1`、`afscp_operation_id=null`、`pending-cleanups/restore-*` 写入 focused regression fixture 或 evidence note。
- 固化 AgentSmith / AFSCP / JVS 状态映射表，包含 AFSCP `queued` / `running` / `succeeded` / `failed` / `operator_intervention_required` 与 JVS `recovery_required` / `cleanup_pending`。
- 明确哪些字段只用于 engineering evidence，不能进入产品 API。

完成标准：

- 三个 repo 对 direct save / restore / operation projection 的字段和终态理解一致。
- 没有为旧 restore preview / restore safety current-state hidden save point 预留兼容字段。
- 没有新增 `file-library-templates` / `FileLibraryTemplate` product object。

### Slice 1：AgentSmith “版本与模板” UI one-cut

Owner：AgentSmith Files frontend

改动：

- 入口从“文件状态”改为“版本与模板”。
- 容器改右侧 Sheet，标题“文件库版本管理”。
- 删除 tabs，实现同屏 sections：保存为恢复点、保存为任务文件模板、恢复点列表。
- 删除 restore preview / restore safety current-state hidden save point 文案和交互。
- 恢复确认只说明未保存为恢复点的文件变更会丢失，不自动保存当前状态。
- 模板发布文案明确 project 内创建 Agent 任务时可用。
- 模板 UI 选择只表达 “未发布” / “发布为 project 内可用”，落到现有 TaskFileTemplate 状态或发布动作。
- i18n 同步 `en-US` 和 `zh-CN`，key 使用 snake_case。

完成标准：

- UI 和测试中不再出现“文件状态”作为入口。
- UI 和测试中不再依赖 tabs。
- 用户点击保存或恢复后一定能看到 admission 或 typed failure。

### Slice 2：AgentSmith operation projection 和 helper 修复

Owner：AgentSmith Files frontend + API consumer

改动：

- save / restore / TaskFileTemplate save/publish 统一使用 typed operation state。
- 移除把 `No active restore is running now`、`Restore state refreshed` 当成功的 helper 逻辑。
- `operation: null` 只渲染为“当前没有正在运行的操作”。
- admission 请求返回前显示本地 pending；返回 operation id 后显示 accepted / running。
- 轮询超时显示“仍在处理”，不能显示 success。
- 下游启动失败后 `afscp_operation_id=null` 的 failed restore 必须显示失败原因，不能进入 running 或 success。
- 普通用户 UI 不显示“内部 runbook”；operator-facing 日志或视图可以携带 runbook reference。

完成标准：

- e2e helper 只有看到 terminal `succeeded` 才能判定 restore 成功。
- refresh 后 active operation 能恢复展示。
- failed / recovery_required 不会触发重复 restore 请求。

### Slice 3：AFSCP operation / recovery 收口

Owner：AFSCP maintainers

改动位置：`../agentsmith-fs-control-plane`

改动：

- direct save / restore HTTP intake/admission 返回可追踪 operation id 或 typed failure；worker/direct execution 可以等待 JVS 并提交 terminal success / failure。
- 修复连续 `409` 时的 operation 投射，区分 active conflict、retryable blocker、recovery_required。
- 修复 worker recovery lifecycle，`operation_recovery.manual=1` 不能被吞掉。
- 清理或收口 `pending-cleanups/restore-*` 生命周期：fresh metadata-referenced cleanup_pending 允许在收敛窗口内存在；stale / non-convergent / unreferenced cleanup 或阻塞后续 save / list / restore 的 cleanup 必须失败。
- 移除 save 前冗余 DirectList，除非该 check 被证明是 metadata-only 且不会阻塞用户 admission。
- AFSCP OpenAPI / schema 删除 preview / run / discard active path。

完成标准：

- fake JVS runner 下 save / restore / list 的 operation 生命周期可重复验证。
- manual recovery 残留会让 focused gate 失败。
- HTTP intake/admission 不等待 JVS clone 终态；worker/direct execution 提交 terminal success / failure。

### Slice 4：JVS JuiceFS clone fast path

Owner：JVS maintainers

改动位置：`../jvs`

改动：

- direct save / restore 使用 JuiceFS clone 语义。
- list / status / doctor 保持 metadata-only。
- 删除或禁止生产路径 hash、全量遍历、容量预扫描、payload sync、copy fallback。
- 输出 clone start / clone end / clone duration 的 operator evidence。
- clone 不可用时 fail fast，返回 typed error，不降级 copy。

完成标准：

- fake JuiceFS runner 证明 save / restore 调用了 clone。
- 静态断言或 focused tests 证明 hot path 没有 tree walk / hash / copy fallback。
- real lane 记录 JVS clone duration，并和 AgentSmith admission latency 分开。

### Slice 5：TaskFileTemplate project-visible 保存 / 发布 / clone

Owner：AgentSmith Files + Agent task frontend/backend + AFSCP + JVS

改动：

- 沿用现有 `task-file-templates` / `TaskFileTemplate`，不新增 `file-library-templates`。
- UI 主推荐“保存并发布为 project 内可用模板”，并允许选择“仅保存为未发布模板”。
- 保存 / 发布状态映射到现有 TaskFileTemplate `published` / `unpublished` 或等价状态 / 动作。
- 创建 Agent task 时按 project-visible TaskFileTemplate 查询。
- 不再仅按 `source_library_id` 过滤模板。
- 不增加组、用户、跨 project 分享 UI。
- AFSCP 补齐 repo-template create / clone lifecycle，确保模板内部 source save point 不污染用户可恢复 save point 列表。
- JVS direct clone evidence 覆盖 template create / clone 所需的 clone 调用和 timing。

完成标准：

- 从 file library A 发布的 project 模板，可以在同 project 创建 Agent task 时被选择。
- 同 project 内授权用户可见性遵守现有 project 权限。
- 其他 project 不可见。
- AFSCP repo-template create / clone 有可追踪 operation 或 typed failure。
- JVS evidence 能区分 template clone duration 与 AgentSmith HTTP intake/admission latency。
- 用户可恢复 save point 列表不出现模板内部 source save point。

## 9. TDD 与测试计划

测试策略采用 progressive validation，不在每个小改动后跑 full gate。

AgentSmith fake runner / unit：

- 组件测试覆盖 Sheet、无 tabs、两个保存入口同屏、restore 确认文案。
- API consumer 测试覆盖 typed operation state。
- helper 测试覆盖 `operation: null` 不是成功。
- i18n 测试或静态检查覆盖新增文案 key。
- TaskFileTemplate 列表测试覆盖 project-visible 查询 / 发布状态，不只按 `source_library_id`。

AgentSmith focused e2e：

- 打开“版本与模板”入口，右侧 Sheet 展示“文件库版本管理”。
- 保存恢复点后，admission 状态快速出现，并最终显示成功或失败。
- restore confirm 不触发 restore safety/current-state hidden save point，不出现 preview 文案。
- refresh 后 active restore 状态仍可见。
- `No active restore is running now` 和 `Restore state refreshed` 不再作为 terminal success。
- 保存并发布 project-visible TaskFileTemplate 后，创建 Agent task 能看到该模板；仅保存为未发布模板时不进入普通创建任务选择列表。

AFSCP focused tests：

- fake JVS runner 覆盖 save / restore admission 和 operation projection。
- 连续 `409` 映射为 conflict / retryable blocker / recovery_required，不是 UI success。
- pre-start local restore 可验证 `afscp_operation_id=null` admission fence；无法启动下游 operation 或下游 terminal null 必须进入 failed admission / failed operation / recovery_required。
- `operation_recovery.manual=1` 让 worker recovery gate 失败。
- stale / non-convergent / unreferenced `pending-cleanups/restore-*` 或阻塞后续 save / list / restore 的 cleanup 让 focused cleanup / recovery gate 失败；fresh metadata-referenced cleanup_pending 在收敛窗口内允许。
- AFSCP repo-template create / clone lifecycle 有 fake JVS runner 覆盖。

JVS focused tests：

- fake JuiceFS runner 验证 save / restore 使用 clone。
- fake JuiceFS runner 验证 template create / clone 所需 direct clone evidence。
- metadata-only list / status / doctor 不遍历 HOME。
- 静态断言 hot path 不调用 hash / digest / checksum / tree walk / copy fallback。
- clone unavailable fail fast，不 fallback。

Focused real lane timing：

- 不以 full `npm run verify -- --goal=real --run` 作为每次小改动门禁。
- 新增或复用 focused real lane timing producer，记录 AgentSmith HTTP intake/admission latency、AFSCP queue / worker hop latency、JVS clone duration、UI projection lag；如果 AgentSmith 产品 API 未暴露 AFSCP worker hop 或 JVS clone duration，evidence 必须写明 source / availability，不能无声写 null。
- admission latency 和 JVS clone duration 分开记录，不能把 clone 变慢伪装成 UI 无响应。
- worker / recovery manual 残留必须让 focused real lane 失败。
- cleanup gate 必须包含收敛窗口和状态判定；fresh metadata-referenced cleanup_pending 在窗口内允许；如果已不阻塞后续 save / list / restore，可允许 terminal success 并作为 operator-facing non-blocking cleanup evidence 继续收敛；stale / non-convergent / unreferenced cleanup 或阻塞后续操作必须失败。

阶段收口：

- AgentSmith UI / contract slice 收口时运行相关 unit、contract check、focused e2e。
- 跨 AFSCP / JVS direct path 收口时运行 focused real lane timing。
- 最终 PR 或发布前再回到 `npm run verify -- --goal=pr --run` 或对应 release gate。

## 10. 性能验收标准

本计划的性能验收看 admission、projection 和 clone 三段，不用一个模糊总耗时掩盖瓶颈。

HTTP Intake / Admission：

- 保存恢复点和恢复点击后，UI 必须在 2s 内显示本地 pending、accepted 或 typed failure。
- focused real lane 中，AgentSmith 产品 API HTTP intake/admission 不应等待 JVS clone 终态；AFSCP worker/direct execution 可以等待 JVS 并提交 terminal success / failure。
- 如果 admission 失败，必须显示 typed failure，不允许闪一下无结果。

Projection：

- accepted / running / succeeded / failed / recovery_required 必须能通过 operation projection 还原。
- 页面刷新后仍能看到 active operation。
- `operation: null` 不是成功。

Clone：

- JVS clone duration 单独记录。
- clone 慢可以显示 running，但不能阻塞 admission 可见性。
- clone unavailable 必须 typed failure，不能 copy fallback。

Recovery：

- `operation_recovery.manual=1` 不允许作为绿色验收。
- fresh metadata-referenced `pending-cleanups/restore-*` 在收敛窗口内允许；如果已不阻塞后续 save / list / restore，可允许 terminal success 并作为 operator-facing non-blocking cleanup evidence 继续收敛；stale / non-convergent / unreferenced cleanup 或阻塞后续 save / list / restore 的 cleanup 不允许作为绿色验收。
- 连续 `409` 不允许让 UI 重复发起 save / restore 并制造更多残留。

## 11. 验收标准

用户体验验收：

- 文件库入口显示“版本与模板”，不再显示“文件状态”。
- 右侧 Sheet 标题为“文件库版本管理”。
- 没有 tabs。
- “保存为恢复点”和“保存为任务文件模板”同屏可见。
- restore 确认只说明未保存为恢复点的文件变更会丢失，不自动保存当前状态。
- 保存和恢复不会只闪一下无结果。
- “恢复需要处理”只在后端明确 `recovery_required` 时出现，并给出下一步。

产品范围验收：

- save point / restore 仍覆盖整个 file library HOME。
- 绑定 Agent task 时覆盖整个 task HOME。
- 测试 fixture 必须包含 HOME 下隐藏运行时目录，证明没有缩小到 `workspace/`。

接口验收：

- active OpenAPI / generated types / MSW mock 不再暴露 restore preview、restore safety current-state hidden save point、restore-run-discard。
- direct restore 需要 idempotency key；discard confirmation 是 UI destructive confirmation，不进入 restore API body，restore body 仍以现有 `save_point_id` 为准。
- Files 版本管理 UI 只以 `/operations/active` 作为 active operation projection 真相；现有 `GET /restore` active projection 必须删除或变成 thin alias，不能保留双语义或双路径。
- operation projection 不把 null active operation 当成功。
- task-file-template list 支持 project-visible 查询 / 发布状态，不只按 source library 过滤；不新增 `file-library-templates` / `FileLibraryTemplate`。

工程验收：

- AgentSmith focused unit / e2e 通过。
- AFSCP fake runner operation lifecycle tests 通过。
- JVS fake JuiceFS clone tests 通过。
- focused real lane timing 产出 admission latency、AFSCP worker hop、JVS clone duration、UI projection lag；不可得的底层耗时必须带 source / availability。
- worker / recovery manual 残留会失败。
- cleanup gate 按收敛窗口判断，stale / non-convergent / unreferenced cleanup 或阻塞后续操作会失败。

## 12. 风险与不做项

风险：

- AFSCP 当前连续 `409` 和 manual recovery 可能需要先清理历史 control root 残留；这是 Pre-GA 可接受的一次性收口，不应为旧残留设计兼容路径。
- JVS / JuiceFS clone 能力如果在本地真实 lane 不稳定，可能需要同步修 `../mbos-sandbox-v1` 的 mount 或环境初始化。
- project 模板可见性需要复用现有 project 权限，不能临时用角色名做门禁。
- HTTP intake/admission 变快后，用户会更早看到 running，因此 failure / recovery copy 必须足够明确，避免用户反复点击。

不做项：

- 不做 group / user 细粒度模板分享。
- 不做跨 project 模板。
- 不新增 `file-library-templates` / `FileLibraryTemplate` product object。
- 不做旧 preview UI 兼容。
- 不做旧 tests 兼容 tabs。
- 不做 file-level restore。
- 不做 HOME hash、全量遍历、copy fallback。
- 不做每个 slice 都跑 full real / release gate。
