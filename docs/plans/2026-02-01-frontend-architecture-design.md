# MBOS Frontend v1 架构设计

日期：2026-02-01
版本：v1
状态：设计阶段

---

## 1. 项目概述

### 1.1 目标
从头开发 MBOS Frontend v1，完全符合验收检查单要求的功能点和交付要求。

### 1.2 技术栈
- **框架**: Next.js 15 (App Router) + TypeScript
- **UI**: TailwindCSS + shadcn/ui
- **图标**: Lucide React
- **i18n**: next-intl (zh-CN / en-US)
- **状态管理**: Zustand
- **表单**: React Hook Form + Zod
- **API Mocking**: MSW (Mock Service Worker)
- **HTTP Client**: fetch API with typed wrappers
- **组件文档**: Storybook (用于 UI 组件展示和评审)

### 1.4 设计规范约束

**⚠️ 重要：所有 UI 设计必须严格遵循**
- 视觉设计系统文档: `/home/percy/works/mygithub/mbos-server/文档/UXUI/2026-01-31-视觉设计系统-v1.md`
- 设计文档位置必须记录在项目中，随时参考

### 1.5 组件评审要求

**Storybook 集成:**
- 所有主要 UI 组件必须在 Storybook 中展示
- 组件开发前先创建 Story
- 通过 Storybook 进行设计评审
- 支持暗色主题预览
- 支持中英双语预览

**需要 Storybook 的组件:**
- App Shell: Topbar, Sidebar, ModeSwitcher
- 布局: 三栏工作区布局
- 表格: 数据密集表格组件
- 表单: Input, Select, Toggle, Textarea
- 按钮: Primary, Destructive, Icon buttons
- Cards: KPI 卡片, 信息卡片
- 对话框: Modal, Dialog, Drawer
- 状态: Badge, Status indicators
- Chat: Message bubble, Attachment chips
- Workbench: Thread 顶栏, Turn 面板
- Sources: 文件列表项, 上传区域

### 1.6 API 架构设计（易于替换）

**API 客户端分层设计:**

```typescript
// lib/api/client.ts - 核心客户端接口
interface ApiClient {
  setToken(token: string): void;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  // ...
}

// lib/api/adapters/msw-adapter.ts - MSW 实现
class MSWApiClient implements ApiClient {
  // MSW 特定实现
}

// lib/api/adapters/fetch-adapter.ts - 真实 API 实现
class FetchApiClient implements ApiClient {
  // 真实 fetch 实现
}

// lib/api/index.ts - 工厂函数
export function createApiClient(): ApiClient {
  if (process.env.NEXT_PUBLIC_USE_MSW === 'true') {
    return new MSWApiClient();
  }
  return new FetchApiClient();
}
```

**切换方式:**
- 环境变量: `NEXT_PUBLIC_USE_MSW=true/false`
- 或运行时配置
- Mock 数据 fixtures 与真实 API 响应结构一致

**类型定义作为契约:**
- `lib/api/types/` 中的类型定义是 API 契约
- MSW fixtures 必须符合这些类型
- 真实 API 返回也必须符合这些类型

### 1.3 开发模式
- **认证**: Mock 认证（开发阶段）
- **API**: MSW Mocks 优先，后续对接真实 backend

---

## 2. 设计哲学

- **Google AI Studio 风格**: 暗色沉浸式界面
- **三栏工作区布局**: Sources / Canvas / Context
- **数据密集**: 管理界面以表格 + 筛选 + 批量操作为核心
- **长任务友好**: SSE 断线恢复，后台执行，用户可关闭浏览器后恢复
- **状态可解释**: queued/processing/managed/backoff 等状态一目了然
- **可复制性**: ID、error_code、request_id 一键复制

---

## 3. 项目结构

```
mbos_frontend/
├── app/                      # Next.js App Router
│   ├── [locale]/            # i18n routing
│   │   ├── login/
│   │   ├── workspaces/
│   │   │   └── [workspace]/
│   │   │       └── projects/
│   │   │           ├── (app)/
│   │   │           │   ├── workbench/
│   │   │           │   ├── chat/
│   │   │           │   ├── agents/
│   │   │           │   ├── endpoints/
│   │   │           │   ├── members/
│   │   │           │   ├── audit/
│   │   │           │   ├── usage/
│   │   │           │   ├── overview/
│   │   │           │   └── settings/
│   │   │           └── layout.tsx
│   │   └── settings/
│   │       └── api-keys/
│   └── api/                  # Route handlers
├── components/
│   ├── app-shell/           # Topbar, Sidebar, ModeSwitcher
│   ├── sources/             # File upload/management
│   ├── chat/                # Chat workspace
│   ├── workbench/           # Workbench components
│   ├── agents/              # Agent management
│   ├── endpoints/           # Endpoint management
│   ├── members/             # Member management
│   ├── audit/               # Audit log viewer
│   ├── usage/               # Usage dashboard
│   ├── settings/            # Project settings
│   └── ui/                  # shadcn/ui components
├── lib/
│   ├── api/                 # API client + types
│   │   ├── client.ts
│   │   ├── types/
│   │   └── endpoints/
│   ├── hooks/               # Custom React hooks
│   ├── stores/              # Zustand stores
│   ├── i18n/                # i18n configuration
│   └── utils/               # Utilities
├── mocks/                   # MSW handlers
│   ├── handlers.ts
│   └── fixtures/
├── messages/                # i18n messages
│   ├── zh-CN.json
│   └── en-US.json
└── public/                  # Static assets
```

---

## 4. 路由结构

```
/login                                    # Login page
/workspaces/{workspace}/projects          # Project list
/workspaces/{workspace}/projects/{project}/
  ├── overview                            # Overview page
  ├── chat                                # Chat workspace
  ├── workbench                           # Workbench
  ├── agents                              # Agents list
  ├── agents/{agent}                      # Agent detail
  ├── agents/{agent}/keys                 # Agent keys
  ├── endpoints                           # Endpoints list
  ├── endpoints/{endpoint}                # Endpoint detail
  ├── members                             # Members list
  ├── members/join-requests               # Join requests
  ├── audit                               # Audit log
  ├── usage                               # Usage dashboard
  └── settings                            # Project settings
/settings/api-keys                        # User API keys (usk)
```

---

## 5. Design System

### 5.1 CSS Variables

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

### 5.2 字体
- 英文/数字: `Inter` 或 `Roboto`
- 中文: `Noto Sans SC`
- 等宽 (ID/error_code): `JetBrains Mono`
- 正文: 16px
- 密集表格: 13-14px

---

## 6. App Shell (Topbar + Sidebar)

### 6.1 Topbar

```
┌─────────────────────────────────────────────────────────────────┐
│ Logo | [Workspace ▼] [Project ▼] [Chat|Workbench] | 🔔 | 👤   │
└─────────────────────────────────────────────────────────────────┘
```

**组件:**
- `WorkspaceSwitcher`: 下拉选择 workspace
- `ProjectSwitcher`: 搜索/选择 project
- `ModeSwitcher`: Chat / Workbench 切换
- `UserMenu`: Profile, API Keys, Language, Logout

### 6.2 Sidebar

**固定项目:**
- Overview
- Chat
- Workbench
- ─────────────
- Agents
- Endpoints
- UserData
- ─────────────
- Members
- Audit
- Usage
- Settings (*) (owner/admin only)

**权限可见性:**
- 根据 project membership 隐藏/显示菜单项
- 深链访问时显示 "无权限" 页（非 404）

---

## 7. 三栏工作区布局

### 7.1 共享布局结构

```
┌────────┬────────────────────────┬─────────────┐
│        │                        │             │
│Sources │     Canvas              │  Context    │
│        │                        │             │
│ 240px  │     Flex               │   300px     │
│        │                        │             │
└────────┴────────────────────────┴─────────────┘
```

### 7.2 Chat vs Workbench

| 组件 | Chat | Workbench |
|------|------|-----------|
| Sources | My Sources (私有文件) | Thread Sources |
| Canvas | Chat messages (SSE) | Messages + Events |
| Context | Model 选择 + 参数 | Agent 选择 + Turn 状态 |

---

## 8. API Client

### 8.1 基础设施

```ts
// lib/api/client.ts
class ApiClient {
  private token: string | null = null;

  setToken(token: string) { ... }
  async request<T>(path: string, options?: RequestInit): Promise<T> { ... }
}
```

### 8.2 类型定义

```
lib/api/types/
├── workspace.ts
├── project.ts
├── agent.ts
├── endpoint.ts
├── chat.ts
├── workbench.ts
├── sources.ts
└── common.ts
```

### 8.3 API 调用目标
- 开发: `localhost:20000` (backend)
- 生产: edge (backend 不对公网暴露)

---

## 9. 状态管理 (Zustand)

```
lib/stores/
├── authStore.ts          # 用户, token, workspace/project 上下文
├── chatStore.ts          # Messages, streaming state
├── workbenchStore.ts     # agent_thread, turns, SSE
├── sourcesStore.ts       # 文件列表, 上传状态
└── uiStore.ts            # 全局 UI 状态
```

---

## 10. i18n 策略

### 10.1 键命名空间

```
nav.*           # 导航
common.*        # 通用按钮/状态
auth.*          # 认证
workspace.*     # Workspace
project.*       # Project
sources.*       # 文件管理
chat.*          # Chat
workbench.*     # Workbench
agents.*        # Agents
endpoints.*     # Endpoints
members.*       # Members
audit.*         # Audit
usage.*         # Usage
settings.*      # Settings
user_keys.*     # User API Keys
errors.*        # 错误提示
```

### 10.2 语言切换优先级
1. 用户 Profile (后端)
2. LocalStorage
3. 浏览器 `Accept-Language`

---

## 11. MSW Mocks 策略

### 11.1 组织结构

```
mocks/
├── handlers.ts            # 聚合所有 handlers
├── fixtures/              # 测试数据
│   ├── workspaces.ts
│   ├── projects.ts
│   ├── agents.ts
│   └── ...
├── auth.mock.ts
├── workspaces.mock.ts
├── projects.mock.ts
├── agents.mock.ts
├── chat.mock.ts
└── workbench.mock.ts      # SSE 流模拟
```

### 11.2 SSE Mocking
使用 `MockEventSource` 模拟 SSE 流，支持 `Last-Event-ID` 恢复。

---

## 12. 核心页面规格

### 12.1 Login
- 路由: `/login`
- 组件: Logo + LoginButton
- Mock 模式: 快速登录面板 (workspace + user 任意值)

### 12.2 Project List
- 路由: `/workspaces/{workspace}/projects`
- 组件: 表格 (名称, 可见性, 状态, 成员数, 操作)
- 操作: Create, Join, View

### 12.3 Overview
- 路由: `/workspaces/{workspace}/projects/{project}/overview`
- KPI Cards: Turns, Errors, Queued, Online Agents
- Recent Activity Timeline

---

## 13. Chat & Workbench 交互

### 13.1 Chat 发送流程
```
用户输入 → POST /openai/v1/chat/completions (stream=true)
         → SSE 流式输出
         → Message 拼接显示
         → 完成/错误
```

### 13.2 Workbench 发送流程
```
用户输入 → POST /agent_threads/{id}/turns
         → turn: queued → started → running
         → SSE 事件流
         → 完成/错误/取消
```

---

## 14. 开发任务拆解

### Phase 1: 项目基础 (1-2天)
- 初始化 Next.js + TailwindCSS + shadcn/ui
- 配置 TypeScript, ESLint
- 配置 next-intl
- 创建路由结构
- Design System tokens

### Phase 2: App Shell (1-2天)
- Topbar, Sidebar
- Workspace/Project Switcher
- Mode Switcher
- User Menu

### Phase 3: 认证与权限 (1-2天)
- Mock Login
- authStore
- 权限检查 hooks
- Protected Route

### Phase 4: API 客户端与 MSW (2-3天)
- API Client
- 类型定义
- MSW handlers
- 错误处理

### Phase 5: 简化 Overview (1天)
- 基本 KPI 卡片
- 项目入口导航

### Phase 6: Chat 功能 (3-4天)
- 三栏布局
- Sources 组件
- Model 选择器
- 消息流
- SSE 流式输出

### Phase 7: Workbench 功能 (4-5天)
- 三栏布局
- Thread 管理
- Agent 选择/Handoff
- Turn 面板
- SSE 事件流

### Phase 8: 管理页面 (5-7天)
- Overview 完整版
- Agents (List + Detail + Keys)
- Endpoints (List + ACL)
- Members + Join Requests
- Audit + Usage
- Settings (Config + Policy)
- User API Keys

### Phase 9: 完善与测试 (2-3天)
- i18n 文案补全
- 错误处理覆盖
- 响应式适配
- 无障碍 (a11y)
- 集成测试

---

## 15. 架构决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 前端框架 | Next.js 15 | 文档要求，App Router 更适合复杂路由 |
| UI 库 | shadcn/ui | 文档要求，可定制性强 |
| i18n | next-intl | Next.js 生态最佳选择 |
| 状态管理 | Zustand | 轻量，符合需求 |
| API Mock | MSW | 开发阶段优先，支持 SSE mock |
| 类型定义 | 前端独立 | 先灵活定义，后端稳定后再考虑共享 |

---

## 16. 详细页面布局规格

### 16.1 App Shell

**Topbar (高度 56px):**
```
┌─────────────────────────────────────────────────────────────────┐
│ Logo | Workspace[▼] Project[▼] [Chat|Workbench]      [👤▼]   │
└─────────────────────────────────────────────────────────────────┘
   32px    140px      160px      120px               40px
```

**Sidebar (宽度 240px):**
```
┌─────────────────┐
│ Overview        │  ← 菜单项高度 40px, padding 16px
│ Chat            │  ← Active: 背景 #2a2a2a + 左侧蓝色竖线
│ Workbench       │  ← Hover: 背景 #2a2a2a
│                 │  ← gap 24px (代替分割线)
│ Agents          │
│ Endpoints       │
│ UserData        │
│                 │
│ Members         │
│ Audit           │
│ Usage           │
│ Settings (*)    │
└─────────────────┘
```

### 16.2 Login 页面

**路由:** `/login`

**居中卡片:**
- 宽度: 400px
- 背景: `--bg-surface` (#252525)
- 圆角: 12px
- 内边距: 32px

**组件:**
- Logo (64px)
- Title (24px)
- Sign in 按钮（跳转 Keycloak）
- Mock 开发面板（仅开发模式）

### 16.3 Project List 页面

**路由:** `/workspaces/{workspace}/projects`

**主内容区 Padding:** 24px

**卡片背景:** `--bg-panel` (#1f1f1f), 圆角 12px

**表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| Name | flex (1fr) | 项目名称 + member 状态（次行） |
| Visibility | 120px | Public/Private 图标 + 文字 |
| Status | 100px | Badge (圆点 + 文字) |
| Members | 60px | 数字 |
| Actions | 80px | 图标按钮 |

**表格行高:** 40px (首行 48px)

### 16.4 Overview 页面

**路由:** `/workspaces/{workspace}/projects/{project}/overview`

**KPI Cards:**
- 4 列等宽, 高度 100px, gap 16px
- 背景: `--bg-panel` (#1f1f1f)
- 圆角: 12px
- 数值: 32px, --text-primary
- 趋势: 14px, 绿色(上升)/红色(下降)

**Recent Activity:**
- 图标: 24px
- 行高: 48px
- 可复制 ID
- 时间: 右对齐, --text-tertiary

### 16.5 Chat 页面

**路由:** `/workspaces/{workspace}/projects/{project}/chat`

**左栏 - Threads (240px):**
- 时间分组标题: 12px, --text-tertiary
- Thread 项: 高度 48px
- Hover: 背景 #2a2a2a
- Active: 背景 #2a2a2a + 左侧蓝色竖线

**中栏 - Chat Canvas (Flex):**
- 附件 chips: 高度 32px, 圆角 16px, 背景 #252525
- 消息流: 自动滚动
- 输入区: 高度 ~120px

**输入框:**
- 背景: `#2a2a2a`
- 圆角: 24px (胶囊形)
- 附件按钮: 20px, 图标
- 发送按钮: 40px, 圆形, 蓝色渐变

**右栏 - Context (300px):**
- Model 选择器: 下拉
- Parameters: Stream Toggle
- Endpoint Status: Badge + 信息
- Session 统计: Messages, Tokens

### 16.6 Workbench 页面

**路由:** `/workspaces/{workspace}/projects/{project}/workbench`

**左栏 - Sources (240px):**
- 标题行: 48px, 包含 [Upload] 按钮
- 搜索框: 40px
- 过滤器: 40px
- 文件项: 48px, 图标 + 文件名 + 状态图标
- 状态: [●] Ready, [⏱] Processing, [✗] Failed, [✓] Attached

**中栏 - Workbench Canvas (Flex):**
- Thread 顶栏: 56px, 标题 + 状态 + 操作按钮
- 消息/事件时间轴: 自动滚动
- User 消息: 右对齐气泡
- Agent 消息: 左对齐气泡
- Turn 事件: 系统提示条, 🔵/✅ 图标

**右栏 - Context (300px):**
- Current Agent: 名称 + 状态 + [Change Agent]
- Turn Status: Queued/Running 数值 + [Cancel Turn]
- Thread Info: ID (可复制) + 状态
- Attachments: chips 列表

### 16.7 Agents 页面

**路由:** `/workspaces/{workspace}/projects/{project}/agents`

**列表页表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| Name | flex (1fr) | 名称 + 描述（次行） |
| Mode | 120px | External / Internal 图标 |
| Presence | 120px | ●/○/⚙️ + 文字 |
| Status | 100px | ● Enabled / ○ Disabled |
| Sessions | 80px | 活跃/上限 |
| Actions | 60px | [⋮] 图标菜单 |

**详情页 Tabs:**
- General: 基本信息
- Keys: Agent Service Keys 管理
- Diagnostics: 诊断信息 (owner/admin only)
- Internal Config: 内部配置 (owner/admin only)

**Issue Key 对话框:**
- 显示明文 ask-***xxx（一次性）
- Copy 按钮
- 警告提示

### 16.8 Endpoints 页面

**路由:** `/workspaces/{workspace}/projects/{project}/endpoints`

**列表页表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| Name | flex (1fr) | 名称 + 描述 |
| Model | 120px | openai_model (可复制) |
| Type | 80px | OpenAI / Anthropic / Custom |
| Limits | 80px | 简写 (100/d) |
| Status | 80px | ● Active / ○ Disabled |
| Updated | 90px | 相对时间 |
| Actions | 60px | [⋮] 图标菜单 |

**详情页 Tabs:**
- General: 基本信息 + Limits + Credential
- ACL: Deny list 管理
- Usage Stats: 使用统计

**ACL 页面:**
- User + Reason + Added At + Actions
- Add Deny: User 选择 + Reason (必填)

### 16.9 Members 页面

**路由:** `/workspaces/{workspace}/projects/{project}/members`

**列表页表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| Member | flex (1fr) | 头像 + 名称 + 邮箱 |
| Role | 120px | Owner/Admin/Developer/User/Custom |
| Status | 100px | ● Active / ○ Blocked / ○ Removed |
| Joined | 90px | 相对时间 |
| Actions | 60px | [⋮] 图标菜单 |

**详情抽屉 (点击行):**
- User ID (可复制)
- Permissions JSON (可复制)
- Update Permissions / Block / Remove 按钮

**Join Requests 表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| User | flex (1fr) | 头像 + 名称 + 邮箱 |
| Reason | flex (1fr) | 申请原因 |
| Status | 100px | ⏱/✓/✗ + 文字 |
| Requested | 90px | 相对时间 |
| Actions | 100px | [✓] [×] / [View] |

### 16.10 Audit 页面

**路由:** `/workspaces/{workspace}/projects/{project}/audit`

**过滤器:**
- Time Range, Action, Actor Type, Result

**表格列 (紧凑):**
| 列 | 宽度 | 内容 |
|----|------|------|
| Time | 80px | 相对时间 |
| Action | 140px | 操作名称 |
| Actor | 100px | 用户/Agent + 类型 |
| EndUser | 100px | usr-***xxx (UUID) |
| Resource | 100px | 资源名称 |
| ReqID | 80px | req-***xxx (可复制) |
| Result | 50px | ✓ / ✗ |
| Error | 100px | error_code |

**详情抽屉:**
- 完整 metadata_json (折叠 JSON viewer)
- Copy JSON 按钮

### 16.11 Usage 页面

**路由:** `/workspaces/{workspace}/projects/{project}/usage`

**KPI Cards:**
- Requests, Errors, Tokens, Bytes In, Bytes Out

**表格列 (按时间分桶):**
| 列 | 宽度 | 内容 |
|----|------|------|
| TimeBucket | 100px | 小时/日期 |
| Type | 100px | endpoint/agent/userdata-* |
| Resource | 120px | 资源名称/ID |
| Reqs | 80px | 请求数 |
| DurP95 | 80px | P95 延迟 |
| Tokens | 80px | Token 数 |
| Bytes | 100px | Bytes (可展开 In/Out) |

### 16.12 Settings 页面

**路由:** `/workspaces/{workspace}/projects/{project}/settings`

**Config Tab:**
- JSON 编辑器 (语法高亮、校验、格式化)
- 保存按钮

**Policy Tab:**
- 表单化分组:
  - Capabilities (开关)
  - Turns (Max Queued, Max Active, Timeout)
  - Agent Invoke Guardrails
  - Internal Agents (Max Sessions, Backoff)
  - Endpoints Limits
- 高级 JSON (可展开)
- 保存二次确认对话框

### 16.13 User API Keys 页面

**路由:** `/settings/api-keys`

**表格列:**
| 列 | 宽度 | 内容 |
|----|------|------|
| Key ID | 120px | key_***xxx (可复制) |
| Prefix | 140px | usk-***xxx... |
| Created | 80px | 相对时间 |
| Last Used | 80px | 相对时间 或 -- |
| Expires | 80px | 相对时间 或 Never |
| Actions | 60px | [×] Revoke |

**Create Key 对话框:**
- Expiration: Never / 30/60/90 days
- Note (optional)

**创建成功:**
- 显示明文 usk-***xxx（一次性）
- Copy 按钮
- 警告提示

---

## 17. 设计文档完成状态

✅ 已完成:
- [x] 架构设计
- [x] 技术栈选型
- [x] Design System
- [x] App Shell 规格
- [x] 所有页面布局规格
- [x] 开发任务拆解

---

## 18. Phase 1-4 完成状态 (2026-02-01)

### ✅ Phase 1: 项目基础 (已完成)

### ✅ Phase 2: App Shell (已完成)
- [x] Topbar 组件
- [x] Sidebar 组件
- [x] Workspace/Project Switcher 组件
- [x] Mode Switcher (Chat/Workbench) 组件
- [x] User Menu 组件
- [x] App Shell Stories

### ✅ Phase 3: 认证与权限 (已完成)
- [x] Mock Login
- [x] authStore
- [x] 权限检查 hooks
- [x] Protected Route

### ✅ Phase 4: API Client & MSW (已完成)
- [x] 完整 Fixtures (workspaces, projects, agents, endpoints, members, audit, usage, user-keys, chat, workbench)
- [x] MSW CRUD handlers (GET, POST, PUT, DELETE for all resources)
- [x] API Endpoint Functions (WorkspaceAPI, ProjectAPI, AgentAPI, EndpointAPI, MemberAPI, AuditAPI, UsageAPI, UserAPIKeyService)
- [x] Error Handling Utilities (APIError, parseErrorResponse, handleAPIError, getErrorSuggestions)

### 🔄 Phase 5: 简化 Overview (进行中)
- [ ] 基本 KPI 卡片
- [ ] 项目入口导航

### ⏳ Phase 6: Chat 功能
- [ ] 三栏布局
- [ ] Sources 组件
- [ ] Model 选择器
- [ ] 消息流
- [ ] SSE 流式输出

### ⏳ Phase 7: Workbench 功能
- [ ] 三栏布局
- [ ] Thread 管理
- [ ] Agent 选择/Handoff
- [ ] Turn 面板
- [ ] SSE 事件流

### ⏳ Phase 8: 管理页面
- [ ] Overview 完整版
- [ ] Agents (List + Detail + Keys)
- [ ] Endpoints (List + ACL)
- [ ] Members + Join Requests
- [ ] Audit + Usage
- [ ] Settings (Config + Policy)
- [ ] User API Keys

### ⏳ Phase 9: 完善与测试
- [ ] i18n 文案补全
- [ ] 错误处理覆盖
- [ ] 响应式适配
- [ ] 无障碍 (a11y)
- [ ] 集成测试

---

## 19. Phase 1 完成状态 (2026-02-01)

### ✅ Phase 1.1: 项目基础初始化
- [x] package.json (Next.js 15, React 19, TypeScript)
- [x] tsconfig.json (path aliases, strict mode)
- [x] TailwindCSS + PostCSS 配置
- [x] ESLint 配置
- [x] Design System 参考文档 (DESIGN_SYSTEM.md)

### ✅ Phase 1.2: 依赖安装
- [x] shadcn/ui 配置 (components.json)
- [x] 工具函数 (cn utility in lib/utils.ts)
- [x] Zustand stores 基础结构 (authStore)
- [x] i18n 配置

### ✅ Phase 1.3: Design System CSS Tokens
- [x] globals.css (CSS variables matching 视觉设计系统-v1.md)
- [x] 字体配置 (Inter, Noto Sans SC, JetBrains Mono)
- [x] 暗色主题变量

### ✅ Phase 1.4: 项目结构和路由
- [x] app/[locale]/layout.tsx (i18n layout)
- [x] app/[locale]/page.tsx (locale home)
- [x] app/[locale]/login/page.tsx (登录页面)
- [x] messages/en-US.json 和 zh-CN.json (i18n messages)
- [x] README.md

### ✅ Phase 1.5: Storybook 配置
- [x] .storybook/main.ts 配置
- [x] .storybook/preview.ts 配置
- [x] 暗色主题装饰器 (decorators.tsx)
- [x] i18n 装饰器
- [x] 测试 Story

### ✅ Phase 1.6: API Client (Adapter Pattern)
- [x] ApiClient 接口定义
- [x] FetchApiClient (真实 API 实现)
- [x] MSWApiClient (Mock API 实现)
- [x] createApiClient 工厂函数 (环境变量切换)
- [x] API 类型定义 (lib/api/types/index.ts)
- [x] MSW handlers 和 fixtures (mocks/handlers.ts)
- [x] MSW browser setup (mocks/browser.ts)

### 📁 已创建的项目文件

```
mbos_frontend/
├── .env.example
├── .gitignore
├── components.json
├── DESIGN_SYSTEM.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.mjs
├── .storybook/
│   ├── main.ts
│   ├── preview.ts
│   └── preview-head.html
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── [locale]/
│   │       ├── layout.tsx
│   │       ├── page.tsx
│   │       └── login/
│   │           └── page.tsx
│   ├── components/
│   │   └── ui/
│   │       └── .gitkeep
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   └── adapters/
│   │   │       ├── fetch-adapter.ts
│   │   │       └── msw-adapter.ts
│   │   ├── i18n/
│   │   │   ├── config.ts
│   │   │   └── i18n.ts
│   │   ├── stores/
│   │   │   └── authStore.ts
│   │   └── utils.ts
│   ├── messages/
│   │   ├── en-US.json
│   │   └── zh-CN.json
│   ├── mocks/
│   │   ├── handlers.ts
│   │   └── browser.ts
│   └── stories/
│       ├── Testpage.stories.tsx
│       ├── decorators.tsx
│       ├── decorators-i18n.tsx
│       └── types.ts
└── docs/
    └── plans/
        └── 2026-02-01-frontend-architecture-design.md
```

### 📋 下一步

**Phase 2: App Shell (1-2天)**
- [ ] Topbar 组件
- [ ] Sidebar 组件
- [ ] Workspace/Project Switcher 组件
- [ ] Mode Switcher (Chat/Workbench) 组件
- [ ] User Menu 组件
- [ ] App Shell Story
