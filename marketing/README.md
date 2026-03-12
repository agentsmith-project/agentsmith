# MBOS Marketing Materials

本目录包含 MBOS 智能体平台的技术文档、市场推广文案及全站截图。

## 截图目录结构（分类组织）

> 截图由 E2E 脚本生成到临时目录 `test-results/screenshots/`。如需用于 marketing，请手动拷贝到本目录。

```
screenshots/   # 手动拷贝后使用
├── 01-auth/                    # 认证入口
│   ├── login.png
│   └── workspace-select.png
├── 02-projects/                # 项目管理
│   └── projects-list.png
├── 03-overview/                # 项目概览
│   └── overview.png
├── 04-chat/                    # 对话
│   └── chat.png
├── 05-studio/                  # AI Studio
│   └── studio.png
├── 06-agents/                  # 智能体管理
│   └── agents.png
├── 07-endpoints/               # 端点管理
│   └── endpoints.png
├── 08-members/                 # 成员管理（含权限、配额、资源ACL）
│   ├── members-list.png
│   ├── member-detail-overview.png
│   ├── member-permissions-template.png
│   ├── member-permissions-advanced.png   # 权限配置详情（高级模式）
│   ├── member-limits.png                  # 配额覆盖
│   └── member-resource-acl.png           # 资源 ACL
├── 09-audit/                   # 审计日志
│   └── audit.png
├── 10-usage/                   # 用量统计
│   └── usage.png
├── 11-settings/                # 项目设置（含全部 token 展示）
│   ├── settings-general.png
│   ├── settings-execution-with-tokens.png   # 执行偏好 + 支持的 token
│   ├── settings-governance-with-tokens.png # 治理规则 + 全部 limit/rate_limits/checks token
│   └── settings-limits-with-tokens.png    # 资源限制 + 全部 limits token
├── 12-sources/                 # 文件管理
│   └── sources.png
├── 13-credentials/             # 凭据管理
│   ├── credentials-list.png
│   └── create-credential-dialog.png
└── 14-user/                    # 用户中心
    ├── profile.png
    └── api-keys.png
```

## 支持的 Token 说明

### 执行偏好 (Execution Preferences)
- `locale.language`, `locale.timezone`
- `ai_behavior.tone`, `ai_behavior.verbosity`
- `shared_context.*`, `extensions`

### 治理规则 (Governance) - Limit / Rate Limits / Checks
- **Capabilities**: userdata.storage/docdb/vectordb, endpoint, plugins
- **Limits**: storage bytes/objects, docdb collections/document/query_timeout, vectordb indexes/top_k/upsert, endpoint requests
- **Rate Limits**: user_rpm, agent_rpm, agent_rpm_high_risk
- **Checks**: agent_invoke max_depth/max_concurrent/budgets, turns, internal_agents

### 资源限制 (Limits)
- **UserData**: max_total_bytes, max_total_collections, max_total_indexes
- **Endpoint**: tokens_per_day/min, requests_per_day/min, timeout_ms, max_concurrent

## 截图生成

运行以下命令生成截图到临时目录 `test-results/screenshots/`（需先启动 dev server `npm run dev`）：

```bash
npx playwright test e2e/capture-screenshots.spec.ts --project=chromium --timeout=180000
```

生成后如需用于 marketing，手动拷贝：

```bash
cp -r test-results/screenshots/* marketing/screenshots/
```

## 测试账号

- 入口：http://localhost:3000/zh-CN/login
- 用户：demo@demo.com（Mock 模式任意邮箱均可）
