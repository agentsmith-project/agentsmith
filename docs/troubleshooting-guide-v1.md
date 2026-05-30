# AgentSmith Troubleshooting Guide v1

更新时间：2026-04-11  
状态：`current-baseline`

这份文档只保留当前有效的排障入口与恢复顺序。

## 1. 先判断问题类型

1. 本地环境没起来
2. token / 登录态失效
3. mock lane 和 real backend 行为不一致
4. 上游 provider 短时波动
5. contract / type / route / product logic 真坏了

## 2. 当前统一排障顺序

1. 看运行线状态
```bash
make local-real-status
```

2. 如运行线未启动，先启动 clean local-real path
```bash
make local-real-up
```

3. 看前端/API 是否在线
```bash
curl http://localhost:20000/health
curl http://localhost:3001/en-US/login
```

4. 如需刷新本地登录态
```bash
make agent-runner-refresh-token
```

5. 再进入对应主链：
- Agent tasks / terminal / runner: [Agent Task Runner Runbook](./agent-task-runner-runbook.md)
- CI / integration： [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)
- 文件库访问模型： [File Library Access Model](./user-guides/file-library-access-model.md)

## Token Issues

这些分区是给新人快速定位用的稳定锚点，不取代上面的统一排障顺序。遇到 token / login state 问题时，先确认当前运行线已启动，再检查浏览器登录态和本地 token 刷新链路。

Common symptoms:
- 页面跳回登录页或工作区选择页。
- SSE / backend-real 请求返回 `401` 或 `403`。
- Agent task / terminal runner 显示认证上下文不可用。

Recommended checks:
```bash
make local-real-status
make agent-runner-refresh-token
```

## Network Issues

网络问题通常表现为前端、API、Keycloak、provider 或本地代理之间无法互通。先确认服务是否在线，再判断是本地端口、代理环境变量还是上游 provider 抖动。

Common symptoms:
- `curl` health check 失败。
- Playwright 页面长时间停在 loading。
- provider callback 超时或短时 `429`。

Recommended checks:
```bash
curl http://localhost:20000/health
curl http://localhost:3001/en-US/login
```

## Backend Issues

后端问题的判断标准是 contract、权限、数据真相或治理证据不一致，而不是单个前端断言失败。先保留 run-scoped evidence，再用 clean real verification 入口复现。

Common symptoms:
- mock lane 正常但 real backend 行为不同。
- Policy、Audit、Usage 或 membership 状态与后端返回不一致。
- backend-real evidence 缺少 `result.json`、review 或 ux-trace。

Recommended checks:
```bash
make local-real-status
npm run verify -- --goal=real --run
```

## Timeout Issues

超时问题要先区分可恢复的上游慢响应和结构性等待条件错误。不要只延长 timeout；应确认等待对象、runner 状态、SSE 或 callback 是否有明确完成信号。

Common symptoms:
- visual / e2e 停在 loading 或 skeleton。
- login callback、terminal truth、runner status 长时间未收敛。
- retry 后偶发恢复，但 evidence 没有记录最终状态。

Recommended checks:
```bash
make local-real-status
npm run verify -- --goal=real --run
```

## 3. 最常用恢复命令

### 启动或恢复本地真实环境
```bash
make local-real-status
make local-real-up
```

### 重建本地真实环境
重新初始化本地真实环境时，单独运行 reset；它会清理并重新拉起环境。

```bash
make local-real-reset
```

从干净或已停止状态启动时，运行：

```bash
make local-real-up
```

reset 后不要再追加 `make local-real-up`；要查看状态运行：

```bash
make local-real-status
```

### Maintainer-only: 重建 backend-real stack
只有在 clean status / verify 路径失败，且 owner diagnostics 或 runbook 指向 backend-real stack recovery 时才使用。

```bash
npm run backend-real:reset
npm run backend-real:bootstrap
npm run backend-real:ready
```

## 4. Governance chain troubleshooting

如果问题落在治理链路：
- `Members`
- `Policy`
- `Audit`
- `Usage`
- alerts / notifications

先跑：
```bash
make governance-smoke
```

如果只想定位页面/交互层：
```bash
make governance-pages-real-backend-smoke-strict
make governance-pages-real-backend-interaction-smoke-strict
```

## 5. Evidence paths

### 日常失败排查
- `test-results/`

### backend-real run-scoped state
- `artifacts/backend-real/runs/<run-id>/...`

### backend-real visual review
- `artifacts/backend-real-visual/<run-id>/review.md`
- `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`

说明：
- current docs 一律指向 run-scoped `artifacts/backend-real/runs/<run-id>/...`

## 6. 如何区分外部波动还是结构性故障

### 可接受的短时波动
1. provider `429`
2. timeout / retry 后恢复
3. 上游暂时抖动，但 contract、权限与 evidence 仍正确

### 必须修复的结构性故障
1. `npx tsc --noEmit` 失败
2. `npm run contracts:check` 失败
3. route authz 语义错误
4. Policy 配了但后端不生效
5. 审计、用量、治理证据不一致

## 7. 当前有效环境基线

```bash
NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

## 8. 不再推荐的做法

1. 不要把阶段性 plan / retro / phase 文档当当前 runbook
2. 不要把一次性 smoke / MVP task 文档当当前执行入口
3. 不要在服务未确认启动前直接怀疑页面断言
4. 不要把上游短时 429 当成平台代码回归

## 9. Related entries

1. [Documentation Index](./README.md)
2. [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
3. [Development Guide](../DEVELOPMENT.md)
4. [User Guides Index](./user-guides/README.md)
5. [Agent Task Runner Runbook](./agent-task-runner-runbook.md)
