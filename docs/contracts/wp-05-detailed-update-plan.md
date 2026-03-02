# WP-05: 测试更新 - 详细执行计划

> Prepared by: Dev-4
> Date: 2026-03-02
> Status: READY FOR EXECUTION
> Dependencies: WP-01 ✅, WP-03 ✅, WP-04 ✅, WP-02 🔄

## 任务完成状态

| WP | 状态 | 说明 |
|----|------|------|
| WP-01: 导航结构更新 | ✅ completed | AppShellSidebar.tsx 已更新 |
| WP-02: Runtime Console 页面 | 🔄 in_progress | runtime-console.spec.ts 已创建 |
| WP-03: 路由重定向 | ✅ completed | route-redirect.spec.ts 已创建 |
| WP-04: 国际化更新 | ✅ completed | i18n 文案已添加 |
| **WP-05: 测试更新** | ⏳ **ready to start** | **等待 WP-02 完成** |
| **WP-06: 合约更新** | ⏳ **ready to start** | **等待 WP-05 完成** |

## Runtime Console Testid 命名规范

根据 `e2e/runtime-console.spec.ts`：

| 组件 | Testid 格式 | 示例 |
|------|-------------|------|
| Tabs 容器 | `tabs` | - |
| Tab 触发器 | `tabs-trigger-{tabName}` | `tabs-trigger-overview`, `tabs-trigger-alerts` |
| Alert Center | `alert-center__*` | `alert-center__tabs`, `alert-center__create-button` |
| Runtime Observability | `runtime-observability__*` | `runtime-observability__refresh` |
| Release Ops | `release-ops__*` | `release-ops__dashboard` |
| Runtime Control Plane | `runtime-cp__*` | `runtime-cp__panel` |

## 需要更新的测试文件清单

### 1. 高优先级 - 直接涉及路由变更

| 文件 | 变更类型 | 状态 |
|------|----------|------|
| `e2e/navigation.spec.ts` | Section 名称 + 路由 | 需要更新 |
| `e2e/alerts.spec.ts` | 路由 → Runtime Console | 需要更新 |
| `e2e/release-ops-trace.spec.ts` | 路由 → Runtime Console | 需要更新 |
| `e2e/visual.spec.ts` | Visual baseline | 需要更新 |

### 2. 中优先级 - 可能需要更新

| 文件 | 原因 | 状态 |
|------|------|------|
| `e2e/runtime-console.spec.ts` | 新文件，WP-02 创建 | ✅ 已存在 |
| `e2e/route-redirect.spec.ts` | 新文件，WP-03 创建 | ✅ 已存在 |

### 3. 低优先级 - 检查确认

| 文件 | 检查项 | 状态 |
|------|--------|------|
| `e2e/smoke.spec.ts` | 是否有旧路由引用 | 需检查 |
| `e2e/organization-governance.spec.ts` | governance trace 链接 | 需检查 |

## 详细更新计划

### 1. `e2e/navigation.spec.ts`

#### 变更 1: Section 列表
```typescript
// 之前
const SIDEBAR_SECTIONS = ['home', 'build', 'govern', 'operate'] as const;

// 之后
const SIDEBAR_SECTIONS = ['home', 'use', 'develop', 'govern', 'operate'] as const;
```

#### 变更 2: 导航项列表
```typescript
// 之前
const SIDEBAR_NAV_ITEMS = [
  'overview',
  'chat',
  'notebook',
  'resource_policy',
  'agents',
  'endpoints',
  'members',
  'files',
  'audit',
  'usage',
  'runtime',        // ← 移除
  'release_ops',    // ← 移除
  'settings',
] as const;

// 之后
const SIDEBAR_NAV_ITEMS = [
  'overview',
  'chat',
  'notebook',
  'files',
  'agents',
  'endpoints',
  'resource_policy',
  'credentials',
  'members',
  'usage',
  'audit',
  'settings',
  'runtime_console',  // ← 新增
] as const;
```

#### 变更 3: 路由映射
```typescript
// 之前
const sectionsToTest = ['chat', 'resource_policy', 'agents', 'members', 'runtime', 'release_ops', 'settings'] as const;

// 之后
const sectionsToTest = ['chat', 'resource_policy', 'agents', 'members', 'runtime_console', 'settings'] as const;

// 路由映射逻辑
const expectedPath = section === 'resource_policy'
  ? '/resource-policy'
  : section === 'runtime_console'
  ? '/runtime-console'
  : `/${section}`;
```

### 2. `e2e/alerts.spec.ts`

#### 变更: 路由 → Runtime Console + tab
```typescript
// 之前
test.beforeEach(async ({ authedPage }) => {
  await goToProject(authedPage, 'alerts');
});

// 之后
test.beforeEach(async ({ authedPage }) => {
  await goToProject(authedPage, 'runtime-console');
  await authedPage.getByTestId('tabs-trigger-alerts').click();
  await authedPage.waitForTimeout(400);
});
```

#### Testid 更新
Alerts 测试已经使用 `alert-center__*` 前缀，这符合新规范，无需修改。

### 3. `e2e/release-ops-trace.spec.ts`

#### 变更: 路由 → Runtime Console + tab
```typescript
// 之前
const RELEASE_OPS_TRACE_ENTRY_PATH =
  '/en-US/workspaces/ws_default/projects/proj_001/release-ops'
  + '?gov_from=organization_overview'
  + '&gov_kind=workspace'
  + '&gov_workspace_id=ws_default'
  + '&gov_project_id=proj_001'
  + '&gov_reason=cost';

// 之后
const RELEASE_OPS_TRACE_ENTRY_PATH =
  '/en-US/workspaces/ws_default/projects/proj_001/runtime-console'
  + '?tab=control'
  + '&gov_from=organization_overview'
  + '&gov_kind=workspace'
  + '&gov_workspace_id=ws_default'
  + '&gov_project_id=proj_001'
  + '&gov_reason=cost';
```

#### Testid 更新
```typescript
// 之前
await expect(authedPage.getByTestId('release-ops__page')).toBeVisible();
await expect(authedPage.getByTestId('release-ops__governance-evidence-bridge')).toBeVisible();
const links = authedPage.locator('[data-testid^="release-ops__governance-trace-open--"]');

// 之后 (根据 runtime-console.spec.ts 的发现)
await authedPage.getByTestId('tabs-trigger-control').click();
await expect(authedPage.getByTestId('release-ops__dashboard')).toBeVisible();
// governance trace 链接可能需要确认新的 testid
```

### 4. `e2e/visual.spec.ts`

#### 移除的测试
```typescript
// 删除这些测试
test('runtime control plane', async ({ authedPage }) => { ... });
test('runtime observability', async ({ authedPage }) => { ... });
test('release ops', async ({ authedPage }) => { ... });
```

#### 新增的测试
```typescript
// Runtime Console - 各 Tab
test('runtime console - overview', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await expect(authedPage).toHaveScreenshot('runtime-console-overview.png', { fullPage: true });
});

test('runtime console - monitoring', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await authedPage.getByTestId('tabs-trigger-monitoring').click();
  await authedPage.waitForTimeout(400);
  await expect(authedPage).toHaveScreenshot('runtime-console-monitoring.png', { fullPage: true });
});

test('runtime console - alerts', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await authedPage.getByTestId('tabs-trigger-alerts').click();
  await authedPage.waitForTimeout(400);
  await expect(authedPage).toHaveScreenshot('runtime-console-alerts.png', { fullPage: true });
});

test('runtime console - control', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await authedPage.getByTestId('tabs-trigger-control').click();
  await authedPage.waitForTimeout(400);
  await expect(authedPage).toHaveScreenshot('runtime-console-control.png', { fullPage: true });
});

test('runtime console - reports', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await authedPage.getByTestId('tabs-trigger-reports').click();
  await authedPage.waitForTimeout(400);
  await expect(authedPage).toHaveScreenshot('runtime-console-reports.png', { fullPage: true });
});
```

## Visual Baseline 变更

### 删除的文件 (3个)
```
e2e/__screenshots__/visual.spec.ts/runtime-control-plane.png
e2e/__screenshots__/visual.spec.ts/runtime-observability.png
e2e/__screenshots__/visual.spec.ts/release-ops.png
```

### 新增的文件 (5个)
```
e2e/__screenshots__/visual.spec.ts/runtime-console-overview.png
e2e/__screenshots__/visual.spec.ts/runtime-console-monitoring.png
e2e/__screenshots__/visual.spec.ts/runtime-console-alerts.png
e2e/__screenshots__/visual.spec.ts/runtime-console-control.png
e2e/__screenshots__/visual.spec.ts/runtime-console-reports.png
```

## 执行步骤

### 阶段 1: 更新测试文件
1. [ ] 更新 `e2e/navigation.spec.ts`
2. [ ] 更新 `e2e/alerts.spec.ts`
3. [ ] 更新 `e2e/release-ops-trace.spec.ts`
4. [ ] 更新 `e2e/visual.spec.ts`

### 阶段 2: 更新 Visual Baseline
1. [ ] 删除旧的 baseline 文件
2. [ ] 运行 `npx playwright test e2e/visual.spec.ts --project=visual --update-snapshots`

### 阶段 3: 验证测试
1. [ ] 运行 `npm run test:e2e`
2. [ ] 运行 `npm test`
3. [ ] 检查测试覆盖率

### 阶段 4: 清理
1. [ ] 删除不再需要的辅助文件 (如果有)
2. [ ] 更新准备文档状态

## 验收标准

- [ ] 所有 testid 更新为新命名规范
- [ ] E2E 测试使用新路由
- [ ] Visual baseline 更新
- [ ] 所有测试通过: `npm test`, `npm run test:e2e`
- [ ] Coverage 不低于 40%

## 风险与注意事项

1. **Tab 切换时序**: 需要确保 tab 切换后内容已加载再进行断言
2. **Governance Trace**: `release-ops-trace.spec.ts` 中的 governance trace 链接可能需要确认新的 testid
3. **Visual Baseline**: 需要在相同环境下生成 baseline 以避免不必要的 diff
4. **路由重定向**: 确保 `route-redirect.spec.ts` 中的测试通过
