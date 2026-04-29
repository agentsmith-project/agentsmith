# MBOS 智能体平台技术文档 v1

## 5. 截图索引（当前 marketing 资产）

当前 marketing 截图不再走“生成到临时目录后手动拷贝”的流程。唯一 current 入口是：

```bash
npm run marketing:assets:generate
```

它会运行专用截图脚本，并直接刷新 `marketing/screenshots/`。

当前截图分组以脚本输出为准：

| 分类 | 路径 | 说明 |
|------|------|------|
| 01-auth | `login.png`, `join-invalid.png`, `login-workspace.png`, `workspace-select.png` | 认证入口 |
| 02-projects | `projects-list.png` | 项目列表 |
| 03-overview | `overview.png` | 项目概览 |
| 04-chat | `chat.png` | 对话工作区 |
| 05-notebook | `notebook.png`, `task-detail.png` | Notebook 列表与任务详情 |
| 06-agents | `agents.png` | 智能体管理 |
| 07-endpoints | `endpoints.png` | 端点管理 |
| 08-members | `members-list.png`, `member-detail-overview.png`, `invite-member-dialog.png` | 成员列表、详情与邀请对话框 |
| 09-audit | `audit.png` | 审计日志 |
| 10-usage | `usage.png` | 用量统计 |
| 11-settings | `settings-general.png` | 项目设置总览 |
| 12-files | `files.png`, `create-library-dialog.png`, `library-mount-access-dialog.png` | Files 页面与关键对话框 |
| 13-credentials | `credentials-list.png`, `create-credential-dialog.png` | 凭据列表与创建对话框 |
| 14-user | `profile.png`, `api-keys.png` | 用户资料与 API Key |
| 16-workspace | `workspace-settings.png` | 工作区设置 |

说明：

- 截图目录说明以 [README.md](./README.md) 和实际脚本输出为准。
- 如需修改页面范围，优先更新 `e2e/capture-screenshots.spec.ts`，不要手工维护旧截图流程。

## 6. 参考文档

- [Marketing README](./README.md)
- [Product Doc Artifacts](../docs/user-guides/product-doc-artifacts.md)
- [Current Engineering Governance Model](../docs/current-engineering-governance-model.md)
