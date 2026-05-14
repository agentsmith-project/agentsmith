# MBOS Marketing Materials

本目录存放营销截图等静态资产。当前唯一推荐入口是 `npm run marketing:assets:generate`，它会运行专用截图脚本，并直接刷新 `marketing/screenshots/`。

命令约定：

- `npm run marketing:assets:generate` 是唯一 current 入口
- 这条命令只生成营销静态资产，不属于测试、门禁或发布主路径
- 如需产品说明书截图与 Markdown 产物，请使用 `npm run docs:artifacts:generate`

## 截图目录结构

```text
screenshots/
├── 01-auth/
│   ├── login.png
│   ├── join-invalid.png
│   ├── login-workspace.png
│   └── workspace-select.png
├── 02-projects/
│   └── projects-list.png
├── 03-overview/
│   └── overview.png
├── 04-chat/
│   └── chat.png
├── 05-agent-tasks/
│   ├── agent-tasks.png
│   ├── create-task-dialog.png
│   └── agent-task-detail.png
├── 06-agent-runners/
│   ├── agent-runners.png
│   ├── create-agent-runner-dialog.png
│   └── connection-keys-dialog.png
├── 07-endpoints/
│   └── endpoints.png
├── 08-members/
│   ├── members-list.png
│   ├── member-detail-overview.png
│   └── invite-member-dialog.png
├── 09-audit/
│   └── audit.png
├── 10-usage/
│   └── usage.png
├── 11-settings/
│   └── settings-general.png
├── 12-files/
│   ├── files.png
│   ├── create-library-dialog.png
│   └── library-mount-access-dialog.png
├── 13-credentials/
│   ├── credentials-list.png
│   └── create-credential-dialog.png
├── 14-user/
│   ├── profile.png
│   └── api-keys.png
└── 16-workspace/
    └── workspace-settings.png
```

目录与文件名应始终以当前脚本输出为准，不手工维护旧分类说明。

## 截图生成

```bash
npm run marketing:assets:generate
```

当前脚本 contract：

- 使用 Playwright `marketing-assets` 项目
- 页面与目录命名以 `e2e/capture-screenshots.spec.ts` 为准
- 默认先写入临时目录，再同步到 `marketing/screenshots/`
- 可通过 `MARKETING_ASSETS_OUTPUT_DIR=/abs/path` 覆盖最终输出目录
- 采用“两层策略”：核心页面与稳定对话框必须产出，扩展场景在页面状态允许时额外补拍，但不阻断整批生成

如需只生成到自定义目录：

```bash
MARKETING_ASSETS_OUTPUT_DIR=/tmp/agentsmith-marketing npm run marketing:assets:generate
```

## 说明

- 这套资产默认基于 mock 场景生成，不代表真实生产数据。
- 如需调整页面范围，优先更新 `e2e/capture-screenshots.spec.ts`，而不是手工改截图目录说明。
