# 测试与证据目录模型

这份说明只回答 4 个问题：
1. 测试代码放在哪里
2. 测试临时结果放在哪里
3. mock visual 基线放在哪里
4. 长期证据和发布审查资产放在哪里

## 1. 测试代码

当前主测试源码目录：
- `src/**/__tests__/`
- `e2e/`
- `scripts/**/__tests__/`

这些目录表示测试代码本身，不应混入长期证据产物。

## 2. 测试临时结果

- `test-results/`

用途：
- Playwright 单次运行的临时结果
- 失败截图、diff、actual、trace、video

这不是长期证据目录。

## 3. mock lane visual 基线

- `e2e/__screenshots__/`

用途：
- `e2e/visual.spec.ts` 的 expected baseline
- 服务于 mock lane visual 回归

这不是“真实后端截图审查结果”。

## 4. 长期证据与发布审查资产

- `artifacts/`

当前长期证据结构：
- `artifacts/backend-real-visual/`
- `artifacts/backend-real/runs/<run-id>/...`
- `artifacts/release-runs/`
- `artifacts/release-reports/`
- `artifacts/release-escalations/`
- `artifacts/governance-reports/`

说明：
- `artifacts/` 是长期证据总入口
- current docs 统一使用 run-scoped 证据路径
- 若脚本仍保留 `current` 便捷别名，应视为兼容入口，不作为文档真相

## 5. 应该看哪一份

### 日常开发排查
看：
- `test-results/`

### mock visual 回归
看：
- `e2e/__screenshots__/`

### 真实后端人工界面审查
看：
- `artifacts/backend-real-visual/<run-id>/review.md`
- `artifacts/backend-real-visual/<run-id>/manifest.json`

### 发布前结论
看：
- 严格门禁命令输出
- `artifacts/backend-real-visual/<run-id>/review.md`
- `artifacts/release-reports/`

## 6. 当前目录治理结论

1. 主测试源码只使用：
   - `src/**/__tests__/`
   - `e2e/`
   - `scripts/**/__tests__/`
2. `test-results/` 只保留临时运行结果
3. `e2e/__screenshots__/` 只表示 mock lane visual baseline
4. `artifacts/` 只放长期证据与审查产物
5. 不再新增泛化的 `tests/` 目录承载主测试代码
