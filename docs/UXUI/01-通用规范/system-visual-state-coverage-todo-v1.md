# System Visual State Coverage

Last updated: 2026-03-15  
Owner: Frontend

## Current status

`system` 页面当前已经具备稳定 visual 覆盖，包含：

1. `system login`
2. `system workspaces`
3. `system workspaces edit mode`
4. `system workspaces failed state`
5. `system workspaces delete confirmation`
6. `system info`

## Fixture shape

当前 mock visual lane 使用专用 seeded-state 辅助入口来准备 `system 管理侧` 状态：

1. `empty`
2. `with_workspace`
3. `with_disabled_workspace`
4. `with_failed_workspace`

实现目标已经完成：

1. 不在 `visual.spec.ts` 里通过长 UI 链造状态
2. 不依赖前一个 visual 用例留下状态
3. `system` 状态准备与工作区业务 visual 隔离

## Follow-up boundary

当前 MVP 不再缺少高价值 `system` visual 状态。后续如继续扩展，只允许补：

1. 新增 `system` 页面时同步加 visual
2. 明确由产品新增的新状态，而不是为了截图继续制造额外测试状态
