# 产品文档截图产物生成

这套工具用于生成白皮书、功能说明书、操作手册所需的中文界面截图和同名说明文件。

## 用途

- 生成关键页面的中文截图
- 生成同名 Markdown 说明
- 生成总索引 `index.md`
- 生成机器可读清单 `manifest.json`

这套工具不属于测试门禁或发布门禁，只用于产品文档产物生成。

## 当前入口

```bash
npm run docs:artifacts:generate
```

可选环境变量：
- `DOC_ARTIFACTS_RUN_ID`
- `DOC_ARTIFACTS_OUTPUT_DIR`

## 运行特征

- 固定使用 `zh-CN`
- 固定截图分辨率 `1920x1080`
- 固定使用 `MSW`
- 固定使用面向文档说明的 fixtures

## 输出目录

默认输出到：

```text
artifacts/product-docs/<run-id>/
```

目录内包含：
- `*.png`
- `*.md`
- `index.md`
- `manifest.json`

## 当前覆盖面

当前默认覆盖：
- 工作区与项目入口
- Chat 多轮会话
- Agent tasks 列表与任务详情
- Files 页面与本地挂载说明
- Endpoints / Project secrets / Agent Runners / Members / Policy / Audit / Usage / Settings

## 注意事项

- 这套产物使用专门的文档 mock 数据，不代表真实线上业务数据。
- 如需新增页面，优先扩展 `e2e/doc-artifacts.spec.ts` 的 capture 清单。
- 如需调整页面内容真实性，优先更新 `src/mocks/doc-fixtures/`。
- 如需营销截图，请使用 `npm run marketing:assets:generate`。
