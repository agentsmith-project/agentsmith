# M4 Evidence Pipeline 工作包规划

## 目标

增强 Evidence Pipeline 模块，支持 blocker/warning 可解释、、证据下钻到 workspace/项目执行点。

## 工作包 (依赖顺序执行)

### WP-01: Evidence Pipeline 增强

**目标**: 增强 `governance-evidence.ts` 模块，**范围**:
- 增强 blocker/warning 分类
- 添加 evidence 来源字段
- 完善下钻 UI

**验收标准**:
- 单元测试覆盖新分类和来源
- E2E 测试验证下钻链接
- Lint 通过

**依赖**: 无

**完成后**: WP-02 开始

### WP-02: 组织级证据进入 Release Gate
**目标**: 将组织级证据整合到 Release Gate
**范围**:
- 定义 release report 数据结构
- 添加门禁 hard fail 逻辑
- 组织级证据门禁

**验收标准**:
- release report 包含组织级证据
- 门禁可阻断发布
- hard fail 时显示阻塞来源

- 单元测试验证门禁逻辑
- E2E 测试通过

**依赖**: WP-01

**完成后**: WP-02 开始

### WP-03: Organization Rollup 增强
**目标**: 完善组织级治理总控台
**范围**:
- 添加风险排序优化
- 完善动作队列执行追踪
- 添加下钻能力

**验收标准**:
- 动作可批量执行
- 执行状态可追踪
- 下钻链接正确
- 单元测试覆盖批量执行
- E2E 测试验证下钻
- Lint 通过

- 更新 PULL_REQUEST_TEMPLATE.md

**依赖**: WP-01, WP-02
**完成后**: WP-03 开始

### WP-04: 持续质量护栏
**目标**: 持续质量护栏，**范围**:
- 持续质量检查
- 证据化 PR 模板
- 更新 PULL_REQUEST_TEMPLATE.md

**验收标准**:
- PR 模板包含所有验证命令
- 所有测试通过
- 文档更新

