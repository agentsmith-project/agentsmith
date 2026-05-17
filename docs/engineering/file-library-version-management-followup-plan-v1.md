# 文件库版本管理下一步收敛改进计划 v1

<!-- markdownlint-disable MD013 -->

Status: `handoff_ready`
Date: 2026-05-16
Owner: AgentSmith Files / AFSCP / JVS maintainers
Source: 最近手测反馈、Aquinas/Russell/Feynman 多角度只读 review findings、现有 `file-library-version-management-fast-path-plan-v1.md` 与 `file-library-version-management-stabilization-plan-v1.md`

## 1. 目的

本计划只记录下一轮必须修的真实缺口，不重新设计文件治理系统。

用户目标很朴素：

- 点击保存恢复点后，立刻知道系统是否接收、是否处理中、是否成功或失败。
- 点击恢复后，文件库确实回到保存点状态；如果不能恢复，用户看到明确下一步。
- 保存为任务文件模板时，用户知道它是否会在当前 project 创建 Agent task 时可用。
- 文件库入口和界面语言符合普通用户心智，不把 JVS、AFSCP、cleanup、operation id 暴露给用户。
- 保存和恢复必须覆盖完整 file library HOME；绑定 Agent task 时就是完整 task HOME。慢的问题只回到 JVS / AFSCP 的 JuiceFS clone fast path 与 metadata-only status / doctor 修，不靠缩小 HOME 范围、隐藏文件或增加前端等待来掩盖。

工程目标也要收敛：

- 完整 HOME 持久化是硬产品规则；隐藏运行时目录也属于 HOME 范围，不能用 `workspace/`、白名单或隐藏文件过滤来缩小 save point / restore。
- 文件系统完整性交给 JuiceFS；JVS / AFSCP 只做基础版本操作和 metadata-only 状态，不做 HOME / file / content hash、preview、tree walk、容量预扫描、copy fallback 或类似文件内容开销。
- AFSCP 负责把 JVS 状态规整成清晰 operation 状态，不把 non-blocking cleanup 误判成用户故障。
- AgentSmith 负责展示产品状态和用户下一步，不暴露内部路径、raw code 或下游实现词。
- 测试补关键 user story 和已发现失效点，不新增厚重治理线。

## 2. 当前 findings 复盘

这些 findings 都来自已经出现过的手测问题或代码静态证据，不是未来想象的扩展需求。

### 2.1 AFSCP 与 JVS 状态真相仍有错位

现象：

- restore 可能成功，但后续被判成需要人工处理。
- save point / restore 有时长期显示同步、或后续操作被 409 / recovery 状态阻塞。

根因：

- JVS 当前真实 `metadata_state` 是 `ready`，但 AFSCP restore executor 仍按 `clean` 判断。
- JVS `doctor` 对 `cleanup_pending` 会返回 `healthy=false` warning，AFSCP runner 把所有 `healthy=false` 都当成 invalid。
- `cleanup_pending` 同时被用作 operator evidence 和用户可见阻塞，边界没有完全收敛。

用户影响：

- 用户明明完成了恢复，却看到“恢复需要处理”。
- 用户再次保存或恢复时被阻塞，但不知道该等待还是联系 system 管理侧。

### 2.2 AgentSmith restore `recovery_required` 只是部分落地

现象：

- OpenAPI / 前端类型已经出现 `recovery_required`，但真实 restore 后端链路仍会折成 generic failed。

根因：

- AgentSmith persistence 的 restore status 仍是 `pending / restoring / succeeded / failed`。
- AFSCP storage adapter 把 `operator_intervention_required` 归一成 `failed`。
- route reconcile 写入的 restore terminal 仍偏失败态，不保留“需要 system 管理侧处理”的产品状态。

用户影响：

- 用户看到的是普通失败，可能反复点击重试，制造更多残留。
- system 管理侧也更难从产品状态判断是否需要人工处理。

### 2.3 Operation projection contract 曾有不一致，当前已收敛

历史现象：

- implementation 可以从 operation lookup / active operation 返回 restore operation。
- 当时 OpenAPI / generated types 对应 response 仍主要描述 version operation，restore operation 不是完整 union。

当前真相：

- worker 已把 operation lookup / active operation response contract、OpenAPI、generated types 收敛为包含 restore operation 的 union。
- 后续只保留回归守护，不能再按 version-only contract 设计新调用或 mock。

回归风险：

- 如果后续回退，前端或 API client 可能在 restore terminal 边界场景下类型不可信。

### 2.4 Public API 仍可能暴露 raw-ish failure 信息

现象：

- UI covered cases 已避免直接渲染 raw path/code。
- 但产品 API 仍可能返回 `failure_reason`、`projection.error.code` 等偏内部的信息给有 `project:files:update` 权限的普通项目用户。

根因：

- 后端没有把 operator evidence 和 user-facing message 完全分开。

用户影响：

- 用户看到内部错误码或路径时，会误以为自己需要理解 JVS/AFSCP。
- 企业演示时会显得产品粗糙，也可能泄露不必要的内部实现信息。

### 2.5 TaskFileTemplate lifecycle 仍有两个产品风险

现象：

- “Retry publish” 对 failed template 可能只是把 status 翻成 `published`，没有重新验证模板材料。
- AFSCP handler 接受 `source_namespace_id`，但 schema 没包含该字段。

根因：

- 模板“保存材料”和“发布可见性”被当成一个轻量状态切换，但失败场景下二者不是一回事。
- AFSCP schema 与 handler 没 lockstep。

用户影响：

- 一个坏模板可能被标成可用，创建 Agent task 时才失败。
- project-visible 模板能力可能在真实 contract client 下不稳定。

### 2.6 AgentSmith 本地 idempotency 与 AFSCP idempotency 规则不完全一致

现象：

- AFSCP 对 same key / different payload 做 request-hash conflict；这里的 request hash 只允许覆盖小型 operation DTO，用于幂等冲突判断，不是 HOME / 文件 / 内容 hash。
- AgentSmith local save-point / restore replay 仍可能只按 key 找旧 operation，没有对 message 或 `save_point_id` 做同等冲突校验。

根因：

- 不同层对“一个用户动作”的定义不一致。

用户影响：

- 用户重试时可能复用到错误的旧操作。
- 测试环境可能通过，真实环境因为 AFSCP 拒绝冲突而表现不一致。

### 2.7 UX 入口和界面组织仍需按用户心智收口

现象：

- “文件状态”或“版本操作”不如“文件更新”直观。
- tabs 让用户误以为保存点和模板是两个割裂功能。
- 用户想在一个界面里选择“保存恢复点”或“保存为任务文件模板”。
- 模板需要能选择是否发布为当前 project 内可用；本版不需要组/用户细粒度分享。

根因：

- UI 仍带着工程对象拆分痕迹，而不是围绕用户要完成的两个动作组织。

用户影响：

- 用户不知道该去哪个 tab。
- 用户不理解模板创建后谁能用、在哪里用。

### 2.8 测试证据还偏 happy path

现象：

- 有 clone independence、idempotency replay、UI loading/error 等 focused tests。
- 但 restore `recovery_required`、failed template material、schema union、真实 cleanup_pending shape、focused visual/screenshot 证据仍不足。

根因：

- 前一轮测试主要补“功能能跑通”，对“失败是否以正确产品状态暴露”覆盖不够。

用户影响：

- 手测仍能发现 E2E 没抓到的问题。

## 3. 产品决策

### 3.1 入口和界面

- 文件库主入口和 Sheet 标题使用“文件更新”。
- 不使用 tabs。
- 同屏展示：
  - 保存为恢复点。
  - 保存为任务文件模板。
  - 恢复点列表。
  - 已保存模板列表。

### 3.2 保存与恢复

- save point 保存整个 file library HOME。
- 绑定 Agent task 时，保存整个 task HOME。
- restore 直接恢复到 save point，不自动保存当前状态。
- restore 确认只提示：当前未保存为恢复点的文件变更会丢失；对话和 trace 不恢复。
- `operation: null` 只表示当前没有正在处理的操作，不代表上一次成功。

### 3.3 模板

- 沿用现有 TaskFileTemplate，不新增 FileLibraryTemplate 产品对象。
- 模板保存时允许用户选择：
  - 保存并发布为当前 project 创建 Agent task 时可用，推荐。
  - 仅保存为未发布模板。
- 本版不做组、用户、跨 project 分享。
- failed template 不能通过单纯翻 status 变成 published；要么重新保存模板材料，要么展示“重新保存模板”。

### 3.4 用户状态词

普通用户只需要看到：

- `已接收`：系统已接收请求。
- `处理中`：文件更新仍在保存或恢复中。
- `已完成`：保存、恢复或模板保存完成。
- `失败`：操作没有完成，可按提示重试。
- `需要 system 管理侧处理`：系统无法自动恢复，普通用户不应反复重试。

普通用户不需要看到：

- JVS。
- AFSCP。
- JuiceFS。
- control root。
- cleanup marker。
- raw operation id。
- internal path。
- raw error code。

## 4. 非目标

本轮不做：

- 不做文件级 restore、局部目录 restore、diff preview。
- 不恢复 restore preview / restore run / restore cancel 旧心智。
- 不做 restore 前自动保存当前状态。
- 不缩小 save point / restore 范围到 `workspace/`、白名单目录或“非隐藏文件”；完整 HOME 是强制产品语义。
- 不做 HOME / file / content hash、preview、tree walk、容量预扫描、copy fallback 或类似文件内容开销。
- 不新增 FileLibraryTemplate 对象。
- 不做 group / user 细粒度模板分享。
- 不做跨 project 模板市场。
- 不做全站 UI 重构。
- 不把每个小改动都升级成 full release gate。

## 5. 下一步开发 slices

### Slice 1：JVS / AFSCP 状态 contract 收敛

Owner：JVS + AFSCP

优先级：P0

目标：

- AFSCP 按 JVS 真实状态 `metadata_state=ready` 判断 restore 成功。
- AFSCP 不把 non-blocking `cleanup_pending` doctor warning 当成用户可见失败。
- stale / non-convergent / unreferenced cleanup 仍必须失败或进入 `recovery_required`。

建议实现：

- AFSCP restore executor 测试改成真实 JVS shape：`MetadataState=ready`、`ActiveOperation=none`、`Recovery=cleanup_pending`。
- AFSCP runner 对 `doctor healthy=false + recovery=cleanup_pending` 做结构化判断：如果 cleanup 是 fresh、metadata-referenced 且不阻塞后续 save/list/restore，投射为 non-blocking evidence。
- purge / lifecycle 路径不得因为普通 restore 成功后的 cleanup marker 误报 `JVS_DOCTOR_FAILED`。
- JVS 不新增复杂 GC；如果需要 cleanup owner，只做 metadata-only、operator-facing 收敛，不进用户路径。

验收标准：

- restore 成功后 JVS `ready + cleanup_pending` 不导致 AFSCP `operator_intervention_required`。
- stale / non-convergent / unreferenced cleanup 会让 focused cleanup gate 失败。
- 没有 HOME / file / content hash、tree walk、容量预扫描、copy fallback 或类似文件内容开销。

### Slice 2：AgentSmith restore 产品态贯通

Owner：AgentSmith Files backend + API client + frontend

优先级：P0

目标：

- restore operation 真实支持 `recovery_required`，不是只在 UI 类型里出现。
- operation lookup / active operation response contract 与实现保持一致。
- 普通用户 API 与 UI 都只看到 public-safe message。

建议实现：

- persistence restore status 加入 `recovery_required`。
- storage adapter 保留 AFSCP `operator_intervention_required` 到 AgentSmith `recovery_required` 的映射。
- restore reconcile 写入 `recovery_required` terminal，而不是 generic failed。
- OpenAPI / generated types 已纳入 restore operation union；MSW / tests 继续守住 operation lookup 和 active operation union 回归。
- 后端输出 public-safe `message` / `user_action`，raw `failure_reason`、内部 code、内部 path 只进 operator evidence 或日志。

验收标准：

- route test 覆盖 restore terminal `recovery_required`。
- hook/UI test 覆盖 restore `recovery_required` 的用户文案。
- API response 不直接暴露 raw path / raw code 给普通用户字段。
- generated types 与实现一致。

### Slice 3：模板 lifecycle 和幂等规则收敛

Owner：AgentSmith Files + AFSCP

优先级：P1

目标：

- failed template 不会被单纯翻 status 发布。
- AFSCP template clone schema 与 handler 一致。
- AgentSmith 与 AFSCP 对 save point / restore / template 的 idempotency 规则一致。

建议实现：

- AFSCP schema 补齐 `source_namespace_id`，或如果这个字段不再应存在，则从 handler 删除；Pre-GA 一次性选一个合理 contract。
- failed template 的 UI action 改成“重新保存模板”或“重新创建模板”，不要叫“重试发布”，除非后端真的重新验证材料。
- publish 动作只允许 publish 已验证、material-ready 的 template。
- AgentSmith 本地 save-point / restore operation 记录小型 DTO request hash：save point 至少覆盖 message；restore 至少覆盖 `save_point_id`；不得读取 HOME、文件树或文件内容来生成 hash。
- same idempotency key / different request body 返回 conflict，不复用旧 operation。

验收标准：

- same key / different save-point message 返回 conflict。
- same key / different restore `save_point_id` 返回 conflict。
- failed template 不能被 publish endpoint 直接标成可用。
- AFSCP contract check 覆盖 `source_namespace_id` 取舍。

### Slice 4：低心智 UI 收口

Owner：AgentSmith Files frontend

优先级：P1

目标：

- 入口、布局和文案按用户动作组织，不按工程对象拆分。
- 用户点击后不出现“闪一下无结果”。

建议实现：

- 入口和 Sheet 标题使用“文件更新”。
- 删除 tabs，同屏 sections。
- 保存恢复点、保存模板都显示 local pending、accepted、running、succeeded、failed、recovery_required。
- 模板发布选择使用一个 checkbox 或 segmented action：保存并发布为当前 project 可用 / 仅保存为未发布模板。
- restore 进行中禁用 destructive 文件操作，并显示“正在恢复文件库，完成前暂不能修改文件”。
- `operation: null` 显示“当前没有正在处理的版本操作”，不显示成功。

验收标准：

- 中文和英文 i18n 同步。
- 组件测试覆盖 no tabs、两个保存入口同屏、restore direct confirmation。
- focused screenshot 覆盖 light/dark 和窄屏关键状态。

### Slice 5：精确证据补强

Owner：QA / Governance maintainers

优先级：P1

目标：

- 补上手测暴露问题对应的自动化证据。
- 不把治理线变厚。

建议测试：

- AgentSmith route tests：
  - restore `recovery_required` terminal projection。
  - operation lookup / active union 包含 restore operation。
  - public-safe response 不含 raw path/code。
  - save-point / restore idempotency conflict。
- AFSCP tests：
  - restore executor 使用 JVS 真实 `ready + cleanup_pending` shape。
  - doctor `cleanup_pending` non-blocking 不误判。
  - template clone request schema 与 handler 一致。
- JVS tests：
  - cleanup_pending status/doctor metadata-only。
  - hot path 不调用 HOME / file / content hash、tree walk、容量预扫描、copy fallback 或类似文件内容开销。
- Focused user-story E2E：
  - 用户保存 save point，删除文件，restore，确认文件恢复。
  - restore 后立即发起 Agent task 消息，不应出现 workspace AFSCP error。
  - 保存并发布 project-visible template，然后创建 Agent task 能选择模板。
- Focused visual：
  - 文件更新 Sheet light/dark。
  - 窄屏布局。
  - failed / recovery_required 状态。

最终收口：

- 每个 slice 先跑 focused tests。
- 所有 P0/P1 完成后再跑对应 `npm run verify -- --goal=pr --run` 或当前阶段需要的 release gate。
- 不用 full release gate 代替 focused regression。

## 6. 推荐执行顺序

1. 先修 Slice 1：JVS/AFSCP 状态真相。否则 restore 成功也可能继续被误判。
2. 再修 Slice 2：AgentSmith restore 产品态和 contract。否则用户看到的仍是 generic failed。
3. 再修 Slice 3：模板和幂等。避免模板发布或重复提交产生新的不稳定。
4. 再做 Slice 4：UI 低心智收口。此时状态真相已稳定，UI 不会返工。
5. Slice 5 跟随每个 slice 补证据，最后做一次阶段收口 gate。

## 7. Handoff checklist

- [ ] AFSCP restore executor 接受 JVS 真实 `metadata_state=ready`。
- [ ] AFSCP 不把 non-blocking `cleanup_pending` doctor warning 当成用户故障。
- [ ] stale / non-convergent / unreferenced cleanup 会失败或进入 `recovery_required`。
- [ ] AgentSmith restore status 真实支持 `recovery_required`。
- [ ] AFSCP `operator_intervention_required` 映射为 AgentSmith `recovery_required`。
- [x] Operation lookup / active operation contract 包含 restore operation。
- [ ] 普通用户 API response 不暴露 raw path / raw internal code。
- [ ] failed template 不能被单纯 status flip 成 published。
- [ ] AFSCP template clone schema 与 handler 一致。
- [ ] AgentSmith save-point / restore idempotency 校验 request body。
- [x] 文件库入口改为“文件更新”或等价低心智文案。
- [ ] File updates UI 无 tabs，保存恢复点和保存模板同屏。
- [ ] restore 后 Agent task 继续使用文件库的 user story E2E 覆盖。
- [ ] focused visual / screenshot 覆盖关键状态。

## 8. 交付边界

这轮完成后，用户应该能稳定完成：

1. 保存整个文件库为恢复点。
2. 删除或修改文件。
3. 直接恢复到恢复点。
4. 继续在绑定该文件库的 Agent task 中发消息。
5. 将当前文件库保存为当前 project 可用的任务文件模板。
6. 从模板创建新 Agent task。

如果上述路径仍慢，下一步只看三段耗时：

- AgentSmith admission latency。
- AFSCP worker / operation projection latency。
- JVS JuiceFS clone duration。

完整 HOME 持久化是强制语义，性能只能来自 JuiceFS clone fast path 和 metadata-only status / doctor。不要用缩小 HOME 范围、隐藏文件、preview、HOME / file / content hash、tree walk、容量预扫描、copy fallback 或类似文件内容开销来“优化”用户感知。
