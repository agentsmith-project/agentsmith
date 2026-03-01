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
- 发布验证与 gate：  
  [release-verification.md](./user-guides/release-verification.md)
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

如果问题落在 `Members / Resource Policy / Audit / Usage / Release Ops`：

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
- [internal-release-capability-matrix.md](./release/internal-release-capability-matrix.md)
- [release-governance-control-plane.md](./user-guides/release-governance-control-plane.md)

## 5. Runtime / Usage / Release 排障

如果问题落在 runtime、usage、release gate：

1. 先看 `Release Ops` 页面里的：
   - policy enforcement
   - gate runs
   - escalations
   - incident trace
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
5. 审计、用量、release evidence 不一致

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
2. [Development Guide](../DEVELOPMENT.md)
3. [Release Verification](./user-guides/release-verification.md)
4. [Release Governance Control Plane](./user-guides/release-governance-control-plane.md)
5. [Agent Codex Notebook Runbook](./agent-codex-notebook-runbook.md)
