# Agent Task Terminal Recovery and Message Footer Improvement Plan v1

更新时间：2026-05-01 PDT
状态：`handoff_plan_ready`
适用范围：Agent task terminal 恢复体验、Browser terminal WS reconnect handshake、前端 terminal focus/fit 行为、AI 消息气泡 active footer 布局稳定性

## 0. 文档状态

本文是基于 team findings 整理的后续改进计划，用于产品和工程 handoff。它描述目标行为、分层方案、契约草案、测试与验收标准，不是当前实现真相，也不替代现有 contracts、API spec 或代码。

进入实现前需要同步的权威位置：

- `docs/contracts/agent-execution-protocol.md`
- `docs/contracts/agent-task-frontend-module-map.md`
- Agent task terminal 相关 OpenAPI / WS / SSE contract
- 对应前端模块说明和 UX/UI 状态文案规范

## 1. 非目标

本计划明确不做：

1. 不把 terminal 做成文件级审计或长期日志检索系统。
2. 不要求第一阶段恢复完整交互式 screen；P0 只承诺在单 API 实例、会话未过期、bounded ring 命中的条件下展示可恢复的真实输出并继续输入。
3. 不用前端 `sessionStorage` / localStorage 作为权威 screen truth。
4. 不通过强发回车、伪造 prompt 或伪造 shell 状态来制造“已恢复”的错觉。
5. 不把 platform-managed tmux 纳入后续方案；用户如需 tmux，可以在 terminal 内自行启动、attach 和管理，平台不为 tmux 建特殊生命周期。
6. 不把 terminal 扩展成远程桌面、交互式屏幕专用恢复产品、shell 会话管理器或跨任务持久工作台。
7. 不把 `xterm-headless` screen snapshot、persistent attach、runner-owned terminal 作为当前开发主线；这些只能在 P0 后由单独决策重新打开。
8. 不把最近动作文案升级为主操作；`取消当前轮` 始终是 active footer 的优先操作。
9. 不扩大验证范围到每次改动都跑 full heavy gate；按风险做 focused validation，阶段收口再升级。

## 2. Executive Summary

当前 Agent task terminal 的问题不是“连接没恢复”，而是“可继续工作的终端视图没有恢复”。刷新页面、切换 conversation / terminal 或切 tab 后，后端只向前端发送 synthetic `started`，没有 replay 或 screen snapshot；前端 xterm 重新挂载后 buffer 是空的，用户会看到运行中任务、交互式程序或 prompt 内容消失。这会让用户误判为任务丢失，尤其在长命令、交互式程序、需要继续输入的场景中风险很高。

同时，AI 消息气泡 active footer 中的“最近动作”是辅助信息，但当前 flex + wrap 布局会在文本过长时挤压主操作按钮，导致“取消当前轮”掉到下一行。对于正在运行的轮次，取消是最高优先级控制，不应被辅助状态文案影响可见性和点击稳定性。

产品承诺：

> AgentSmith terminal 是 Agent task 内的短生命周期 shell 执行入口。刷新、断线、切换后，系统承诺恢复可信状态和可用控制；不承诺完整屏幕现场、长期日志、跨任务工作台或平台托管 shell 会话。

P0 的用户成功标准：

1. 我能确认 terminal session 是否还在运行。
2. 我能看到后端可恢复范围内的最近真实输出。
3. 我知道较早输出是否缺失。
4. 我知道当前能不能继续输入。
5. 我不会被空白 terminal、假 prompt 或连接成功文案误导。

建议按“一个当前主线 + 两个延后决策点”推进，并明确排除 platform-managed tmux：

| 层级 | 目标 | 交付边界 |
| --- | --- | --- |
| P0 当前主线 | 在单实例、未过期、ring 命中的条件下，把 terminal 从“空白重连”提升为“可见最近真实输出并可继续输入”，并稳定 footer 主操作 | WS reconnect handshake、`seq` + bounded ring replay、权限/票据重校验、后端 truth 状态同步、focus/fit 稳定、xterm buffer 不污染、footer 两列布局 |
| 延后决策 A | 是否需要 screen continuity snapshot | 不属于当前主线；只有 P0 后仍有明确产品缺口，才单独评审 `xterm-headless` 或等价方案 |
| 延后决策 B | 是否需要多实例 durable routing / runner-owned relay | 不属于当前主线；只有多实例部署真实需要时，单独评审生命周期 owner、权限撤销、资源上限和路由模型 |

明确排除项：平台不内置、不托管、不编排 tmux。tmux 对用户仍然是普通 shell 工具：用户可以在 terminal 中自行运行 `tmux`、恢复 session 或管理窗口，但这些行为不改变 AgentSmith 的 terminal session contract。

## 3. 现状与根因

### 3.1 Terminal 当前恢复的是连接，不是可继续输入的视图

现状：

- `Agent task terminal service` 实时将 output `sendToBrowserSocket`，但没有 server-side replay buffer。
- 前端重新绑定 existing runtime 时，后端只发 synthetic `started`。
- xterm 组件刷新或重新挂载后，本地 buffer 为空，历史 screen 内容和 prompt 不会自动回来。
- 如果刷新前用户停在 terminal，恢复后当前逻辑只选择 active tab，没有稳定触发 terminal focus。

根因：

- 后端缺少 reconnect contract：没有定义客户端带 `after_seq` 重连时，服务端应该 replay、snapshot、降级还是声明不可恢复。
- terminal output 没有 monotonic `seq`，前端无法去重、续接或判断缺口。
- 当前只把 terminal 当作 streaming endpoint，没有形成 Agent task-scoped terminal session contract：即在某个 Agent task 范围内，由后端授权和路由的短生命周期 terminal session 契约。
- 前端恢复 active terminal 后缺少 `focusRequestToken` 语义，无法可靠把焦点送回 terminal。

### 3.2 交互式 screen / prompt 恢复不能用普通 transcript 伪装

交互式程序可能使用 cursor movement、alternate screen、clear screen、resize 等控制序列。普通 transcript 只能表示 output 流，不等价于当前 screen state。

因此：

- P0 只在单实例、未过期、ring 命中且权限有效时 replay bounded output，让用户看到最近真实输出并继续交互。
- screen snapshot 不属于当前主线。只有 P0 的真实 output replay 与状态同步仍不能满足核心 shell 使用时，才进入单独决策。
- 如果没有 snapshot，界面必须诚实降级，不能把 transcript 渲染成“完整交互式 screen 已恢复”。

### 3.3 xterm 刷新后空白与 resize/fit 不稳定

现状风险：

- terminal panel mount 后，如果容器尺寸还没稳定就 fit，xterm 可能出现行列计算不准。
- 切 tab、侧栏变化、窗口 resize 后，如果没有稳定的 `ResizeObserver` / fit 调度，可能出现可视区域和真实 rows/cols 不一致。
- 恢复数据如果直接写入当前 xterm buffer，容易把系统提示、恢复说明或重复 replay 污染到用户的 shell screen。

P0 需要把“恢复状态 UI”和“terminal byte stream”分开：系统状态可以在 terminal 外层呈现，xterm buffer 只写入来自后端的真实 terminal output / snapshot。

### 3.4 Message footer 是 flex-wrap 布局风险

现状：

- active AI 消息 footer 使用 `flex` + `flex-wrap`。
- “最近动作”文本过长时会挤压右侧按钮。
- `取消当前轮` 可能被挤到下一行，导致高度跳动、位置不稳定、主控制弱化。

根因：

- 布局没有明确主次列。
- 左侧辅助信息没有 `min-width: 0`、nowrap/ellipsis 约束。
- 右侧主按钮没有稳定 `shrink-0` 和 `whitespace-nowrap` 约束。

## 4. 产品原则

1. 控制优先于解释：运行中状态下，用户首先需要可见、稳定、可点击的控制动作，解释性文本只能辅助。
2. 状态诚实降级：无法完整恢复 screen 时，要明确展示“已连接但现场只能部分恢复”，不能假装 prompt / 交互式 screen 完整存在。
3. Terminal 是可交互执行视图，不是日志窗：terminal 的核心价值是继续输入、观察当前状态、不中断任务，而不只是查看历史输出。
4. 取消按钮优先级高于最近动作：`取消当前轮` 是当前轮次的安全控制，布局上必须比最近动作更稳定。
5. 后端是恢复真相源：前端可以缓存体验状态，但不能把本地缓存当作 terminal screen truth。
6. 恢复不能制造副作用：自动 focus、fit、replay、snapshot 都不能向 shell 注入输入，也不能改变正在运行的命令。

## 5. 方案分层

### 5.1 P0 必做：单实例可续接、可聚焦、布局稳定

P0 的目标必须收敛：只在单 API 实例、terminal session 未过期、bounded ring 命中、权限仍有效时，展示可恢复的真实 output 并允许用户继续输入。除此之外都必须进入 `partial` 或 `unavailable` 降级状态，不能用空白 xterm 或本地缓存制造“已恢复”的错觉。

#### 5.1.1 Contract handshake

权威来源：

- `docs/contracts/agent-execution-protocol.md`
- Agent task terminal 相关 OpenAPI / WS contract
- 后端 token、session owner、task/project/workspace scope、`project:agent_task:terminal` 权限检查结果

必做行为：

- Browser terminal WS 建连后，客户端第一条业务消息必须是 `terminal.reconnect`。handshake 完成前，服务端不得接受 `terminal.stdin`、`terminal.resize` 或其他会改变 terminal session 状态的消息。
- `terminal.reconnect` 必须携带 `terminal_session_id`、当前 `rows` / `cols`，并可携带 `after_seq`；浏览器 reconnect payload 不再携带 `view` 字段。字段类型、取值范围、session 归属、scope 和权限校验失败时，服务端必须返回明确 `terminal.error`，随后关闭连接或用明确 close reason 关闭。
- `GET list/get terminal session` 会返回可 attach 的 `ws_url` / ticket，必须要求 `project:agent_task:terminal`；`delete terminal session` 不下发 ticket，不能作为后续可交互 attach、`terminal.stdin`、`terminal.resize` 的权限证明。attach/reconnect、`terminal.stdin`、`terminal.resize` 每次都必须重新校验 token、session owner、scope 和 `project:agent_task:terminal`。
- 权限撤销、成员离开 project、task/session owner 不匹配或 token 过期后，服务端不能下发可输入 ticket，也不能继续接受 `terminal.stdin` / `terminal.resize`。
- handshake 成功后，服务端按 contract 发送 `terminal.replay_start`、`terminal.output*`、`terminal.replay_end`。Replay 完成不等于可输入；服务端是否接受 `terminal.stdin` / `terminal.resize` 只以后端 runtime truth `isTerminalInputEnabled(session)` 为准，`terminal.replay_end.input_enabled` 或后续 `terminal.state.input_enabled` 只是把这个 truth 告诉浏览器。post-handshake / pre-ready 输入必须返回 `terminal.error` 并关闭，不写入伪 output。`ready` 是外层状态事件，不是写入 xterm 的 terminal bytes。

降级行为：

- 未携带 `terminal.reconnect` 就发送 `terminal.stdin` / `terminal.resize`：返回 `handshake_required` error 并关闭。
- 字段校验失败（包括携带任何 `view` 值；旧 `notebook.task_terminal` 只作为 removed/forbidden evidence）：返回 `invalid_reconnect_payload` error 并关闭。
- 权限、owner、scope 或 ticket 校验失败：返回不泄露 session 存在性的 `permission_denied` / `attach_unavailable`，或在已确认 session 的 browser WS 上返回 `terminal_permission_revoked`，并关闭或进入不可输入状态。
- 多实例路由不到持有 ring 的 API entry：返回 `partial` 或 `unavailable`，不能返回空白 terminal 假装成功。

不可承诺项：

- P0 不承诺跨 API 实例恢复。
- P0 不承诺完整交互式 screen 恢复。
- P0 不承诺 persistent attach 或 runner-owned terminal 生命周期重构。

测试：

- WS contract parser 覆盖合法 `terminal.reconnect`、缺字段、非法 `view`、非法 `after_seq`、非法 `rows/cols`。
- handshake 前发送 `terminal.stdin` / `terminal.resize` 必须被拒绝；handshake 后但 runtime input 尚未 enabled 时也必须被拒绝，且不能产生 runtime side effects。
- token 过期、权限撤销、owner/scope 不匹配时不能得到可输入 ticket。
- `GET list/get` 缺少 `project:agent_task:terminal` 时不能下发 `ws_url` / ticket；`delete` 不下发 ticket，也不能让后续 attach/reconnect、`terminal.stdin`、`terminal.resize` 绕过 `project:agent_task:terminal` 复校验。

#### 5.1.2 Backend replay buffer

权威来源：

- P0 `seq` 由 API entry 的 terminal session stream 生成。
- `seq` 作用域仅限单个 `terminal_session_id`，不是全局审计游标，也不是跨 session 游标。
- bounded ring 是 P0 恢复体验的唯一 replay truth；前端本地 buffer 不能作为 screen truth。

必做行为：

- 为每个 terminal session 的 output chunk 生成单调递增 `seq`；同一 session 内不能乱序发送，不能复用 `seq`。
- output chunk 以 bytes 为语义单位，WS JSON 传输建议使用 `encoding=base64`；实现必须明确单 chunk 最大 bytes、最大 chunk 数、TTL 和 session end 清理策略。
- `after_seq` 命中 ring 时，从 `after_seq + 1` replay；`after_seq` 早于 `earliest_seq` 时，从 `earliest_seq` replay 并标记 `gap=true` / `status=partial`；`after_seq` 大于 `latest_seq` 时返回 `status=unavailable`、`error_code=future_after_seq`，并可在 `terminal.replay_start` / `terminal.replay_end` 上携带 `next_seq`，不能静默接受客户端游标。
- 缺省 `after_seq` 表示客户端没有可信连续 buffer。服务端可以 replay ring 当前可用范围；如果 ring 不包含 session 起点，必须标记 `partial`。
- replay 期间服务端必须避免 replay 与 live output 交错造成乱序。推荐先冻结或队列化 live flush，完成 `terminal.replay_end` 后再进入 live。
- API 进程重启、ring 过期、session ended、session route miss 或多实例未命中时，必须返回明确 `partial` / `unavailable` 降级状态。

降级行为：

- ring 命中但不完整：显示最近真实 output，声明较早 output 已过期。
- ring 不存在、路由不到或 future cursor 不可 replay：声明无法恢复 replay；若后端知道后续 live output 的连续性边界，可用 `next_seq` 告诉前端下一条可接受的 live `seq`。这不代表缺失 output 已恢复，前端只能展示降级提示并等待真实 live output。
- 重复 output `seq` 且 payload 一致：前端可丢弃；payload 不一致是 contract violation，服务端应记录元数据并关闭或要求重新 reconnect。

不可承诺项：

- bounded ring 不作为长期日志、审计证据、合规检索或 release evidence。
- P0 不生成 screen snapshot，不恢复 alternate screen、cursor、modes 或完整 prompt 状态。
- P0 不解决多 API 实例一致性；多实例/API reload 只能 `partial` / `unavailable`，不能空白假恢复。

测试：

- 单 session `seq` 单调递增，且不同 session 之间互不比较。
- ring 按 bytes、chunk 数和 TTL 淘汰。
- `after_seq` 命中、过旧、缺省、future 的 replay metadata 和 status。
- replay 与 live output 不乱序；重复 seq 去重；payload mismatch 进入 error。
- 单实例 happy path 通过；API instance mismatch 返回 `partial` / `unavailable`。

#### 5.1.3 Frontend apply/status/focus/fit

权威来源：

- xterm buffer 只接受后端真实 terminal bytes：P0 的 `output`，以及延后决策 A 单独通过后才可能出现的 `snapshot` restore。
- 外层 UI 负责连接状态、恢复状态、错误状态和降级说明。
- URL、后端 sessions、最近 focus owner 共同决定恢复后的 active terminal 和 focus 行为。

必做行为：

- Browser WS open 后立即发送 `terminal.reconnect`；收到 handshake 完成状态前，前端必须禁用或队列丢弃 `terminal.stdin` / `terminal.resize`，不能向服务端发送会改变 terminal session 的消息。
- 前端按 `terminal_session_id` 维护 `lastAppliedSeq`。`seq <= lastAppliedSeq` 丢弃；`seq === lastAppliedSeq + 1` 写入 xterm；发现普通 gap/乱序时，展示外层降级状态并请求 reconnect，不把补偿文本写入 xterm。若 `terminal.replay_start` / `terminal.replay_end` 以 `status=unavailable` 携带 `next_seq`，前端把 `next_seq` 作为后续 live output 的连续性边界，只展示降级提示，不伪造缺失 output，也不为同一 unavailable replay 进入重连循环。
- 必须迁移所有非 runner terminal bytes：`connecting`、`reconnecting`、`ready`、`failed`、`closed` 等文案都不能写入 xterm buffer。它们应成为 terminal 外层 UI 状态，并同步更新 en-US / zh-CN i18n key、unit/e2e/visual 期望。
- `hydrateTerminalWorkspaceFromBackendSessions` 选中 active terminal 后，只在“刷新前焦点在 terminal”或“用户主动切到 terminal”时触发 `focusRequestToken`。如果用户正在其他 input、textarea、contenteditable 或 combobox 中输入，不抢焦点。
- `TaskTerminalPanel` 使用稳定的 resize/fit 触发机制，覆盖 mount、tab visible、container resize、font load / size change。handshake 完成前不发送 resize；完成后发送当前 rows/cols。
- 降级状态用 `aria-live="polite"` 呈现，不覆盖 xterm，不阻断用户读取 output。

降级行为：

- `connected_partial_replay`：显示最近真实 output，可输入能力取决于 ticket 和权限状态。
- `snapshot_unavailable`：P0 只展示外层提示，不伪造交互式 screen。
- `permission_revoked` / `session_ended` / `attach_unavailable`：输入不可用，保留可读状态。

不可承诺项：

- 不用 `sessionStorage` / localStorage 生成 terminal screen。
- 不伪造 prompt、工作目录、命令状态或交互式 screen。
- 不把 reconnect 状态、错误文案或 ready/closed 文案写入 xterm。

测试：

- frontend unit 覆盖 handshake 前不发送 `terminal.stdin` / `terminal.resize`。
- replay apply 覆盖重复、乱序、gap、future cursor。
- i18n 覆盖 en-US / zh-CN 状态 key。
- a11y 覆盖 `aria-live="polite"`、不抢其他输入框焦点、按钮 accessible name 可读。
- focused e2e 覆盖刷新、切 terminal、切 tab/resize 后 output 不重复且 xterm 不含连接状态文案。

#### 5.1.4 Footer layout

权威来源：

- `DESIGN.md`
- 当前 `src/app/globals.css` token 与现有组件变体
- AI 消息 active footer 的 i18n 文案和交互规范

必做行为：

- active footer 改为两列稳定布局：左列承载最近动作，右列承载主控制按钮。
- 左列使用 `minmax(0, 1fr)`，文本 `min-width: 0`、单行、ellipsis；右列按钮使用 `auto` 宽度，`shrink-0`、`whitespace-nowrap`。
- 过长最近动作只截断，不影响按钮位置和 footer 高度；窄屏下仍保证 `取消当前轮` 的 accessible name 完整，不因视觉截断影响屏幕阅读器。
- tooltip / title 可用于查看完整最近动作，但不能替代主界面稳定性。

降级行为：

- 极窄宽度下允许最近动作更早截断，不能挤压或换行主按钮。
- 最近动作缺失时左列保留稳定布局，不改变主按钮位置。

不可承诺项：

- 不把最近动作升级为主操作。
- 不为了展示完整最近动作牺牲取消按钮稳定性。
- 不引入设计系统外的颜色、阴影或一次性布局风格。

测试：

- footer 长文本布局 class / variant 的确定性单元测试。
- desktop 与窄屏 visual scenario 覆盖按钮不换行、不被挤压、accessible name 不截断。
- e2e 覆盖 active running 状态下 `取消当前轮` 可见、可点击、焦点顺序稳定。

P0 交付后允许的降级文案，必须落到 en-US / zh-CN i18n keys：

- “已重新连接，显示最近输出。”
- “较早输出已过期，仅显示可恢复范围。”
- “该会话正在运行，交互式屏幕内容可能需要继续输入或等待新输出刷新。”

### 5.2 延后决策 A：screen continuity snapshot

Screen continuity snapshot 不属于当前开发主线。当前主线只保证核心 shell 通讯、后端状态 truth、bounded replay、断线重连和页面恢复后的可预期状态。

只有在 P0 完成后，仍有明确产品缺口且无法通过真实 output replay 与诚实降级解决时，才允许单独打开 screen snapshot 评审。

进入评审前必须重新确认：

- 该能力是否仍然属于“核心 shell 可预期状态”，而不是把 terminal 扩展成交互式屏幕专用恢复产品。
- 后端是否仍然是唯一 truth source。
- snapshot 是否只作为短期内存态恢复辅助，而不是日志、审计或长期工作台。
- secret、内存上限、TTL、rows/cols mismatch 和降级语义是否可验收。

若进入评审，`xterm-headless` 或等价方案只能作为候选技术，不是默认路线。任何实现都必须继续遵守：不伪造 prompt、不改写 shell 状态、不把本地缓存当 truth。

### 5.3 延后决策 B：多实例 durable routing / runner-owned relay

多实例 durable routing 或 runner-owned relay 不属于当前开发主线。当前主线先闭合单实例可预期恢复和明确降级；多实例场景不能恢复时，必须 `partial` / `unavailable`，不能空白假恢复。

只有当真实部署需要跨 API 实例保持 terminal stream truth 时，才允许单独打开评审。候选方向可以包括：

- runner-owned terminal：terminal 会话由 runner 明确持有，API entry 只做授权、路由和 event relay。
- persistent attach：用户刷新、切 tab、切 conversation 后重新 attach 到同一个 runner terminal。
- 会话生命周期与 task / command / terminal session 的 ownership、idle timeout、max lifetime 对齐。

进入延后决策 B 前需要先回答：

- 谁是 terminal session 的生命周期 owner？
- 多 API 实例如何路由到同一 session？
- 权限撤销、成员离开 project、task 删除时如何中断 attach？
- output ring / snapshot 和长期审计边界如何保持分离？

### 5.4 明确排除：platform-managed tmux

本计划不把 tmux 或等价 session supervisor 作为 AgentSmith 平台方案。原因：

- 用户需要 tmux 时，可以直接在 terminal 中自行启动、attach、detach 和管理，这是 shell 的正常能力。
- 平台托管 tmux 会引入新的生命周期 owner、权限撤销、资源清理、多实例路由和安全边界问题，收益与复杂度不匹配。
- AgentSmith 需要治理的是 Agent task-scoped terminal session contract，而不是替用户选择或编排 shell 内部的会话工具。

允许的行为：

- 用户在 terminal 内运行 `tmux`、`tmux attach` 或其他自选工具。
- 这些命令产生的输出仍按 P0 的 terminal output replay 规则处理；若延后决策 A 未来通过，再按对应 snapshot 规则处理。

不做的行为：

- 不自动创建 tmux session。
- 不把 terminal reconnect 实现为 tmux attach。
- 不为用户自建 tmux session 提供专门 UI、审计、生命周期托管或跨任务恢复语义。

## 6. 技术契约草案

### 6.1 Browser terminal WS handshake

P0 reconnect 必须是显式 handshake，不能把 WebSocket 建连本身当作 attach 成功。

推荐顺序：

1. Browser 建立 terminal WS，携带现有认证上下文或短期 attach ticket。
2. 客户端第一条业务消息发送 `terminal.reconnect`。
3. 服务端校验 payload、token、ticket、session owner、task/project/workspace scope 和 `project:agent_task:terminal`。
4. 校验通过后发送 `terminal.replay_start`、`terminal.output*`、`terminal.replay_end`。`terminal.replay_end.input_enabled=true` 或后续 `terminal.state.input_enabled=true` 才表示可以发送 `terminal.stdin` / `terminal.resize`；handshake 完成但 input 尚未 enabled 不能发送可改变 runtime 状态的消息。
5. 校验失败时发送 `terminal.error`，随后 close；如不能安全返回详细原因，则 close reason 使用通用 `attach_unavailable`。

`terminal.reconnect` 字段：

| 字段 | 语义 |
| --- | --- |
| `type` | 固定为 `terminal.reconnect` |
| `terminal_session_id` | 要恢复的 terminal session |
| `after_seq` | 客户端已成功应用的最后一个 output `seq`；缺省表示没有可信本地连续 buffer |
| `view` | Removed field；browser reconnect payload 必须不携带该字段。任何值，包括旧 `notebook.task_terminal`，都必须返回 `invalid_reconnect_payload` |
| `rows` / `cols` | 当前 xterm viewport，必须是 contract 定义范围内的正整数 |

当前 contract 不使用旧草案中的 `view=blank` / `view=continuing` 枚举。前端是否有可信连续 buffer 由 `after_seq` 和本地 `lastAppliedSeq` 共同表达；服务端仍按 `seq` replay，前端必须去重。P0 不发送 screen snapshot，前端不得用本地缓存伪装完整 screen。

handshake 完成前收到以下消息都必须拒绝：`terminal.stdin`、`terminal.resize`、`interrupt`、`paste`、任何会改变 terminal session 状态的自定义 event。推荐错误码为 `handshake_required`。handshake 完成后，如果后端 runtime input truth 尚未 enabled，`terminal.stdin` / `terminal.resize` 仍必须以 `terminal_not_ready` 一类错误拒绝并关闭，不能写入 runner runtime。

### 6.2 事件、编码与 chunk

| 事件 | 必需字段 | 语义 |
| --- | --- | --- |
| `terminal.error` | `terminal_session_id?`、`error_code?`、`error_message?`、`reason?` | handshake 或运行中错误；文案由前端 i18n 渲染，不写入 xterm |
| `terminal.replay_start` | `terminal_session_id`、`status`、`gap`、`after_seq?`、`earliest_seq?`、`latest_seq`、`next_seq?`、`error_code?` | 开始一次恢复流，声明 replay 范围和是否存在缺口；`status=unavailable` 时可带 `next_seq` |
| `terminal.output` | `terminal_session_id`、`seq`、`chunk` 或 `encoding`/`data` | 真实 terminal output bytes 的 chunk；当前实现发送 `chunk`，浏览器也兼容 `encoding`/`data` |
| `terminal.replay_end` | `terminal_session_id`、`status`、`gap`、`latest_seq`、`next_seq?`、`input_enabled` | 恢复流结束；`input_enabled` 才表达 `terminal.stdin` / `terminal.resize` 是否可立即发送 |
| `terminal.state` | `terminal_session_id`、`state?`、`status?`、`input_enabled?`、`reason?` | `ready/active/connected/closed/failed/unavailable` 等外层 UI 状态，不是 terminal bytes |

`snapshot` 不属于当前 browser terminal contract；如果延后决策 A 未来进入实现，必须先在 contract 中新增命名空间事件和字段。

当前 contract 不发送旧草案字段 `from_seq`、`mode`、`degraded_reason`、`input_allowed`。新实现和测试应使用 `after_seq`、`status`、`gap`、`error_code`、`input_enabled` 与 `terminal.state`。

`terminal.replay_start` / `terminal.replay_end` 的 `status=unavailable` 帧可带 `next_seq`。`next_seq` 是后续 live `terminal.output` 的下一条可接受 `seq`，不代表 `after_seq` 到 `latest_seq` 之间的缺失 output 已恢复；前端只能据此对齐连续性边界并展示降级状态。

编码与 chunk 约束：

- P0 当前实现使用 `terminal.output.chunk` 传输 terminal bytes 文本 chunk；contract 也允许后续用 `encoding=base64` + `data` 表达原始 bytes。前端解码后交给 xterm；不得假设 chunk 是完整 UTF-8 字符、完整行或完整 ANSI sequence。浏览器处理 base64 bytes 时必须按 `terminal_session_id` 维护 streaming UTF-8 decoder state，避免多字节字符跨 frame 时被替换字符污染。
- `status=partial` 表示 replay 起点之前有缺口；前端可以在 `terminal.replay_start` 丢弃旧 decoder state，但 replay window 内产生的 decoder state 必须跨 `terminal.replay_end` 续接后续 live `terminal.output`，避免多字节字符刚好跨 replay/live 边界时腐化。
- `status=unavailable` 只用 `next_seq` 对齐后续 seq，不能证明 byte continuity；前端必须在该边界丢弃 pending UTF-8 decoder state，再接受后续 live output。
- 服务端必须定义并执行单 chunk 最大 bytes、每 session 最大 chunk 数、每 session 最大 bytes 和 TTL。
- chunk 边界只是传输边界，不是语义边界；去重、续接和 gap 判断只能依赖 `seq`，不能依赖文本内容。
- `timestamp` 只用于调试和 UI 辅助，不参与顺序权威判断。

当前 `status` 取值：

- `complete`：已恢复可用范围。
- `partial`：存在 gap，例如 `after_seq` 早于 ring 的 `earliest_seq`。
- `unavailable`：ring 不存在、路由不可达、session 不可 attach，或 `after_seq` 大于 `latest_seq`。

当前 P0 contract 不定义单独 `degraded_reason` 字段；诊断原因若需要暴露，只能通过 `terminal.error.error_code`、`terminal.replay_start.error_code`、`terminal.state.reason` 或日志元数据表达。例如：

- `ring_expired`
- `gap_before_earliest_seq`
- `future_after_seq`
- `snapshot_unavailable`
- `resize_mismatch`
- `api_instance_mismatch`
- `session_ended`
- `permission_revoked`
- `attach_unavailable`
- `invalid_reconnect_payload`

### 6.3 `seq` 权威与 replay 语义

- P0 `seq` 的权威来源是 API entry 的 terminal session stream。`seq` 只在单个 `terminal_session_id` 内单调递增，不跨 session 比较，也不作为审计游标。
- 服务端 replay 必须按 `seq` 升序发送。replay 期间 live output 需要队列化或在 replay 后 flush，避免 `terminal.output(10)`、`terminal.output(12)`、`terminal.output(11)` 这种乱序。
- `after_seq` 命中：从 `after_seq + 1` 开始 replay，`gap=false`。
- `after_seq` 早于 `earliest_seq`：从 `earliest_seq` 开始 replay，`gap=true`，`status=partial`。
- `after_seq` 大于 `latest_seq`：不能默默当作最新。服务端返回 `status=unavailable`、`error_code=future_after_seq`，并可在 `terminal.replay_start` / `terminal.replay_end` 上携带 `next_seq=latest_seq+1`；前端把 `next_seq` 作为后续 live output 的连续性边界，不渲染缺失 output，也不因该 unavailable replay 自行重连循环。
- 缺省 `after_seq`：表示没有可信连续 buffer。服务端可从 `earliest_seq` replay；如果 ring 不包含 session 起点，必须标记 `partial`。
- 重复 `seq` 且 payload 一致：前端丢弃。重复 `seq` 但 payload 不一致：contract violation，前端停止写入 xterm，展示外层错误并 reconnect 或关闭。
- 前端收到 `seq > lastAppliedSeq + 1`：这是 gap 或乱序。P0 不做本地补洞，必须显示外层降级状态并触发 reconnect。

### 6.4 权限、票据与可交互边界

- `GET list/get terminal session` 因下发 `ws_url` / ticket 必须要求 `project:agent_task:terminal`；`delete terminal session` 不下发 ticket，不能被复用为 `terminal.stdin` / `terminal.resize` 权限证明。
- attach/reconnect、`terminal.stdin`、`terminal.resize`、interrupt/paste 必须重新校验 token、session owner、task/project/workspace scope 和 `project:agent_task:terminal`。
- 可输入 ticket 必须短期、绑定 `terminal_session_id`、project、task、member 和权限版本。权限撤销后不能继续下发新 ticket，已下发 ticket 或已打开 socket 也必须在服务端按当前权限 truth 重新校验；不能只信旧 ticket 或 browser handshake 状态。
- reconnect 成功但 `input_enabled=false` 时，前端可以展示 replay/live output，但必须禁用输入和 paste，直到 `terminal.state` 或后续 replay completion 明确给出 `input_enabled=true`。
- 权限失败的错误响应不能泄露用户无权访问的 session 是否存在；前端用通用不可连接状态展示。

### 6.5 Buffer 与 snapshot 边界

| 对象 | 用途 | 持久性 |
| --- | --- | --- |
| bounded ring replay | 刷新/切换后的短期 output 恢复 | 内存态，TTL + 大小上限 |
| screen snapshot | 延后决策项；仅在单独评审通过后作为短期 screen continuity 辅助 | 优先内存态，TTL + 大小上限 |
| audit event | 审计谁创建、连接、取消、结束 session | 只记录必要元数据，不落完整 terminal output |

## 7. UX 行为要求

### 7.1 刷新页面

- 如果刷新前 terminal session 仍在运行，页面恢复后应自动回到该 terminal 所在 tab。
- 如果该 terminal 是刷新前焦点所在区域，应自动 focus terminal。
- terminal 外层显示短暂恢复状态；xterm buffer 只显示后端 replay / snapshot / live output。
- 如果 replay 有缺口，显示明确降级状态，不阻止用户继续输入。
- 如果 session 过期、权限撤销、ring 未命中或 API instance mismatch，必须展示 `partial` / `unavailable` 外层状态，不能留下空白 xterm 让用户误以为已完整恢复。

### 7.2 切换 conversation / terminal

- 切回已有 terminal 时，继续发送当前 browser view 标识；是否能连续续接由 `after_seq` 和后端 replay metadata 判断。
- active terminal 恢复后触发 `focusRequestToken`。
- 如果用户当前正在输入到其他控件，不应抢焦点；焦点恢复只针对“上次焦点就在 terminal”或用户主动切到 terminal 的场景。

### 7.3 切 tab / 视图可见性变化

- tab 重新可见后触发 fit 检查和必要的 terminal resize sync。
- 不因为 fit/resize 重复写 output。
- 如果 rows/cols 变化影响 snapshot 可用性，显示轻量状态，不把 resize mismatch 写进 xterm。
- handshake 完成前不发送 resize；完成后只发送当前稳定 rows/cols。

### 7.4 运行中 command

- reconnect 后应展示最近真实 output，并继续接收 live output。
- `取消当前轮` 或 terminal interrupt 类操作必须保持可见、可点击、状态明确。
- 不伪造 shell prompt；只有真实 output 中出现 prompt 才显示 prompt。

### 7.5 交互式屏幕程序场景

- P0：只承诺真实 output replay、继续接收 live output 和可输入能力。交互式程序 screen 可能需要继续输入或等待新输出刷新。
- 不用 transcript 假装完整 screen，也不为了恢复视觉状态向 shell 注入输入。
- screen snapshot 属于延后决策项，不是当前主线验收条件。
- 用户继续输入时，输入只发送到真实 terminal session，不触发任何本地补偿命令。

### 7.6 降级状态

用户可见状态需要短、准、可行动。主界面不直接暴露 `future_after_seq`、`api_instance_mismatch`、`resize_mismatch` 等工程原因码；这些原因码只进入诊断详情、日志或开发者工具。

用户可见状态：

- `live_ready`：已连接，正在接收实时输出，可继续输入。
- `reconnected_recent_output`：已重新连接，显示最近输出，可继续输入。
- `reconnected_partial_output`：已重新连接，但较早输出不可恢复。
- `connected_waiting_output`：已连接，但历史输出不可恢复；等待新输出。
- `read_only_session`：会话仍可查看，但当前不能输入。
- `session_ended`：会话已结束。
- `attach_unavailable`：当前无法重新连接。

工程原因码：

- `connected_partial_replay`：已连接，仅恢复最近输出。
- `replay_gap`：较早输出已过期。
- `snapshot_unavailable`：当前 screen 无法完整恢复。
- `session_ended`：会话已结束，不能继续输入。
- `permission_revoked`：权限变化，不能重新连接。
- `attach_unavailable`：当前无法恢复交互连接，可等待新输出或重新打开任务。
- `future_after_seq`：本地游标异常；若 replay unavailable 带 `next_seq`，已对齐后续 live output 边界，但缺失 output 没有恢复。

所有连接状态、用户可见状态和工程原因详情都必须在 terminal 外层 UI 渲染。`connecting`、`reconnecting`、`ready`、`failed`、`closed` 以及对应中文文案都不能写入 xterm buffer。

### 7.7 Footer 长文本

- 最近动作永远在左列单行截断。
- `取消当前轮` 永远在右列稳定显示，不换行、不被挤压。
- footer 高度在常规 active 状态下保持稳定。
- tooltip / title 可用于查看完整最近动作，但不能替代主界面稳定性。

### 7.8 i18n、a11y 与窄屏

- 新增或迁移状态文案必须同时提供 `en-US` / `zh-CN` key，key 使用 snake_case，优先放在现有 `studio`、`chat` 或 `errors` namespace 中的合适位置。
- Terminal 外层状态区域使用 `aria-live="polite"`，避免频繁 output 时打断屏幕阅读器。
- `取消当前轮`、terminal reconnect retry、关闭状态提示等按钮必须有完整 accessible name；视觉 ellipsis 不能截断屏幕阅读器名称。
- 窄屏下 footer 允许最近动作更短，但不能让主按钮换行、消失或覆盖其他内容。
- 自动 focus 不得抢夺其他输入框、textarea、contenteditable、combobox 或正在输入的快捷命令面板焦点。

## 8. 测试计划

测试遵循精确小范围原则：每个实现切片先跑 focused unit / service / frontend / e2e / visual，阶段收口再按改动风险升级到 `npm run verify -- --goal=<pr|real|visual> --run`。不要求每个小改动都跑 full heavy gate。

### 8.1 Focused unit

- `terminal.reconnect` payload 校验：缺字段、非法 `view`、非法 `rows/cols`、非法 `after_seq`。
- handshake 完成前 `terminal.stdin` / `terminal.resize` 被拒绝。
- `seq` 生成单调递增。
- ring buffer 按大小和 TTL 淘汰。
- `after_seq` 命中、过旧、缺省、未来值的边界行为。
- output encoding / chunk 边界：base64 bytes、chunk max bytes、不假设完整 UTF-8 或完整行。
- gap、乱序、重复 seq、payload mismatch 的处理。
- replay event 顺序：`terminal.replay_start` → `terminal.output*` → `terminal.replay_end`。`snapshot` 不属于当前 P0 contract。
- attach/reconnect、`terminal.stdin`、`terminal.resize` 权限 guard：token、owner、scope、`project:agent_task:terminal`。
- footer 长文本布局 class / variant 的确定性单元测试。

### 8.2 Backend service

- `Agent task terminal service` 在实时 send 之外同步写入 bounded ring。
- reconnect existing runtime 时不只发送 synthetic `started`，而是按 contract 返回 replay metadata。
- Browser WS 必须先收到 `terminal.reconnect`；handshake 前收到 `terminal.stdin` / `terminal.resize` 必须明确 error/close。
- 多客户端 attach 同一 terminal 时，`seq` 去重和 replay 范围一致。
- `GET list/get` 缺少 `project:agent_task:terminal` 时不能下发 `ws_url` / ticket；`delete` 不下发 ticket，后续 attach/reconnect、`terminal.stdin`、`terminal.resize` 仍必须按 `project:agent_task:terminal` 失败。
- 权限撤销后不再下发可输入 ticket，已连接 session 进入不可输入或关闭。
- session ended、permission revoked、ring expired、API instance mismatch 的降级状态可观测。

### 8.3 Frontend unit

- `hydrateTerminalWorkspaceFromBackendSessions` 恢复 active terminal 后触发 `focusRequestToken`。
- replay output 按 `seq` 去重，缺口状态渲染在 xterm 外层。
- `connecting/reconnecting/ready/failed/closed` 文案只出现在外层 UI，不写入 xterm buffer。
- `TaskTerminalPanel` 在 mount、container resize、tab visible 后触发 fit，不重复污染 buffer。
- handshake 完成前不发送 `terminal.stdin` / `terminal.resize`，完成后按当前稳定 rows/cols 发送 `terminal.resize`。
- 状态文案覆盖 en-US / zh-CN i18n key，状态区域 `aria-live="polite"`。
- 自动 focus 不抢其他 input、textarea、contenteditable、combobox 焦点。
- `MessageItem` active footer 在长最近动作下仍保持按钮不换行。

### 8.4 E2E

- 运行中 command：刷新页面后看到最近 output，live output 继续更新，terminal 可继续输入。
- ring 过期/API instance mismatch：展示 `partial` / `unavailable`，不出现空白假恢复。
- 切换 conversation / terminal：切回 active terminal 后焦点回到 terminal。
- 其他输入框正在编辑时：terminal 恢复不抢焦点。
- 切 tab / resize：terminal rows/cols 稳定，输出不重复。
- 交互式屏幕程序：刷新后展示诚实降级状态，不伪造完整 screen。
- xterm buffer 不包含 `connecting/reconnecting/ready/failed/closed` 或对应中文状态文案。
- footer：构造超长最近动作，`取消当前轮` 仍在同一行稳定可见。

### 8.5 Visual

- active footer 长文本视觉场景：桌面和窄宽度下按钮稳定。
- terminal 降级状态视觉场景：状态提示不遮挡 xterm，不写入 terminal buffer。
- 窄屏场景：按钮 accessible name 完整，视觉文本不覆盖或挤压主操作。
- 只跑受影响 visual scenario；视觉系统级或整页级改动收口时再升级 full visual catalog。

### 8.6 Contracts 与阶段收口

涉及 terminal reconnect contract、OpenAPI schema、generated types 或事件 payload 的改动，必须在 focused tests 后补跑：

- `npm run contracts:check`
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`

涉及 ticket、scope、execution context、Agent task runner terminal attach/reconnect 的改动，至少补跑 Agent task runner focused diagnostics：

- `npm run test:agent-task:runner:fast`
- 如果触及 backend-real attach/reconnect、ticket 下发或权限撤销路径，再跑 `npm run test:agent-task:runner:backend-real`

阶段收口或准备合并前，根据风险回到：

- `npm run verify -- --goal=pr --run`
- 若涉及真实后端权限、ticket 或 execution context 主链，再升级到对应 `real` goal。

## 9. 验收标准

P0 验收：

1. 单 API 实例、session 未过期、ring 命中、权限有效时，刷新运行中 terminal 后能看到最近真实 output，live output 继续更新，并可继续输入。
2. ring 过期、future cursor、权限撤销、session ended、API instance mismatch 时，前端展示 `partial` / `unavailable`，不出现空白假恢复。
3. Browser terminal WS 必须先完成 `terminal.reconnect` handshake；handshake 前 `terminal.stdin` / `terminal.resize` 被拒绝，字段校验失败有明确 error/close。
4. attach/reconnect、`terminal.stdin`、`terminal.resize` 重新校验 token、session owner、scope 和 `project:agent_task:terminal`；`GET list/get` 下发 `ws_url` / ticket 时要求 `project:agent_task:terminal`，`delete` 不下发 ticket 且不能替代可交互 attach。
5. 后端 reconnect contract 能表达 replay 范围、gap、future cursor、latest seq、`next_seq`、`input_enabled` 和降级原因。
6. 前端对 replay output 去重，重复 reconnect 不产生重复文本；乱序、gap、payload mismatch 不写入补偿文本。
7. `connecting/reconnecting/ready/failed/closed` 和恢复提示不写入 xterm buffer，全部迁移到外层 UI。
8. 上次焦点在 terminal 或用户主动切回 terminal 时才自动 focus；不抢其他输入框焦点。
9. terminal mount / resize / tab visible 后 fit 稳定，不出现明显错列或遮挡；handshake 前不发送 resize。
10. active footer 在长最近动作和窄屏下，`取消当前轮` 不换行、不被挤压、位置稳定，accessible name 完整。
11. en-US / zh-CN i18n key、`aria-live="polite"` 状态区、受影响 unit/e2e/visual 通过。
12. contract/OpenAPI/generated checks 通过；涉及 ticket/scope/execution context 时 Agent task runner focused diagnostics 通过。

延后决策 A 验收：

1. 有独立决策记录证明 screen continuity snapshot 仍属于核心 shell 可预期状态，而不是范围扩张。
2. 有独立安全和资源评审说明 secret、TTL、内存上限、rows/cols mismatch 和降级语义。
3. 如果进入实现，snapshot 后续 output 能从 `snapshot_seq + 1` 续接，且不伪装完整恢复。

延后决策 B 验收：

1. 有独立决策记录说明生命周期 owner、权限撤销、多实例路由、资源上限和安全边界。
2. 证明 persistent attach / runner-owned terminal 带来的收益超过复杂度，再进入实现。
3. 明确 platform-managed tmux 仍不进入平台方案；用户自主管理 tmux 只按普通 terminal output 处理。

## 10. 风险与安全

### 10.1 Secret 暴露

Terminal output 可能包含 token、API key、路径、环境变量或用户粘贴的 secret。P0 的 ring 必须默认内存态，并设置 TTL、大小上限和 session 生命周期清理；若延后决策 A 未来通过，snapshot 也必须遵守同样边界。

要求：

- 不把完整 terminal output 落长期审计。
- 不把 ring / snapshot 写入 release evidence、diagnostic bundle 或普通错误日志。
- 错误日志只记录 session id、seq 范围、状态码、降级原因等元数据。
- 任何导出能力都必须另行设计权限、脱敏和用户确认。

### 10.2 多 API 实例与路由

如果 terminal service 是进程内内存态，bounded ring 和 snapshot 会受到多 API 实例影响。

P0 可接受的边界：

- 本地 / 单实例路径先闭环，且只承诺命中持有 terminal session stream 与 bounded ring 的 API entry。
- 多实例环境需要 sticky routing、shared session store 或 runner-owned relay 之一。
- 无法命中原实例时必须返回 `unavailable` 或 `partial`，不能静默空白。
- API reload 后 ring 丢失时同样必须显式降级，不能用 synthetic `started` 或空白 xterm 伪装恢复成功。

### 10.3 交互式屏幕真实度

交互式屏幕程序不能用普通 transcript 伪装完整恢复。P0 只承诺最近真实 output、继续接收 live output 和继续交互。Screen snapshot 属于延后决策项，不是当前主线承诺。

### 10.4 资源上限

Ring 和 snapshot 都必须有明确上限：

- 每 session 最大 bytes。
- 每 session 最大 chunk 数。
- 单 chunk 最大 bytes。
- TTL。
- 全局内存上限或压力淘汰策略。
- session end / task delete / permission revoke 后清理。

### 10.5 权限撤销与票据泄露

可输入 terminal ticket 的风险高于只读 session 元数据。P0 必须把权限和票据边界作为安全验收项：

- `GET list/get` 下发 `ws_url` / ticket 时必须要求 `project:agent_task:terminal`；`delete` 不下发 ticket，不能被当作 attach/reconnect、`terminal.stdin`、`terminal.resize` 权限。
- 可输入 ticket 绑定 member、project、task、terminal session 和权限版本。
- 权限撤销、成员移除、scope 变化后，服务端不能下发新 ticket，已连接通道必须进入不可输入或关闭。
- 日志只记录 ticket id/hash、session id、权限版本和失败原因等元数据，不记录 ticket 明文或 terminal output。

## 11. 明确不做的 workaround

1. 不强发回车来让 shell 重新打印 prompt。
2. 不伪造 prompt、工作目录、命令状态或交互式 screen。
3. 不把前端 `sessionStorage` 当作权威 screen truth。
4. 不把“已连接”当作“已恢复现场”。
5. 不把恢复说明写入 xterm buffer。
6. 不用最近动作完整展示牺牲取消按钮稳定性。
7. 不把 tmux 作为任何阶段的平台补丁或内置恢复机制。
8. 不把 `delete` 这类不下发 ticket 的操作当作可交互 attach 权限；`GET list/get` 下发 `ws_url` / ticket 时必须要求 `project:agent_task:terminal`。
9. 不用 synthetic `started`、空白 xterm 或本地缓存伪装多实例/API reload 后的恢复成功。

## 12. 建议实施顺序

Slice A：Terminal recovery，目标是执行入口可信度。

1. Contract handshake：补 `terminal.reconnect`、error/close、`after_seq` / `view`、`input_enabled`、`next_seq`、encoding/chunk、权限/票据边界。
2. Backend replay buffer：实现 API entry 单 session `seq`、bounded ring、gap/future/duplicate/out-of-order 处理、单实例降级状态。
3. Frontend apply/status/focus/fit：实现 handshake 前禁 `terminal.stdin` / `terminal.resize`、replay apply、外层状态、用户可见状态与工程原因码分层、i18n/a11y、focusRequestToken、fit/resize。
4. Focused validation：unit、backend service、frontend unit、目标 e2e、`contracts:check`、`contracts:check-openapi`、`openapi:check-generated`。
5. 涉及 ticket/scope/execution context 时补 Agent task runner diagnostics：`test:agent-task:runner:fast`，必要时 `test:agent-task:runner:backend-real`。

Slice B：Message footer，目标是运行中主控制稳定性。

1. Footer layout：active footer 两列稳定布局、最近动作单行截断、取消按钮固定位置。
2. UX validation：长文本、中英文、窄屏、accessible name、键盘焦点顺序。
3. Focused validation：MessageItem unit、相关 Agent task e2e、受影响 visual scenario。

延后决策：

1. 延后决策 A：只有 P0 后仍有明确缺口时，才评审 screen continuity snapshot、rows/cols、secret 和内存边界。
2. 延后决策 B：只有真实多实例部署需要时，才评估 persistent attach / runner-owned terminal；继续排除 platform-managed tmux。
