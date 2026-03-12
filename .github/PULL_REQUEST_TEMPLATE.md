# PR Title

<!-- 格式建议：type(scope): summary -->
<!-- Examples: feat(audit): add review metrics, fix(auth): resolve permission gate race, refactor(chat): extract hook -->

## 1) 变更意图（What / Why）

- **本次解决的问题**：
- **业务/治理目标**：
- **不在本次范围**：

## 2) 合约与系统真相（Contract / System Truth）

> 本节确保代码变更与系统契约保持一致

### 2.1 对象模型

- 涉及领域对象：
- 状态变更（新增/修改/删除字段）：

### 2.2 权限点（Permission Points）

- 涉及权限点（token/permission）：
- 权限点定义位置：`src/lib/constants/permissions.ts`
- 前端门禁：[ ] 已使用 `useHasPermission` 驱动 UI
- 后端强制：[ ] 后端 API 已对应配置 401/403
- 证据引用：`docs/contracts/frontend-backend-gating-matrix.md` 相关行

### 2.3 URL 真相源（URL as Source of Truth）

- URL 变化（tab/filter/pagination/路由参数）：
- 深链支持：[ ] 可直接通过 URL 参数进入对应状态
- 状态还原：[ ] 刷新页面后状态从 URL 正确还原
- 前进后退：[ ] 浏览器前进后退按钮正常工作
- 规范化：[ ] 无效/冗余参数已自动纠正（如 `?tab=overview` 移除）

### 2.4 API 合约（OpenAPI Contract）

- API 合约变化：
  - [ ] Request 变更已更新 OpenAPI spec
  - [ ] Response 变更已更新 OpenAPI spec
  - [ ] Error semantics 已定义（401/403/422 稳定错误码）
- 相关契约文档：

## 3) 风险评估（Risk Assessment）

### 3.1 主要风险

| 风险类型 | 风险描述 | 缓解措施 | 证据 |
|---------|---------|---------|------|
| 数据兼容 | | | |
| 性能回归 | | | |
| 安全漏洞 | | | |
| 权限绕过 | | | |

### 3.2 回滚策略

- [ ] 可独立回滚（不依赖其他变更）
- [ ] 数据迁移可逆（如有）
- [ ] Feature flag 已配置（如适用）
- 回滚步骤：

### 3.3 残余风险与 Owner（必须填写）

| 残余风险 | 影响 | Owner | 缓解计划 |
|---------|------|-------|---------|
| | | | |
| | | | |

> 注：Owner 必须是具体人员（@mention），不能是"待定"或"团队"

## 4) 测试与证据（Evidence）

> 证据驱动：本节所有检查必须附实际执行输出，不接受"已手动验证"等模糊描述

### 4.1 必填门禁（Gate Checks）

```txt
# 粘贴 npm run lint 输出
✅ ESLint: 0 errors, X warnings

# 粘贴 npx tsc --noEmit 输出
✅ TypeScript: no errors

# 粘贴 npm test 输出（或相关测试集）
✅ Test Files: X passed (Y)
✅ Tests: Z passed
```

### 4.2 领域专项证据（Domain Evidence）

#### 4.2.1 权限门禁证据（如涉及）

```txt
# 粘贴有权限测试输出
✅ with project:xxx:view - can access

# 粘贴无权限测试输出
✅ without project:xxx:view - 403 forbidden / permission denied message shown
```

#### 4.2.2 URL 状态证据（如涉及）

```txt
# 深链进入测试
✅ Direct URL /xxx?tab=monitoring - lands on correct tab

# 刷新还原测试
✅ Page refresh - state preserved from URL

# 前进后退测试
✅ Browser back/forward - URL and state synced correctly
```

#### 4.2.3 Audit 证据（如涉及）

```txt
# 粘贴 npm run test:e2e -- --project=chromium e2e/audit.spec.ts 输出
✅ X passed (Y)
```

#### 4.2.4 Evidence Pipeline 证据（如涉及）

```txt
# 粘贴 npm test -- governance-evidence 输出
✅ Evidence Pipeline tests passed

# 粘贴 npm test -- release-policy 输出
✅ Release Policy tests passed
```

#### 4.2.5 Organization Governance 证据（如涉及）

```txt
# 粘贴 npm run test:e2e -- --project=chromium e2e/organization-governance.spec.ts 输出
✅ Organization Governance Overview tests passed

# 验证下钻功能
✅ Governance drilldown links work correctly
✅ Audit drilldown from organization overview works
```

### 4.4 Visual Baseline（手动、非阻断）

- 是否涉及视觉变更：[ ] 是 / [ ] 否
- 若“是”，是否执行了手动 visual 流程：[ ] 已执行 / [ ] 不适用

```txt
# 可选：粘贴 visual 手动流程输出
npm run test:e2e:lane:mock:visual:update
```

### 4.3 覆盖率证据（Coverage）

```txt
# 粘贴覆盖率报告（如适用）
Coverage: X% (lines), Y% (branches), Z% (functions)
```

## 5) 回归范围（Regression Scope）

### 5.1 受影响模块

- 核心模块：
- 路由/页面：
- 组件/ Hook：

### 5.2 明确回归点清单

- [ ] 相关页面加载正常
- [ ] 权限控制正确
- [ ] URL 状态同步
- [ ] API 调用成功
- [ ] 错误处理正确

### 5.3 防复发测试

- [ ] 已添加单元测试防止回归
- [ ] 已添加 E2E 测试防止回归
- [ ] 已更新契约文档

## 6) 治理合规检查（Governance Checklist）

> 本节确保代码符合 MBOS 企业级控制面规范

### 6.1 安全规范

- [ ] **Token 唯一做门禁**：未使用角色名做鉴权门禁
- [ ] **参数校验**：路由参数已校验（workspace/project 等）
- [ ] **XSS 防护**：用户输入已正确转义
- [ ] **SSE 安全**：无 Token 暴露风险

### 6.2 代码质量

- [ ] **无生产 any**：未引入 `any` 类型
- [ ] **无死代码**：无无效 props、无用 import、未使用变量
- [ ] **类型安全**：`npx tsc --noEmit` 通过

### 6.3 设计规范

- [ ] **设计系统约束**：未破坏 tokens 语义（颜色、间距、阴影）
- [ ] **i18n**：文案已纳入 i18n（如适用）
- [ ] **响应式**：移动端/桌面端适配正确

### 6.4 合规性

- [ ] **契约优先**：API 变更已更新 OpenAPI spec
- [ ] **门禁检查**：前后端门禁矩阵已同步
- [ ] **文档更新**：相关文档已更新

## 7) Reviewer 指南（Reviewer Guide）

### 7.1 重点文件

1. **文件 1**：
   - 检查点：
   - 验收方法：

2. **文件 2**：
   - 检查点：
   - 验收方法：

3. **文件 3**：
   - 检查点：
   - 验收方法：

### 7.2 重点行为

1. **行为 1**：
   - 预期结果：
   - 测试命令：

2. **行为 2**：
   - 预期结果：
   - 测试命令：

3. **行为 3**：
   - 预期结果：
   - 测试命令：

### 7.3 容易忽略的点

- 潜在边界情况：
- 性能影响：
- 安全隐患：

## 8) 发布说明（Release Notes）

### 8.1 用户可见变化

- 功能新增/变更：
- 行为变化：
- 视觉变化：

### 8.2 运维/治理影响

- 新增/修改权限点：
- 新增/修改 API：
- 监控/告警影响：

### 8.3 文档更新

- [ ] 用户文档需更新：
- [ ] 运维文档需更新：
- [ ] 契约文档需更新：

---

## 附录：快速检查清单（提交前自检）

```bash
# 1. 代码质量
npm run lint           # 0 errors
npx tsc --noEmit       # no errors
npm test               # 相关测试通过

# 2. 契约检查（如涉及 API 变更）
npm run contracts:check
npm run contracts:check-openapi

# 3. E2E 测试（如涉及相关页面）
npm run test:e2e

# 4. Evidence Pipeline 相关（如涉及）
npm test -- governance-evidence
npm test -- release-policy

# 5. Organization Governance 相关（如涉及）
npm run test:e2e -- --project=chromium e2e/organization-governance.spec.ts

# 6. Visual（手动、非阻断，如涉及视觉变更）
npm run test:e2e:lane:mock:visual:update

# 7. 无死代码
# 搜索: console.log, debugger, TODO, FIXME, @ts-ignore
```
