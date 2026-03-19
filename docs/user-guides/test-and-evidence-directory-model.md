# 测试与证据目录模型

这份说明只回答 4 个问题：

1. 测试代码放在哪里
2. 测试临时结果放在哪里
3. mock visual 基线放在哪里
4. 真实发布审查证据放在哪里

目标是减少以下混淆：
- `e2e/` 和 `tests/` 到底哪个才是主测试目录
- `test-results/` 和 `artifacts/` 都有截图时应该看哪一个
- `e2e/__screenshots__/` 是不是“真实页面截图”

## 目录分工

### 1. 测试代码

当前主测试代码目录有两类：

- `src/**/__tests__/`
  - 组件、页面、hooks、模块单测
- `e2e/`
  - Playwright 端到端、visual、真实环境截图巡检测试源码

补充：
- `scripts/**/__tests__/`
  - 面向脚本和 CLI 的集成测试
  - 例如治理脚本、报告生成脚本

结论：
- 看到这些目录，默认理解成“测试代码本身”
- 不应把运行结果或长期审查截图放进这些目录

### 2. 测试临时结果

- `test-results/`

用途：
- Playwright 单次运行的临时结果
- 包括失败截图、diff、actual、error context、trace/video

使用方式：
- 日常排查某次运行为什么失败，优先看这里

不应承担：
- 长期审查入口
- 发布证据归档
- mock visual 基线

### 3. mock lane visual 基线

- `e2e/__screenshots__/`

用途：
- `e2e/visual.spec.ts` 的像素对比基线
- 服务对象是 mock lane visual 回归

边界：
- 这不是“真实后端截图审查结果”
- 这也不是“本次运行的实际截图结果”
- 它的角色是：`expected baseline`

### 4. 长期证据与发布审查资产

- `artifacts/`

用途：
- 面向人工审查、发布复核、治理复盘、系统导出的长期产物

当前建议结构：
- `artifacts/release-real-visual/`
  - 真实后端截图巡检与 `review.md`
- `artifacts/release-evidence/`
  - 发布级汇总结论与门禁证据
- `artifacts/governance-reports/`
  - 治理报告与治理执行证据
- `artifacts/system-state/`
  - system 管理侧导出的配置与状态快照
- `artifacts/notebook-runner/`
  - notebook runner / external agent 长期运行产物

说明：
- `artifacts/` 是“长期证据总入口”
- 它不应被当成测试源码目录

## 应该看哪一份

### 日常开发排查
看：
- `test-results/`

### mock lane visual 回归
看：
- `e2e/__screenshots__/`

### 真实后端人工界面审查
看：
- `artifacts/release-real-visual/<run-id>/review.md`
- `artifacts/release-real-visual/<run-id>/manifest.json`

### 发布前结论
看：
- 严格门禁命令输出
- `artifacts/release-real-visual/<run-id>/review.md`
- 未来统一收口到 `artifacts/release-evidence/`

## 当前目录治理结论

### 当前主目录
- `src/**/__tests__/`：正常
- `e2e/`：正常
- `test-results/`：正常
- `artifacts/`：正常，但需要继续维持子目录边界

### 需要避免的情况
- 再新增泛化的 `tests/` 目录来放主测试代码
- 把长期审查截图放进 `test-results/`
- 把 mock visual baseline 当成真实发布审查图

## 现在的收口约定

1. 主测试源码只使用：
   - `src/**/__tests__/`
   - `e2e/`
   - `scripts/**/__tests__/`
2. `test-results/` 只保留临时运行结果
3. `e2e/__screenshots__/` 只表示 mock lane visual baseline
4. `artifacts/` 只放长期证据与审查产物

## 过渡期说明

当前仓库里仍有少量现有运行时输出继续沿用历史路径：

- `artifacts/system-workspace-provisioning/`

它目前仍被 system 管理侧的工作区发布/初始化流程直接使用。  
这意味着：

- 新的长期证据目录约定已经成立
- 但不能因为有了 `artifacts/system-state/` 这样的新命名，就直接把上述现有路径手工迁走或重命名

当前正确理解是：
- `artifacts/system-workspace-provisioning/` 是**当前运行时输出路径**
- `artifacts/system-state/` 是**后续长期状态快照与审查资产**的收口方向
