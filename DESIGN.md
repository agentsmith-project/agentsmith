# AgentSmith UI Constitution

Status: `authoritative`
Last updated: 2026-04-11

`DESIGN.md` 是 AgentSmith 当前唯一的 UI 宪法与设计语言真相。

它只定义四类内容：
1. 视觉方向与气质
2. typography / color / spacing / surface 原则
3. 页面 chrome 与组件风格边界
4. 新 UI 改动的实现约束

它**不**定义：
- 产品对象和 IA 真相（看 `docs/contracts/product-terminology.md`）
- 路由与权限可见性（看 `src/lib/routes/project-route-policy-manifest.ts`）
- 工程门禁、visual lane、发布排演规则（看 `docs/current-engineering-governance-model.md` 与 `scripts/governance/*manifest.ts`）

`docs/UXUI/` 中的 active 文档只能补充模块交互规范与状态文案，不再定义平行视觉真相。

## 1. Design Direction

AgentSmith 的界面要传达的是：**企业控制面的冷静、编辑性、克制和精度**，而不是消费级玩具感，也不是过度企业化的沉重后台。

当前正式方向：
- 温暖、克制、偏编辑化的基调
- 大面积留白与轻微纹理感，而不是高饱和大色块
- 强调层次、节奏和阅读感，而不是“把所有能力同时喊出来”
- 让用户感觉系统可靠、审慎、可治理，而不是炫技

禁止回退到：
- 默认蓝白后台模板感
- 过度紫色 / 赛博霓虹 / 深色玻璃拟态
- 纯工具面板堆砌，缺少视觉主次
- 为了“现代”而滥用圆角、阴影、渐变、动画

## 2. Core Principles

1. **Calm over noise**
   - 页面应该让用户先读懂结构，再执行动作。
   - 视觉重点必须极少，主行动、状态风险、信息层级不能同时争抢注意力。

2. **Editorial over dashboard clutter**
   - 内容块要像经过编排的版面，而不是无差别的面板墙。
   - 标题、辅助说明、元信息、操作区必须有明确阅读顺序。

3. **Warm precision**
   - 色彩与材质可以有温度，但不能失去控制面该有的严谨度。
   - 温暖来自色温、字型、边框与留白，不来自装饰性噪音。

4. **Consistency through restraint**
   - 组件的一致性来自“少量稳定规则”，不是来自所有页面长得一模一样。
   - 新页面要先复用既有层次、排版与组件边界，再决定是否需要新样式。

5. **Design follows product truth**
   - 设计不能掩盖对象模型、权限边界和运行时真相。
   - 一个动作或对象若产品上不成立，设计不能通过视觉包装把它“做得像成立”。

## 3. Visual Language

### 3.1 Palette

当前正式方向是**warm neutral base + warm near-black text + restrained orange accent**。

基线角色：
- 背景：warm off-white / warm cream，而不是纯白
- 主文本：warm near-black，而不是纯黑或冷灰
- 次级表面：比背景略深的米灰 / 暖灰层次
- 边框：低对比、温暖、偏有机，而不是冷硬分割线
- 强调色：偏橙红的品牌强调色，只用于重要交互与品牌瞬间
- 成功 / 错误：都应带暖调，避免医院式冷绿 / 冷红

使用约束：
- accent 不得变成全站泛蓝链接色的替代品
- 不允许把品牌强调色涂满整个页面或整块大面板
- 背景层次优先靠 surface 温差与边界处理表达，而不是靠夸张阴影

### 3.2 Surfaces and Borders

- 页面背景应保持轻、平、稳
- 卡片和面板要通过**边界 + 微弱层次差**建立结构
- 边框优先温和、低对比、连续，不要冷白硬线
- 大面积浮层可以使用更明显的 elevation，但页面主体不要处处漂浮

### 3.3 Density and Space

- 密度要支持控制面高信息量，但不能拥挤
- 间距优先用稳定节奏，而不是局部临时魔法值
- 模块之间靠编排和节奏分层，不靠到处塞 divider
- 页面默认优先“清楚可读”，而不是“尽量塞满”

## 4. Typography

### 4.1 Font roles

- Display / hero / editorial heading：优先使用 `CursorGothic` 风格的压缩展示字体
- Body / longform / explanatory copy：优先使用 `jjannon` 风格的 serif 或高质量正文 fallback
- Code / terminal / technical metadata：优先使用 `berkeleyMono` 风格的 monospace
- UI 系统性文本：允许使用系统 sans 作为稳定 fallback

### 4.2 Rules

- 新表面不要默认退回通用 `Inter + 蓝链` 的普通 SaaS 味道
- 展示标题应有更强的个性和压缩感，但不能牺牲可读性
- Body copy 的职责是解释、陪伴和降心智，不是制造营销感
- 技术信息和元信息必须能一眼区分于正文

## 5. App Chrome

### 5.1 Sidebar

- Sidebar 是跨产品面的导航容器，不是装饰面板
- 视觉上应安静、稳定、可折叠
- 激活态要明确，但不要像 CTA 按钮一样大喊
- 图标、label、section grouping 要有清楚层级

### 5.2 Topbar

- Topbar 主要承载上下文切换、身份信息、少量全局操作
- 不应堆叠过多状态徽标和营销式视觉
- 切换器、面包屑、上下文标签要强调“位置与归属”，不是按钮感

### 5.3 Overview and Governance Pages

- `Overview` 是 readiness / health / recent state 页面，不是第二导航页
- 治理页应该像审慎的配置与证据面板，而不是 CMS 式工具箱
- 操作区要和解释区分离，避免“点错就变更”式高风险布局

## 6. Components

### 6.1 Buttons and Links

- 主要按钮只在真正主要的动作上使用
- 次要动作优先使用 quiet / secondary 变体
- 文字链接可以使用 accent，但不能把整个页面做成一片亮色跳点

### 6.2 Dialogs and Side Panels

- 简单确认 / 轻量输入：Dialog
- 多字段 / 多步骤 / 需要沉浸式配置：Side Panel / Sheet
- 头部说明、正文编辑区、底部操作栏要保持清晰三段式结构

### 6.3 Tables and Lists

- 列表要优先支持扫描、比对和批量动作
- 批量操作栏应尽量保持布局稳定，不得引发布局跳变
- 状态、badge、元信息应服务于扫描效率，而不是装饰

### 6.4 Forms

- 默认让用户理解“这是在改什么对象、改动会影响什么”
- 输入控件优先简单、宽松、稳定
- 表单帮助文案必须帮助降低理解成本，而不是重复 label

### 6.5 Charts and Usage Surfaces

- Usage / Audit 视图优先可读、可比较、可解释
- 时间和数值视图应稳定、低噪声
- 不要为了“数据感”引入过度装饰和复杂配色

## 7. Motion

- 动画只用来表达层级变化、状态反馈和进入/退出
- 时间应短、平滑、可预期
- 不做炫技型过场、不做连续微动画噪音
- hover/focus 反馈优先清晰而不是华丽

## 8. Implementation Rules

1. 新增或重构 UI 时，先判断：
   - 是否符合 `DESIGN.md`
   - 是否复用了现有 tokens / variants / layout primitives
   - 是否需要同步更新 `docs/UXUI/` 中的交互规范

2. 不允许在组件局部发明新的视觉哲学：
   - 新颜色角色
   - 新密度系统
   - 新阴影系统
   - 与整体语言冲突的特殊圆角/边框/渐变

3. 如果当前实现 token 与本宪法有差距：
   - 以本宪法作为收敛方向
   - 但单次改动应分层推进，不要求一次性重画全站

4. 任何新的视觉规范文档都必须：
   - 明确 `Depends on: DESIGN.md`
   - 明确只定义 interaction / module behavior
   - 不得再次定义全局 palette / typography / shell truth

## 9. Relationship To Other Current Docs

- 产品对象与 IA：`docs/contracts/product-terminology.md`
- 当前工程治理模型：`docs/current-engineering-governance-model.md`
- active UX/UI interaction specs：`docs/UXUI/`
- visual evidence policy：`docs/testing/visual-baseline-policy-v1.md`

如果发生冲突，优先级如下：
1. 产品对象与 IA 边界：以 terminology contract 为准
2. 全局 UI 语言与风格边界：以 `DESIGN.md` 为准
3. 具体模块交互细节：以对应 active UX/UI spec 为准
4. visual 验证执行与证据规则：以 testing policy / governance model 为准
