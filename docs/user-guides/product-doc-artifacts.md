# 产品文档截图产物生成

这套工具用于生成白皮书、功能说明书、操作手册所需的中文界面截图和同名说明文件。

## 用途

- 生成关键页面的中文截图
- 生成同名 Markdown 说明
- 生成总索引 `index.md`
- 生成机器可读清单 `manifest.json`

这套工具**不属于测试门禁或发布门禁**，仅用于产品文档产物生成。

## 运行方式

在仓库根目录执行：

```bash
npm run docs:artifacts:generate
```

可选环境变量：

- `DOC_ARTIFACTS_RUN_ID`
  - 自定义输出目录名
- `DOC_ARTIFACTS_OUTPUT_DIR`
  - 自定义输出目录绝对路径

例如：

```bash
DOC_ARTIFACTS_RUN_ID=whitepaper-20260317 npm run docs:artifacts:generate
```

命令约定：

- `npm run docs:artifacts:generate` 是唯一 current 入口
- 这条命令只生成静态文档产物，不属于测试、门禁或发布主路径
- 如需营销截图，请使用 `npm run marketing:assets:generate`

## 运行特征

- 固定使用 `zh-CN`
- 固定截图分辨率 `1920x1080`
- 固定使用 `MSW`
- 固定使用更有说明性的 `doc fixtures`

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

## 内容说明

当前默认覆盖：

- 工作区与项目入口
- Chat 多轮会话
- Notebook 列表与任务详情
- Files 页面与本地挂载说明
- Endpoint / Credential / Agent / Members / Resource Policy / Audit / Usage / Settings

## 注意事项

- 这套产物使用的是专门的文档 mock 数据，不代表真实线上业务数据。
- 如需新增页面，优先扩展 `e2e/doc-artifacts.spec.ts` 中的 capture 清单。
- 如需调整页面内容的真实性，优先更新 `src/mocks/doc-fixtures/`。
- 当前脚本会直接写入目标输出目录；如需保留多次产物，请显式传入 `DOC_ARTIFACTS_RUN_ID` 或 `DOC_ARTIFACTS_OUTPUT_DIR`。
