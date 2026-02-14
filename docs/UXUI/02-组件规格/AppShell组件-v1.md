# App Shell：Topbar 与 Sidebar 组件规格 v1（可直接开发）

日期：2026-01-31  
目标：定义全局壳（App Shell）组件行为：Topbar、Sidebar、Mode Switcher、Breadcrumb（可选），保证全站一致。  

## 变更说明（2026-02-01）

- Sidebar：
  - 支持折叠/展开（展开 210px，折叠建议 72px）
  - Sidebar 本身不滚动（菜单项较少），只允许内容区滚动；折叠按钮必须始终可见
- Topbar：
  - 重新布局以避免 Logo 与 Workspace/Project 挤压：
    - 左：品牌（Logo）
    - 中：Workspace / Project（breadcrumb-like，下拉切换，文本截断）
    - 右：通知 + 用户菜单
  - 打开下拉菜单不应引起 topbar 宽度变化（避免 scroll-lock 造成 body padding 调整）

## 变更说明（2026-02-07）

- Sidebar 宽度收敛（空间密度优化）：
  - 展开宽度：`192px`
  - 折叠宽度：`72px`
  - 菜单项高度保持 `40px`，图标保持 `20px`，保证可读性不下降
- 页面空间利用策略：
  - Sidebar 继续保持“不滚动”，仅内容区滚动
  - Chat / Notebook 页面推荐沉浸式内容布局（减少外圈留白）

---

## 1) Topbar（全局）

左侧：
- Logo（点击回到当前 workspace 的 Project List）

中间：
- Workspace Switcher（见入口规格）
- Project Switcher（见入口规格）
- Mode Switcher：Chat / Notebook（在 project 内显示）

右侧：
- 全局 loading/connection 状态（可选：SSE/WS indicator）
- 用户菜单（Profile / API Keys(usk) / Language / Logout）

规则：
- workspace 未选择时隐藏 project switcher 与 mode switcher
- 不允许匿名：未登录时不渲染（直接跳 /login）
- Topbar 高度固定 56px（14 * 4px 基数），且不随下拉弹出产生布局抖动

---

## 2) Sidebar（project 内）
规则：
- 根据 token 权限可见性隐藏菜单项（例如缺少 `project:settings:manage` 时隐藏 Settings）
- 但深链访问时仍要显示“无权限”页（避免 404 迷惑）
- Sidebar 需要提供折叠/展开按钮：
  - 折叠态仅显示 icon（可用 tooltip 显示 label）
  - 展开态显示 icon + label
  - 折叠状态建议 localStorage 持久化（按设备，不跨用户）
- 宽度规范：
  - 展开：`192px`
  - 折叠：`72px`
- 滚动策略：
  - Sidebar 不滚动（内容少），只允许 main content 滚动
