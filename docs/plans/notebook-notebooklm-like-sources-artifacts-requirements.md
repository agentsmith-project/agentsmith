# Notebook「类似 NotebookLM 的资料选择与产物展示」功能需求文档

## 1. 背景与目标

### 1.1 背景

当前 AgentSmith 已具备以下基础能力：

- 文件管理模块（Files / Sources Library）
- Notebook Task 工作流（任务、对话、外部 agent 执行）
- Notebook 已支持挂载输入文件（`attached_source_ids`）
- Notebook 已支持展示 Artifacts 面板（`taskArtifacts` / `ArtifactsPanel`）
- 外部 agent（Codex CLI）执行链路、trace 详情、监控与回归工具链已建立

但从产品体验上看，距离类似 Google NotebookLM 的“围绕资料进行研究与生成”的工作模式，仍缺少两个关键产品能力：

1. 在 Notebook Task 中以更明确、可控的方式选择并插入 Files 模块中的资料作为上下文输入
2. 将 agent 生成的目标产物（图、文件、文本结果）稳定地呈现在 Artifacts 中，并能被后续复用/保存

同时，当前使用 Codex CLI 执行工具时，还需要明确一条执行策略：

- **禁止 agent 在任务中尝试进行用户不可见的 UI 交互动作**（例如弹出图窗、尝试本地 GUI 展示 matplotlib 图像等），因为这些动作在当前运行环境不可见且可能阻塞进程。

### 1.2 产品目标

本期目标是将 Notebook 从“基础任务聊天”提升为“围绕资料进行研究与产出”的工作台：

- 用户能在 Notebook Task 内快速选取项目文件作为研究资料输入
- agent 的输出结果能以 Artifact 形式可见、可管理、可复用
- agent 执行策略更稳定（Headless-first，不做不可见 UI 交互）

### 1.3 非目标（本期不做）

- 不做 NotebookLM 级别的自动资料摘要/自动问答索引系统（如引用定位、跨文档自动章节索引）
- 不做 GUI/浏览器自动化可视化播放能力（本期明确禁止不可见 UI 交互）
- 不改造现有 Notebook trace 详情面板为新的交互模型（该部分已具备基础能力，本期重点是资料与产物工作流）

---

## 2. 需求重述（产品化表达）

将原始需求转化为产品语言如下：

### 2.1 资料输入（Notebook Inputs）

用户在 Notebook Task 中，应能够从项目文件库（Files / Sources）中选择资料并挂载到当前任务，形成该任务的“研究输入集合”。

该输入集合需要具备：

- 清晰的可见性（当前任务挂载了哪些资料）
- 可控性（可添加、可移除）
- 与文件库解耦（从 Notebook 移除不等于删除文件库中的文件）
- 对 agent 可用（作为执行上下文的一部分）

### 2.2 产物输出（Artifacts）

用户在 Notebook Task 中，应能够看到 agent 执行过程中生成的目标产物（文本、图片、文件等），并在需要时进行：

- 查看（预览）
- 下载
- 保存回文件库（Save to Library）
- 后续在其他 Notebook/Task 中复用

### 2.3 执行策略约束（Headless Agent Runtime Policy）

对于使用 Codex CLI 的 agent，Notebook 场景下默认采用 **Headless-first 执行策略**：

- agent 应输出可被客户端消费的结果文件/文本/日志
- agent 不应尝试执行依赖本地 GUI 的展示动作（例如 `plt.show()`、打开系统图窗等）
- 对于图像/图表类任务，应生成文件（如 `.png` / `.svg`）并通过 Artifact 返回，而不是直接尝试显示

这是一条产品与运行时共同约束的策略，不只是 prompt 技巧。

---

## 3. 用户故事（User Stories）

### 3.1 资料驱动研究（核心）

- 作为用户，我希望在 Notebook Task 中直接选择文件库中的文件作为输入资料，而不是手动复制内容粘贴。
- 作为用户，我希望看到当前任务已经挂载了哪些资料，以便确认 agent 的上下文范围。
- 作为用户，我希望从 Notebook 移除某个资料时，不会误删文件库中的原文件。

### 3.2 结果产物消费（核心）

- 作为用户，我希望 agent 生成的图表、报告、文件能在 Artifacts 中稳定显示，而不是只出现在对话文本里。
- 作为用户，我希望一键保存 Artifact 到文件库，便于复用或进一步处理。
- 作为用户，我希望图像类产物以文件形式返回，而不是 agent 在不可见环境中尝试弹窗显示。

### 3.3 执行稳定性（核心）

- 作为用户，我希望在 Notebook 场景下 agent 的执行不会因不可见 UI 行为阻塞。
- 作为系统管理员/研发，我希望这条策略可被配置、可被审计、可在文档中明确约束。

---

## 4. 当前能力盘点（结合现有代码）

以下为当前已存在能力（可复用）：

### 4.1 Notebook 输入资料挂载（已有基础）

后端（`packages/api-entry-node/src/task-route-handler.ts`）已支持：

- `POST /.../tasks/:taskId/sources`（批量挂载 source ids）
- `DELETE /.../tasks/:taskId/sources/:sourceId`（移除挂载）
- Task 数据结构中已有：
  - `attached_source_ids: string[]`

前端（已有组件）：

- `src/components/notebook/AttachedFilesPanel.tsx`
- `src/components/notebook/FileSelectDialog.tsx`
- `TaskPage` 中已透传 `attachedFileIds={task.attached_source_ids}`

结论：
- **“挂载文件到任务”基础能力已存在**
- 本期重点是提升为更清晰的产品工作流，并确保与 NotebookLM 类体验一致（资料驱动研究）

### 4.2 Artifacts 面板（已有基础）

后端：

- `GET /.../tasks/:taskId/artifacts`
- Task Artifact 数据结构已存在（`text/image/file/other`）

前端：

- `src/components/notebook/ArtifactsPanel.tsx`
- `src/components/notebook/ArtifactCard.tsx`
- `src/components/notebook/ArtifactSaveDialog.tsx`

结论：
- **Artifacts 展示与保存回文件库基础能力已存在**
- 本期重点是强化“agent 产物规范化输出”的产品与运行时要求

### 4.3 外部 Agent（Codex CLI）执行链路（已有基础）

当前已有：

- 外部 agent runner（Codex CLI）
- endpoint proxy（Responses/Chat 兼容层）
- notebook task runtime + trace + artifacts 展示链路

结论：
- 本期不需要重做主链路，重点是产品策略与执行约束落地（避免 GUI 阻塞）

---

## 5. 功能需求（Functional Requirements）

## 5.1 Notebook Task 中的资料选择与挂载（Sources as Task Inputs）

### 5.1.1 入口与交互

在 Notebook Task 详情页中，用户应能通过 `Attached Inputs` 区域完成以下操作：

- 从 Files/Source Library 选择已有文件挂载到当前 task
- 从本地上传文件（若当前产品已支持该路径）
- 通过 URL 添加输入（已有 URL 入口可继续保留）

要求：

- 支持多选批量挂载（优先）
- 支持搜索/筛选（按文件名、类型；如现有 FileSelectDialog 已支持则复用）
- 显示挂载结果即时更新（与 task `attached_source_ids` 同步）

### 5.1.2 挂载语义（必须明确）

- “挂载到 Notebook Task”是**引用关系**，不是复制文件
- 从 Notebook 移除文件：
  - 只解除该 task 的引用关系
  - 不删除 Files 模块中的文件实体

这条语义需在产品文案和交互提示中保持一致。

### 5.1.3 agent 可用性语义（产品层要求）

被挂载到 task 的文件应被视为该任务的上下文输入集合。

对用户的可见表达：

- “This file is attached to this notebook as context input”
- 或中文等价表达

对系统实现的要求（本期不强制指定具体实现）：

- agent 执行时能够获得该输入集合的信息（至少是 source ids / 元数据）
- 后续可演进为内容提取、AIReady 管道、引用检索等能力

### 5.1.4 失败与边界处理

需要明确处理以下情况：

- 文件不存在 / 已被删除
- 文件无权限访问
- 重复挂载（应去重）
- 文件仍在处理（例如未 AIReady）
  - 可挂载但提示状态，或限制挂载（由产品策略决定；本期建议先允许挂载并提示）

---

## 5.2 Artifacts 中展示与管理 agent 生成产物（Artifacts as Outputs）

### 5.2.1 基本展示（本期必须）

Artifacts 面板应稳定展示 agent 生成的目标产物，至少包含：

- 文本产物（report/summary/snippet）
- 图片产物（chart/diagram/plot）
- 文件产物（csv/json/pdf/png 等）
- 其他类型（fallback）

### 5.2.2 操作能力（本期至少保持现有能力）

对 artifact 的操作至少包括：

- 查看（view）
- 下载（download）
- 保存到文件库（save to library）

产品要求：

- 这些操作入口应在 Artifacts 面板中稳定出现
- 对不可预览的类型，应至少支持下载/保存

### 5.2.3 产物与对话的关系（建议明确）

用户在对话文本中看到“已生成图表/文件”的描述时，应能在 Artifacts 面板中找到对应产物。

本期建议要求：

- agent 输出图像/文件时，优先以 artifact 形式返回
- 文本消息中仅作说明，不承担完整结果承载

### 5.2.4 产物命名与元数据（建议）

生成的 artifact 尽量包含：

- `title`
- `type`
- `mime_type`
- `created_at`
- `file_size`（如适用）

便于用户在 Artifacts 面板中辨识与筛选。

---

## 5.3 Codex CLI Notebook 执行策略（Headless-first Policy）

这是本期新增的核心产品/运行时约束。

### 5.3.1 策略定义（必须）

对于 Notebook 场景下使用 Codex CLI 的 agent：

- **禁止尝试不可见 UI 交互**
- **禁止依赖 GUI 展示作为任务完成条件**

典型禁止行为示例：

- `matplotlib.pyplot.show()` 打开图窗
- 试图调用本地 GUI 程序展示图像
- 阻塞等待用户在本地界面点击确认

### 5.3.2 替代策略（必须）

对于图表/图像类任务，agent 应采用：

- 生成文件（如 `plot.png`, `chart.svg`）
- 将文件作为 artifact 输出
- 在文本中说明生成结果与路径/名称

对于交互类任务，agent 应采用：

- 生成脚本、HTML、配置文件、截图文件（如可能）
- 输出可供用户下载/查看的结果，而不是直接打开 UI

### 5.3.3 产品与系统落地方式（建议分层）

应通过以下多层机制共同保证，而不只依赖单一 prompt：

1. **Runner / Runtime policy（系统约束）**
   - 在 Codex 启动提示或任务前置指令中明确 headless policy
   - 可在 runner 层加入“Notebook mode runtime policy”固定前缀

2. **Agent profile / runtime preference（配置层）**
   - notebook 模式 agent 使用专用执行策略模板
   - 可后续增加 `runtime_preferences.notebook.execution_policy = headless`

3. **Product copy（前端提示）**
   - 在 Notebook 中向用户说明：图像/图表会以 Artifact 形式返回

### 5.3.4 错误处理（必须）

若 agent 仍尝试不可见 UI 行为导致阻塞或失败：

- 应在 trace / stderr 中可见（已具备 trace 能力）
- 应鼓励输出可操作错误提示（例如提示改为保存图片文件）
- 后续可考虑在 runner 中对常见模式（如 `plt.show()`）做提示性 warning（本期不强制）

---

## 6. 体验与交互要求（UX Requirements）

## 6.1 类 NotebookLM 的体验原则（本期适用）

1. **资料优先**
- 任务上下文应显式围绕“已挂载资料”构建，而不是隐式猜测

2. **结果与产物并重**
- 对话文本回答 + Artifacts 面板共同构成完整结果

3. **默认简洁**
- 不展示底层复杂性（已有 trace 折叠方案）

4. **按需展开细节**
- 需要排障/审计时可查看执行详情（已实现）

## 6.2 文案与术语（建议统一）

推荐术语（对外）：

- `Attached Inputs` / `已附加输入`
- `Files Library` / `文件库`
- `Artifacts` / `产物`
- `Save to Library` / `保存到文件库`

推荐避免混淆：

- 不要把“挂载输入”描述成“上传新文件”（除非确实是本地上传路径）
- 不要把“Artifact 保存到库”描述成“自动可用于 AIReady”（当前仍需要后续处理时应明确提示）

---

## 7. 技术需求与实现约束（结合现有架构）

## 7.1 后端（api-entry-node）要求

### 7.1.1 保持并强化已有 notebook task sources/artifacts 契约

现有已支持：

- `taskSources`（attach / detach）
- `taskArtifacts`（list）

本期要求：

- 契约文档（OpenAPI supplement 或主 spec）应与实际行为一致
- 对失败码与错误信息保持稳定（避免前端特殊分支失效）

### 7.1.2 Artifact 记录与展示链路

若 agent 生成文件/图像：

- 后端应能记录为 `task artifact`
- 前端 `ArtifactsPanel` 能读取并显示

本期不强制要求改造 artifact 存储模型，但要求产物生成路径可稳定接入已有 `taskArtifacts` 接口。

### 7.1.3 执行策略配置入口（建议）

建议在运行时/agent 配置层预留 headless policy 配置入口，避免策略长期仅存在于 prompt 文本中。

示例（概念级）：

- `runtime_preferences.notebook.execution_policy = "headless"`

本期可先文档化与 runner 固定策略，后续再结构化。

## 7.2 外部 Agent Runner（Codex CLI）要求

### 7.2.1 Headless-first 执行约束（本期关键）

runner 应确保 Notebook 场景的执行提示中明确包含：

- 不执行不可见 UI 交互
- 图表/图像输出为文件 artifact
- 不阻塞等待本地 GUI 展示

### 7.2.2 可观测性（沿用现有能力）

runner 已具备：

- trace event
- stderr 捕获
- 过滤器 debug 计数

本期应利用这些能力帮助验证 headless policy 是否生效（例如是否出现 GUI 类报错/阻塞特征）。

## 7.3 前端 Notebook（TaskPage / Panels）要求

### 7.3.1 Attached Inputs 体验收口

前端需要确保：

- 用户能从 Files 选择并挂载到当前 task
- `AttachedFilesPanel` 正确反映 `attached_source_ids`
- 移除动作语义清晰（仅移除引用）

### 7.3.2 Artifacts 面板消费链路

前端需要确保：

- `ArtifactsPanel` 能稳定展示 agent 生成产物
- 对图片/文件类有合理的预览/下载/保存行为
- 无产物时有空状态提示

### 7.3.3 与 trace 面板的关系

本期不要求新增 trace UI 功能，但应保持：

- 当 agent 产物生成失败或被 GUI 行为阻塞时，用户可在 trace 中定位问题

---

## 8. 验收标准（Acceptance Criteria）

## 8.1 核心功能验收（用户视角）

1. 用户在 Notebook Task 中可以从文件库选择文件并挂载到任务
2. 挂载后的文件出现在 `Attached Inputs` 中
3. 从 `Attached Inputs` 移除文件后，文件库中的文件仍存在
4. agent 生成图像/文件类结果时，`Artifacts` 面板能显示相应产物
5. 用户可以对 artifact 执行查看/下载/保存到文件库（至少保持现有能力）
6. 对图表类任务，agent 不会因尝试本地 GUI 展示而卡住（应输出文件/artifact）

## 8.2 工程验收（研发/测试视角）

1. 现有 notebook task sources/artifacts API 契约文档与代码行为一致
2. headless policy 在 runner/运行时文档中明确记录
3. 真实链路 smoke（Notebook + external agent + Codex）可完成至少一条图像/文件生成任务
4. 产物在 Artifacts 面板中可见且可操作
5. 若出现 GUI 尝试导致错误，trace 中可定位问题

---

## 9. 测试建议（QA / 自动化）

## 9.1 功能回归（手工/集成）

建议至少覆盖：

1. 挂载文件到 task（单个/多个）
2. 移除挂载文件（确认文件库未删除）
3. 生成文本 artifact
4. 生成图片 artifact（例如 matplotlib 保存 png）
5. 保存 artifact 到文件库

## 9.2 E2E（MSW / mock）

建议新增或强化用例：

- Notebook task 中 Attached Inputs 挂载/移除交互
- Artifacts 面板显示与操作入口（view/save/download）

## 9.3 真实链路验证（重点）

使用现有工具链：

- `make notebook-agent-smoke-task`
- `make notebook-agent-monitor`
- 可新增一条专项 smoke：
  - “生成图表并保存为文件 artifact，不使用 GUI 展示”

---

## 10. 风险与规避

## 10.1 风险：agent 仍尝试 GUI 展示导致阻塞

规避：

- headless policy 固定化（runner / notebook mode 指令模板）
- trace/stderr 可见性保持
- 文档与示例 prompt 明确要求“保存文件而不是 show”

## 10.2 风险：Artifacts 生成与展示链路不稳定

规避：

- 使用已有 `taskArtifacts` 契约，避免多条临时路径
- 对 artifact 类型与元数据字段做最小规范化

## 10.3 风险：用户误解“移除输入”会删除原文件

规避：

- UI 文案明确“Remove from notebook (file remains in your library)”
- 保持行为一致，不做破坏性操作

---

## 11. 迭代建议（分期实施）

## Phase A（短期，可快速交付）

- 收口并验证 Notebook 中的 Files 选择/挂载体验
- 强化 Artifacts 展示链路的真实用例验证
- 落地 Codex CLI headless policy（文档 + runner 执行策略）

## Phase B（中期，NotebookLM 风格增强）

- 资料状态显示（处理状态/AIReady 状态/类型）
- 资料选择体验优化（搜索、筛选、批量）
- 产物与消息/trace 的关联展示增强

## Phase C（长期，研究工作台能力）

- 资料引用与来源定位（source citation）
- 基于资料的回答引用标注
- 更强的产物工作流（版本、比较、复用）

---

## 12. 与现有文档/模块的对应关系（便于实施团队）

### 12.1 前端相关

- `src/components/notebook/TaskPage.tsx`
- `src/components/notebook/AttachedFilesPanel.tsx`
- `src/components/notebook/FileSelectDialog.tsx`
- `src/components/notebook/ArtifactsPanel.tsx`
- `src/components/notebook/ArtifactCard.tsx`
- `src/components/notebook/ArtifactSaveDialog.tsx`

### 12.2 后端相关

- `packages/api-entry-node/src/task-route-handler.ts`
  - `taskSources`
  - `taskArtifacts`
  - `taskMessages` / `taskTraces`
- `packages/agent-codex-runner/src/index.ts`
  - Codex CLI 启动参数与 notebook 场景执行策略

### 12.3 文档相关（需后续同步）

- `docs/agent-codex-notebook-runbook.md`
- `docs/contracts/*`（如接口行为有调整）
- `DEVELOPMENT.md`（若引入新的运行策略约束或专项 smoke）

