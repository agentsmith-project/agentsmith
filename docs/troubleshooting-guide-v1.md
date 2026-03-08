# AgentSmith Troubleshooting Guide v1

更新时间：2026-03-01  
状态：`current-baseline`

这份文档只保留当前仍然有效的排障入口，不再重复历史阶段性流程、过时环境值或已被新版 user guide 取代的说明。

## 1. 先判断是哪一类问题

1. 本地环境没有起来  
2. token / 登录态失效  
3. real-backend 行为和 mock lane 不一致  
4. 上游 LLM / provider 短时不稳定  
5. 契约、类型或页面断言真的坏了

## 2. 当前统一排障顺序

1. 看服务是否在线  
```bash
curl http://localhost:20000/health
curl http://localhost:3001/en-US/login
```

2. 看 token 是否需要刷新  
```bash
make notebook-agent-refresh-token
```

3. 看 demo / runner 状态  
```bash
make notebook-agent-demo-status
```

4. 再看对应 lane 的正式入口  
- Notebook / external agent / benchmark / traces：  
  [agent-codex-notebook-runbook.md](./agent-codex-notebook-runbook.md)
- CI / integration 环境问题：  
  [ci-integration-troubleshooting.md](./ci-integration-troubleshooting.md)

## 3. 最常用恢复命令

### 刷新用户 token
```bash
make notebook-agent-refresh-token
```

### 重启 demo 环境
```bash
make notebook-agent-demo-down
make notebook-agent-demo-up
```

### 仅重启 managed runner
```bash
GLM_API_KEY=<your-key> make notebook-agent-demo-restart-runner
```

### 重新初始化 demo 资源
```bash
./scripts/notebook-agent-init-resources.sh
```

## 4. 治理链路排障

如果问题落在 `Members / Resource Policy / Audit / Usage / Runtime Console`：

1. 先跑正式 smoke，不先猜  
```bash
make governance-release-smoke
```

2. 如果只想定位页面级问题  
```bash
make governance-pages-real-backend-smoke-strict
make governance-pages-real-backend-interaction-smoke-strict
```

3. 如果怀疑是治理 effect 没真正生效  
直接看：
- [Audit & Usage Reports](./user-guides/audit-usage-reports.md)
- [Cost & Limits Dashboard](./user-guides/cost-limits-dashboard.md)

## 5. Runtime / Usage / Governance 排障

如果问题落在 runtime、usage、治理链路：

1. 先看 `Runtime Console` + `Usage` + `Audit` 的治理证据链：
   - runtime control/monitoring 状态
   - usage/cost/rate-spending 指标
   - audit 的 deny/quota/policy 命中证据
2. 再跑：
```bash
npm run release:report -- --name local-debug
```

## 6. 如何区分“外部波动”还是“结构性故障”

按这个标准判断：

### 可接受的短时波动
1. provider `429`
2. timeout / retry 后恢复
3. allow-path 请求慢，但 deny 预检和治理证据正确

### 必须修复的结构性故障
1. typecheck / contract 失败
2. route authz 语义错误
3. policy 配了但后端不生效
4. token / SSE ticket 链路设计错误
5. 审计、用量、治理证据不一致

## 7. 当前有效的环境基线

本地 real-backend 常用值：

```bash
NEXT_PUBLIC_API_BASE=http://localhost:20000
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

如果你看到带 `/api/v1` 的旧前端环境示例，把它当成历史内容，不要继续使用。

## 8. 不再推荐的做法

1. 不要把旧版 FAQ 当作当前 runbook  
2. 不要把阶段性 phase plan 当作当前执行入口  
3. 不要在服务未确认启动前直接怀疑页面断言  
4. 不要把上游短时 429 当成平台代码回归  

## 9. 相关入口

1. [Documentation Index](./README.md)
2. [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
3. [Development Guide](../DEVELOPMENT.md)
4. [User Guides Index](./user-guides/README.md)
5. [Agent Codex Notebook Runbook](./agent-codex-notebook-runbook.md)

## Token Issues

Token 排障遵循上文 `2` 和 `3` 节：先确认服务在线，再执行 `make notebook-agent-refresh-token`，最后回到对应 lane 验证。

## Network Issues

网络类问题先区分上游短时抖动和结构性故障，执行上文 `2` 和 `6` 节步骤，并在治理证据报告中核对失败分类。

## Backend Issues

后端行为异常统一按治理链路排障：先跑 `make governance-release-smoke`，再按 `Members / Resource Policy / Audit / Usage / Runtime Console` 定位。

## Timeout Issues

超时问题优先检查 provider 短时波动、runner 健康、以及重试后是否恢复；无法恢复时按结构性故障处理并升级到治理证据。
