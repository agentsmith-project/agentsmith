# 文件库版本与模板 UX 同步开发计划 v1

<!-- markdownlint-disable MD013 -->

Status: `handoff_ready`
Date: 2026-05-17
Owner: AgentSmith Files frontend / Files backend maintainers
Scope: Files 文件库的保存点保存、恢复、任务文件模板保存/发布，以及最近一次恢复来源投影

## 1. 背景

本计划只解决当前用户已经反馈的 3 个问题，不重新设计文件治理系统：

- 保存 save point 后，前端长时间显示“正在保存”，刷新页面才看到保存点已经完成。
- UX 需要把“版本保存/恢复”和“模板保存/发布”拆成两个独立入口、两个独立抽屉。
- 文件库恢复后，需要长期可见“最近一次恢复来自哪个保存点、何时恢复”。

当前代码锚点：

- `src/components/files/file-library-recovery/FileLibraryRecoveryDialog.tsx`：一个右侧 Sheet 同时承载保存点创建、恢复确认、恢复状态、模板创建、模板发布/取消发布/删除。
- `src/lib/hooks/use-file-library-recovery.ts`：保存点和恢复依赖 active operation、operation lookup、save point list、React Query invalidation 共同收敛。
- `src/lib/hooks/use-task-file-templates.ts`：模板保存/发布是 project-scoped task file template 能力。
- `src/lib/api/types/files.ts`：`FileLibrary` 目前没有最近恢复来源字段；`FileLibraryVersionOperation` 也没有稳定的 save point terminal result 字段。
- `src/lib/api/endpoints/files.ts`：两个能力已使用 project-scoped API，保存点/恢复和模板都在 `/workspaces/{workspaceId}/projects/{projectId}/...` 下。
- `src/mocks/handlers/files.ts` 与相关测试已经覆盖 direct restore、template source save point 隔离、operation lookup 等基础路径，但还没有后端持久 `last_restore` 投影。

本计划延续现有产品真相：

- 保存点和恢复覆盖整个 file library HOME。
- 绑定 Agent task 时，覆盖整个 task HOME。
- 后端是唯一权威；前端只展示 API/DTO 返回的运行时真相。
- 两个入口继续复用 `project:files:update`，不新增权限点。
- 最近恢复来源由 AgentSmith FileLibrary projection/catalog 记录并对外投影；AFSCP/JVS 不承担产品展示字段。
- 最小闭环只改 AgentSmith Files API/DTO、MSW/contract 和前端展示，不要求兄弟项目改动。

## 2. 用户心智

用户不关心“版本操作”这个工程对象，只关心两个独立任务：

| 用户要做的事 | 入口 | 用户期待 |
| --- | --- | --- |
| 保存当前文件状态，必要时恢复回去 | 版本保存/恢复 | 点击保存后能看到已接收、处理中、已完成或失败；恢复后能看到最近恢复来源 |
| 把当前文件库保存成创建 Agent task 可用的起始文件集 | 模板保存/发布 | 能保存模板、选择发布到当前项目、管理已保存模板 |

两个入口都属于文件库管理能力，因此仍要求 `project:files:update`。读权限用户可以浏览文件，但不能看到或使用这两个写入口。

用户可见状态只保留低心智词：

- `已接收`：系统已接收请求。
- `处理中`：保存、恢复或模板动作仍在运行。
- `已完成`：保存点已保存、文件已恢复、模板已保存/发布。
- `失败`：动作没有完成，用户可以按提示重试。
- `需要 system 管理侧处理`：系统无法自动完成，用户不应反复重试。

用户不应看到 JVS、AFSCP、JuiceFS、control root、raw operation id、内部路径、raw error code。

## 3. 根因假设

### 3.1 保存点一直显示正在保存

当前前端会观察 3 类信号，但目标实现不能把它们都当成完成判据：

- `POST /save-points` 返回的 local operation。
- `/operations/active` 返回的 active operation / activeOperation。
- `/save-points` 列表中出现新保存点。

问题可能发生在这些信号没有被统一收敛时：

- `handleCreateSavePoint` 在 admission 成功后把 local operation 放进 `restoreOperation`，但普通 admission 路径没有像 409 pending 路径一样用“新保存点已出现”来清理本地 saving 状态。
- `useFileLibraryActiveVersionOperation` 主要把 active operation 当轮询入口；如果 active projection 卡在 `accepted/running` 或 terminal projection 没有被前端按 POST 返回的 operation id 追踪到，UI 就会继续展示“正在保存”。
- save point list 刷新已经能看到新保存点时，当前 UI 仍可能优先相信本地 `restoreOperation` 的 running 状态，导致刷新页面后才重新从列表真相恢复。

收敛方向：

- 保存点创建后，前端必须按 POST 返回的 public operation id 做 operation lookup 跟踪到 terminal。
- active operation / activeOperation 只表达“当前是否有 active blocker”，不是完整状态流，不能作为刚提交操作的完成真相。
- 保存点完成必须以 operation lookup 的 terminal `succeeded` 和 `result_save_point_id` 为正常成功判据。
- save point list 只用于在拿到 `result_save_point_id` 后刷新和展示结果保存点，不用 message、label 或时间做模糊匹配。

### 3.2 版本与模板混在一个抽屉

`FileLibraryRecoveryDialog` 同时包含保存点、恢复、模板表单、模板列表、模板发布动作和 shared operation banner。它降低了复用成本，但让用户把“恢复文件”和“发布任务模板”理解成同一个任务。

收敛方向：

- 文件库操作区提供两个入口。
- “版本保存/恢复”只处理保存点创建、保存点列表、恢复确认、最近恢复来源。
- “模板保存/发布”只处理模板保存、发布/取消发布、删除、模板列表。
- 两个抽屉可共享 hooks 和状态组件，但 UI 入口和抽屉状态独立。

### 3.3 最近恢复来源不能由前端猜

恢复成功后要长期显示最近一次恢复来源，刷新、换浏览器、换成员都应可见。前端本地 state、operation cache、save point list 推断都不满足这个要求。

收敛方向：

- AgentSmith 后端在 restore terminal success 时写入 FileLibrary projection/catalog。
- `FileLibrary` list/detail DTO 返回该 projection 的 public `last_restore` 字段。
- 前端只渲染 DTO 字段；没有 DTO 字段时不显示“最近恢复”。
- failed、recovery_required、pending restore 不更新最近恢复 projection。
- AFSCP/JVS 只保留底层存储或任务执行职责，不新增产品展示字段。

## 4. 数据模型/API 变更

### 4.1 FileLibrary 最近恢复投影

记录归属：

- AgentSmith FileLibrary projection/catalog 是最近恢复来源的产品真相。
- AFSCP/JVS 不保存、不返回面向用户的 `last_restore` 产品展示字段。
- 最小闭环不要求 AFSCP/JVS 或其他兄弟项目改动。

内部持久字段与 public DTO 分开：

- 内部持久字段可以使用扁平字段，例如 `last_restored_save_point_id`、`last_restored_save_point_label`、`last_restored_save_point_created_at`、`last_restored_at`、`last_restore_operation_id`。
- public API 只返回 nested `last_restore`，避免把内部字段命名和存储形态暴露给前端。

在 `FileLibrary` public DTO 增加可空字段：

```ts
export interface FileLibraryLastRestore {
  source_save_point_id: string;
  source_save_point_label: string;
  source_save_point_created_at: string;
  restored_at: string;
  restore_operation_id: string;
}

export interface FileLibrary {
  // existing fields
  last_restore?: FileLibraryLastRestore | null;
}
```

字段语义：

| 字段 | 语义 |
| --- | --- |
| `source_save_point_id` | 最近一次成功恢复使用的保存点 id |
| `source_save_point_label` | 后端提供的 public-safe 展示名快照，优先使用保存点 message，空值使用默认保存点名；不参与成功判定 |
| `source_save_point_created_at` | 来源保存点创建时间 |
| `restored_at` | 最近一次成功恢复完成时间 |
| `restore_operation_id` | 后端审计和调试用；普通 UI 不直接展示 |

写入规则：

- 只在 restore terminal `succeeded` 后更新。
- 恢复失败、仍在恢复、需要 system 管理侧处理时不更新，也不清空或覆盖已有 `last_restore`。
- idempotency replay 只允许重放同一恢复操作的既有结果，不允许把 `restored_at` 回退到更早时间。
- 如果来源保存点后续不可查，后端仍返回已固化的 label 和时间，避免 UI 回退到空态。

需要更新：

- OpenAPI / generated types。
- `src/lib/api/types/files.ts`。
- MSW fixtures 和 `src/mocks/handlers/files.ts`。
- file library list/detail route tests。

### 4.2 保存点 operation terminal result

为保存点创建 operation 增加可选 result 字段：

```ts
export interface FileLibraryVersionOperation {
  id: string;
  kind: 'save_point_create' | 'restore';
  status: 'accepted' | 'running' | 'succeeded' | 'failed' | 'recovery_required';
  file_library_id?: string;
  source_save_point_id?: string;
  result_save_point_id?: string;
  message?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}
```

要求：

- `POST /file-libraries/{libraryId}/save-points` 返回 public operation id。
- 前端必须按该 operation id 轮询 `GET /file-library-operations/{operationId}` 到 terminal。
- terminal `succeeded` 时必须返回 `result_save_point_id`；缺少该字段时不能按保存成功展示。
- `/operations/active` 和前端 activeOperation 继续只表达 active blocker；它不是完整状态流，不要求长期保留 terminal。
- `message` 只能用于用户可读提示或诊断，不作为保存点创建成功的正常判据。

### 4.3 模板 API 不新增产品对象

继续使用现有 TaskFileTemplate：

- `POST /task-file-templates`
- `POST /task-file-templates/{templateId}/publish`
- `POST /task-file-templates/{templateId}/unpublish`
- `DELETE /task-file-templates/{templateId}`

本计划不新增 `FileLibraryTemplate`，不新增 group/user/cross-project 分享字段。两个入口仍复用 `project:files:update`。

## 5. 前端 IA/UX 设计

### 5.1 文件库操作区

在当前选中文件库的文件操作区提供两个独立按钮：

- `版本保存/恢复`
- `模板保存/发布`

可用性规则：

- 没有 `project:files:update` 时不展示写入口，或保持现有权限门禁策略下的不可用态。
- 文件库非 `ready` 时按钮可展示但抽屉内给出 storage/status typed blocker，避免用户误以为入口消失。
- 有 active file update 时，两个抽屉都能看到阻塞提示，但只禁用会修改文件库或模板的动作。

### 5.2 版本保存/恢复抽屉

标题：`版本保存/恢复`

内容顺序：

1. 范围说明：保存和恢复覆盖整个文件库；对话和 trace 不改变。
2. 最近恢复来源：仅当 `library.last_restore` 存在时显示。
3. 保存为恢复点：备注输入、保存按钮、保存进度/成功/失败状态。
4. 恢复点列表：保存点 label、创建时间、恢复按钮。
5. 恢复确认弹窗：说明当前未保存为恢复点的文件变更会丢失。

最近恢复建议文案：

```text
最近恢复：来自“{source_save_point_label}”
恢复时间：{restored_at}
保存点创建时间：{source_save_point_created_at}
```

保存点同步规则：

- 点击保存后立即显示 `已接收` 或 `正在保存恢复点`。
- 前端按 POST 返回的 operation id 查询 terminal；terminal `succeeded` 且返回 `result_save_point_id` 后刷新保存点列表和文件库 detail。
- 如果保存点列表已出现 `result_save_point_id` 对应的保存点，清除“正在保存”并显示完成态。
- 不把 `operation: null` 当作成功；它只表示当前没有 active blocker。
- 不用保存点 `message`、label 或创建时间模糊匹配作为正常成功判据。

### 5.3 模板保存/发布抽屉

标题：`模板保存/发布`

内容顺序：

1. 范围说明：模板捕获整个文件库，已发布模板在当前项目创建 Agent task 时可选。
2. 保存模板表单：名称、描述、发布模式。
3. 发布模式：`保存并发布到当前项目`、`仅保存为未发布模板`。
4. 模板列表：名称、状态、来源文件库、发布/取消发布/删除动作。

模板抽屉不显示保存点列表，不承载恢复确认。模板内部 source save point 继续后端隔离，不进入用户可恢复保存点列表。

### 5.4 组件拆分建议

保留现有逻辑资产，避免重写：

- 从 `FileLibraryRecoveryDialog` 提取 shared operation banner、save point list、restore confirm、template form、template list。
- 新建 `FileLibraryVersionDrawer` 承载保存点和恢复。
- 新建 `TaskFileTemplateDrawer` 承载模板保存和发布。
- 保留 shared hooks，但新增显式 operation-id tracker，避免两个抽屉复制轮询逻辑。

建议新测试 ID：

- `files__version-entry`
- `files__template-entry`
- `files__dialog__version-save-restore`
- `files__dialog__template-save-publish`
- `files__version__last-restore`
- `files__save-point__operation-status`
- `files__template__operation-status`

## 6. TDD 与 e2e/visual 测试

### 6.1 TDD 优先补的单元/组件测试

先写失败测试，再实现：

- 保存点 admission 后，即使 `/operations/active` 仍返回 running，operation lookup terminal succeeded 时 UI 从“正在保存”切到“恢复点已保存”。
- 保存点列表已出现 `result_save_point_id` 对应保存点时，本地 saving 状态会被清除，输入框和按钮恢复可用。
- operation lookup terminal `succeeded` 但缺少 `result_save_point_id` 时，不显示“恢复点已保存”。
- 保存点 message、label 或创建时间相同但没有 `result_save_point_id` 时，不作为保存成功。
- `operation: null` 不显示保存成功或恢复成功，只显示“当前没有正在运行的文件更新”或不显示 terminal success。
- `library.last_restore` 存在时，版本抽屉显示来源保存点 label、恢复时间、保存点创建时间。
- 本地 restore operation succeeded 但 `library.last_restore` 还没从 API 返回时，不凭前端 state 猜测最近恢复来源。
- 两个入口分别打开两个抽屉；版本抽屉不出现模板表单，模板抽屉不出现保存点列表。
- 两个入口均受 `project:files:update` 门禁约束，不新增权限点。
- i18n keys 同步到 `en-US` 和 `zh-CN`，不写硬编码文案。

建议命令：

```bash
npm run test -- src/components/files/file-library-recovery/__tests__/FileLibraryRecoveryDialog.test.tsx
npm run test -- src/lib/hooks/__tests__/use-file-library-recovery.test.tsx
npm run test -- src/lib/hooks/__tests__/use-task-file-templates.test.tsx
npm run test -- src/lib/api/__tests__/files-api.test.ts
```

实际文件拆分后，命令按新测试文件名调整。

### 6.2 API/MSW/contract 测试

需要覆盖：

- FileLibrary list/detail 返回 `last_restore`。
- direct restore terminal success 后，MSW/后端持久更新 `last_restore`。
- failed / recovery_required restore 不更新、不清空、不覆盖已有 `last_restore`。
- idempotency replay 不把已有 `last_restore.restored_at` 回退到更早时间。
- save point operation lookup terminal succeeded 返回 `result_save_point_id`。
- template source save point 仍不出现在普通 save point list。
- OpenAPI、generated types、route-kind map 与实现一致。

建议命令：

```bash
npm run test -- src/lib/__tests__/file-library-recovery-msw.test.ts
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

### 6.3 Focused e2e

新增或扩展 focused Files story：

- 保存点无刷新完成：点击 `版本保存/恢复`，创建保存点，等待 UI 显示完成，断言新保存点可见且按钮恢复可用，不刷新页面。
- 最近恢复持久显示：创建保存点，修改文件，恢复，等待 terminal success，刷新页面，打开版本抽屉，断言最近恢复来源和时间仍显示。
- 最近恢复不被失败覆盖：已有最近恢复来源后，触发 failed 或 recovery_required 恢复路径，刷新后仍显示原最近恢复来源。
- 双入口 IA：Files 页面同时显示两个入口；打开版本抽屉不显示模板表单；打开模板抽屉不显示恢复点列表。
- 模板保存/发布仍可用：在模板抽屉保存并发布项目模板，Agent task 创建入口能看到该模板。

按项目验证策略，优先 focused e2e，不在每个小改动后跑 full visual catalog 或 release gate。

### 6.4 Focused visual

只补受影响状态：

- 版本抽屉：有最近恢复来源、保存点 saving、保存点 succeeded、恢复确认。
- 模板抽屉：创建表单、项目发布模式、模板列表 loading/error/empty/failed。
- 桌面右侧抽屉和窄屏单列布局。

只有视觉系统级改动或发布收口时再跑 full visual catalog。

## 7. 实施步骤

### Slice 1：后端持久投影与 operation contract

Owner：Files backend / API contract

改动：

- 在 AgentSmith FileLibrary projection/catalog 增加最近恢复来源持久记录，并通过 public DTO 投影为 nested `last_restore`。
- 内部持久字段可以使用 `last_restored_*` 扁平命名；public DTO 不暴露这些内部字段。
- restore terminal `succeeded` 时写入最近恢复来源；失败和 recovery_required 不写、不清空、不覆盖。
- idempotency replay 不回退已有 `restored_at`。
- 保存点 operation lookup terminal 增加 `result_save_point_id`。
- 更新 OpenAPI、generated types、MSW、API tests。
- 不要求 AFSCP/JVS 或其他兄弟项目为最小闭环新增产品展示字段。

验收：

- 刷新页面后仍能从 file library list/detail 读取最近恢复来源。
- 保存点 terminal operation 可以通过 public operation id 查到结果保存点。
- failed / recovery_required 和 idempotency replay 的 last_restore 保护规则有自动化测试。

### Slice 2：前端 operation-id tracker

Owner：Files frontend

改动：

- 在保存点创建后记录 POST 返回的 operation id。
- 新增或调整 hook：按 operation id 轮询 `getFileLibraryVersionOperation` 到 terminal，不能用 active operation 当完整状态流。
- terminal `succeeded` 且存在 `result_save_point_id` 后 invalidate save points、file library detail/list、active operation。
- 保存点列表出现 `result_save_point_id` 时清理 local saving 状态。
- 保持 `operation: null` 语义为“无 active blocker”，不显示成功。
- 不用 message、label 或创建时间模糊匹配保存点创建成功。

验收：

- 不刷新页面也能从“正在保存”切到“恢复点已保存”。
- active operation、save point list、operation lookup 任一路径短暂滞后都不会让 UI 永久卡住。
- operation lookup 缺少 `result_save_point_id` 或只有 message 匹配时不会误报保存成功。

### Slice 3：拆分两个入口和两个抽屉

Owner：Files frontend / UX

改动：

- 在 Files 页面文件库操作区放置 `版本保存/恢复` 和 `模板保存/发布` 两个入口。
- 将 `FileLibraryRecoveryDialog` 拆成两个抽屉或保留 shared internals 后新建两个 public components。
- 版本抽屉只展示保存点、恢复、最近恢复来源。
- 模板抽屉只展示模板保存、发布、列表。
- 同步 `en-US`、`zh-CN` 文案。

验收：

- 两个入口各自打开独立抽屉。
- 两个抽屉关闭/打开状态互不污染。
- 两个入口继续复用 `project:files:update`。

### Slice 4：测试和 focused evidence

Owner：Files frontend / QA

改动：

- 补 TDD 测试、MSW contract 测试、focused e2e、focused visual。
- 按风险执行 `npm run verify` dry-run 或 focused commands。
- 阶段收口再根据改动范围决定是否跑 `npm run verify -- --goal=pr --run`。

验收：

- 保存点无刷新完成、双入口 IA、最近恢复持久显示都有自动化证据。
- 没有 raw internal code/path 出现在普通用户 UI。

## 8. 非目标

本轮明确不做：

- 不做文件级恢复、局部目录恢复、diff preview。
- 不恢复 restore preview / restore run / restore cancel 旧流程。
- 不做恢复前自动保存当前状态。
- 不做文件 hash、HOME hash、内容证明、容量预扫描、tree walk、copy fallback。
- 不新增 `FileLibraryTemplate` 产品对象。
- 不做模板组/用户细粒度分享。
- 不做跨 project 模板市场。
- 不新增权限点；两个入口继续使用 `project:files:update`。
- 不用前端本地 state、localStorage、operation cache 猜测最近恢复来源。
- 不要求 AFSCP/JVS 或兄弟项目新增产品展示字段。
- 不把 active operation 当作完整状态流。
- 不用保存点 message、label 或时间模糊匹配作为保存点成功判据。
- 不做全站 Files 页面重构或视觉系统重构。
- 不把每个小改动都升级到 full release gate。

## 9. 验收标准

功能验收：

- 用户点击保存点保存后，不刷新页面也能看到保存完成或失败；成功基于 operation lookup terminal `succeeded` 和 `result_save_point_id`，新保存点随后出现在列表中。
- UI 不再因 active operation、save point list、operation lookup 的短暂不同步而永久显示“正在保存”。
- Files 页面提供 `版本保存/恢复` 和 `模板保存/发布` 两个独立入口。
- 版本抽屉不包含模板保存/发布表单；模板抽屉不包含保存点恢复列表。
- 恢复成功后，刷新页面、重新进入 Files、重新打开版本抽屉，仍显示最近恢复来源保存点和恢复时间。
- 最近恢复来源只来自 AgentSmith FileLibrary public DTO 的 nested `last_restore`，前端不本地推断。
- AFSCP/JVS 不承担 `last_restore` 产品展示字段，最小闭环不要求兄弟项目改动。
- 两个入口都继续受 `project:files:update` 控制。

测试验收：

- 组件/hook 测试覆盖保存点 terminal 同步、`operation: null` 语义、last restore projection、双抽屉 IA。
- MSW/API 测试覆盖 `last_restore` 写入、failed/recovery_required 不覆盖、idempotency replay 不回退 `restored_at`、`result_save_point_id`、模板 source save point 隔离。
- Focused e2e 覆盖保存点无刷新完成、最近恢复刷新后仍显示、两个入口与模板主路径。
- Focused visual 覆盖两个抽屉的核心状态和窄屏布局。

安全与治理验收：

- 普通用户 UI 不展示 JVS、AFSCP、JuiceFS、control root、raw operation id、内部路径或 raw error code。
- 新文案全部进入 i18n。
- URL 参数和权限门禁沿用现有 Files 模块规则。
- 收口时根据实际改动范围运行对应 focused gate；合并前按项目工作流回到 `npm run verify -- --goal=pr --run` 或同等 PR gate。
