# Notebook Task UX/UI Improvement Plan v1

Last updated: 2026-05-01  
Status: `implementation_handoff_plan`
Artifact scope: development plan evidence only; not current documentation truth.

> 本文是 notebook task 本轮开发的 implementation handoff plan，用于把问题、原则、技术切分和验证路径交接给实现 worker。
> 它不是最终 UX/UI 规范，不是产品 contract，也不是已完成实现记录。
> 后续实现仍以 `DEVELOPMENT.md`、`docs/contracts/`、`docs/UXUI/`、实际代码和门禁结果为准；如果实现中发现 contract 或 UXUI 规范需要更新，应另行提交对应文档变更。

## 1. 背景与目标

### 1.1 背景

Notebook task 当前同时承载 AI 执行、trace 展示、terminal 会话和任务级运行控制。随着 notebook、chat、terminal runner 主链逐步收敛，用户界面里出现了几个明显问题：

- 执行状态在顶部、AI 气泡、trace 区、terminal tab 等多个位置重复表达，用户难以判断哪个状态最权威。
- 取消、关闭 terminal tab、结束全部 terminal 会话等操作入口在视觉上分散，背后的权威路径也容易被实现成多套逻辑。
- SSE ping、watchdog、reconnect、可恢复 LLM 或 trace 事件噪声容易进入用户主视图，使用户误以为任务失败或 AI 输出异常。
- active run 的用时、trace、final answer 顺序和取消状态没有形成一个稳定的阅读模型。
- terminal 输入焦点和 tab 关闭行为有交互缺口，影响连续操作体验。

这些问题不是单一组件样式问题，而是“用户如何理解一个 task 内正在发生什么”的信息架构问题。

### 1.2 总目标

本次主线目标是把 notebook task 的运行体验收敛为一个清晰模型：

1. 用户以 AI 气泡为主要执行现场，顶部不再承担 active run 状态展示。
2. active run 的取消、用时、动画反馈、trace、final answer 都在 AI 气泡内形成闭环。
3. trace 作为证据优先展示，final answer 在 trace 之后出现，避免用户误判 AI 跳过了执行过程。
4. 可恢复噪声默认隐藏，只暴露真正需要用户处理的异常。
5. terminal 的输入焦点、单 tab close、end-all 操作共用一个权威生命周期模型。
6. SSE 连接层负责自愈与降噪，不把 ping/watchdog/reconnect 过程当成用户级内容展示。
7. Transport 不等于 execution：短暂 SSE reconnect、gap-fill、reconcile success 默认不可见，不应被展示成 AI 执行进度或错误。

### 1.3 成功后的用户感受

用户打开 notebook task 时，应当只需要看两个地方：

- AI 气泡：当前 AI run 是否还在执行、是否可取消、已经运行多久、trace 证据是什么、最终回答是什么。
- terminal 区域：当前 terminal session 是否可输入、是否关闭、是否正在被统一结束。

顶部区域只保留任务导航、任务元信息和全局动作，不再像“第二个执行控制台”一样竞争注意力。

## 2. 问题清单

### 2.1 顶部执行状态占据了错误的信息层级

当前顶部执行状态容易造成三类问题：

- 与 AI 气泡内状态重复，用户不知道该看哪个。
- 顶部状态离实际输出内容太远，执行失败、取消、用时和 trace 的上下文断裂。
- 当页面存在 terminal 区域时，顶部状态容易被误解为 task 级全局运行状态，而不是某个 AI run 的状态。

改进要求：

- 移除顶部 active run 执行状态展示。
- 不移除必要的 task 导航、标题、设置入口和非执行类系统状态。
- active run 状态统一下沉到正在执行的 AI 气泡内。

### 2.2 取消按钮位置不贴近执行对象

取消当前 AI run 属于对某个 AI 气泡对应 run 的操作，不应作为远离内容的顶部按钮。

现状风险：

- 用户无法快速确认取消的是哪个 run。
- 多轮输出或历史 run 存在时，取消动作的对象不清晰。
- 取消状态可能与气泡内的 loading 状态脱节。

改进要求：

- 取消按钮进入 active AI 气泡 footer。
- canceling 状态应在同一 footer 内展示，避免重复点击和误判。
- 取消成功、取消失败、已完成后的按钮状态必须可预测。

### 2.3 AI 气泡 active run footer 缺少稳定反馈

active run footer 应成为“执行中现场”的主视觉锚点。

需要覆盖：

- running / canceling / reconnecting / completed / failed 等状态。
- 轻量动画，表达仍在工作，但不能使用夸张或营销化动效。
- 用时持续更新。
- 取消入口。
- trace 进展入口或状态摘要。

改进要求：

- active footer 动画仅用于运行中状态。
- 动画不改变布局尺寸，不造成内容跳动。
- 状态文案纳入 i18n，使用 `snake_case` key。

### 2.4 用时没有形成持续更新模型

用户需要知道当前 run 已经执行多久，尤其在工具调用、terminal 操作、长 trace 场景中。

改进要求：

- active run 用时应持续更新。
- 以服务端 run start 时间为基准，前端只做展示层计时。
- run 结束后冻结最终用时。
- reconnect 后不重置用时。
- canceling 状态继续显示已经消耗的时间，直到进入 terminal 状态。

### 2.5 final answer 与 trace 的阅读顺序需要调整

当前 final answer 如果先于 trace 或与 trace 混排，用户容易忽略证据链。

目标模型：

- trace-first：先展示 trace 过程，再展示 final answer。
- final answer after：最终回答应明确出现在 trace 之后。
- final answer 不是 trace 的替代物，也不是执行过程的首屏遮罩。

改进要求：

- 对同一个 AI run，trace 区块在视觉顺序上先于 final answer。
- final answer 仍保持 AI 文本的主阅读体验。
- 如果没有 trace，final answer 仍可正常展示，不制造空壳 trace 区。
- 如果 trace 延迟到达，需要有稳定的插入规则，避免 final answer 在用户眼前被大幅挤动。

### 2.6 用户可见 AI text/progress trace 没有完整展示

用户可见的 AI text/progress trace 与执行证据，是用户理解任务进展和结果来源的重要材料。当前如果只展示摘要或部分用户可见事件，会削弱可追责性。

改进要求：

- 用户可见 AI text/progress trace 完整展示，不静默丢失用户可见 trace。
- 不展示内部 reasoning/thinking，不泄露敏感 payload；进入 UI 前必须经过现有 sanitization/redaction。
- 长 trace 可以折叠、分段、虚拟化或懒加载；如果受 retention、payload size 或 performance 限制，必须展示 truncation marker、load more 或 diagnostic 入口。
- trace 内部应区分用户可读内容、工具事件、系统恢复事件。
- copy/export 行为如后续加入，应基于可访问的完整用户可见 trace 数据源；如果存在 retention、payload size 或 redaction 限制，导出内容也必须带对应标记。

### 2.7 可恢复 LLM/trace 噪声暴露过多

可恢复错误包括但不限于短暂 LLM retry、trace fragment reorder、临时 stream gap、连接恢复事件。它们是工程运行细节，不应默认进入用户主阅读路径。

改进要求：

- 默认隐藏可恢复 LLM/trace 噪声。
- 保留调试证据，但放在 debug/details 层，不与用户级 trace 混在一起。
- 只有最终不可恢复错误、需要用户重试/修改输入/检查权限的错误，才进入主视图。
- 错误分类必须由明确的事件类型或状态字段驱动，避免靠文案字符串判断。

### 2.8 SSE ping/watchdog/reconnect 噪声需要降级

SSE 连接维护事件是传输层细节。ping、watchdog tick、reconnect attempt、backoff 等如果进入主 UI，会让用户误以为 AI 正在输出这些内容。

改进要求：

- ping/watchdog 不进入 AI 气泡正文。
- reconnect 只在影响用户等待感知时进入 active footer 的轻量状态。
- reconnect 成功后恢复 running 状态，不追加用户级噪声。
- reconnect 失败并达到不可恢复阈值后，才展示用户级错误。
- SSE 层需要有清晰事件分类：content、trace、status、transport、diagnostic。

### 2.9 terminal 输入 focus bug 影响连续操作

terminal 区域的核心体验是连续输入。输入焦点丢失会让用户误以为 terminal 卡死。

典型表现：

- terminal tab 切换后输入框没有重新 focus。
- active run footer、trace 更新或页面 re-render 抢走 focus。
- 关闭 terminal tab 后焦点没有落到下一个合理目标。
- terminal 输出追加时导致输入区域滚动或焦点异常。

改进要求：

- terminal active tab 可输入时，焦点保持在 terminal input。
- tab 切换、session ready、reconnect 成功后恢复输入焦点。
- AI 气泡刷新、footer 用时 tick、trace append 不应抢 terminal focus。
- 关闭最后一个 tab 后焦点回到明确的 task 操作入口，而不是丢到 body。

### 2.10 terminal 单 tab close 与 end-all 权威路径不统一

terminal 单 tab close 和 end-all 本质上都是结束 terminal session，只是作用范围不同。如果前端实现成两套权威路径，会造成状态不同步。

现状风险：

- 单 tab close 成功，但 task 级阻塞状态未释放。
- end-all 成功，但局部 tab 仍显示 live。
- 某些路径只更新前端状态，未以服务端 terminal session 状态为准。
- 关闭失败、部分成功、重连后恢复状态的处理不一致。

改进要求：

- 单 tab close 与 end-all 共用 session lifecycle authority。
- 后端 terminal session 状态是权威，前端只做请求中和展示状态。
- end-all 是批量结束入口，不是另一个独立生命周期。
- 所有关闭路径都必须回收同一批 UI 状态：tab 列表、active tab、task run blocked、focus target、toast/error。

## 3. 根因判断

### 3.1 信息架构根因：active run 没有唯一展示现场

顶部、AI 气泡、trace 区和 terminal 区都在表达“正在发生什么”，但没有明确谁是 active run 的主显示权威。结果是状态重复、文案冲突、操作入口分散。

判断：

- active AI run 的主现场应是 AI 气泡。
- task 顶部只表达任务级上下文，不表达某个 run 的实时执行细节。

### 3.2 状态模型根因：传输事件与用户事件混在一起

SSE ping、watchdog、reconnect、LLM retry、trace reorder 等属于工程恢复机制。如果这些事件与 content/trace/final answer 使用相同展示通道，就会污染用户体验。

判断：

- 事件必须在进入 UI 前完成分类。
- UI 只渲染用户可理解的状态，不直接渲染传输层噪声。

### 3.3 具体 SSE 根因：命名 ping 没有被前端监听

当前后端 task events 会每 15s 发送命名 SSE 心跳：`event: ping`。代码证据位于 `packages/api-entry-node/src/task-route-handler.ts`。前端 `useTaskSSE` 当前只监听 `EventSource.onmessage`，而命名事件不会进入默认 `onmessage` 回调，导致前端 watchdog 误判为 silent stream。

这会带来两个连锁影响：

- 实际连接仍有后端 ping，但前端认为没有收到事件。
- 前端可能触发不必要的 reconnect、gap-fill 或 reconcile，并把这些传输层恢复动作错误暴露到用户界面。

判断：

- 不能把“调大 watchdog 时间”作为解决方案；这只会掩盖心跳语义不一致。
- 正确路径是让前端监听命名 `ping`，或前后端统一 heartbeat 语义，再由 `realtimeHealth` 表达连接健康。
- heartbeat 只能证明 transport 仍活着，不等于 AI execution 有新进展。

### 3.4 生命周期根因：terminal 操作范围不同但权威对象相同

单 tab close 和 end-all 的对象数量不同，但权威对象都是 terminal session。如果前端把它们当成不同业务动作，各自维护状态，就会出现释放不一致。

判断：

- terminal session state 必须是统一权威。
- 批量操作只是一组 session close 的编排，不应绕过单 session 生命周期。

### 3.5 渲染根因：频繁 tick 与 stream append 影响 focus

用时持续更新、trace append、AI 气泡动画都会触发 re-render。如果组件边界和 focus 管理没有隔离，terminal 输入会被非 terminal 更新影响。

判断：

- active footer tick 应局部化。
- terminal input focus 应有显式恢复策略。
- 非 terminal 区域更新不应重建 terminal input 节点。

## 4. 产品设计原则

### 4.1 一个对象，一个主现场

- AI run 的实时状态归 AI 气泡。
- terminal session 的实时状态归 terminal tab/panel。
- task 顶部只保留任务级导航和管理动作。

### 4.2 操作靠近对象

- 取消 AI run 的按钮放在 active AI 气泡 footer。
- 关闭 terminal session 的动作放在对应 tab 或 terminal 面板内。
- end-all 作为 terminal 区域级批量动作，不上升为页面顶部执行控制。

### 4.3 证据优先，结论随后

- trace 是执行证据，final answer 是最终结果。
- 同一 run 内优先展示 trace，再展示 final answer。
- 可折叠不等于可丢失，尤其是用户可见 AI text/progress trace。

### 4.4 可恢复事件默认安静

- 用户不需要看到每一次 ping、watchdog、retry、reconnect attempt。
- 只有影响等待、操作或最终结果的状态才进入主界面。
- debug 信息可以保留，但不能污染默认阅读路径。
- Transport 不等于 execution：SSE reconnect、gap-fill、reconcile success 只表示传输或本地状态恢复成功，不表示 AI 又执行了一步。
- 短暂 SSE reconnect、gap-fill、reconcile success 默认不可见；只有超出恢复阈值、影响用户等待或需要用户动作时，才进入主界面。

### 4.5 后端为唯一权威

- 服务端 run 状态、cancel result、terminal session closed state 均以后端为准。
- 前端可以展示 pending/canceling/closing，但不能自行宣布最终成功。
- reconnect 后以前端重新获取到的服务端状态收敛 UI。

### 4.6 不扩大产品范围

本次改进只收敛 notebook task 内 AI run 与 terminal session 的体验，不引入新的 task 类型、权限模型、文件级策略或独立配额。

## 5. 技术改进方案

### 5.1 UI 信息架构调整

计划动作：

- 移除顶部 active run 执行状态展示。
- 保留顶部 task 标题、导航、必要的设置/刷新/更多动作。
- 将 active run 状态、取消、用时、轻量 reconnect 提示移动到 AI 气泡 footer。
- terminal 区域内保留 terminal session 状态和关闭动作。

实现约束：

- 新增或调整文案必须纳入 next-intl。
- 新 UI 样式优先复用现有 design token 和组件变体。
- 不引入页面级营销化视觉，不使用大面积渐变承载状态。

### 5.2 `activeRunView` 单一 view model

`activeRunView` 是本次 AI run 展示的核心收敛点。它只管 AI run，不包含 terminal action，不传给 terminal 相关区域。它应由 `TaskPage` 基于当前 task、messages、SSE 状态、trace 和 cancel mutation 统一生成，然后向下传给 `ConversationPanel`、`MessageList`、`MessageItem` 和 AI 气泡 footer。

下游 AI conversation 组件禁止各自从 `streamingMessageId`、`latestAgentMessageId`、`task.run_state`、局部 message 状态或 terminal 状态里拼 active run 判断。否则会重新制造多套真相源，导致顶部、气泡、trace 状态不一致。

建议字段：

- `messageId`：active AI message 的稳定 id。
- `runState`：queued、running、canceling、reconnecting、completed、failed、canceled 等展示态。
- `traceEvents`：完整、已分类、已 sanitization/redaction 的用户可见 trace 事件。
- `latestAction`：当前最近一条用户可理解的执行动作。
- `recentActions`：用于 progress/trace 摘要的近期动作列表。
- `startedAt`：服务端 run start 时间，缺失时保持 unknown。
- `elapsed`：展示层 elapsed view data，active 时持续更新，run 终态后冻结。
- `cancelPending`：cancel mutation 是否进行中。
- `onCancel`：绑定当前 run/message 的取消回调。
- `realtimeHealth`：transport 健康视图，表达 connected、reconnecting、stale、exhausted 等，不直接等同于 execution 进展。

生成约束：

- `TaskPage` 负责把 task/run/message/SSE/trace/cancel 数据合成一个 AI run view model。
- 下游只消费 `activeRunView`，不再自行推断“当前哪个 run active”。
- `realtimeHealth` 可影响 footer 的轻量状态，但不能生成 AI 正文或 trace 正文。
- 如果没有 active run，`activeRunView` 应为明确的 empty/null 状态，而不是让下游回退拼接。

### 5.3 `terminalSessionsView` 独立状态

terminal session lifecycle 归 terminal tab/panel，不属于 `activeRunView`。`TaskPage` 可以同时汇总 `activeRunView` 和 `terminalSessionsView` 两类 view，并分别向 AI conversation 区域和 terminal 区域传递，但不能混成一个 view model。

`terminalSessionsView` 应表达：

- `sessions`：以后端 list/hydrate 结果为准的 terminal session 列表。
- `activeSessionId`：当前用户选择的 terminal tab。
- `closingSessionIds`：正在关闭中的 session。
- `blockedReason`：task 是否因为 live terminal session 阻塞 run/delete。
- `focusIntent`：由用户显式动作写入的 terminal focus intent token。
- `onCloseSession` / `onEndAllSessions`：调用当前 API 下的后端权威关闭路径。

边界约束：

- AI run 状态不从 `terminalSessionsView` 推导。
- terminal tab/panel 不消费 `activeRunView` 来判断 session lifecycle。
- terminal session 状态以后端 truth 为准，前端只承载 pending/closing/error 展示态。

### 5.4 AI 气泡 active run footer

footer 应承载：

- 状态：queued、running、canceling、reconnecting、completed、failed、canceled。
- 用时：active 时持续更新，run 终态后冻结。
- 操作：可取消时展示 cancel，canceling 时禁用并展示处理中状态。
- 动画：running/reconnecting 使用轻量 pulse 或 progress motion，尺寸稳定。
- trace 摘要：可选展示 trace 正在生成或 trace 已完成，不替代用户可见 trace 区。

关键约束：

- footer 不改变气泡宽度和主文本布局。
- 用时更新不触发整页重排。
- cancel 操作必须绑定当前 run id，禁止依赖“页面当前看起来正在运行”的隐式状态。

### 5.5 用时持续更新

建议模型：

- `started_at` 来自服务端 run 状态或 SSE run start 事件。
- 前端以本地 interval 计算显示用时。
- reconnect 后沿用同一 `started_at`。
- `ended_at` 到达后冻结显示。
- 缺少 `started_at` 时显示状态，不伪造精确用时。

测试关注：

- 运行 1 秒后文案更新。
- reconnect 不重置。
- completed/canceled/failed 后停止 tick。
- 多 run 历史气泡不继续 tick。

### 5.6 trace-first final answer after

建议 AI 气泡内部顺序：

1. trace/progress 区块。
2. final answer 区块。
3. active footer。

运行中 footer 是气泡底部的固定执行控制区，用来放状态、用时、取消和轻量 reconnect 提示；它不是 final answer 的正文内容。run 结束后，footer 应消失或收敛为最终 duration/copy 等稳定操作区，避免与“final answer after trace”形成语义矛盾。

可选实现细化：

- 如果 trace 尚未到达，footer 显示 trace pending，不插入空 trace 容器。
- 如果 final answer 先到达，先缓存或放入 final answer slot，待 trace slot 决定后稳定渲染。
- 如果协议保证 trace complete 在 final answer 前到达，则前端仍需要保底处理乱序。

验收重点：

- 用户看到 final answer 时，trace 已经在其上方或已明确标记为无 trace。
- 不因乱序 SSE 导致 final answer 多次移动。

### 5.7 用户可见 AI text/progress trace 完整展示

建议策略：

- trace 数据层保留完整的用户可见事件列表或用户可见 text/progress span。
- 展示层可以默认折叠长内容，但提供展开完整内容。
- 对超长 trace 使用局部滚动、虚拟列表或分段加载时，必须保证用户可见语义完整。
- 不展示内部 reasoning/thinking，不泄露敏感 payload；所有进入 UI 的 trace 内容必须经过现有 sanitization/redaction。
- 如果受 retention、payload size 或 performance 限制不能一次展示完整用户可见 trace，必须展示 truncation marker、load more 或 diagnostic 入口，不能静默丢失。
- trace copy/export 后续如加入，应读取完整数据源。

不建议：

- 按字符数静默截断用户可见 trace。
- 把 LLM retry 噪声混入用户可见 AI text/progress trace 正文。
- 只展示最后一段 trace。

### 5.8 隐藏可恢复 LLM/trace 噪声

建议事件分类：

- `user_visible_content`：AI 正文、final answer。
- `user_visible_trace`：用户应理解的 trace。
- `recoverable_diagnostic`：LLM retry、trace reorder、temporary parse gap。
- `transport_diagnostic`：ping、watchdog、reconnect attempt、heartbeat timeout before recovery。
- `terminal_error`：不可恢复错误，需要用户感知。

展示规则：

- `recoverable_diagnostic` 默认不展示。
- `transport_diagnostic` 不进入 AI 正文或 trace 正文。
- `terminal_error` 进入错误 UI，文案必须可操作。
- debug/details 入口如存在，应与普通用户路径隔离。

### 5.9 SSE ping/watchdog/reconnect 降噪

建议改进：

- SSE adapter 在进入 notebook UI store 前完成事件类型归类。
- `useTaskSSE` 必须监听命名 `ping`，或切换到前后端一致的 heartbeat 事件语义。
- ping/watchdog 更新内部连接健康状态，不生成 message item。
- reconnect attempt 只更新 active footer 的轻量状态。
- reconnect success 不追加“已重连”正文。
- gap-fill/reconcile success 默认不进入用户界面。
- reconnect exhausted 才进入用户级错误，并附带 retry 操作。

watchdog 策略：

- watchdog 应检测“没有业务事件且连接可能停滞”的风险。
- ping 可刷新连接健康，但不代表业务进度。
- 如果业务长时间无 trace/content，但连接健康，footer 可表达“仍在等待响应”，不要制造错误。
- 禁止把单纯调大 watchdog 超时时间作为本轮修复；必须修正 heartbeat 监听或统一 heartbeat 语义。

### 5.10 terminal 输入 focus 修复

建议策略：

- terminal input 使用稳定 key，避免非 terminal 状态变化导致 remount。
- focus 由显式 user intent token 驱动，不靠 mount、visible、session 存在与否猜测。
- 新建 terminal session、用户点击 tab、用户点击 terminal 输入区域时，可以写入 user intent token 并触发 focus。
- 恢复旧 session、list/hydrate、SSE reconnect、页面重新渲染时不能偷焦点。
- 用户正在选择文本、使用快捷键或打开菜单时不强抢 focus。
- AI footer tick、trace append、SSE transport 状态变化不触发 terminal input 重新创建。
- 关闭 tab 后：
  - 若还有 tab，focus 下一个 active tab input。
  - 若没有 tab，focus terminal 的 create/new session 入口或 task 主操作入口。

测试场景：

- 输入中收到 AI trace append，焦点仍在 terminal input。
- tab 切换后可直接输入。
- reconnect 后可继续输入。
- 关闭最后一个 tab 后焦点落点稳定。

### 5.11 terminal 单 tab close 与 end-all 权威路径统一

建议模型：

- Phase 0 先确认当前 API contract，不在本文中隐性定义新的后端 contract。
- 在当前 API 下，用户级 close 应走后端权威关闭路径：现有前端 API 是 `closeTerminalSession(session_id)` / REST `DELETE` session，然后通过 list/hydrate 重新收敛为权威状态。
- WebSocket `terminal.close` 只能作为 best-effort 或内部清理细节，不能作为用户级 close 的权威成功来源。
- `endAllTerminalSessions(task_id)` 只负责枚举或请求后端批量关闭，并统一进入 session closed 状态同步。
- 每个 terminal session 的状态以后端响应和后续查询/SSE 同步为准。
- UI 层只维护 `closing`、`close_failed` 等临时展示状态。

状态收敛：

- close 成功：移除或标记 tab closed，释放 active tab，刷新 task blocked 状态。
- close 失败：保留 tab，展示可重试错误。
- end-all 部分成功：成功的 tab 关闭，失败的 tab 保留并展示失败状态。
- reconnect 后：按后端 session list 重建 tab 状态，不按旧前端缓存硬恢复。

### 5.12 不要 workaround

本轮实现不要用以下方式绕过问题：

- 不通过调大 watchdog 超时时间掩盖命名 ping 未监听的问题。
- 不让下游组件继续从 `streamingMessageId`、`latestAgentMessageId`、`task.run_state` 自行拼 active run。
- 不用 CSS 隐藏顶部执行状态但保留可触发逻辑；状态真相应迁移到 `activeRunView` 和 AI 气泡 footer。
- 不把 reconnect/gap-fill/reconcile success 写成 AI message、trace 正文或 toast。
- 不靠组件 mount、visible、tab 恢复来猜测 terminal focus。
- 不把 WebSocket `terminal.close` 当成用户点击关闭 tab 的权威成功结果。
- 不用 WS-only 或前端本地删除 tab 代替当前 API contract 下的后端权威 close + list/hydrate 收敛。
- 不把 terminal action 塞进 `activeRunView`，也不让 terminal tab/panel 消费 `activeRunView` 判断 session lifecycle。
- 不展示内部 reasoning/thinking，不绕过现有 sanitization/redaction 展示 trace payload。
- 不静默丢失受 retention、payload size 或 performance 限制影响的用户可见 trace；必须给 truncation marker、load more 或 diagnostic 入口。

## 6. 分阶段实施计划

### Phase 0：确认对象与事件边界

目标：

- 明确 notebook task 内 AI run、trace event、final answer、terminal session 的当前数据来源。
- 梳理 active run 状态和 terminal session 状态在前端 store/query 中的权威来源。
- 标记哪些事件是用户级内容，哪些是 diagnostic/transport。
- 确认后端 task events 的 `event: ping` 语义、`useTaskSSE` 当前监听路径，以及 mock/real 语义是否一致。
- 定义 `activeRunView` 字段、生成位置和 AI conversation 下游消费边界。
- 定义 `terminalSessionsView` 字段、生成位置和 terminal tab/panel 消费边界。
- 确认当前 terminal close API contract，不在本文中隐性新增后端 contract。

产出：

- 当前事件清单。
- UI 状态映射表。
- `activeRunView` 与 `terminalSessionsView` 字段表和数据来源表。
- heartbeat / `realtimeHealth` 语义说明。
- mock/real SSE heartbeat 行为一致性结论。
- 需要新增或复用的 i18n key 列表。

不做：

- 不调整视觉。
- 不改后端协议，除非发现前端无法可靠分类事件。

### Phase 1：active run 现场迁移

目标：

- 在 `TaskPage` 生成 AI-run-only 的 `activeRunView` 并向 AI conversation 下游传递。
- 移除顶部执行状态展示。
- 取消按钮进入 AI 气泡 footer。
- AI 气泡 footer 支持 running/canceling/completed/failed/canceled 基础状态。
- 用时可持续更新并在结束后冻结。

验收点：

- 页面顶部不再出现 active run 执行状态。
- AI conversation 下游组件不再自行从 `streamingMessageId`、`latestAgentMessageId`、`task.run_state` 拼 active run。
- `activeRunView` 不包含 terminal action，不传给 terminal tab/panel。
- 用户可在 active AI 气泡内取消当前 run。
- canceling 状态不会重复提交取消请求。
- 用时在 active 状态持续更新，结束后停止。

### Phase 2：trace 与 final answer 顺序收敛

目标：

- 实现 trace-first final answer after。
- 用户可见 AI text/progress trace 完整展示。
- 长 trace 有可用的折叠/展开、分段展示、truncation marker、load more 或 diagnostic 策略。
- 运行中 footer 固定在气泡底部；结束后消失或收敛为最终 duration/copy 操作区。

验收点：

- 同一 run 中 final answer 在 trace 之后。
- active footer 不被解释为 final answer 正文的一部分。
- 用户可见 trace 不被静默丢失；受 retention、payload size 或 performance 限制时有明确标记或后续读取入口。
- trace 不展示内部 reasoning/thinking，不绕过现有 sanitization/redaction。
- 无 trace 的 run 不展示空容器。
- 乱序事件不会造成重复 final answer 或明显布局跳动。

### Phase 3：噪声降级与 SSE 恢复体验

目标：

- 隐藏可恢复 LLM/trace 噪声。
- `useTaskSSE` 监听命名 `ping`，或完成统一 heartbeat 语义。
- ping/watchdog 不进入用户内容，且不被误判为 execution progress。
- reconnect 降级到 footer 轻量状态。
- 不可恢复连接错误才进入用户级错误 UI。

验收点：

- 正常 ping/watchdog 不产生消息或 trace。
- 15s 命名 `event: ping` 能刷新 `realtimeHealth`，不会触发 silent stream 误判。
- reconnect success 不污染 AI 正文。
- gap-fill/reconcile success 默认不可见。
- reconnect exhausted 有明确错误和重试路径。
- debug 信息仍可在诊断层定位，不从数据层丢失。

### Phase 4：terminal focus 与关闭权威路径

目标：

- 修复 terminal 输入 focus bug。
- 统一单 tab close 与 end-all 的权威路径。
- 关闭后 task blocked、active tab、focus target 同步收敛。
- Phase 0 确认当前 API contract 后，单 tab close 走现有 `closeTerminalSession` / REST DELETE + list/hydrate 权威收敛路径。

验收点：

- terminal 输入不被 AI footer tick 或 trace append 抢焦点。
- focus 只由显式 user intent token 驱动；恢复旧 session 不偷焦点。
- 单 tab close 和 end-all 都以后端 terminal session 状态为准。
- WebSocket `terminal.close` 或 WS-only 路径不作为用户级 close 成功依据。
- end-all 部分失败时 UI 可解释且可重试。
- 关闭最后一个 tab 后焦点落点稳定。

### Phase 5：整体验收与门禁

目标：

- 以 notebook task 用户主链完成 focused 验证。
- 按改动风险决定是否升级到 PR/real/visual verification。
- 形成 evidence，便于后续发布审查。

产出：

- focused unit/integration/e2e/visual 结果。
- 已知风险与 follow-up 列表。
- 若涉及 runner 主链或 skill runtime，补跑对应 focused diagnostics。
- 默认不跑 `release:ready`、full visual、real gate；只有阶段收口、跨模块高风险或发布要求时再升级。

## 7. TDD/测试计划

### 7.1 单元测试

覆盖：

- `TaskPage` 生成 `activeRunView` 的字段完整性、优先级和 AI-run-only 边界。
- `TaskPage` 生成 `terminalSessionsView` 的字段完整性，以及它与 `activeRunView` 的隔离边界。
- AI run 状态到 footer 展示状态的映射。
- 用时 formatter 与 tick/freeze 逻辑。
- SSE 事件分类：content、trace、status、transport、diagnostic。
- 命名 `event: ping` 更新 heartbeat / `realtimeHealth`，不走普通 message。
- mock/real heartbeat 语义一致时不触发 silent stream 误判。
- 可恢复噪声过滤规则。
- final answer 与 trace slot 排序规则。
- terminal session close/end-all 状态 reducer 或 store 行为。

重点用例：

- reconnect 后 elapsed 不重置。
- final answer 先于 trace 到达时仍最终位于 trace 之后。
- ping/watchdog 不生成 message item。
- 15s 命名 ping 不触发 silent stream watchdog 误判。
- recoverable LLM retry 不进入用户 trace。
- canceling 状态下 cancel 按钮不可重复触发。

### 7.2 组件测试

覆盖：

- active AI 气泡 footer 的 running/canceling/reconnecting/completed/failed/canceled 展示。
- cancel 按钮在 AI 气泡内并绑定正确 run id。
- `ConversationPanel`、`MessageList`、`MessageItem` 只消费 `activeRunView`，不自行推断 active run。
- `TaskTerminalPanel` 消费 terminal 独立状态或 `terminalSessionsView`，不消费 `activeRunView` 判断 session lifecycle。
- 长 trace 可展开用户可见内容；受限制时展示 truncation marker、load more 或 diagnostic 入口。
- 无 trace 时不渲染空 trace 区。
- trace 不展示内部 reasoning/thinking，不泄露未经 sanitization/redaction 的敏感 payload。
- terminal input 在 trace append 后保持 focus。
- 新建/点击 terminal tab 后 focus；恢复旧 session 不偷焦点。
- 关闭 tab 后 focus 到下一个合理目标。

测试要求：

- 使用稳定 test id，格式为 `scope__element__state`。
- 不依赖动画具体帧数，只断言状态、尺寸稳定性和可访问状态。

### 7.3 集成测试

覆盖：

- notebook task active run 从 start 到 trace 到 final answer 到 completed 的完整顺序。
- cancel active run 后 UI 状态与服务端 run/task 状态收敛。
- SSE reconnect 期间不污染消息列表。
- 命名 ping 能维持 realtime health，不触发错误 reconnect。
- terminal 单 tab close 释放对应 tab 和 task blocked 状态。
- 单 tab close 按当前 API contract 经 `closeTerminalSession` / REST DELETE 后 list/hydrate 收敛。
- end-all 批量关闭成功/部分失败的 UI 收敛。

建议方式：

- mock adapter 用于稳定覆盖事件乱序、reconnect、recoverable error。
- backend-real focused diagnostics 用于验证实际 runner/terminal/session 权威路径。

### 7.4 E2E 与 visual

focused E2E 场景：

- 用户发起 notebook task AI run，看到 active footer、用时更新、trace、final answer。
- 用户在 AI 气泡内取消 run。
- 用户在 terminal 输入时，AI trace 更新不抢 focus。
- 用户关闭单个 terminal tab。
- 用户执行 end-all，所有 terminal tab 状态收敛。

focused visual 场景：

- active AI bubble running footer。
- canceling footer。
- reconnecting footer。
- trace-first final answer after。
- long trace expanded/collapsed。
- terminal tab closing/closed/error state。

执行策略：

- 每个 change slice 先跑最小相关测试。
- UI/visual 改动先跑受影响 visual scenario。
- 默认不跑 `npm run release:ready`、full visual catalog、`npm run verify -- --goal=real --run` 或 real gate。
- 阶段收口或合并前再按风险回到 `npm run verify -- --goal=pr --run`。
- 如果触及 chat/notebook/terminal execution context、agent ticket scope、Context Store ownership 或 skill env，再补 `npm run test:skills:fast`，必要时补 `npm run test:skills:backend-real`。

### 7.5 focused 命令建议

前端 SSE / active run：

```bash
npm run test:run -- src/lib/hooks/__tests__/use-task-sse.test.ts
npm run test:run -- src/components/notebook/__tests__/TaskPage.test.tsx
```

前端 conversation / message：

```bash
npm run test:run -- src/components/notebook/__tests__/ConversationPanel.test.tsx src/components/notebook/__tests__/MessageList.test.tsx src/components/notebook/__tests__/MessageItem.test.tsx
```

前端 terminal：

```bash
npm run test:run -- src/components/notebook/__tests__/TaskTerminalPanel.test.tsx
```

如果后端或 server-side session/SSE 路径被 touched，再加：

```bash
npm run test:run -- packages/api-entry-node/src/task-route-handler.test.ts packages/api-entry-node/src/notebook-task-sse-broker.test.ts packages/api-entry-node/src/notebook-terminal-service.test.ts
```

这些是 focused diagnostics，不替代阶段收口门禁；但本轮不默认升级到 `release:ready`、full visual 或 real gate。

## 8. 非目标

本次不做：

- 不引入新的 notebook task 产品类型。
- 不改变权限模型，不新增未定义权限点。
- 不做文件级策略、Chat/Notebook 独立配额。
- 不重写 SSE 协议整体，只做事件分类、展示降噪和必要的适配。
- 不把 trace 设计成完整 observability 产品。
- 不新增 terminal 多窗口/分屏能力。
- 不改变后端作为 `run_state` / terminal session 状态唯一权威的原则。
- 不把本 handoff plan 当作最终 UXUI 规范或产品 contract。
- 不用角色名做门禁。
- 不引入设计系统外的新视觉语言。

## 9. 风险与验收标准

### 9.1 主要风险

风险 1：移除顶部执行状态后，用户短期找不到运行状态。  
缓解：AI 气泡 footer 必须足够稳定、清晰，并在 active run 创建后自动出现在可见区域或合理位置。

风险 2：final answer 等待 trace 可能造成感知延迟。  
缓解：允许 final answer slot 就绪但在 trace 后稳定展示；trace 缺失时明确走 no-trace 分支，不无限等待。

风险 3：隐藏可恢复噪声会降低排障便利性。  
缓解：数据层保留 diagnostic，默认 UI 隐藏，debug/details 或日志仍可定位。

风险 4：用时 tick 造成性能或 focus 回归。  
缓解：tick 局部化，避免重建 terminal input 和大列表。

风险 5：单 tab close 与 end-all 统一时暴露既有 API contract 或后端状态不一致。  
缓解：Phase 0 先确认当前 API contract，再以前端 focused tests 和 backend-real diagnostics 锁定当前真相，避免在本文中隐性定义新后端 contract。

风险 6：SSE reconnect 与 watchdog 降噪后，真实断连反馈变慢。  
缓解：区分短暂恢复窗口与不可恢复阈值；超过阈值必须展示用户级错误。

风险 7：`activeRunView` 未统一落地时，AI conversation 下游继续拼装状态。  
缓解：`TaskPage` 生成并传递 AI-run-only view model，组件测试覆盖下游消费边界。

风险 8：terminal close 仍走 WebSocket 成功回调。  
缓解：在当前 API contract 下，单 tab close 以 `closeTerminalSession` / REST DELETE + list/hydrate 为权威，WebSocket close 只作为 best-effort 内部细节。

风险 9：用户可见 trace 完整展示与安全边界冲突。  
缓解：只展示经过现有 sanitization/redaction 的用户可见 AI text/progress trace；内部 reasoning/thinking 和敏感 payload 不进入 UI。受 retention、payload size 或 performance 限制时展示 truncation marker、load more 或 diagnostic 入口。

风险 10：`activeRunView` 与 terminal session lifecycle 再次混成一个 view model。  
缓解：`TaskPage` 可以汇总 `activeRunView` 和 `terminalSessionsView`，但分别下传；terminal tab/panel 以后端 truth 和 terminal 独立状态为准。

### 9.2 产品验收标准

- 顶部不再展示 active run 执行状态。
- active AI 气泡 footer 展示运行状态、用时、取消入口和必要的 reconnect/canceling 状态。
- 取消按钮在 AI 气泡内，且对象明确。
- 用时在运行中持续更新，结束后冻结。
- 同一 run 内 trace 先于 final answer 展示。
- running footer 固定在气泡底部，结束后消失或收敛为最终 duration/copy。
- 用户可见 AI text/progress trace 可完整查看，或在受限制时看到 truncation marker、load more 或 diagnostic 入口。
- trace 不展示内部 reasoning/thinking，不泄露未经现有 sanitization/redaction 的敏感 payload。
- 可恢复 LLM/trace 噪声默认隐藏。
- ping/watchdog/reconnect/gap-fill/reconcile success 不污染 AI 正文或用户级 trace。
- 命名 `event: ping` 或统一 heartbeat 能正确更新 `realtimeHealth`。
- terminal 输入焦点由 user intent token 驱动，在常见 stream/update/tab 切换场景下稳定。
- 单 tab close 与 end-all 均以后端 terminal session 状态为权威；当前 API contract 下，单 tab close 通过 `closeTerminalSession` / REST DELETE + list/hydrate 收敛。

### 9.3 工程验收标准

- 生产代码不新增 `any`。
- 新增文案纳入 i18n，key 使用 snake_case。
- URL 参数和权限相关逻辑不因本次 UI 改动绕过既有校验。
- focused unit/component/integration/e2e/visual 覆盖本次主链。
- 默认不跑 `release:ready`、full visual、real gate；按风险完成 `npm run verify -- --goal=pr --run` 或记录为什么暂不升级。
- 若触及 runner/skill/runtime 相关主链，完成对应 `test:skills:*` 或 notebook/chat runner diagnostics。

## 10. Handoff Checklist

接手实现前：

- [ ] 确认当前 notebook task active run 的数据来源和 run id 绑定方式。
- [ ] 确认 `activeRunView` 由 `TaskPage` 生成并只向 AI conversation 下游传递。
- [ ] 确认 `terminalSessionsView` 或 terminal 独立状态由 `TaskPage` 汇总后传给 terminal tab/panel。
- [ ] 确认顶部执行状态的组件入口和可移除范围。
- [ ] 确认 AI 气泡组件是否已有 footer slot 或需要扩展 compound component。
- [ ] 确认 cancel API/action 的权威 run id 来源。
- [ ] 确认 SSE 事件类型和当前 adapter/store 写入路径。
- [ ] 确认 `useTaskSSE` 是否监听后端每 15s 的命名 `event: ping`，并确认 mock/real heartbeat 语义一致。
- [ ] 确认 trace 与 final answer 当前排序规则。
- [ ] 确认 trace 进入 UI 前沿用现有 sanitization/redaction，不展示内部 reasoning/thinking 或敏感 payload。
- [ ] 确认 terminal tab/session state 的后端查询与 SSE 同步路径。
- [ ] 确认当前 terminal close API contract：single close 是否走 `closeTerminalSession` / REST DELETE + list/hydrate，end-all 是否复用同一权威收敛路径。
- [ ] 确认 terminal input focus 当前由哪个组件管理。
- [ ] 确认 terminal focus 是否已有 user intent token，或需要新增。
- [ ] 列出新增/修改 i18n key。

实现过程中：

- [ ] 先写或更新 `activeRunView`、`terminalSessionsView`、状态映射、事件分类、排序和 elapsed timer 的测试。
- [ ] 先修命名 ping / heartbeat 监听语义，再处理 reconnect 降噪。
- [ ] 再迁移顶部状态到 AI 气泡 footer。
- [ ] 再处理 trace-first 与 final answer after。
- [ ] 再隐藏 recoverable diagnostic 和 transport noise。
- [ ] 再用 user intent token 修 terminal focus。
- [ ] 最后统一 terminal single close 与 end-all 状态收敛，单 tab close 以当前 API contract 下的 `closeTerminalSession` / REST DELETE + list/hydrate 为准。
- [ ] 每个 slice 跑对应 focused test，避免一口气堆到最终门禁。

交付前：

- [ ] 顶部 active run 状态已移除。
- [ ] AI conversation 下游组件不再从 `streamingMessageId`、`latestAgentMessageId`、`task.run_state` 拼 active run。
- [ ] terminal tab/panel 不消费 `activeRunView` 判断 session lifecycle。
- [ ] AI 气泡 footer 的 running/canceling/reconnecting/completed/failed/canceled 状态可验证。
- [ ] cancel 位于 AI 气泡内并绑定当前 run。
- [ ] elapsed timer active 更新、run 终态冻结。
- [ ] trace-first final answer after 行为通过测试。
- [ ] 用户可见 AI text/progress trace 完整展示；受限制时有 truncation marker、load more 或 diagnostic 入口。
- [ ] trace 不展示内部 reasoning/thinking，不泄露未经 sanitization/redaction 的敏感 payload。
- [ ] recoverable LLM/trace 噪声默认隐藏。
- [ ] SSE ping/watchdog/reconnect/gap-fill/reconcile success 不进入用户正文。
- [ ] 命名 `event: ping` 或统一 heartbeat 语义有回归测试。
- [ ] terminal focus bug 有 user intent token 回归测试。
- [ ] single tab close 与 end-all 权威路径统一并有测试，WS-only / WebSocket `terminal.close` 不作为用户级成功依据。
- [ ] focused visual 场景通过或有明确 evidence。
- [ ] 阶段收口门禁结果已记录。
