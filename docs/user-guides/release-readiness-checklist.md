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
4. full visual、machine-readable story evidence 与两条部署排演通过

补充判定规则：
1. 当前 automated release-grade verdict 统一以 `npm run gate:release:full` 为准。
2. `npm run gate:default` 不能代替 full visual，也不能代替 release-grade backend-real 或最终 release verdict。
3. 对 evidence-owning gates 和 lanes，`command passed` 与 machine-readable evidence completeness 同级；缺少 required review artifacts、`visual_scene_catalog` 或 `ux_trace_bundle`，都不能算通过。
4. 对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的 gate/lane，还必须存在 canonical `<evidence_dir>/result.json`。
5. `result.json` 里的 `failure_class` 是 gate verdict 字段，不等于排障脚本或 incident 复盘里的 troubleshooting 分类。

## 环境前提

发布级验证前，先确认：
1. Keycloak 集成依赖可用
2. 真实 backend-real 所需的 endpoint / API key 已配置
3. 本机没有残留的多余 `next dev` 进程与 scenario

## 自动化与手工边界

1. 本文里的自动化 release-grade campaign，指当前 machine-readable gates、lanes 与 release-grade backend-real 命令链。
2. `make manual-feishu-*` 属于 release operator 手工联调步骤，不属于 automated gate identity，也不会改变 canonical gate-result schema。
3. 如果当前 release scope 需要 Feishu 联调，手工步骤仍然可能影响最终放行判断；但它们必须与 automated verdict 分层记录，不能伪装成“某个 gate 已经覆盖”。

## 验证顺序

### 1. 自动化 release-grade campaign

```bash
npm run gate:fast
npm run gate:default
npm run lane:visual
npm run backend-real:reset
npm run backend-real:bootstrap
npm run backend-real:ready
npm run backend-real:run
npm run backend-real:report
npm run gate:release
npm run lane:demo-rehearsal
npm run lane:cluster-rehearsal
npm run gate:release:full
```

说明：
1. `npm run gate:default` 只覆盖默认业务链与治理门禁，以及它们自己的 targeted visual。
2. `npm run lane:visual` 是唯一 full visual 验证通道，不能被 `gate:default` 代替，并且它承担 `visual_scene_catalog` 证据所有权。
3. `npm run gate:release` / `npm run lane:backend-real:release` 承担 `ux_trace_bundle` 证据所有权。
4. `npm run lane:demo-rehearsal` 与 `npm run lane:cluster-rehearsal` 都必须从各自 scenario-owned local kind world 的 clean reset 开始。
5. `npm run gate:release:full` 是完整发布验收命令，也是最终 release verdict 入口。
6. 如果某条 focused 测试、targeted lane 或 backend-real 局部命令通过，只能说明对应诊断切片恢复了，不能替代上面这条 automated verdict 链。

### 2. 手工 Feishu 联调步骤

当当前 release scope 明确包含 Feishu 联调或 Feishu 访问入口验收时，再执行：

```bash
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
```

说明：
1. 这组步骤属于 operator 手工联调，不属于 automated gate。
2. 它们可以作为 release sign-off 的补充条件，但不能替代 `gate:release:full`。
3. 如果这里失败，应在 release 结论中单独记录为手工集成阻塞，而不是改写 automated gate truth。

## 当前证据路径

- full visual scene catalog：
  - `e2e/visual-baseline-support.ts`
  - `e2e/__screenshots__/visual.spec.ts`
- backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces`
- demo rehearsal report：
  - `artifacts/runtime/scenario/demo-rehearsal/reports/<timestamp>.md`
- cluster rehearsal report：
  - `artifacts/runtime/scenario/cluster-rehearsal/reports/<timestamp>.md`

## 当前 story evidence 真相

- `visual_scene_catalog`
  - owner: `test:visual`, `lane:visual`
  - source: `e2e/visual-baseline-support.ts`
- `ux_trace_bundle`
  - owner: `gate:release`, `lane:backend-real:release`
  - root: `artifacts/backend-real-visual/<run-id>/ux-traces`

## 失败时的处理原则

如果门禁失败：
1. 只修阻塞发布的问题
2. 不顺带扩新功能
3. 如果是 visual 差异，先确认是否为真实 UX/UI 变更
4. 只有在页面行为正确且变更合理时才更新基线
5. 先判断这是 automated verdict 失败、evidence 缺失，还是手工联调失败；不要把不同层次的问题混成同一条结论
6. focused 诊断命令只用于缩小范围；最终仍要回到 automated release-grade campaign 重新给出 verdict

## 最终结论模板

发布结论只允许两种：
- `ready for release`
- `not ready for release`

如果 `not ready for release`，必须同时列出：
1. 阻塞项
2. 失败命令
3. 最小修复方向
