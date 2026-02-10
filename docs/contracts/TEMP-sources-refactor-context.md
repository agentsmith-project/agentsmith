# TEMP - Sources Refactor Context Snapshot (2026-02-10)

> 临时上下文文档。用于中断后快速恢复工作，不作为最终契约文档。

## 1. 当前主线状态

- 分支：`main`
- 冻结点：`b38ddfb`（移除 chat 消息气泡左下角 Branch badge；sources 拆分仍停留在第一刀之后）
- 当前文档状态：已提交（TEMP 文档仍保留用于后续恢复上下文）
- 当前目标：推进模块化收口流程（chat -> endpoints -> sources）
- 本文档对应中断点：`sources` 模块拆分进行中（已完成第一刀）

## 2. 已完成（本轮相关）

### Chat

- 已完成 chat 紧凑线程栏 + 超宽布局模式 + 持久化 + e2e + visual
- 已有手动验收清单：
- `docs/contracts/chat-manual-acceptance-checklist.md`

### Endpoints（已收口）

- 路由薄化 + 组件抽离：
- `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx`
- `src/components/endpoints/EndpointsPage.tsx`
- hooks 抽离：
- `src/lib/endpoints/use-endpoints-data.ts`
- `src/lib/endpoints/use-endpoints-mutations.ts`
- `src/lib/endpoints/use-endpoints-table-columns.tsx`
- 类型与测试：
- `src/lib/endpoints/types.ts`
- `src/lib/endpoints/__tests__/use-endpoints-data.test.tsx`
- `src/lib/endpoints/__tests__/use-endpoints-mutations.test.tsx`
- 文档：
- `docs/contracts/endpoints-frontend-module-map.md`
- `docs/contracts/endpoints-closeout-summary.md`

### Sources（进行中）

- 已建立模块契约文档：
- `docs/contracts/sources-frontend-module-map.md`
- 已完成第一刀拆分（状态层）：
- 新增 `src/lib/hooks/use-sources-query-state.ts`
- `src/lib/hooks/use-sources-list.ts` 已接入该 hook
- 已修复拆分后 hook deps lint 警告

## 3. 最近关键提交

- `92c26bb` docs(contracts): finalize endpoints closeout and start sources module map
- `ef582bb` refactor(sources): extract query state hook from use-sources-list
- `cc7d638` test(endpoints): complete data/mutation hook coverage and update contract status
- `eaaf787` refactor(endpoints): extract table columns module for page composition
- `0244756` refactor(endpoints): extract data/mutation hooks and add mutation hook tests
- `d7f2983` refactor(endpoints): extract route page body into EndpointsPageView

## 4. 已验证结果（中断前）

### Sources

- Unit:
- `npm test -- src/lib/hooks/__tests__/use-sources-list.test.tsx src/lib/hooks/__tests__/use-sources.test.tsx 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/sources/__tests__/page.test.tsx'`
- 结果：通过
- E2E:
- `npm run test:e2e -- e2e/sources.spec.ts --project=chromium --workers=1`
- 结果：15/15 通过
- Visual:
- `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "sources"`
- 结果：1/1 通过

### Endpoints

- Unit + Hook tests + e2e + visual 均通过（收口状态 completed）

## 5. 下一步待做（sources）

注意：Sources 模块目标已变更为 “MinIO-like object browser”，AIReady/plugin processing 暂不做。
契约以 `docs/contracts/sources-object-browser-contract.md` 为准。

1. 先完成契约与 MSW 对齐（避免 UI/Mock 漂移）：
- 新增对象浏览相关 endpoints 的 MSW handlers
- 更新 `e2e/sources.spec.ts` 的选择器与行为断言（按新 UX）
2. 将现有 “文件列表 + AIReady” UI 替换为对象浏览器 UI：
- libraries 左侧列表/选择
- prefix breadcrumb + objects table
- upload / create folder / rename / delete / download
- details panel（最小版：meta + key + size + last_modified）
3. 再进行“拆 hook + 补测”收口：
- `use-source-browser-state`
- `use-source-objects`
- `use-source-object-actions`
- `use-source-libraries`
4. 每一步都保持以下 gates 绿灯：
- sources unit tests
- `e2e/sources.spec.ts`
- `visual --grep "sources"`
- `tsc --noEmit`
- `eslint --max-warnings=0`

## 6. 约束提醒

- 保持 KISS/DRY/SOLID/YAGNI
- 不引入迁移期 fallback 或 feature toggle
- 保持 contracts 文档同步更新
- 快照目录不提交 git（项目约定）
