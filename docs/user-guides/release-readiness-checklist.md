# 发布前检查清单

这份清单用于当前版本的最终发布验收。

术语边界：
- 这里的 `release` 仅表示工程验收与上线准备流程
- 不代表 AgentSmith 提供对外 DevOps 发布管理能力

## 通过标准

只有下面 4 类检查都通过，当前版本才可视为 `ready for release`：
1. 合约与类型检查通过
2. 默认业务链与治理门禁通过
3. release-grade backend-real 验证通过
4. full visual 与两条部署排演通过

## 环境前提

发布级验证前，先确认：
1. Keycloak 集成依赖可用
2. 真实 backend-real 所需的 endpoint / API key 已配置
3. 本机没有残留的多余 `next dev` 进程与 scenario

## 验证顺序

```bash
npm run gate:fast
npm run gate:default
npm run lane:visual
npm run backend-real:reset
npm run backend-real:bootstrap
npm run backend-real:ready
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
npm run backend-real:run
npm run backend-real:report
npm run gate:release
npm run lane:demo-rehearsal
npm run lane:cluster-rehearsal
npm run gate:release:full
```

说明：
1. `npm run gate:default` 只覆盖默认业务链与治理门禁，以及它们自己的 targeted visual。
2. `npm run lane:visual` 是唯一 full visual 验证通道，不能被 `gate:default` 代替。
3. `npm run lane:demo-rehearsal` 与 `npm run lane:cluster-rehearsal` 都必须从各自 scenario-owned local kind world 的 clean reset 开始。
4. `npm run gate:release:full` 是完整发布验收命令，也是最终 release verdict 入口。

## 当前证据路径

- backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
- demo rehearsal report：
  - `artifacts/runtime/scenario/demo-rehearsal/reports/<timestamp>.md`
- cluster rehearsal report：
  - `artifacts/runtime/scenario/cluster-rehearsal/reports/<timestamp>.md`

## 失败时的处理原则

如果门禁失败：
1. 只修阻塞发布的问题
2. 不顺带扩新功能
3. 如果是 visual 差异，先确认是否为真实 UX/UI 变更
4. 只有在页面行为正确且变更合理时才更新基线

## 最终结论模板

发布结论只允许两种：
- `ready for release`
- `not ready for release`

如果 `not ready for release`，必须同时列出：
1. 阻塞项
2. 失败命令
3. 最小修复方向
