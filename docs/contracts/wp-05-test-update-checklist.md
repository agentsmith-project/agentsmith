# WP-05: 测试更新清单

> Prepared by: Dev-4
> Date: 2026-03-02
> Status: PREPARATION - Ready for execution after WP-01, WP-02, WP-03, WP-04

## 发现

`AppShellSidebar.tsx` 已经实现了新的导航结构：
- Sections: `home`, `use`, `develop`, `govern`, `operate` ✅
- Runtime Console: `href: 'runtime-console'` ✅

这意味着 WP-01 (导航结构更新) 已经部分完成！

## 需要更新的测试文件

### 1. `e2e/navigation.spec.ts`

#### 当前状态
```typescript
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
  'runtime',        // ← 需要移除
  'release_ops',    // ← 需要移除
  'settings',
] as const;

const SIDEBAR_SECTIONS = ['home', 'build', 'govern', 'operate'] as const;
```

#### 需要更新为
```typescript
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

const SIDEBAR_SECTIONS = ['home', 'use', 'develop', 'govern', 'operate'] as const;
```

#### 路由测试更新
```typescript
// 当前路由映射
const sectionsToTest = ['chat', 'resource_policy', 'agents', 'members', 'runtime', 'release_ops', 'settings'] as const;

// 需要更新为
const sectionsToTest = ['chat', 'resource_policy', 'agents', 'members', 'runtime_console', 'settings'] as const;

// 路由映射更新
const expectedPath = section === 'resource_policy'
  ? '/resource-policy'
  : section === 'runtime_console'
  ? '/runtime-console'
  : `/${section}`;
```

### 2. `e2e/alerts.spec.ts`

#### 路由更新
```typescript
// 当前
await goToProject(authedPage, 'alerts');

// 需要更新为
await goToProject(authedPage, 'runtime-console');
// 然后切换到 alerts tab
await authedPage.getByRole('tab', { name: /alerts/i }).click();
```

#### testid 更新
| 当前 testid | 新 testid (推测) |
|-------------|------------------|
| `alert-center__create-button` | `runtime-console__alerts__create-button` |
| `alert-rules-list` | `runtime-console__alerts__rules-list` |
| `alert-rule-form-dialog` | `runtime-console__alerts__rule-form-dialog` |
| `alert-notifications` | `runtime-console__alerts__notifications` |
| `alert-rule-card` | `runtime-console__alerts__rule-card` |
| `alert-rule-toggle` | `runtime-console__alerts__rule-toggle` |

### 3. `e2e/release-ops-trace.spec.ts`

#### 路由更新
```typescript
// 当前路径
const RELEASE_OPS_TRACE_ENTRY_PATH =
  '/en-US/workspaces/ws_default/projects/proj_001/release-ops'
  + '?gov_from=organization_overview'
  + '&gov_kind=workspace'
  + '&gov_workspace_id=ws_default'
  + '&gov_project_id=proj_001'
  + '&gov_reason=cost';

// 需要更新为
const RELEASE_OPS_TRACE_ENTRY_PATH =
  '/en-US/workspaces/ws_default/projects/proj_001/runtime-console'
  + '?tab=control'
  + '&gov_from=organization_overview'
  + '&gov_kind=workspace'
  + '&gov_workspace_id=ws_default'
  + '&gov_project_id=proj_001'
  + '&gov_reason=cost';
```

#### testid 更新
| 当前 testid | 新 testid (推测) |
|-------------|------------------|
| `release-ops__page` | `runtime-console__control__page` |
| `release-ops__governance-evidence-bridge` | `runtime-console__control__governance-evidence-bridge` |
| `release-ops__governance-trace-open--` | `runtime-console__control__trace-open--` |

### 4. `e2e/visual.spec.ts`

#### 移除的测试
```typescript
// 这些测试需要移除或替换
test('runtime control plane', async ({ authedPage }) => { ... });
test('runtime observability', async ({ authedPage }) => { ... });
test('release ops', async ({ authedPage }) => { ... });
```

#### 新增的测试
```typescript
// 新增 Runtime Console 测试
test('runtime console - overview', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  await expect(authedPage).toHaveScreenshot('runtime-console-overview.png', { fullPage: true });
});

test('runtime console - monitoring', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  const tab = authedPage.getByRole('tab', { name: /monitoring/i });
  if (await tab.isVisible()) {
    await tab.click();
    await authedPage.waitForTimeout(400);
  }
  await expect(authedPage).toHaveScreenshot('runtime-console-monitoring.png', { fullPage: true });
});

test('runtime console - alerts', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  const tab = authedPage.getByRole('tab', { name: /alerts/i });
  if (await tab.isVisible()) {
    await tab.click();
    await authedPage.waitForTimeout(400);
  }
  await expect(authedPage).toHaveScreenshot('runtime-console-alerts.png', { fullPage: true });
});

test('runtime console - control', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  const tab = authedPage.getByRole('tab', { name: /control/i });
  if (await tab.isVisible()) {
    await tab.click();
    await authedPage.waitForTimeout(400);
  }
  await expect(authedPage).toHaveScreenshot('runtime-console-control.png', { fullPage: true });
});

test('runtime console - reports', async ({ authedPage }) => {
  await stableNavigate(authedPage, projectPath('runtime-console'));
  const tab = authedPage.getByRole('tab', { name: /reports/i });
  if (await tab.isVisible()) {
    await tab.click();
    await authedPage.waitForTimeout(400);
  }
  await expect(authedPage).toHaveScreenshot('runtime-console-reports.png', { fullPage: true });
});
```

### 5. Visual Baseline 更新

需要删除旧的 baseline 文件：
- `e2e/__screenshots__/runtime-control-plane.png`
- `e2e/__screenshots__/runtime-observability.png`
- `e2e/__screenshots__/release-ops.png`

需要生成新的 baseline 文件：
- `e2e/__screenshots__/runtime-console-overview.png`
- `e2e/__screenshots__/runtime-console-monitoring.png`
- `e2e/__screenshots__/runtime-console-alerts.png`
- `e2e/__screenshots__/runtime-console-control.png`
- `e2e/__screenshots__/runtime-console-reports.png`

## 执行步骤

1. **更新测试文件** (按顺序):
   - [ ] `e2e/navigation.spec.ts`
   - [ ] `e2e/alerts.spec.ts`
   - [ ] `e2e/release-ops-trace.spec.ts`
   - [ ] `e2e/visual.spec.ts`

2. **更新 Visual Baseline**:
   - [ ] 删除旧的 baseline 文件
   - [ ] 运行 `npx playwright test e2e/visual.spec.ts --project=visual --update-snapshots`

3. **运行测试验证**:
   - [ ] `npm run test:e2e` - 所有 e2e 测试通过
   - [ ] `npm test` - 单元测试通过
   - [ ] 确认覆盖率不低于 40%

## 注意事项

1. **Tab 导航**: Runtime Console 使用 tab 结构，需要确保测试正确切换 tab
2. **testid 命名规范**: 新的 testid 应该遵循 `scope__element__state` 格式
3. **路由参数**: 需要使用 `?tab=` 参数来指定 Runtime Console 的 tab
4. **Governance Trace**: 确保 governance trace 链接在新的 Runtime Console 中正常工作

## 相关文档

- `docs/plans/next-mainline-execution-hold-plan-v1.md`
- `e2e/fixtures/test-base.ts` - 测试工具函数
- `src/components/app-shell/AppShellSidebar.tsx` - 当前的导航结构
