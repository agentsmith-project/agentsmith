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
make substrate-status
make local-manual-status
```

2. 看前端/API 是否在线
```bash
curl http://localhost:20000/health
curl http://localhost:3001/en-US/login
```

3. 如需刷新本地登录态
```bash
make notebook-agent-refresh-token
```

4. 再进入对应主链：
- notebook / terminal / runner： [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
- CI / integration： [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)
- 文件库本地挂载： [File Library Client Mount](./user-guides/file-library-local-mount.md)

## 3. 最常用恢复命令

### 重启本地真实手测环境
```bash
make local-manual-down
make local-manual-up
make local-manual-seed-notebook
```

### 仅重启 runner / demo resources
```bash
make local-manual-seed-notebook
```

### 重建底座
```bash
make substrate-reset
```

### 重建 backend-real stack
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
5. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
