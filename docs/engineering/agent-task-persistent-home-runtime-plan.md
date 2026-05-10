# Agent Task File Library HOME Runtime Implementation Plan

更新时间：2026-05-09
状态：`current_implementation_plan`
适用范围：Agent task 创建/删除、Files 文件库绑定、managed runner、terminal、agent run、task HOME/cwd/artifacts 路径语义；Developer runner 在 AFSCP Slice 5 blocked 时只覆盖连接/存在状态和 fail-closed 证据，不覆盖 task HOME/file access/execution。

## 0. 文档状态

本文是当前工程实施计划，不是开放分析。本文的决策目标是：

> 文件库就是 Agent task 的持久 HOME 根目录。terminal 与 agent 使用同一个 HOME。同一个文件库不能同时绑定为多个未删除 task 的 HOME；未删除包括 active 和 archived。只有 Delete task 释放绑定，Archive 不释放。

实现时必须同步更新 contracts、OpenAPI/generated types、MSW、runner schema、Files/Agent task UI、runbook 和 backend-real evidence。实现完成后，以 contract/runbook/代码为当前运行时真相；本文作为当前开发计划记录关键工程约束。

本文不引入文件级权限、文件级锁、文件级策略，也不把 binding 暴露成用户需要理解的新产品对象。

## 1. 决策总表

| 决策面 | 结论 |
| --- | --- |
| 文件库与 HOME | 文件库根目录就是 task HOME 根目录 |
| terminal 与 agent | 同一 task 内共用同一个 `TASK_HOME` / `HOME`，默认 `cwd=$HOME/workspace` |
| 文件库独占 | 同一个文件库最多绑定一个未删除 task；active 和 archived 都占用 |
| Archive | 只改变 task 状态，不释放文件库绑定 |
| Delete task | 删除 task 元数据/对话/trace/artifact metadata，释放绑定，保留文件库和文件内容 |
| 文件库复用 | 新 task 必须显式选择已释放的文件库；只复用文件内容，不继承前一 task 历史、runner binding 或 terminal |
| 文件库删除 | 被未删除 task 绑定时禁止删除；释放绑定后仍受 Files 非空删除规则约束 |
| managed runner | 当前可执行 HOME binding 主链，使用 AFSCP workload mount binding |
| Developer runner | Slice 5 blocked 时只允许连接/存在状态诊断；task HOME/file access/execution 必须 fail closed |
| `task_home_segment` 身份 | 文件库稳定的 HOME segment，不是 task 稳定 segment，不由 task id 派生 |
| Binding 真相 | 后端 durable truth，使用 DB/JsonDocStore 持久条件写入或唯一约束保障 |
| In-memory Map | 只能作为 cache/test helper，不能作为绑定真相 |
| Pre-GA 数据 | 只保留目标 HOME 模型；开发/测试数据 reset/recreate |

## 2. 对象与路径模型

### 2.1 产品对象

```text
Project
  FileLibrary flib_a
    root == task HOME root while bound
    file_library_home_segment = flib_a_stable_segment

AgentTask task_1
  workspace_file_library_id = flib_a
  task_home_segment = flib_a_stable_segment
```

不变量：

- `workspace_file_library_id` 是 task 的文件系统根绑定。
- 文件库绑定在 task 创建时确定，task 生命周期内不可变。
- task 删除后，绑定释放；文件库 catalog、AFSCP repo mapping 和文件内容保留。
- 新 task 选择这个文件库时，会看到同一文件库根目录下已有文件。
- 新 task 不继承被删除 task 的 messages、trace、artifact metadata、runner binding、terminal session、PTY 或 replay。

### 2.2 HOME segment 身份

`task_home_segment` 的 wire 字段名继续保留，但语义必须改成 file-library-stable HOME segment。后端必须在文件库记录上持久化 `file_library_home_segment` 或等价字段，并由它填充 wire `task_home_segment`：

- segment 在文件库创建时生成并持久化。
- task 创建时把该 segment 写入 task record / execution context，作为运行时快照和审计字段。
- 复用同一个文件库创建新 task 时，segment 不变，因此 managed canonical path 仍是同一个 `/home/<task_home_segment>`。
- segment 不得由 task id、task title、runner id 或 Kubernetes workload name 派生。
- Kubernetes name、pod name、PVC/mount object name 可以使用独立算法，但不得回流为 runtime truth。
- segment 必须走统一校验：只允许安全路径段，拒绝空值、`.`、`..`、slash、backslash、traversal、控制字符、替换式 sanitize 和截断式 sanitize。

这个选择是为了符合“复用同一 HOME”的用户心智。若 segment 随 task 变化，复用同一文件库时绝对路径会变化，terminal、agent、生成文档和调试证据都会暗示这是一个新 HOME；这与本计划目标冲突。

### 2.3 路径合同

Managed runner：

```text
/home/<task_home_segment>/                 # TASK_HOME / HOME，文件库根目录
/home/<task_home_segment>/workspace/       # cwd / WORKSPACE_PATH
/home/<task_home_segment>/workspace/.artifacts/
/home/<task_home_segment>/.codex/
/home/<task_home_segment>/.mbos/
/home/<task_home_segment>/.agents/skills/
/home/<task_home_segment>/.cache/
/home/<task_home_segment>/.config/
/home/<task_home_segment>/.local/
```

Developer runner（Slice 5 blocked）：

```text
no local task HOME path
no local file_library binding
no execution self-check path
```

规则：

- managed runner 的 `task_home_path` 代表文件库根目录的执行呈现路径。
- Developer runner 在 AFSCP export-backed lease/connector 安全实现前不得创建、解析或暴露 local `file_library` HOME；只能做 runner 记录、密钥/连接配置、readiness projection 和 Test connection。
- `workspace_path` 必须等于 `${task_home_path}/workspace`。
- `artifacts_path` 必须等于 `${workspace_path}/.artifacts`。
- `workspace_binding_mode=file_library | pre_mounted` 只表示可执行 runtime 如何获得文件库根目录，不改变 managed/sandbox 的目录语义；它不是 Developer runner local path/file_library smoke 的依据。
- runner 只能消费后端下发的 path fields；不得根据文件库 id、task id 或 runner 类型自行拼路径。
- Files 打开的文件库根目录就是 `$HOME` 根目录；不要虚拟成 `$HOME/workspace`，也不要展示 `agent-tasks/<task>` 这类实现目录。

## 3. Durable Binding Truth

### 3.1 后端真相

绑定独占必须由后端 durable truth 保证。推荐新增或收敛一个当前绑定集合：

```text
agent_task_file_library_bindings
  key: <workspace_id>/<project_id>/<file_library_id>
  workspace_id
  project_id
  file_library_id
  task_id
  binding_generation
  owner_user_id
  runtime_writable_affordance: task_internal_home | files_update
  binding_state: bound | releasing
  acquired_at
  updated_at
  correlation_id
```

约束：

- 同一 `workspace_id/project_id/file_library_id` 只能有一个 current binding document。
- active 和 archived task 都对应 `binding_state=bound`，都占用文件库。
- released 历史不留在 current binding truth 中；释放历史写 audit，或写单独 history collection。
- 从 task 表派生占用状态可以作为读模型，但不能作为并发控制的唯一依据。
- 每次 acquire 必须分配新的 `binding_generation`。同一文件库复用时 `task_home_segment` 不变，因此 generation 是 runtime holder / lease / release 的 ABA fence。
- `runtime_writable_affordance` 是后端私有授权快照：`create_new` 来自 task 内部 HOME 创建授权，`use_existing` 来自 Files 写能力和 resource policy / owner 边界。它不是新 permission point。
- 进程内 Map、hydrated fixture、MSW fixture 只能是 cache/test helper。服务重启、多实例并发后仍必须保持独占。

DB 实现必须使用唯一约束或事务内 conditional insert。JsonDocStore 实现必须提供持久 compare-and-create / compare-and-delete，条件写失败返回 typed conflict。禁止只用本进程锁或前端过滤完成独占。

### 3.2 操作语义

`acquireBinding`：

- 在同一 truth 边界检查文件库属于当前 workspace/project、状态为 `ready`、没有 current binding。
- 写入新的 `binding_generation` 和已校验的 `runtime_writable_affordance`，供后续 workspace-access、terminal、runner holder 发放时复校验。
- 条件创建 binding document，失败返回 `AGENT_TASK_FILE_LIBRARY_IN_USE` 或对应文件库状态错误。
- 必须写 audit，成功和冲突都要有 correlation id。

`releaseBinding`：

- 只允许 task DELETE 流程释放。
- 条件删除或标记 releasing 的前提是 binding 的 `task_id` 与 `binding_generation` 等于被删除 task 当前快照。
- release 前必须重新确认 active run、terminal、live holder、live lease 已清除，或这些 holder / lease 已被 `binding_generation` / `lease_epoch` fence 判定为 stale。
- 操作必须幂等：binding 已不存在且 task 已 deleted 时视为完成。
- Archive/PATCH/cancel run/terminal close 不释放 binding。

`reconcileBinding`：

- 如果 binding 指向不存在、deleted、或长期 stuck `deleting` 的 task，reconcile 只有在 blocker truth 证明无 active run、terminal、live holder、live lease，或所有遗留 holder / lease 都被 generation / epoch fence 判定 stale 后，才可以释放并写 audit。
- 如果 task 仍是 active/archived，reconcile 必须保留 binding。
- stale lease、失效 holder、已消失 pod 走 TTL/reconcile，不得成为永久删除阻断；无法确认 stale 时不得释放 binding，必须返回 blocked / retryable reconcile evidence。

## 4. CreateTask Contract

### 4.1 参数矩阵

`workspace_mode` 缺省为 `create_new`。`workspace_file_library_id` 只在 `use_existing` 下合法。

| `workspace_mode` | `workspace_file_library_id` | 结果 |
| --- | --- | --- |
| omitted / `create_new` | omitted | 创建新文件库并绑定 |
| omitted / `create_new` | present | `422 AGENT_TASK_WORKSPACE_MODE_INVALID` |
| `use_existing` | present | 绑定已有 ready、未占用、且 actor 具备 runtime writable affordance 的文件库 |
| `use_existing` | omitted | `422 AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED` |
| other | any | `422 AGENT_TASK_WORKSPACE_MODE_INVALID` |

创建时还必须拒绝：

- 文件库不存在或不在当前 workspace/project：`404 FILE_LIBRARY_NOT_FOUND`。
- actor 无权把该文件库交给 task runtime 写入：`403 FILE_LIBRARY_FORBIDDEN`。`use_existing` 下只具备 Files read/use 不够，必须有 `project:files:update` 加 resource policy / owner 边界通过。
- 文件库不是 `ready`：`409 FILE_LIBRARY_NOT_READY`。
- 文件库为 `deleting/deleted`：`409 FILE_LIBRARY_DELETING`。
- 文件库已被未删除 task 绑定：`409 AGENT_TASK_FILE_LIBRARY_IN_USE`。

### 4.2 原子流程

CreateTask 的可见成功条件是：task record、file library、binding 三者全部提交完成。不得留下半创建可见 task。

推荐事务流程：

1. 校验 token、URL params、task payload、runner binding authority。
2. `create_new` 时用 `project:agent_task:use` 创建 task HOME 文件库，持久化 `file_library_home_segment`，public source 统一为 `agent_task_files`，并记录 task 内部 HOME 的 writable affordance。
3. `use_existing` 时校验文件库 `ready`、project 边界、`project:files:update`、resource policy 和 owner 边界；Files read/use 只能浏览，不能把文件库交给 task runtime 写入。
4. 在同一事务内 conditional acquire binding。
5. 持久化 task record，写入 `workspace_file_library_id`、`workspace_file_library_name`、`task_home_segment`、runner binding fields。
6. 提交 audit `agent_task.file_library_binding.acquire` 和 `agent_task.create`。
7. 返回 task，并触发前端刷新 file library list/detail query。

如果当前 store 不支持跨集合事务，必须实现 idempotent saga：

1. 创建不可见 `creating` task draft 或仅持有 request correlation，不进入普通 task list。
2. `create_new` 自动文件库创建失败时直接返回错误，不创建 task。
3. binding acquire 失败时删除 task draft；若是自动创建文件库，执行补偿删除或标记 `deleting` 等待 reconcile job。
4. task persist 失败时释放 binding；若是自动创建文件库且无用户写入，补偿删除文件库 catalog 和 AFSCP repo mapping。
5. compensation 失败必须写 audit，并由 reconcile job 收敛；普通用户不能看到半创建 task。

`create_new` 自动文件库命名需要可解释且低心智，例如默认从 task title 生成，并在 Files 中显示来源为 Agent task 自动创建。实现不需要把 binding 变成用户可管理的新对象。自动文件库作为 Agent task 创建的内部 HOME 资源存在；之后用户通过 Files UI 编辑该文件库时仍必须走 `project:files:update` 和 Files resource policy。

## 5. Task DELETE Contract

### 5.1 Delete blockers

Delete task 只在 live blockers 存在时返回 `409 AGENT_TASK_DELETE_BLOCKED`：

- active agent run。
- active terminal session 或 terminal close/hard-teardown debt。
- live Developer workspace holder。
- live runner workspace lease 或 managed mount holder。

stale/releasable lease 不作为永久阻断：

- 过期 lease、找不到 owner 的 holder、已消失 pod、已超过 TTL 的 releasing 状态应先走 reconcile，并用 holder `task_id` + `binding_generation` + `lease_epoch` 证明它们属于旧 generation 或已不可写。
- reconcile 成功后继续 delete。
- reconcile 无法确认安全时才返回 blocked，并带 `retry_after_seconds` 或 safe blocker reason。

Delete 不自动停止活跃进程，不做部分用户不可理解的清理。

### 5.2 提交顺序

目标是避免两类坏状态：task 已删除但 binding zombie；binding 已释放但 task 仍作为普通 task 可见。

推荐事务流程：

1. 读取 task、binding、file library，校验 task 属于当前 workspace/project。
2. 先收集 live blockers；若存在，task 状态不进入 `deleting`，返回 `AGENT_TASK_DELETE_BLOCKED`。
3. 设置 task deletion state 为 `deleting`，从普通 task list 中隐藏或显示为不可操作删除中状态。
4. 删除 messages、trace、artifact records、runtime coordination、runner binding metadata、terminal metadata。
5. 同一事务内写 task tombstone/deleted state，并 conditional release binding；release predicate 必须再次确认无 live blockers，或 holder / lease 已被 generation / epoch fence 判定 stale。
6. 提交 audit `agent_task.delete`、`agent_task.file_library_binding.release`。
7. 不删除文件库记录，不删除文件库内容，不调用 file library delete。

如果只能 saga：

- 先把 task durable 标记为 `deleting`，确保不再作为普通可运行 task 出现。
- binding 在 task 已是 `deleting/deleted` 后才能释放，且 release 前仍必须执行 blocker truth guard。
- release 失败时保留 binding 并由 reconcile 重试，避免文件库过早复用。
- release 成功但 metadata cleanup 未完成时，task 必须保持 hidden/tombstoned；cleanup job 继续删除 metadata。

Task DELETE 删除：

- task record 或 tombstone 之外的普通 task 可见数据。
- messages、trace、artifact metadata、terminal metadata、runner binding metadata。

Task DELETE 保留：

- 文件库 catalog、AFSCP repo mapping。
- 文件库中所有文件，包括 `workspace/.artifacts` 实际文件、`.codex`、`.mbos`、`.agents`、`.cache`、`.config`、`.local`。

## 6. File Library Delete 与写操作 Race

文件库删除必须在后端同一 truth 边界完成 `ready -> deleting` 与 `no current binding` 检查。DB 必须使用事务；JsonDocStore 必须提供 conditional transition / CAS：

```text
file_library.status == ready
file_library.version == expected_version
no current binding for workspace/project/file_library
  -> status = deleting, version = version + 1, delete_correlation_id = correlation_id
```

- 如果存在 current binding，返回 `409 FILE_LIBRARY_TASK_IN_USE`。
- 如果文件库状态不是 `ready`，返回对应 typed error。
- 如果 expected version/status 不匹配，返回当前状态对应的 typed conflict，不得继续删除。
- 如果状态已是 `deleting/deleted`，CreateTask、workspace-access、task HOME writable access issuance 和所有写操作都必须拒绝。
- 非空检查仍保留在 Files delete 规则中。无 task binding 但非空时返回 `409 FILE_LIBRARY_NOT_EMPTY`，并必须把文件库从本次 `deleting` transition 回滚/transition 回 `ready`，写入新 version、correlation id 和 audit；不能让文件库 stuck 在 `deleting`。

Delete AFSCP repo mapping / storage 的实际删除只能在 `deleting` transition 成功且非空检查通过后执行。若后续步骤失败，reconcile 必须按 `delete_correlation_id` 收敛到 `ready` 或 `deleted` 的明确终态，并写 audit；普通写入口在终态前继续 fail closed。

CreateTask 和所有写入口只接受 `ready`，且必须校验读取到的 status/version 仍匹配当前写事务或 CAS 条件。只在前端看到 ready 不构成授权。

进入 `deleting` 后必须拒绝这些写操作：

- upload、move、rename、delete object、create folder。
- task HOME writable access issuance that creates new writable holder/ticket。
- `POST /tasks/{taskId}/workspace-access` 或任何会为 runner 建立新 holder 的请求。
- CreateTask `use_existing` 和自动绑定流程。

浏览和下载可以按现有 Files 规则返回只读状态或 typed conflict，但不能发放新的写凭据。UI 需要在 409 race 后 refetch file library list/detail，并显示 i18n inline error。

## 7. 权限边界

不新增 permission point，复用现有 token 和后端 row-level/resource checks。

| 操作 | 权限/边界 |
| --- | --- |
| CreateTask `create_new` | `project:agent_task:use`；自动创建文件库作为 task create 的内部 HOME 资源，写 source/audit，不授予通用 Files UI 写能力 |
| CreateTask `use_existing` | `project:agent_task:use` + 后端 writable affordance；具体复用现有 `project:files:update` + project/resource policy/owner 边界，不新增 permission point，不得跨 project |
| Explicit Developer runner binding | Slice 5 blocked 时 backend binding affordance 必须 fail closed；Slice 5 unblocked 并实现后才允许 `project:agent_task:use` + `project:agent_runner:manage` + backend binding affordance |
| Delete task release binding | `project:agent_task:use`；这是 task lifecycle，不要求 `project:files:update`，且不删除文件 |
| File library delete | `project:files:update` + no current task binding + empty library rule |
| Files browse/download bound HOME | `project:endpoint:use`；bound 不禁止浏览 |
| Files edit/upload/move bound HOME | `project:files:update`；bound 不禁止编辑，但 deleting 状态禁止写 |
| Workspace-access writable holder/ticket | `project:agent_task:use` + current task binding + `runtime_writable_affordance` 复校验；`use_existing` 必须重新通过 `project:files:update` + resource policy/owner 边界 |
| Terminal writable access | `project:agent_task:use` + `project:agent_task:terminal` + current task binding + writable affordance 复校验；Slice 5 unblocked 后的 Developer-bound task 继续叠加 runner manage/affordance |
| Task HOME writable access issuance | current task binding + file library `ready` + writable affordance + generation/epoch fence；不得只凭 stale holder 或 taskHome 发放 |

后端仍是唯一授权真相。前端禁用态只用于 UX，不得替代后端校验。Terminal、workspace-access、runner holder 和 task HOME writable access issuance 在发放任何可写 holder/ticket 前，都必须重新读取 task binding、file library status/version 和 writable affordance；否则会绕过 Files 写权限。

## 8. Contract、错误码与审计

### 8.1 OpenAPI / generated / MSW

必须同步：

- `docs/contracts/specs/openapi.yaml` 和 generated types。
- backend route schemas / zod validators。
- MSW handlers、fixtures、parity tests。
- `docs/contracts/agent-execution-protocol.md`。
- `docs/contracts/internal-agent-workspace-binding-model-v1.md`。
- `docs/contracts/files-frontend-module-map.md`。
- `docs/agent-task-runner-runbook.md`。

### 8.2 Typed errors

| Error code | HTTP | 场景 | Safe fields | i18n key |
| --- | --- | --- | --- | --- |
| `AGENT_TASK_WORKSPACE_MODE_INVALID` | 422 | workspace mode 非法或 `create_new` 同时传 `workspace_file_library_id` | `field`, `workspace_mode` | `errors.agent_task_workspace_mode_invalid` |
| `AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED` | 422 | `use_existing` 未传文件库 id | `field` | `errors.agent_task_workspace_file_library_required` |
| `FILE_LIBRARY_NOT_FOUND` | 404 | 文件库不存在或不属于当前 workspace/project | `file_library_id` | `errors.file_library_not_found` |
| `FILE_LIBRARY_FORBIDDEN` | 403 | actor 无权使用该文件库 | `file_library_id` | `errors.file_library_forbidden` |
| `FILE_LIBRARY_NOT_READY` | 409 | 文件库状态不是 ready | `file_library_id`, `file_library_status` | `errors.file_library_not_ready` |
| `FILE_LIBRARY_DELETING` | 409 | 文件库 deleting/deleted 或删除中拒绝写/绑定 | `file_library_id`, `file_library_status` | `errors.file_library_deleting` |
| `AGENT_TASK_FILE_LIBRARY_IN_USE` | 409 | CreateTask 绑定已占用文件库 | `field`, `file_library_id`, `bound_task_visible`, optional `bound_task_id`, optional `bound_task_title`, optional `bound_task_status` | `errors.agent_task_file_library_in_use` |
| `FILE_LIBRARY_TASK_IN_USE` | 409 | 删除文件库时仍被 task 占用 | `file_library_id`, `bound_task_visible`, optional `bound_task_id`, optional `bound_task_title`, optional `bound_task_status` | `errors.file_library_task_in_use` |
| `FILE_LIBRARY_NOT_EMPTY` | 409 | 文件库释放绑定后仍非空 | `file_library_id` | `errors.file_library_not_empty` |
| `AGENT_TASK_DELETE_BLOCKED` | 409 | Delete task 遇到 live blockers | `task_id`, `blockers`, optional `retry_after_seconds` | `errors.agent_task_delete_blocked` |
| `AGENT_TASK_WORKSPACE_BINDING_CONFLICT` | 409 | workspace-access、terminal、task HOME holder issue、holder adopt/release 发现 task/binding/holder generation 不匹配 | `task_id`, `file_library_id`, optional `holder_id`, optional `binding_generation`, optional `lease_epoch` | `errors.agent_task_workspace_binding_conflict` |

`bound_task_id/title/status` 只能在 actor 可见该 task 摘要时返回。不可见时仍返回 occupied 状态，但不泄露 task title、owner、prompt、runner、内部路径或 trace。

Route x error mapping 必须在 OpenAPI、handlers、MSW parity 和 frontend error handling 中一致：

| Route / route family | Deleting mapping | Bound mapping | Conflict / version mapping |
| --- | --- | --- | --- |
| CreateTask `POST /tasks` | selected file library `deleting/deleted` -> `409 FILE_LIBRARY_DELETING` | selected file library has current binding -> `409 AGENT_TASK_FILE_LIBRARY_IN_USE` | invalid mode/id -> `422 AGENT_TASK_WORKSPACE_MODE_INVALID` or `AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED`; stale ready/version -> `409 FILE_LIBRARY_NOT_READY` with current status/version |
| Task DELETE `DELETE /tasks/{taskId}` | task already `deleting` is idempotent only if same task/binding generation; otherwise conflict | live run/terminal/holder/lease -> `409 AGENT_TASK_DELETE_BLOCKED` | stale holder release/adopt or binding generation mismatch -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT`; no release without blocker truth guard |
| File library DELETE | existing `deleting/deleted` -> `409 FILE_LIBRARY_DELETING` | current task binding -> `409 FILE_LIBRARY_TASK_IN_USE` | expected version/status mismatch -> typed status conflict; non-empty after transition -> `409 FILE_LIBRARY_NOT_EMPTY` and transition back to `ready` |
| Files write routes: upload/move/rename/delete object/create folder | file library `deleting/deleted` -> `409 FILE_LIBRARY_DELETING` | bound HOME is writable only with `project:files:update`; bound alone is not a conflict | stale status/version -> typed status conflict; no permission -> `403 FILE_LIBRARY_FORBIDDEN` |
| Workspace-access `POST /tasks/{taskId}/workspace-access` | bound file library not `ready` -> `409 FILE_LIBRARY_DELETING` or `FILE_LIBRARY_NOT_READY` | current binding must match task; missing/mismatched binding -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT` | writable holder denied when writable affordance fails -> `403 FILE_LIBRARY_FORBIDDEN`; stale generation -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT` |
| Task HOME writable access issuance | file library not `ready` -> `409 FILE_LIBRARY_DELETING` or `FILE_LIBRARY_NOT_READY` | requires current task binding and writable affordance; bound to another task -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT` | holder_id/task_id/generation/epoch mismatch -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT` |
| Metadata PATCH for file library/task workspace metadata | deleting file library -> `409 FILE_LIBRARY_DELETING`; deleting task workspace binding metadata -> `409 AGENT_TASK_WORKSPACE_BINDING_CONFLICT` | display metadata patch may proceed with update permission; changing HOME identity/AFSCP repo mapping while bound -> `409 FILE_LIBRARY_TASK_IN_USE` | expected version/status mismatch -> typed status conflict with safe current status/version |

### 8.3 审计事件

| Event | Result | Metadata |
| --- | --- | --- |
| `agent_task.create` | success/error | `task_id`, `file_library_id`, `workspace_mode`, `actor_id`, `correlation_id` |
| `agent_task.file_library_binding.acquire` | success/error | `task_id`, `file_library_id`, `workspace_mode`, `actor_id`, `correlation_id` |
| `agent_task.file_library_binding.conflict` | error | `file_library_id`, redacted `bound_task_*`, `reason_code`, `correlation_id` |
| `agent_task.delete` | success/error | `task_id`, `file_library_id`, `actor_id`, `deleted_metadata_kinds`, `correlation_id` |
| `agent_task.file_library_binding.release` | success/error | `task_id`, `file_library_id`, `release_reason=task_delete`, `correlation_id` |
| `agent_task.delete.blocked` | error | `task_id`, `blocker_types`, redacted holder ids, `correlation_id` |
| `agent_task.file_library_binding.reconcile` | success/error | `file_library_id`, optional `task_id`, `reconcile_reason`, `correlation_id` |
| `agent_task.create.compensation` | success/error | `workspace_mode`, optional `task_id`, optional `file_library_id`, `failed_step`, `correlation_id` |
| `agent_task.delete.compensation` | success/error | `task_id`, `file_library_id`, `failed_step`, `correlation_id` |
| `project.file_library.delete.blocked` | error | `file_library_id`, redacted `bound_task_*`, `correlation_id` |
| `project.file_library.delete.rollback` | success/error | `file_library_id`, `from_status=deleting`, `to_status=ready`, `version`, `reason=not_empty_or_compensation`, `correlation_id` |

审计和 debug 日志不得包含 Project secrets、OAuth token、storage credentials、metadata_url、AFSCP access credential payload、raw trace 或 host-private absolute paths。request id / correlation id 必须贯穿 CreateTask、binding acquire、DELETE、release、reconcile 和 compensation。

实现 evidence 必须包含 audit snapshots 和 redaction assertions：`agent_task.create`、`agent_task.delete` 成功事件可查；reconcile、compensation、file-library rollback 有 success/error 审计；冲突和 blocked 审计只含 redacted holder/task 摘要，不泄露 secrets、credential payload、metadata_url、raw trace 或 host-private absolute paths。

## 9. Frontend / UX

Files 只展示两个主状态：

- 可用：ready 且没有 current task binding。
- 已被 task 占用：ready 但存在 current task binding，包括 archived task。

FileLibrary DTO 必须由后端提供安全占用字段：

- `task_home_binding_status: unbound | bound`
- `bound_task_visible`
- `bound_task_id`，仅 `bound_task_visible=true` 时返回
- `bound_task_title`，仅 `bound_task_visible=true` 时返回
- `bound_task_status`，仅 `bound_task_visible=true` 时返回

不要承诺“可复用状态”作为第三种状态；task 删除释放后，文件库自然回到“可用”。如果 bound task 对 actor 可见，可以在详情里说明 active/archived 占用；不可见时只显示安全占用文案。

Agent task 创建：

- 默认选择创建新文件库。
- 使用已有文件库时，只展示后端 DTO 标记为可用的文件库。
- 提交遇到 `AGENT_TASK_FILE_LIBRARY_IN_USE` 时刷新 fileLibraries query，并提示用户选择其他文件库或创建新文件库。
- 自动创建文件库需要显示可理解的名称和来源，例如“由 Agent task 自动创建”。

Task 删除确认：

- 明确会删除 task 历史、对话、trace、artifact metadata 和 runner/terminal 关联。
- 明确文件库和文件内容保留，可在 Files 中继续使用，也可被新 task 显式选择。
- 不暗示会清空 HOME。

Files bound banner：

- 告诉用户“这个文件库正在作为某个 Agent task 的 HOME 使用，Files 中的改动会影响该 task 的 HOME 内容。”
- 不把 task 绑定解释成禁止浏览、禁止挂载或禁止编辑；是否可写仍由 Files 权限和文件库状态决定。
- 删除文件库按钮在 bound 时禁用或失败为 typed conflict。

Artifacts：

- Delete task 后，`workspace/.artifacts` 中的实际文件仍在 Files 中。
- 前一 task 的 artifact metadata 不继承到新 task。
- 新 task 需要使用旧 artifact 文件时，通过 Files 或 input 重新选择。

Cache 行为：

- task create/update/archive/delete 成功后刷新 task queries 和 fileLibraries list/detail queries。
- `AGENT_TASK_FILE_LIBRARY_IN_USE`、`FILE_LIBRARY_TASK_IN_USE`、`FILE_LIBRARY_DELETING`、`FILE_LIBRARY_NOT_EMPTY` 后刷新相关 file library query，处理并发 race。
- Files delete 409 race 使用 inline/i18n 错误，不只 toast 后静默失败。
- MSW parity 必须覆盖 status code、required fields、unique occupied/archived fixtures、redacted invisible-bound-task fixtures。

## 10. Runtime Fail Closed

`TaskExecutionContext`、terminal execution context、`POST /tasks/{taskId}/workspace-access` 必须强校验并 fail closed。

必填身份字段：

- `task_id`
- `workspace_file_library_id` in `TaskExecutionContext`
- `file_library_id` in workspace-access responses
- `workspace_binding_mode`
- `runtime_profile`
- `task_home_segment`

必填路径字段：

- `task_home_path`
- `workspace_path`
- `artifacts_path`
- `library_root_path`

校验规则：

- `workspace_binding_mode` 只能是 contract 中允许的值。
- `runtime_profile` 必须与当前可执行 runtime path contract 一致；Slice 5 blocked 时不得解析 Developer runner local HOME。
- `library_root_path` 必须是 `.`，表示文件库根就是 HOME。
- `workspace_path` 必须在 `task_home_path` 下，且尾部为 `/workspace`。
- `artifacts_path` 必须等于 `${workspace_path}/.artifacts`。
- `task_home_segment` 必须通过统一 path segment validator。
- workspace-access echo 必须逐字段比对 `task_id`、`workspace_file_library_id` / `file_library_id`、`workspace_binding_mode`、`runtime_profile`、`task_home_segment`、`task_home_path`、`workspace_path`、`artifacts_path`、`library_root_path`。
- managed pod-manager 必须校验 mountPath/taskHome/workspace/artifacts/env/workingDir 一致，拒绝空路径、相对路径、traversal 和错误 prefix。
- URL id 必须 encode；Kubernetes name derivation 只能作为 infra name，不能作为 runtime path truth。

Runner path 目标：

- `mountRoot` / `taskRoot` / `runtimeRoot` / `homeDir` 都等于 `taskHome`。
- `cwd` 始终是 `workspaceDir`。
- `artifactsDir` 始终是 `workspaceDir/.artifacts`。
- `file_library` 模式把文件库根目录 mount 到 `taskHome`。
- `pre_mounted` 模式直接使用已挂载的 `taskHome`。
- mount registry、lease、release 不得只以 `taskHome` 为 key；同一文件库复用时 `taskHome` 不变，会产生 ABA release 风险。
- 每个 workspace-access、terminal、runner holder 必须携带 `holder_id`、`task_id`、`file_library_id`、`task_home_segment`、`binding_generation`、`lease_epoch`、`holder_kind`、`issued_at`、`expires_at`。
- release/adopt/reconcile 的条件键是 `holder_id + task_id + binding_generation + lease_epoch`，`taskHome` 只能作为 path 校验字段。前一 generation task 的迟到 release、stale terminal close 或 stale runner cleanup 如果 generation/epoch 不匹配，只能 no-op 并写 debug/audit evidence，不能释放新 task holder/mount。
- workspace-access、terminal 和 managed runner 都必须在 holder 发放、续租、adopt、release、reconcile 时校验 generation / epoch fence；Slice 5 blocked 时 Developer runner 不得发放 task HOME/file access holder。

## 11. Credentials Boundary

- execution ticket、Project secrets、managed OAuth credentials、AFSCP export/workload credentials、metadata_url、临时授权材料不得写入 task HOME、workspace、artifacts、Codex config 或可复用工具配置。
- runner 可以把可复用工具配置、缓存、安装产物写入 HOME，但不能把短期授权票据作为 HOME 状态的一部分。
- runner-private task HOME holder registry 必须有 redaction、TTL 和 path isolation；debug dump 不得泄露 credential payload 或 metadata_url。
- 生成的 task docs、`AGENTS.md`、`RUNNER_RUNTIME.md` 不能暗示 auth material 位于 HOME 下。
- 如果上游工具必须生成临时凭据文件，必须落在受控短生命周期位置，并在 run/terminal session 结束时清理；不得进入文件库复用语义。

## 12. Artifact 双层语义

artifact 有两个不同路径语义，不能混用：

- metadata `task_relative_path` 是 workspace-relative：`.artifacts/<name>`。
- file-library object key 是 root-relative：`workspace/.artifacts/<name>`。

要求：

- collector 只扫描 `$TASK_HOME/workspace/.artifacts`。
- 不扫描 `$TASK_HOME/.artifacts`、`$TASK_HOME/.codex`、`$TASK_HOME/.mbos`、`$TASK_HOME/.agents`。
- artifact 下载 fallback 使用 file-library object key `workspace/.artifacts/...`。
- 不再使用 `agent-tasks/<task>/workspace/.artifacts/...`。

## 13. 实施同步清单

当前模型不变量：

- 文件库是 AFSCP-backed repo 与 task HOME 绑定的产品对象；repo payload root、文件库 root 和 task HOME payload root 对齐。
- `file_library_home_segment` / `task_home_segment` 由当前 schema 持久化管理，是后端签发 HOME 和 runtime holder 的 identity 输入。
- task 删除只释放 binding、holder、lease 和可运行访问；HOME 内容留在对应文件库内，由文件库生命周期策略管理。
- 文件库在同一时刻只能作为一个 undeleted/active task 的 writable HOME；复用必须先完成前一 task 删除和后端 admission。
- 文件库不能作为多个 active task 的共享 HOME。
- managed runner 共享 HOME-relative 语义；路径形态由当前 task/file-library binding、HOME segment 和 runtime profile 共同确定。
- Developer runner 在 Slice 5 blocked 时没有 HOME-relative 执行语义；关闭证据是 upstream blocker/no-workaround record 加 fail-closed 行为。
- binding 权威在后端 durable binding repository / task-file-library records；前端状态和进程内缓存只做展示或临时加速，不能作为授权或 release 真相。
- binding generation、lease epoch、holder id 是 acquire/release/adopt/reconcile 的 fence，所有运行入口必须复校验当前 generation/epoch。

需要同步的文件族：

- Contracts：agent execution protocol、internal workspace binding model、Files module map、OpenAPI。
- Backend：task create/delete、file library routes、binding repository、audit、reconcile job。
- Runner：agent-runner protocol、agent-task-runner workspace builder、terminal runtime、pod manager path guard。
- Frontend：TaskCreateDialog、Task delete dialog、Files library list/detail/banner、i18n。
- MSW：tasks/files handlers、fixtures、parity tests。
- Docs：runbook、DEVELOPMENT、AGENTS、相关 user guide。

pre-GA 数据处理：

- 不做长期双读或双 HOME 根运行。
- 本地开发/测试数据 reset/recreate。
- 缺少 `file_library_home_segment` 的开发/测试配置记录不得在读取时派生或补写字段；删除后重新创建。

## 14. 测试与验收

### 14.1 Focused tests

首轮 unit/component/MSW：

```bash
npm run test:run -- \
  packages/api-entry-node/src/notebook-task/task-models.test.ts \
  packages/api-entry-node/src/notebook-task/task-runtime-paths.test.ts \
  packages/api-entry-node/src/notebook-task/task-file-library-bindings.test.ts \
  packages/api-entry-node/src/task-route-handler.test.ts \
  packages/api-entry-node/src/project-file-library-routes.test.ts \
  packages/api-entry-node/src/internal-agent-workspace-provisioner.test.ts \
  packages/api-entry-node/src/internal-agent-pod-manager.test.ts \
  packages/agent-runner/src/protocol.test.ts \
  packages/agent-task-runner/src/task-workspace.test.ts \
  packages/agent-task-runner/src/terminal-runtime.test.ts \
  src/components/agent-tasks/__tests__/TaskCreateDialog.test.tsx \
  src/components/files/__tests__/FilesPage.test.tsx \
  src/lib/__tests__/msw-stop-contracts.test.ts
```

Contract / generated：

```bash
npm run contracts:check-openapi
npm run openapi:check-generated
```

Runner / skill focused diagnostics：

```bash
npm run test:agent-task:runner:fast
npm run test:skills:fast
```

Conditionally required focused backend-real diagnostics：

```bash
npm run test:agent-task:runner:backend-real
npm run test:skills:backend-real
```

Use these when the change touches real managed runner behavior, runner ticket scope, Context Store / skill env, workspace binding, holder generation, task HOME holder issuance, or backend-real ownership. If the change touches internal sandbox or workspace binding, also run:

```bash
npm run test:internal:backend-real:agent-task-workspace
```

If the change touches terminal execution context, terminal holder release/adopt, or terminal path/env echo, also run the terminal backend-real matrix:

```bash
npm run test:agent-task:backend-real:terminal:matrix
```

Files backend-real diagnostics when file library delete/browse/task HOME binding behavior changes：

```bash
npm run test:files:backend-real:smoke
npm run test:files:backend-real:home-binding
```

### 14.2 Required scenarios

- `workspace_mode` matrix validation, including omitted mode plus id as invalid.
- `create_new` creates file-library-stable segment and binds it.
- `use_existing` reuses the same segment after prior task delete, and cannot bind an existing library without `project:files:update` + resource policy / owner writable affordance.
- `create_new` can create the internal HOME file library with `project:agent_task:use`; later Files UI writes still require Files update permission.
- workspace-access, terminal, runner holder and task HOME holder issuance refuse writable holder/ticket when task binding, file library status/version, writable affordance, or generation/epoch check fails.
- Concurrent CreateTask against one file library across two requests rejects exactly one with `AGENT_TASK_FILE_LIBRARY_IN_USE`.
- Multi-instance or service restart evidence proves binding truth is durable, not in-memory.
- Archive keeps binding; Delete releases binding after live blockers clear.
- Delete with active run/terminal/live lease returns `AGENT_TASK_DELETE_BLOCKED`.
- Stale lease/holder is reconciled or TTL-released only after generation/epoch fence proves it stale, not permanent blocker.
- Reconcile never releases binding or clears stuck deleting/deleting task while active run/terminal/live holder/live lease still exists.
- Delete failure/retry does not leave zombie binding or visible task with released binding.
- Prior-generation holder release cannot release a new task holder/mount for the same `taskHome`.
- File library delete race proves ready->deleting and no-binding guard are atomic, including expected version/status CAS.
- File library delete non-empty path returns `FILE_LIBRARY_NOT_EMPTY`, transitions back to `ready` with new version/correlation/audit, and never remains stuck `deleting`.
- CreateTask rejects deleting/deleted/non-ready/cross-project/forbidden libraries.
- Files upload/move/folder/workspace-access write operations reject deleting libraries.
- Route x error matrix covers CreateTask, Task DELETE, File library DELETE, Files write routes, workspace-access, task HOME holder issuance and metadata PATCH deleting/bound/conflict mappings.
- Files list/detail shows only available/occupied primary state; archived occupied is discoverable when visible.
- Redacted occupied library does not leak task title/owner/id.
- Audit evidence covers `agent_task.create`, `agent_task.delete`, binding acquire/release/conflict, reconcile, compensation, file-library rollback and redaction assertions.
- Task delete confirm copy and Files bound banner render i18n strings.
- Cache invalidation refreshes fileLibraries after task create/update/archive/delete and typed conflicts.
- MSW parity covers status code, required fields, unique occupied fixtures, redaction fixtures.
- Managed runner echoes `HOME`, `TASK_HOME`, `pwd`, `WORKSPACE_PATH`, `ARTIFACTS_PATH` consistently.
- Slice 5 blocked Developer runner connection/existence diagnostics do not synthesize task HOME env vars; task HOME/file access/execution self-check fails closed.
- Negative echo/mode/profile/path tests fail closed.
- Credentials, metadata_url and AFSCP access secrets do not appear under HOME or debug output.
- Artifact metadata path is `.artifacts/...`; file-library object key is `workspace/.artifacts/...`.

### 14.3 阶段收口

遵守渐进验证。focused 变绿只是局部证据，不是发布签署。

阶段收口：

```bash
npm run verify -- --goal=pr --run
```

如果改动覆盖真实 managed runner、local-kind sandbox、Context Store/skill env、backend-real ownership，或 Slice 5 unblocked 后的 Developer runner connector/mount/release，再升级：

```bash
npm run verify -- --goal=real --run
npm run release:ready
npm run release:status
```

## 15. 验收标准

功能验收：

- 每个未删除 task 最多绑定一个文件库；每个文件库最多绑定一个未删除 task。
- Archive 不释放文件库；Delete 成功释放文件库。
- Delete task 保留文件库和文件内容。
- 复用保留文件库创建新 task 后，managed runner 把同一文件库根目录作为 `TASK_HOME` / `HOME`。
- Slice 5 blocked 时 Developer runner 只提供连接/存在状态证据；task HOME/file access/execution self-check 必须 fail closed，且不要求 Developer runner backend-real/deploy smoke。
- 复用同一文件库时 `task_home_segment` 不变。
- `pwd` 始终是 `$TASK_HOME/workspace`。
- Files 中打开文件库根目录时看到的是 `$TASK_HOME` 根目录内容。
- 文件库删除被未删除 task 绑定阻止；释放绑定后仍受非空删除规则约束。
- task 删除后，前一 task messages、trace、artifact metadata、runner binding、terminal 不会出现在新 task 中。
- execution ticket、Project secrets、managed credentials、OAuth token、storage credentials 和 metadata_url 不落到文件库 HOME。

工程验收：

- Binding 独占有 DB/JsonDocStore durable conditional evidence，覆盖并发、多实例或重启。
- File library delete 有 status/version + no-binding conditional transition evidence，覆盖非空 rollback 回 `ready`。
- OpenAPI/generated types、MSW、backend handlers、frontend types、runner schemas 一致。
- `TaskExecutionContext` 和 workspace-access 缺任何必填身份/路径字段都会 fail closed。
- writable workspace-access、terminal 和 task HOME holder issuance 都有 task binding + writable affordance + generation/epoch 复校验证据。
- `InternalAgentWorkspaceMount` 不再以 task-specific `subPath` 表达 task HOME。
- `buildTaskHomePaths` 不再生成文件库内 task 子目录作为 storage partition。
- `removeTaskHomeSubtree` 或同等逻辑不参与 task DELETE。
- File library list/detail contract 暴露安全 occupied 状态，前端不从 task list 推断绑定。
- route x error matrix 覆盖 CreateTask、Task DELETE、File library DELETE、Files write、workspace-access、task HOME holder issuance 和 metadata PATCH。
- audit 覆盖 `agent_task.create`、`agent_task.delete`、acquire/conflict/release/delete-blocked/reconcile/compensation/file-library rollback，且完成 redaction。
- focused tests 与匹配风险的 verification goal 保留 evidence。

## 16. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 用户复用文件库时继承 `.codex` / `.mbos` / cache 状态 | 新 task 可能受保留运行时状态影响 | 创建 UI 与 Files 状态明确复用会保留文件内容；需要干净环境时创建新文件库 |
| 并发 CreateTask 绕过前端过滤 | 同一文件库被两个 task 绑定 | durable binding 条件写/唯一约束；并发和重启 evidence |
| Delete task 部分失败 | zombie binding 或前一 task 可见 | `deleting` state、idempotent release、reconcile job、audit correlation |
| 文件库 deleting race | 删除中仍被绑定或写入 | ready->deleting 与 no-binding 原子 guard；所有写入口拒绝 deleting |
| 非空文件库删除后 stuck deleting | 用户无法继续使用文件库 | 非空检查失败必须 transition 回 ready，带 version/correlation/audit；reconcile 只收敛明确终态 |
| 同一文件库复用时前一 generation release 迟到 | 新 task holder/mount 被前一 generation cleanup 释放 | holder_id + task_id + binding_generation + lease_epoch fencing；release/adopt/reconcile 不以 taskHome 单独定位 |
| Artifact 文件保留但 metadata 删除 | 用户误以为新 task 自动继承 artifact | 双层路径语义和 UI 文案明确 metadata 不继承 |
| Developer runner local HOME workaround 回流 | Slice 5 blocked 时绕过 AFSCP export-backed lease/connector 安全边界 | backend affordance fail closed；runbook 和 close evidence 只接受 upstream blocker/no-workaround record，不接受 local path/file_library smoke |
| 凭据落入 HOME | 复用文件库泄露授权材料 | credentials boundary tests、debug redaction、短生命周期临时目录 |
