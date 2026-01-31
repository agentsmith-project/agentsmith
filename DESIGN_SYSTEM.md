# Design System Reference

**重要：所有 UI 设计必须严格遵循以下视觉设计系统文档**

## 权威设计文档

- **视觉设计系统**: `/home/percy/works/mygithub/mbos-server/文档/UXUI/2026-01-31-视觉设计系统-v1.md`

## 关键设计原则

1. **内容优先 (Content-First)**: 界面极度克制，将视觉重心完全让给内容
2. **暗色调沉浸感 (Dark Mode Immersion)**: 使用"软暗色"而非纯黑
3. **功能性极简 (Functional Minimalism)**: 所有线条、背景色、阴影都为"区分功能区域/状态"服务
4. **三栏工作区**: Sources / Canvas / Context 是主体验
5. **状态可解释**: queued/processing/managed/backoff 等必须一眼看懂
6. **可复制性**: ID、error_code、request_id 一键复制

## CSS Tokens（核心）

```css
/* Surfaces - Dark mode primary */
--bg-base: #191919;           /* App background */
--bg-panel: #1f1f1f;          /* Navigation, cards */
--bg-surface: #252525;        /* Dialogs, inputs */
--bg-hover: #2a2a2a;          /* Hover, selected */

/* Typography */
--text-primary: #ffffff;
--text-secondary: #c6c6c9;
--text-tertiary: #8c8c8c;

/* Accents */
--accent-blue: #87a9ff;
--accent-gradient: linear-gradient(90deg, #4fa0ff, #3186ff);

/* Functional */
--color-success: #3ddb85;     /* completed/ready/enabled/online */
--color-info: #4fa0ff;        /* running/started/managed */
--color-error: #ffb4ab;
--color-warning: #ffb95c;

/* Radius */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 24px;

/* Spacing - 4px multiples */
--spacing-xs: 8px;
--spacing-sm: 16px;
--spacing-md: 24px;
--spacing-lg: 32px;
```

## 字体规范

- 英文/数字: `Inter` 或 `Roboto`
- 中文: `Noto Sans SC`
- 等宽 (ID/error_code): `JetBrains Mono`
- 正文: 16px
- 密集表格: 13-14px

## 布局规范

- **三栏布局**: 左栏 240px / 中栏 Flex / 右栏 300px
- **列表项高度**: 约 40px
- **间距**: Padding 16px 或 24px，列表项 gap 8px，模块 gap 24px
- **尽量不用分割线**: 优先用间距与背景微差分区

## 组件规范

- **卡片**: 背景 #1f1f1f/#252525，圆角 12px 或 16px
- **输入区**: 大圆角胶囊 24px，背景 #2a2a2a
- **按钮**: 主按钮圆角 8px，图标按钮透明背景
- **Focus**: 所有输入/按钮必须有可见 focus ring
