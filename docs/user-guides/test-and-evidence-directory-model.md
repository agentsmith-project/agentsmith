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

补充：
- `e2e/stories/backend-real/*.story.md` 是可执行 user story 的真相源
- story 源文件属于测试源码，不属于运行产物
- story 对应的 trace / review / screenshot 证据仍然进入 `artifacts/`

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
- `artifacts/release-reports/`（历史/生成的报告快照；当前发布结论优先看 campaign-scoped `artifacts/release-runs/<campaign-run-id>` 与 `latest.json`）
- `artifacts/release-escalations/`
- `artifacts/governance-reports/`

说明：
- `artifacts/` 是长期证据总入口
- current docs 统一使用 run-scoped 证据路径
- 若脚本仍保留 `current` 便捷别名，应视为兼容入口，不作为文档真相
- `e2e/stories/` 定义“应当发生什么”，`artifacts/` 记录“实际发生了什么”
- release-grade authority artifacts 必须是 producer-owned snapshot，不能由 wrapper 或 aggregate 事后重建

### visual review root
- `artifacts/visual-baseline-reviews/<run-id>/run-manifest.json`
- `artifacts/visual-baseline-reviews/<run-id>/captured/<scenario-id>/<file>`
- `artifacts/visual-baseline-reviews/<run-id>/<scenario-id>/review.md`

### backend-real UX trace root
- `.../ux-traces/ux-trace-index.json`
- `.../ux-traces/<lane>/<suite>/<story-id>/<run-id>/manifest.json`
- `.../ux-traces/<lane>/<suite>/<story-id>/<run-id>/contract-snapshot.json`
- `.../ux-traces/<lane>/<suite>/<story-id>/<run-id>/events.jsonl`
- `.../ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`

### Agent Runner lifecycle focused evidence
- Command: `npm run test:agent-runners:lifecycle:evidence`
- Root: `artifacts/backend-real/runs/<run-id>/agent-runner-lifecycle/`
- Required files:
  - `manifest.json`
  - `agent_runner.default_managed.read_only.json`
  - `agent_runner.developer.key_lifecycle.json`
  - `agent_runner.developer.test_connection.json`
  - `agent_runner.developer.test_task.json`

说明：
- 这是 local focused evidence producer，只声明 manifest/report contract。
- `backend_real_executed:false` 表示它不证明真实 deployment default managed runner 解析、Developer runner 连接、Test connection 或 test task 全链路。
- `agent_runner.developer.*` 只表示开发测试证据，不能作为 managed release proof。

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
- `artifacts/backend-real-visual/<run-id>/ux-traces/ux-trace-index.json`
- `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
- `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/events.jsonl`
- `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/contract-snapshot.json`

### 发布前结论
看：
- `npm run release:ready` / `npm run release:status` 的输出
- `artifacts/release-runs/<campaign-run-id>/summary.md`
- `artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json`
- `artifacts/release-runs/latest.json`
- `artifacts/release-reports/` 中被当前 release run 明确引用的生成报告；其他旧报告只作为历史证据快照

不要把 standalone `artifacts/backend-real-visual/<run-id>/...` 或 `artifacts/unified-deploy/` 的最新文件直接当作发布结论；除非它们被当前 campaign root 的 evidence pointer 明确引用，否则只属于诊断产物。`state/readiness.json` 这类运行期 readiness state 也不是 release authority evidence。

## 6. 当前目录治理结论

1. 主测试源码只使用：
   - `src/**/__tests__/`
   - `e2e/`
   - `scripts/**/__tests__/`
2. `e2e/stories/backend-real/*.story.md` 是 user story 真相源，不放运行产物
3. `test-results/` 只保留临时运行结果
4. `e2e/__screenshots__/` 只表示 mock lane visual baseline
5. `artifacts/` 只放长期证据与审查产物
6. 不再新增泛化的 `tests/` 目录承载主测试代码
