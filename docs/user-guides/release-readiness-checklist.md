# 发布前检查清单

这份清单用于当前 MVP 的最终发布验收。

术语边界：

- 这里的 `release` 仅表示工程验收与上线准备流程
- 不代表 AgentSmith 提供 DevOps 发布管理能力

## 通过标准

只有下面 4 类检查都通过，当前版本才可视为 `ready for release`：

1. 合约与类型检查通过
2. 默认业务链与治理门禁通过
3. 真实 notebook 主线通过
4. 全量 visual 与两条部署排演通过

## 环境前提

发布级验证前，先确认：

1. Keycloak 集成依赖可用
2. 用于真实 notebook 主线的 `BACKEND_REAL_API_KEY` 已配置
3. 本地没有残留的多余 `next dev` 进程

## 验证顺序

命名约定：

- `npm run` 是当前权威命令名
- 这里保留的 `make` 写法只是同一路径的便捷包装

按下面顺序执行：

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

1. `npm run gate:default` 只覆盖默认业务链与治理门禁，以及它们各自内嵌的 targeted visual。
2. `npm run lane:visual` 是唯一 full visual 验证通道，不能被 `gate:default` 代替。
3. `npm run lane:demo-rehearsal` 与 `npm run lane:cluster-rehearsal` 是 release 级部署排演证据通道。
4. `npm run gate:release:full` 是完整发布验收命令；它不会替代单独排查时的分步执行，但定义了最终一键验收真相。

`npm run gate:release` 会基于当前发布状态机校验发布级工程门禁、真实 notebook 主线、Feishu 人工步骤完成状态，以及真实环境截图巡检。

真实截图默认输出到：

```bash
artifacts/backend-real-visual/<run-id>/
```

目录内会生成：

- `manifest.json`
- `review.md`
- 所有主要界面截图

## 身份与权限检查点

发布前额外确认：

1. `system 管理侧` 选择 `workspace admin` 时使用 email 搜索
2. 工作区设置里的 `project creators` 使用 email 搜索与多选
3. 正式权限对象保存的是 `user_id`
4. 历史工作区配置记录若仍是旧 email / 旧字符串，管理员知道需要重新选择并保存以完成绑定

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
