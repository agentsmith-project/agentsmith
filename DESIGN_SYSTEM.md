# Frontend Design System (MBOS v1)

唯一权威文档：`文档/UXUI/2026-01-31-视觉设计系统-v1.md`

本文件是“代码侧落地摘要”，用于帮助开发者把 UI 设计系统稳定落到 Tailwind + CSS tokens 上。

## Tokens（source of truth）

Tokens 定义在 `mbos_frontend/src/app/globals.css`（使用 RGB triplets，支持 alpha）。

```css
--bg-base: 20 19 19;          /* #141313 */
--bg-sidebar: 25 25 25;       /* #191919 */
--bg-surface: 30 31 32;       /* #1E1F20 */
--bg-surface-high: 40 42 44;  /* #282A2C */
--bg-hover: 50 50 50;         /* #323232 */

--border: 51 51 51;           /* #333333 */
--border-subtle: 38 38 38;    /* #262626 */

--text-strong: 255 255 255;   /* #FFFFFF */
--text-primary: 212 212 212;  /* #D4D4D4 */
--text-tertiary: 140 140 140; /* #8C8C8C */
--icon-default: 196 198 207;  /* #C4C6CF */

--accent: 135 169 255;        /* #87A9FF */
--ai-gradient: linear-gradient(90deg, #B1C5FF, #076EFF);
--success: 61 219 133;        /* #3DDB85 */
--error: 244 67 54;           /* #F44336 */
```

## Tailwind token classes

`mbos_frontend/tailwind.config.js` 映射到以下常用类：

- 背景：`bg-background` / `bg-panel` / `bg-surface` / `bg-surface-high` / `bg-hover`
- 文本：`text-foreground`（白）/ `text-primary` / `text-tertiary` / `text-icon-default`
- 语义：`text-accent` / `text-success` / `text-error` / `text-warning`
- 边框：`border-border` / `border-subtle`
- 浮层阴影（仅 Dropdown/Dialog/Toast）：`shadow-float`

## Typography

- 默认正文：14px（已在 `globals.css` 固定）
- 标题：24px / 16px（页面标题/卡片标题）
- 字体：Inter + Noto Sans SC；等宽：JetBrains Mono（通过 `next/font` 注入变量）

## Layout

- Sidebar 固定宽度：260px
- Sidebar item 高度：40px
- 间距基数：4px（常用 8/12/16/24/32）

## Style guardrails

- 不使用高饱和色块按钮（蓝色只用于 link / icon / highlight）
- 渐变只用于 AI 标识（例如 Logo/Avatar 等“AI 特征”位置）
- 阴影极少使用：只在浮层组件出现
