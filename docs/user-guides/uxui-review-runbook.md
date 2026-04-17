# UX/UI 审查运行手册

这份运行手册用于 AgentSmith 的重复性 UX/UI 审查。

它的目标是把“真实后端行为验证 + 人工界面审查 + 设计规范对齐”收敛成一套长期可复用的方法，既适用于当前页面，也适用于未来新增的页面、功能线、对话框和工作流状态。

它不做下面这些事：
- 不发明新的 gate、lane、story 或 release truth
- 不把 `gate:default` 当成 full visual 或 backend-real release verdict
- 不把 redirect / callback / 兼容入口都算成“逐页视觉审查完成”
- 不用“页面文件数量”代替真实的产品界面覆盖

## 1. 当前真相源

执行 UX/UI 审查时，按下面顺序理解真相：

1. [DESIGN.md](../../DESIGN.md)
2. [站点页面配方与壳层规范 v1](../UXUI/00-设计系统/站点页面配方与壳层规范-v1.md)
3. [视觉基线审查与交付规范 v1](../UXUI/00-设计系统/视觉基线审查与交付规范-v1.md)
4. [状态与文案规范 v1](../UXUI/00-设计系统/状态与文案规范-v1.md)
5. [对话框与侧边栏使用规范 v1](../UXUI/00-设计系统/对话框与侧边栏使用规范-v1.md)
6. [Verification Campaigns v1](../testing/verification-campaigns-v1.md)
7. [Visual Baseline Policy v1](../testing/visual-baseline-policy-v1.md)
8. [Test & Evidence Directory Model](./test-and-evidence-directory-model.md)
9. `e2e/stories/backend-real/*.story.md` 与 `e2e/stories/mock-lane/*.story.md`

补充说明：
- 视觉风格和实现偏好看 `DESIGN.md`
- 页面语法、recipe family 和 shell 边界看 `docs/UXUI/`
- 自动化验证路径、evidence owner 和 machine-readable evidence 看 testing docs
- 真实后端下的核心视觉巡检基线，优先看 [`e2e/stories/backend-real/real-backend-visual-review.story.md`](../../e2e/stories/backend-real/real-backend-visual-review.story.md)

## 2. 什么时候使用这份运行手册

适用场景：
- 新页面、新功能线、新 overlay 上线前，需要做人工 UX/UI 审查
- 大范围 UI 重构后，需要确认视觉语言没有分叉
- 发布前，需要在 automated verdict 之外补一轮人工界面结论
- 功能虽然通过了，但团队仍要确认“是否真的符合 AgentSmith 的设计语言和产品交互标准”

不适用场景：
- 只做类型、contract、unit、integration 排查
- 只想跑 mock 回归，不关心真实后端行为
- 只看某个 callback 是否跳转成功，不关心持久界面质量

## 3. 先选执行模式

不要直接说“跑 real lane”。先明确这次审查属于哪种模式。

### `ui_only`

适用：
- 只改前端 UI、文案、交互细节
- 不需要真实后端数据真相

建议路径：
- 先跑最小 targeted checks
- 需要 full visual 结论时，再跑：

```bash
npm run lane:visual
```

说明：
- `lane:visual` 是唯一 full visual owner
- 它不等于真实后端审查

### `local_manual`

适用：
- 需要真实本地 API / Web / Notebook / Terminal / runner / files 行为
- 需要做日常人工 UAT 和人工 UX/UI 巡检

建议路径：

```bash
make substrate-up
make substrate-reseed
make local-manual-up
```

若本次范围触达 notebook/files/internal runner，再补：

```bash
make local-manual-seed-notebook
```

如果要生成 standalone 真实后端视觉审查产物，可执行：

```bash
npm run test:visual:backend-real:review
```

说明：
- 这是人工审查最常用的路径
- 它适合反复执行，不要求每次都走完整 release campaign

### `release_grade`

适用：
- 发布前收口
- 跨域大改动后，需要 release-grade 结论

建议路径：

```bash
npm run test:release:precheck
npm run release:campaign:full
```

说明：
- `release:campaign:full` 会编排 full visual、backend-real release evidence 和 aggregate verdict
- 人工 UX/UI 审查仍然需要单独记录，不能被自动化 verdict 替代

## 4. 审查单位与范围模型

### 4.1 canonical 审查单位

UX/UI 审查的最小单位不是“一个 `page.tsx` 文件”，而是：

```text
审查分组 × scene/route/overlay × state × theme
```

必须区分两层概念：
- `审查分组`：用于盘点范围和组织审查任务
- `recipe family`：用于判断页面语法是否正确

### 4.2 默认审查分组

未来新增页面或功能线时，优先归到现有分组，而不是发明新的审查分类。

#### A. Entry & Bootstrap

包含：
- system login
- system workspaces
- system workspace create
- system info
- workspace selector
- join / invite accept
- desktop auth request / complete
- workspace login

#### B. Workspace Surfaces

包含：
- workspace home / projects entry
- workspace settings
- workspace context
- workspace integrations / connections
- 其他工作区级连续设置面

#### C. User Self-Service

包含：
- user profile
- api keys
- third-party accounts

#### D. Project Work Surfaces

包含：
- overview
- chat
- notebook
- notebook task detail
- files
- use guide
- 其他沉浸式或主工作面

#### E. Project Governance & Ops

包含：
- endpoints
- credentials
- agents
- members
- resource policy
- audit
- usage
- settings
- alerts
- context / my-context
- 其他 project 级治理与运维面

#### F. Redirect / Callback / Preview Pack

包含：
- redirect page
- login callback
- third-party callback
- preview / app-shell demo

规则：
- 这组默认只做 smoke 和路由真相检查
- 不计入“逐页视觉审查完成率”
- 只有当 callback 本身承载持久可审的界面时，才升级为正式 scene

### 4.3 每个 route 还必须映射到一个 recipe family

每个正式页面或 overlay，都必须映射到 `docs/UXUI/00-设计系统/站点页面配方与壳层规范-v1.md` 定义的 recipe family：

- `public_auth_single`
- `public_auth_split`
- `work_surface_standard`
- `work_surface_immersive`
- `settings_sheet`
- `governance_table_detail`
- `system_admin_detail`
- `overlay_dialog`
- `overlay_sheet`

判定规则：
- 如果 10 秒内说不清一个页面属于哪个 recipe family，先记录为 `recipe drift`
- 不允许因为新增对象或新业务线，就页面私有发明第二套壳层语法

## 5. 必审状态与最小覆盖标准

### 5.1 每个正式 scene 的最低覆盖

默认至少审 2 个状态：

1. `default ready`
2. `一个主交互态或详情态`

高风险页面再加第 3 个状态：

1. `empty / zero-data`
2. `error / recovery`
3. `permission denied`

### 5.2 长任务与恢复链路

下列页面必须额外检查长任务和恢复状态：
- chat
- notebook
- files
- 任何需要 SSE、streaming、task execution 的界面

至少确认：
- `queued`
- `started`
- `completed`
- `cancelled` 或可取消语义
- `error`
- `Disconnected. Reconnecting…`
- `Recovered`

### 5.3 overlay 是一等审查对象

以下对象不能只算“附属弹层”，需要独立记录：
- dialog
- sheet
- drawer
- detail panel
- trace panel

规则：
- 1 到 2 个输入或轻确认，用 `overlay_dialog`
- 3 个及以上字段、分组配置、ACL、复杂表单、要对照主列表的编辑面，用 `overlay_sheet`

### 5.4 theme 与视口

默认要求：
- `light` 必审
- `dark` 必审
- desktop 基线使用 `1920x1080`

补充要求：
- 如果本次变更涉及文案、排版、宽度、信息密度，至少对 `zh-CN` 做 spot-check
- mobile 或特定窄宽断点不是本手册默认范围；需要时单独升级 scope

## 6. 执行流程

### 6.1 第一步：定义审查范围

先确定：
- 本次改动触达哪些 route / module / story
- 对应属于哪个审查分组
- 每个 scene 的 recipe family 是什么
- 哪些状态属于必审状态
- 哪些页面只是 smoke-only 的 redirect / callback

建议把范围写成：

```text
审查分组 -> route/overlay -> state -> theme
```

### 6.2 第二步：跑官方验证路径

根据模式选择入口：

- `ui_only`
  - 最小 targeted checks
  - 需要 full visual 时：`npm run lane:visual`
- `local_manual`
  - `make substrate-up`
  - `make substrate-reseed`
  - `make local-manual-up`
  - 需要 notebook/files 真实链路时：`make local-manual-seed-notebook`
  - 需要 standalone 真实界面产物时：`npm run test:visual:backend-real:review`
- `release_grade`
  - `npm run test:release:precheck`
  - `npm run release:campaign:full`

注意：
- `gate:default` 不能代替 `lane:visual`
- `lane:visual` 不能代替 `gate:release`
- `command passed` 不能代替 evidence completeness

### 6.3 第三步：收集证据

至少确认下面的证据存在并可读：

- mock full visual：
  - `e2e/__screenshots__/`
- standalone 真实后端人工审查：
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces/.../review.md`
- release campaign：
  - `artifacts/release-runs/<campaign-run-id>/lane-visual/...`
  - `artifacts/release-runs/<campaign-run-id>/gate-release/backend-real-visual/...`

如果缺少 `result.json`、review artifact、`visual_scene_catalog` 或 `ux_trace_bundle`，本次结论不能直接记为通过。

### 6.4 第四步：逐 scene 做人工审查

每个 scene 都按下面顺序检查：

1. 先确认 route 和 recipe family
2. 再看截图或实机渲染
3. 再看 light / dark parity
4. 再对照 `DESIGN.md`、站点页面配方和状态规范
5. 最后给出 `已足够好`、`建议改进` 或 `阻塞审查`

## 7. 人工审查清单

### 7.1 页面语法与壳层

必须确认：
- 这页明确属于一个 recipe family
- 没有 page-local shell 或第二层 page wrapper
- shell 比内容更轻
- 没有双主栏、双 header、过亮工具条、summary strip、chooser card stack

### 7.2 第一眼任务感

必须确认：
- 第一眼像安静工作面，不像 dashboard 或 marketing page
- 用户能在 3 到 5 秒内看清主任务
- 主动作清楚，但不过分抢眼

### 7.3 结构与表面

必须确认：
- 层级主要靠 spacing、type rhythm、divider、轻 surface 建立
- 不靠卡片墙、重阴影、重渐变、发光背景建立结构
- `settings` 是连续 section + divider，不是 panel stack
- `governance` 有 dominant table / list，不是用摘要卡代替主列表

### 7.4 CTA 与动作层级

必须确认：
- 每个 header cluster 只有 1 个 primary CTA
- 可见 secondary action 最多 2 个
- primary CTA 才能用更强的 accent fill
- empty / recovery CTA 指向真实可达的下一步

### 7.5 状态完整性

必须确认：
- loading 有 skeleton 或细粒度 spinner
- empty 解释“为什么空”并给下一步 CTA
- error 有稳定标识和建议动作
- 403 区分“未加入”和“已加入但无权限点”
- 长任务和恢复链路对用户可感知

### 7.6 overlay 选择是否正确

必须确认：
- 轻量确认和 1 到 2 输入用 dialog
- 复杂创建 / 编辑 / ACL / 多字段配置用 sheet
- sheet 采用 header / content / footer 三段式

### 7.7 light / dark parity

必须确认：
- light / dark 拓扑一致
- 控制位置一致
- 信息顺序一致
- dark mode 仍是温暖近黑，不是发亮 overlay 或玻璃浮层

### 7.8 文案与产品语义

必须确认：
- 文案使用当前正式对象名
- 没有把工程分层词误写成产品能力词
- 文案纳入正式 i18n namespace
- 中文和英文都没有因为长度或语义漂移破坏布局或理解

## 8. 什么时候可以判定“已足够好”

只有同时满足下面条件，才能记为 `已足够好，无需改动`：

- route 已落在正确 recipe family
- 页面没有额外 shell，也没有视觉语言分叉
- 第一眼能快速理解主任务、主动作和下一步
- shell 已轻于内容
- 结构主要靠排版、间距、divider 成立
- 关键状态完整，恢复路径真实可达
- light / dark 只有色调差异，没有构图漂移
- 文案准确、可翻译、对象命名统一

下面这些理由通常不能单独构成改动依据：
- “想让它更像 dashboard”
- “想让它更像 marketing page”
- “想做得更有设计感”
- “想再加一个更醒目的按钮”

## 9. 什么时候必须提出改进建议

出现下面任一情况，至少要记为 `建议改进`：

- recipe family 不清晰，或明显漂移
- 页面自己发明新的壳层语言
- shell 比内容更抢眼
- 大量 bordered card、summary strip、chooser card stack 抢主任务
- `settings` 被做成 panel stack
- `governance` 没有 dominant table / list
- 复杂表单仍然用 dialog
- error 没稳定标识，empty 没解释和 CTA
- light / dark 布局漂移
- 文案误导对象边界、语义不清或未纳入 i18n

如果问题已经影响任务完成、权限理解、恢复路径或 evidence completeness，则记为 `阻塞审查`。

## 10. 建议优先级

为了让反复执行的审查结果可比较，所有建议都带优先级：

- `P0`
  - 阻断任务完成、权限理解、恢复路径或 release sign-off
- `P1`
  - 明显影响效率、判断、可发现性，或已构成 recipe drift
- `P2`
  - 不阻断任务，但会持续增加认知负担或破坏一致性
- `P3`
  - 纯打磨项，不影响当前放行

## 11. 标准输出模板

每个 scene 都建议按下面模板记录：

```md
## <审查分组> / <scene 名称>

- route:
- overlay:
- state:
- theme:
- recipe_family:
- story_or_code_ref:
- evidence:
- verdict: 已足够好 | 建议改进 | 阻塞审查
- priority:
- reason:
- suggestion:
```

最终汇总结论建议只保留三类：

- `已足够好，无需改动`
- `建议改进`
- `阻塞审查`

规则：
- 如果判定“已足够好”，必须写清楚为什么不改更合理
- 如果判定“建议改进”，必须说明问题、影响、建议和理由
- 如果判定“阻塞审查”，必须说明阻塞点是视觉问题、交互问题、状态问题，还是 evidence 缺失

## 12. 新页面或新功能线的接入规则

未来新增页面或功能线时，按下面步骤接入这套手册：

1. 先把新 route 归到现有审查分组
2. 再把它映射到一个 site-wide recipe family
3. 定义至少一个 `default ready` scene
4. 再定义一个主交互态或详情态
5. 如果页面高风险，再补 `empty / error / permission denied`
6. 如果它只是 redirect / callback，默认只做 smoke，不进入正式视觉完成率
7. 如果它引入了新的持久工作面或治理面，再补充到 story 和 review inventory

只有在下面情况下，才应该新增新的审查分组：
- 新对象家族已经无法归入现有分组
- 它代表新的持续性产品面，而不是现有页面的变体

不要因为下面原因新增分组：
- 只是换了布局密度
- 只是多了一个 tab
- 只是多了一个 dialog / sheet
- 只是多了一条 callback 路由

## 13. 与其他运行手册的关系

这份手册和下面文档配合使用：

- [Local Runtime Flows](./local-runtime-flows.md)
  - 真实本地环境怎么拉起
- [Release Readiness Checklist](./release-readiness-checklist.md)
  - release-grade 验收怎么给最终 verdict
- [Verification Campaigns v1](../testing/verification-campaigns-v1.md)
  - gate / lane / campaign / evidence owner 怎么分层
- [Test & Evidence Directory Model](./test-and-evidence-directory-model.md)
  - 证据该去哪里找

如果目标是“做一次可复验、可追溯、可比较的 UX/UI 审查”，应先用这份手册确定范围和审查方法，再按 `local_manual` 或 `release_grade` 入口执行。

补充：
- 如果你需要一份可直接复制填写的记录格式，使用 [UX/UI 审查记录模板](./uxui-review-record-template.md)
