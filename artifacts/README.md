# Artifacts Directory

这个目录只放**长期证据**，不放测试源码，也不把它当作 Playwright 临时结果目录。

## 目录职责

### `release-real-visual/`
- 真实后端界面巡检截图
- `review.md`
- `manifest.json`

### `release-evidence/`
- 发布级汇总结论
- 门禁执行证据
- 需要长期留档的发布审查材料

### `governance-reports/`
- 治理报告
- 治理执行证据
- 治理闭环与发布治理审查材料

### `system-state/`
- `system 管理侧` 导出的配置与状态快照
- 工作区配置记录快照
- 需要人工排障或审查的 system 导出物

### `notebook-runner/`
- notebook runner / external agent 相关的长期运行产物

## 不应该放在这里的内容

- Playwright 单次运行失败截图
- Playwright actual / diff 图
- mock visual baseline
- 组件或页面测试代码

这些内容分别应该去：
- `test-results/`
- `e2e/__screenshots__/`
- `src/**/__tests__/` / `e2e/`

## 过渡期现状

当前仓库仍有少量现有运行时输出继续使用历史路径：

- `artifacts/system-workspaces.json`
- `artifacts/system-workspace-provisioning/`

它们还被现有代码直接消费，所以现在不要手工迁移或重命名。  
可以把它们理解为：

- 当前运行时路径
- 不是这份目录约定里的最终长期归档形态
