# 文件库版本管理稳定化改进计划 v1

<!-- markdownlint-disable MD013 -->

Status: `review_findings_handoff_ready`
Date: 2026-05-16
Owner: Files / TaskFileTemplate / AFSCP / JVS maintainers
Source: 20 个 subagent review 对 `029ff958`、`379455d`、`968c659` 的只读审查结果

## 1. 目的

本计划不是重新设计文件治理系统，也不是扩大治理范围。它只把最近 review 发现的真实薄弱点收敛成下一轮可实施修复。

用户侧目标很简单：

- 保存恢复点后，用户能明确知道系统是否已接收、是否完成、是否失败。
- 恢复后，文件库内容必须回到恢复点；如果系统需要处理，用户看到清楚、低心智的提示。
- 保存为任务文件模板时，不产生重复模板，不污染普通恢复点列表。
- 演示和手测中不出现“闪一下没结果”“一直同步”“失败原因看不懂”“模板从哪里来不清楚”。

工程侧目标也要简单：

- 完整 HOME 持久化是硬产品规则；JVS 只负责版本与 JuiceFS clone 快路径、metadata-only 状态，不做 HOME / file / content hash、preview、全量扫描、容量预扫描、copy fallback 或类似文件内容开销。
- AFSCP 只负责把 JVS 状态收敛成清晰 operation 状态。
- AgentSmith 只向用户展示产品状态，不暴露 JVS / AFSCP / control root / raw operation 细节。
- 测试只补关键 user story 和失效点，不增加大而全的重门禁。

## 2. 不做项

本轮明确不做：

- 不做文件级 restore、局部目录 restore、diff preview。
- 不做 group / user 细粒度模板分享。
- 不做跨 project 模板市场。
- 不做 restore 前自动保存当前状态。
- 不恢复旧 restore-preview / restore-run / restore-cancel 产品心智。
- 不增加 HOME / file / content hash、内容证明、preview、容量预扫描、tree walk、copy fallback 或类似文件内容开销；request hash 只允许用于小型 operation DTO 幂等冲突判断。
- 不为历史兼容保留双协议或双语义。当前仍是 Pre-GA，接口不合理就一次性改干净。
- 不把本轮变成全站 responsive / accessibility 大重构；只修文件库版本管理路径中会影响使用理解和演示稳定性的点。

## 3. Review 结论收敛

20 轮 review 的 findings 可以归成 5 类。

### 3.1 状态真相不一致

JVS、AFSCP、AgentSmith 对 `cleanup_pending`、`operator_intervention_required`、`recovery_required` 的语义不一致。

用户影响：

- 正常 restore 后的 cleanup residue 可能被误判成需要人工处理。
- 真正需要人工处理时，AgentSmith 可能只显示 generic failed。
- 保存或恢复的 terminal 状态可能被 `operation: null` 或旧 terminal restore 遮蔽。

根因判断：

- JVS 把 cleanup pending 放在 `recovery=cleanup_pending`。
- AFSCP 的 restore executor 把非 `none` recovery 先当作 manual recovery。
- AgentSmith restore status 还不能表达 `recovery_required`。
- `/operations/active` 主要表达 active operation，对 terminal save-point / missed terminal restore 的投射不稳定。

### 3.2 JVS cleanup marker 过度参与用户路径

用户影响：

- restore 成功后留下的 marker 可能在 24h 后变成 `repair_metadata`。
- rollback 后 marker 目录可能因为非空而删除失败，后续 status / doctor 误报。
- status / doctor 扫 HOME parent，会被 unrelated sibling backup 误伤。

根因判断：

- cleanup marker 同时承担“恢复安全标记”和“后续 operator cleanup evidence”两种职责。
- 成功路径和 rollback 路径没有把 marker 生命周期收敛成无歧义终态。
- unreferenced backup 检测跨出当前 control-root，增加了性能和误判风险。

### 3.3 TaskFileTemplate 幂等和内部 save point 隔离不足

用户影响：

- “保存并发布模板”如果 publish 失败，用户可能看到创建成功和失败混杂提示，重试还可能创建重复模板。
- 模板内部 source save point 可能出现在普通恢复点列表，用户误以为可以恢复。
- 模板列表在当前文件库抽屉内展示 project 全量模板但不标来源，容易误解。

根因判断：

- create 和 publish 是两个用户不可见的 mutation，但 UI 把它们当一个用户动作。
- publish 没有稳定 `Idempotency-Key`。
- create idempotency 没有 request body conflict 检查；storage adapter 拼接给 AFSCP 的 idempotency key 还可能超长后退化为随机。
- template source save point 缺少结构化 purpose，靠后续映射过滤不够可靠。

### 3.4 普通用户错误文案和投影仍可能泄露内部信息

用户影响：

- 用户可能看到 JVS / AFSCP / raw error code / internal path，而不是“需要 system 管理侧处理”。
- 文件库降级/失败原因只放在 `title`，触屏和键盘用户看不到。
- 模板列表 loading / error 时显示空态，用户误以为没有模板。

根因判断：

- 后端 `failure_reason` 到前端文案缺少 public-safe 映射。
- UI 把技术 failure 和用户下一步混在一起。
- loading / error / empty 没有明确分态。

### 3.5 测试证据没有覆盖关键用户心智

用户影响：

- 真实 lane 可能通过，但没有证明模板 clone 与 source 独立。
- restore failure / recovery terminal 是否能被用户看到，没有绿色路径证据。
- save point pending 可能过早消失，演示时用户看不到结果。

根因判断：

- focused real smoke 仍偏“接口 happy path”，缺少几个用户可见结果断言。
- 部分 static guard 只证明字符串存在，不证明行为。
- AFSCP release evidence manifest 更新后 selector digest 没同步，发布证据链会失败。

## 4. 目标状态

### 4.1 用户心智

文件库版本管理只给用户 4 类状态：

- `已接收`：系统已接收保存/恢复/模板操作。
- `处理中`：系统正在处理，可以等待或刷新回来继续看。
- `已完成`：恢复点已保存、文件库已恢复、模板已保存或发布。
- `需要处理`：系统无法自行完成，请联系 system 管理侧。

普通用户不需要理解：

- JVS。
- JuiceFS。
- AFSCP。
- control root。
- cleanup marker。
- raw operation id。
- recovery planner。

### 4.2 工程真相

- JVS `cleanup_pending` 是 operator evidence，不应让普通成功 restore 未来变成用户可见故障。
- AFSCP 明确区分 caller terminal state 和 mutation blocker state。
- AgentSmith restore / save-point / template operation 都能表达 `accepted / running / succeeded / failed / recovery_required`。
- TaskFileTemplate create/publish 对用户是一个可恢复、幂等的产品动作。
- 模板内部 source save point 有结构化 purpose，默认不进入用户可恢复 save point 列表。

## 5. 开发切片

### Slice 1：JVS / AFSCP 状态真相收敛

Owner：JVS + AFSCP

优先级：P0

改动目标：

- JVS cleanup marker 不再让成功 restore 在未来变成 `repair_metadata`。
- JVS status / doctor 只读取当前 control-root 下的 metadata，不扫描 HOME parent。
- rollback 后 marker 必须可靠移除或标成明确终态，不能静默残留。
- AFSCP 按 JVS 真实输出处理 `recovery=cleanup_pending`，不得误判成 manual recovery。
- AFSCP error schema 补齐实际会返回的 typed error code。
- AFSCP 不返回空 `operation_id` 的 `OperationEnvelope`；没有合法 operation id 时返回 typed error envelope。

建议实现：

- JVS 删除 HOME parent sibling scan；只信 control-root marker。
- marker 目录清理使用明确的 marker cleanup helper，不用静默 `os.Remove`。
- successful restore 的 cleanup residue 作为 non-blocking operator evidence；除非真实阻塞后续 mutation，否则不投射为 user-facing repair。
- AFSCP restore executor 增加针对 `cleanup_pending` 的真实 JVS shape 测试：`Recovery=cleanup_pending`、`ActiveOperation=none`。
- AFSCP schema / contract test 加入 `FILE_LIBRARY_OPERATION_PENDING`、`FILE_LIBRARY_OPERATION_REQUIRES_RECOVERY`。

验收标准：

- JVS focused tests 覆盖 rollback 后无 bogus marker。
- JVS focused tests 覆盖 unrelated sibling backup 不影响当前 repo status。
- AFSCP focused tests 覆盖 JVS真实 `cleanup_pending` shape 不误判。
- AFSCP schema test 覆盖所有实际 typed error code。
- 不新增 HOME / file / content hash、tree walk、容量预扫描、copy fallback 或类似文件内容开销。

### Slice 2：AgentSmith operation projection 和 recovery_required 收敛

Owner：AgentSmith Files backend + frontend

优先级：P0 / P1

改动目标：

- save-point terminal 不从 UI 消失。
- restore terminal 不依赖 30s recent window 才能刷新文件列表。
- failed / recovery_required terminal 能被用户看到。
- 普通用户只看到 public-safe failure copy。

建议实现：

- mutation response 返回 public operation id 后，前端按该 operation id 跟踪到 terminal；`/operations/active` 继续作为刷新后的 active blocker 入口。
- 如果没有 operation-id endpoint 可复用，则补一个产品级 operation lookup；不要靠 30s active terminal window 做唯一真相。
- `operation: null` 只表示当前无 active blocker；如果前端本地知道刚才有 pending operation，看到 null 时必须刷新文件树、保存点、模板列表，并显示“当前没有正在处理的操作”，不能显示成功。
- restore / save-point / template operation 都支持 `recovery_required` 产品态。
- failure reason 在后端或前端映射成有限 public copy：普通失败、仍在处理、需要 system 管理侧处理。raw code 只进 operator evidence/log。

验收标准：

- route tests 覆盖 save-point terminal projection。
- route / hook tests 覆盖 missed restore terminal 后仍刷新文件树。
- failed / recovery_required terminal 有 UI 测试。
- UI 测试证明 raw internal code/path 不直接渲染给普通用户。

### Slice 3：TaskFileTemplate 保存/发布幂等化和 source save point 隔离

Owner：AgentSmith + AFSCP + JVS

优先级：P1

改动目标：

- “保存并发布为项目模板”对用户是一个幂等动作。
- create 成功但 publish 失败时，重试不创建重复模板。
- template source save point 不进入普通恢复点列表。
- 模板列表表达来源文件库，避免用户误解。

建议实现：

- 为 publish 引入必填 `Idempotency-Key`，或把 create+publish 合并为一个 `publish_on_create` 产品动作。优先选择更少用户心智的一步式产品动作。
- create idempotency 按 canonical request body 做冲突检查：同 key 不同 body 返回 conflict，不返回旧模板。
- AgentSmith 传给 AFSCP 的 idempotency key 可使用小型 operation DTO 派生的稳定短 hash，不使用可能超长后随机 fallback 的拼接串；不得读取 HOME、文件树或文件内容来生成 hash。
- JVS / AFSCP 为 template source save point 增加结构化 `purpose=template_source`。如果 JVS 缺少 metadata 字段，优先小范围补 metadata，不靠 message prefix。
- AFSCP save-point list 默认过滤 `template_source`。
- AgentSmith 本地 upsert save point 时保留 purpose；用户恢复点列表只显示 `purpose=user`。
- 模板列表显示来源文件库名称或“来自其他文件库”，并区分 loading / error / empty。

验收标准：

- 重复提交同一 create/publish key 不创建重复模板。
- 同 key 不同 body 返回 conflict。
- publish 失败后重试不会创建第二个 source save point。
- 创建模板后，用户恢复点列表不出现 template source save point。
- project 模板列表显示来源信息或明确 project scope。

### Slice 4：UX 小范围收敛

Owner：AgentSmith Files frontend

优先级：P2

改动目标：

- 不改变信息架构，只减少误解。

建议实现：

- 保存点 pending 只有在新 save point 出现、operation terminal、或 typed failure 后才清除。
- 模板列表显示 loading / error / retry，不把失败当空态。
- 文件库 failed / degraded reason 在主区域可见，不只放 `title`。
- “检查恢复状态”文案改为“正在检查文件更新，完成前暂不能保存或发布。”
- 模板 failed 状态显示下一步，例如“重试发布”或“重新保存模板”。
- Sheet / dialog close aria-label 纳入 i18n。
- 窄屏先补 horizontal overflow 或简单 single-column fallback；不做全文件库 workbench 重排。

验收标准：

- 组件测试覆盖 loading / error / empty 分态。
- 中文和英文 i18n key 同步。
- focused visual 或 screenshot 覆盖版本管理 Sheet 的 light/dark 和窄屏关键状态。

### Slice 5：精确测试和发布证据修补

Owner：QA / Governance maintainers

优先级：P1 / P2

改动目标：

- 补用户心智关键证据，不加重全量 gate。

建议实现：

- focused real smoke 增加模板 clone 独立性检查：clone 后修改 source，再读取 clone，证明 clone 不跟 source 变化。
- focused e2e / route test 增加 failed / recovery_required terminal projection。
- smoke replay 同一 TaskFileTemplate idempotency key，断言同一 template id 和列表数量不变。
- AFSCP release selector digest 随 manifest 更新。
- contracts test 对关键状态码使用 exact set，避免旧状态码残留。
- evidence producer 不把 AFSCP/JVS timing “unavailable” 当最终满足；如果产品 API 不暴露，则 sibling 项目 focused evidence 必须覆盖 worker hop / clone duration。

验收标准：

- 不跑 full release gate 作为每次小改动验收。
- 每个 slice 有 focused unit / contract / e2e 或 real smoke 证据。
- 最终收口再跑对应 release-ready gate。

## 6. 推荐执行顺序

1. 先做 Slice 1：JVS / AFSCP 状态真相。否则上层 UI 再怎么修都会被错误状态误导。
2. 再做 Slice 2：AgentSmith operation projection。让用户看见可靠结果。
3. 再做 Slice 3：TaskFileTemplate 幂等和污染隔离。解决重复模板和恢复点污染。
4. 再做 Slice 5 的关键测试，跟随每个 slice 补，不集中最后补。
5. 最后做 Slice 4 UX 小收口，避免先美化后返工。

## 7. Gate 策略

每个 slice 使用精确验证：

- JVS：`go test ./internal/afscp` 中相关 direct restore / metadata focused tests。
- AFSCP：operation intake、restore executor、schema contract、repo-template focused tests。
- AgentSmith backend：`project-file-library-routes.test.ts`、`file-library-persistence.test.ts`、`file-library-afscp-storage.test.ts` 的相关 grep / test name。
- AgentSmith frontend：`FileLibraryRecoveryDialog.test.tsx`、`use-file-library-recovery.test.tsx`、`use-task-file-templates.test.tsx`。
- Real lane：只跑 file-library focused smoke，不扩大到全量 release gate。

最终合并前再跑：

- AgentSmith `npm run verify -- --goal=pr --run` 或当前阶段要求的 release gate。
- AFSCP / JVS 对应 focused release evidence。

## 8. Handoff Checklist

- [ ] JVS cleanup marker 不会让成功 restore 未来变成 repair。
- [ ] JVS status / doctor 不扫描 HOME parent。
- [ ] AFSCP schema 包含实际 typed error code。
- [ ] AFSCP 不返回空 operation id 的 operation envelope。
- [ ] AFSCP 正确处理 JVS `recovery=cleanup_pending`。
- [ ] AgentSmith restore / save-point terminal 对用户可见。
- [ ] AgentSmith 支持 `recovery_required` 产品态。
- [ ] 普通用户 UI 不直接渲染 raw failure reason。
- [ ] TaskFileTemplate create/publish 幂等且冲突可检测。
- [ ] Template source save point 不进入用户恢复点列表。
- [ ] Focused real smoke 验证 template clone 独立性。
- [ ] AFSCP release selector digest 已同步。
- [ ] UX loading / error / empty / failed 文案可理解。
