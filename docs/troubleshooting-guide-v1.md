# AgentSmith Troubleshooting Guide v1

更新时间：2026-03-01  
状态：`current-baseline`

这份文档只保留当前仍然有效的排障入口，不再重复历史阶段性流程、过时环境值或已被新版 user guide 取代的说明。

术语边界：文中的 `governance-smoke`、`governance:report` 等命令名是当前保留的 focused verification / evidence commands，仅用于本项目工程验收与排障；`permission gate` 仅表示产品权限门禁语义，不代表平台对外发布管理能力。

当前工程术语与命令模型统一见：
- [Current Engineering Governance Model](./current-engineering-governance-model.md)

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
make local-manual-status
```

4. 再看对应 lane 的正式入口  
- Notebook / external agent / benchmark / traces：  
  [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
- CI / integration 环境问题：  
  [ci-integration-troubleshooting.md](./ci-integration-troubleshooting.md)

## 3. 最常用恢复命令

### 刷新用户 token
```bash
make notebook-agent-refresh-token
```

### 重启 demo 环境
```bash
make local-manual-down
make local-manual-up
make local-manual-seed-notebook
```

### 仅重启 managed runner
```bash
make local-manual-seed-notebook
```

### 重新初始化 demo 资源
```bash
make local-manual-seed-notebook
```

### Files / Desktop 挂载联调
```bash
cd /home/percy/works/mbos-v1/agentsmith-desktop
npm run smoke:local-manual-mount
```

### Files 管理侧 UX 发布验收
```bash
cd /home/percy/works/mbos-v1/agentsmith
npm run test:e2e:integration:files:management-ux
```

### Notebook Terminal backend-real smoke
```bash
cd /home/percy/works/mbos-v1/agentsmith
npm run test:notebook:backend-real:terminal
```

Notebook Terminal 的当前产品规则：
- 打开 terminal 时，系统会自动准备这个 task 的运行环境；用户不需要区分 internal / external runner 是否已预热
- terminal 内改动的文件会保留在当前 task workspace
- terminal 内临时 shell 状态只在当前 terminal session 有效，不会自动影响后续 agent run
- 默认不承诺 `sudo`；terminal 面向的是 task 工作环境，不是主机提权入口
- 长运行前台程序应支持 `Ctrl-C` / `Ctrl-D` 等标准终端交互
- `Hide Terminal` 只收起 terminal 工作面；`Close terminal` 才会结束当前 shell session
- 刷新页面或短时断线后，系统会优先恢复同一个 terminal session；如果另一个标签页已经接管该 terminal，会显示友好提示并要求重新打开

Terminal 发布前最小门禁：
```bash
cd /home/percy/works/mbos-v1/agentsmith
npx tsc --noEmit
npm run test:notebook:backend-real:terminal:matrix
npm run test:e2e:integration:notebook:terminal:ux
```

截图验收重点：
- active 态：header 是 `Hide Terminal`，panel 内是 `Close terminal`
- connecting 态：用户知道系统在准备/连接，而不是页面卡死
- failed 态：显示普通用户语言，不暴露原始错误码

## 4. 治理链路排障

如果问题落在 `Members / Resource Policy / Audit / Usage`：

1. 先跑正式 smoke，不先猜  
```bash
make governance-smoke
```

2. 如果只想定位页面级问题  
```bash
make governance-pages-real-backend-smoke-strict
make governance-pages-real-backend-interaction-smoke-strict
```

3. 如果怀疑是治理 effect 没真正生效  
直接看：
- [Audit & Usage](./user-guides/audit-usage-reports.md)

## 5. Audit / Usage / Governance 排障

如果问题落在 audit、usage、治理链路：

1. 先看 `Usage` + `Audit` 的治理证据链：
   - usage/cost/rate-spending 指标
   - audit 中的变更、事件、异常与 deny/limit/policy 命中证据
2. 再跑工程诊断报告：
```bash
npm run governance:report -- --name local-debug
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
NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

如果你看到不带 `/api/v1` 的旧前端环境示例，把它当成历史内容，不要继续使用。

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
5. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
6. [File Library Client Mount](./user-guides/file-library-local-mount.md)

## Files / Desktop Mount Issues

如果问题是：
- Desktop 看不到某个文件库
- Desktop 挂载失败
- Files 里出现 `failed` / `degraded` 文件库

先按下面判断：

1. Desktop 里看不到文件库
- 先不要怀疑 Desktop。
- 这通常表示该文件库不是可挂载状态。
- 回到 Files 页面检查该库是否为 `ready`。

2. Files 页面中该库是 `failed` / `degraded`
- 这属于文件库管理侧问题。
- 先治理文件库本身，再回到 Desktop。
- 当前策略是不提供一键“重新初始化”。
- 最佳实践是人工判断后删除并重建，避免不透明的恢复动作带来额外存储副作用。

3. 只在本地挂载链路出问题
- 直接看：
  - [File Library Client Mount](./user-guides/file-library-local-mount.md)

4. 想确认 Files 页面是否符合正常人心智
- 跑真实 walkthrough，而不是只看组件测试：
```bash
npm run test:e2e:integration:files:management-ux
```
- 这条命令会自动登录真实环境、验证 `ready` / `degraded` 文件库展示，并产出截图证据。
- 截图产物默认写到：
  - `test-results/.../files-ready-overview.png`
  - `test-results/.../files-degraded-overview.png`
  - `test-results/.../files-degraded-delete-dialog.png`

## Token Issues

Token 排障遵循上文 `2` 和 `3` 节：先确认服务在线，再执行 `make notebook-agent-refresh-token`，最后回到对应 lane 验证。

## Network Issues

网络类问题先区分上游短时抖动和结构性故障，执行上文 `2` 和 `6` 节步骤，并在 smoke 输出工件中核对失败分类。

## Backend Issues

后端行为异常统一按治理链路排障：先跑 `make governance-smoke`，再按 `Members / Resource Policy / Audit / Usage` 定位。

## Timeout Issues

超时问题优先检查 provider 短时波动、runner 健康、以及重试后是否恢复；无法恢复时按结构性故障处理并升级到治理证据。
