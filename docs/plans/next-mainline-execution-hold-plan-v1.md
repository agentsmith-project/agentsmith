# Next Mainline Navigation Restructure Plan v1

更新时间：2026-03-02
状态: `planned-not-start`

---

## 1. 目的

重构 AgentSmith 的导航结构，从「模块平铺」转变为「任务分层」，更好地服务不同用户角色。

---

## 2. 用户角色分析

| 用户角色 | 核心需求 | 使用的能力 |
|----------|----------|------------|
| **最终用户** | 使用 AI 能力完成工作 | Chat、Notebook、Files |
| **开发人员** | 构建和管理智能体 | Agents（创建、申请 Key） |
| **运维/管理员** | 配置资源、管理发布 | Endpoints、Resource Policy、Runtime Console |

---

## 3. 最终导航结构

```
├── Home
│   └── Overview
├── Use (使用)
│   ├── Chat
│   ├── Notebook
│   └── Files
├── Develop (开发)
│   └── Agents
├── Govern (治理)
│   ├── Endpoints
│   ├── Resource Policy
│   ├── Credentials
│   ├── Members
│   ├── Usage
│   ├── Audit
│   └── Settings
└── Operate (运维)
    └── Runtime Console
```

---

## 4. 变化说明

### 4.1 Section 变化

| 变化 | 当前 | 新方案 |
|------|------|--------|
| **Build 拆分** | Build (chat, notebook, files, agents, endpoints) | Use (chat, notebook, files) + Develop (agents) |
| **Endpoints 归属** | Build | Govern |
| **Settings 归属** | Operate | Govern |
| **Operate 页面数** | 5个 (runtime-control-plane, runtime-observability, release-ops, alerts, settings) | 1个 (Runtime Console) |

### 4.2 页面变化

| 当前页面 | 新方案 | 说明 |
|----------|--------|------|
| runtime-control-plane | 合并到 Runtime Console | |
| runtime-observability | 合并到 Runtime Console | |
| release-ops | 合并到 Runtime Console | |
| alerts | 合并到 Runtime Console (作为 Tab) | |
| settings | 移到 Govern | 配置属于治理范畴 |
| endpoints | 移到 Govern | 端点由运维管理员配置 |

---

## 5. Runtime Console Tab 结构

Runtime Console 是运维的统一入口，包含以下 Tab：

| Tab | 职责 |
|-----|------|
| **Overview** | 运行时健康状态、关键指标一览 |
| **Monitoring** | 详细监控指标、链路追踪 |
| **Alerts** | 告警规则、通知规则管理 |
| **Control** | 配置发布、门禁状态、策略例外 |
| **Reports** | 发布报告、历史记录 |

---

## 6. 设计原则

### 6.1 为什么拆分 Build → Use + Develop

- **Use**：最终用户日常工作，使用 AI 能力
- **Develop**：开发人员构建智能体
- 区分两种用户角色，降低认知负担

### 6.2 Chat 与 Agents 的关系

- Chat 可以选择 **LLM Endpoint** 直接聊天
- 也可以选择**接口类型为 "chat" 的 Agent** 来聊天
- Agents 的接口类型可以是：`chat`、`notebook`、未来可扩展其他类型

### 6.3 为什么 Endpoints 放在 Govern

- Endpoints 是「配置 LLM 提供商」，由运维管理员负责
- 不是开发人员关心的事
- 配置生效能力集成在 Endpoints 页面中

### 6.4 为什么 Settings 放在 Govern

- Settings 是「配置定义」，不是「操作执行」
- 配置属于治理范畴（定义规则）
- 分离原则：Govern = 定义策略，Operate = 执行运维

### 6.5 为什么 Operate 只保留 1 个页面

- 运维人员需要统一入口，不是分散的多个页面
- 监控、告警、控制、发布是运维的完整闭环
- 符合「控制面必须分层，而不是堆叠」的原则

### 6.6 Notebook 调试功能权限控制

Notebook 的调试功能需要满足以下条件才会启用：

| 条件 | 权限点 | 说明 |
|------|--------|------|
| **开发权限** | `project:agent:manage` | 有权管理智能体和密钥 |
| **Agent 开发者** | - | 当前选择的执行 agent 的 `developers` 列表中包含当前用户 |

**逻辑**：
```
if (hasPermission('project:agent:manage') && currentAgent.developers.includes(currentUser)) {
  // 启用调试功能
} else {
  // 关闭调试功能，保持界面友好
}
```

**设计意图**：
- 最终用户：看到简洁的使用界面，不被调试功能干扰
- 开发人员：只在自己负责的 agent 上看到调试功能
- 降低认知负担，保持界面友好

### 6.7 Runtime Console 默认 Tab

- 默认显示 **Overview** Tab
- 展示运行时健康状态、关键指标一览

---

## 7. 路由策略

### 7.1 新路由结构

| Section | 页面 | 新路由 |
|---------|------|--------|
| Home | Overview | `/overview` |
| Use | Chat | `/chat` |
| Use | Notebook | `/notebook` |
| Use | Files | `/files` |
| Develop | Agents | `/agents` |
| Govern | Endpoints | `/endpoints` |
| Govern | Resource Policy | `/resource-policy` |
| Govern | Credentials | `/credentials` |
| Govern | Members | `/members` |
| Govern | Usage | `/usage` |
| Govern | Audit | `/audit` |
| Govern | Settings | `/settings` |
| Operate | Runtime Console | `/runtime-console` |

### 7.2 旧路由重定向

| 旧路由 | 新路由 |
|--------|--------|
| `/runtime-control-plane` | `/runtime-console` |
| `/runtime-observability` | `/runtime-console?tab=monitoring` |
| `/release-ops` | `/runtime-console?tab=control` |
| `/alerts` | `/runtime-console?tab=alerts` |

---

## 8. 权限点

权限点保持不变，仅调整导航归属：

| 权限点 | 当前 Section | 新 Section | 说明 |
|--------|--------------|------------|------|
| `project:chat:access` | Build | Use | 访问 Chat |
| `project:notebook:access` | Build | Use | 访问 Notebook |
| `project:source:use` | Build | Use | 使用文件库 |
| `project:agent:use` | Build | Develop | 使用智能体 |
| `project:agent:manage` | Build | Develop | 管理智能体和密钥（开发权限） |
| `project:endpoint:use` | Build | Govern | 使用端点 |
| `project:endpoint:manage` | Build | Govern | 管理端点 |
| `project:settings:manage` | Operate | Govern | 管理项目设置 |

**Notebook 调试功能**需要同时满足：
1. `project:agent:manage` 权限
2. 当前 agent 的 `developers` 列表包含当前用户

---

## 9. 国际化文案

需要添加新的 i18n key：

| Key | en-US | zh-CN |
|-----|-------|-------|
| `sidebar.use` | Use | 使用 |
| `sidebar.develop` | Develop | 开发 |
| `nav.runtime_console` | Runtime Console | 运行时控制台 |

---

## 10. 执行约束

当前阶段明确约束:
1. 仅允许规划、评审、文档化
2. 不启动功能开发
3. 不引入新的 runtime 行为变更
4. 不调整现网验收口径

---

## 11. 后续步骤

### WP-01: 导航结构更新
- 更新 `AppShellSidebar` 组件
- 添加新的 section（Use、Develop）
- 调整页面归属

### WP-02: Runtime Console 页面
- 创建 `/runtime-console` 页面
- 实现 Tab 结构（Overview、Monitoring、Alerts、Control、Reports）
- 迁移现有功能组件

### WP-03: 路由重定向
- 添加旧路由到新路由的重定向
- 更新内部链接

### WP-04: 国际化更新
- 添加新的 i18n key
- 更新现有文案

### WP-05: 测试更新
- 更新 E2E 测试的 testid
- 更新测试路由
- 更新 visual baseline

### WP-06: 合约更新
- 更新相关合约文档
- 更新权限模型文档

---

## 12. 相关文档

- `docs/design/ai-ops-home-ux-strategy-v1.md` - AI Ops Home UX 策略
- `docs/user-guides/release-governance-control-plane.md` - Release Governance 说明
- `docs/contracts/auth-permission-model.md` - 权限模型
- `src/components/app-shell/AppShellSidebar.tsx` - 当前导航组件
