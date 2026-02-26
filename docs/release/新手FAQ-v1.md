# 新手 FAQ v1（测试与发布）

更新时间：2026-02-26

## 1. 我是新同学，第一天先跑什么？

先跑这 3 条：

```bash
make dev-up
make smoke-main
make smoke-governance
```

## 2. `governance` 是什么？

治理是“权限 + 限流/配额 + 审计/用量证据”的统称。  
在本项目里主要是 `Members`、`Resource Policy`、`Audit`、`Usage`。

## 3. `contracts` 是什么？

前后端约定（字段、路由、行为）的契约。  
如果契约不一致，页面可能能编译但运行报错。

## 4. 什么时候跑 `verify-contracts`？

改了 API、OpenAPI、策略字段、路由语义时必须跑：

```bash
make verify-contracts
```

## 5. `smoke-main` 和 `smoke-governance` 有什么区别？

- `smoke-main`：验证 Notebook/Agent/Files/InputRefs 主线
- `smoke-governance`：验证治理链路（页面 + 策略生效 + 审计/用量）

## 6. 为什么还有 `strict` 和 `tolerant`？

- `strict`：发布门禁，用于“是否可发布”
- `tolerant`：排障模式，用于“继续跑下去多收集线索”

发布判断只看 strict。

## 7. 一条命令做发布前验证怎么做？

```bash
make verify-release
```

它会执行契约校验 + 主线 smoke + 治理 smoke。

## 8. `demo-check` 过了，为什么后续还是失败？

常见原因是 token 在后续步骤中过期。  
现在主线和治理 smoke 都有“自动刷新 token + 重试一次”机制，但仍可能因为外部依赖异常失败。

## 9. 报 `token invalid/expired` 怎么办？

先执行：

```bash
make notebook-agent-refresh-token
```

然后重跑失败命令。

## 10. 报 API 连接失败（`localhost:20000`）怎么办？

说明 API 没起来或已退出。  
推荐直接恢复环境：

```bash
make dev-up
```

## 11. 我只改了前端 UI，也要跑治理 smoke 吗？

如果改动落在治理页面（Members/Resource Policy/Audit/Usage）或共享组件影响这些页面，建议跑。  
只改主线页面则至少跑 `smoke-main`。

## 12. 为什么命令这么多，我该记哪些？

只记 4 个：
1. `make dev-up`
2. `make smoke-main`
3. `make smoke-governance`
4. `make verify-release`

## 13. 失败时先看哪里？

按这个顺序：
1. `make notebook-agent-demo-status`
2. token 是否有效
3. API/Web 是否可达
4. `/tmp/agentsmith_demo_api.log`
5. `/tmp/agentsmith_demo_web.log`
6. `/tmp/agentsmith_demo_runner.log`

## 14. 发布前“最小通过标准”是什么？

至少通过：
- `make verify-contracts`
- `make notebook-agent-release-smoke-full`
- `make governance-release-smoke`

## 15. 发布后要做什么？

建议观察 30-60 分钟：
- 主线任务成功率
- runner 在线状态
- 治理 deny/rate/quota 的 audit/usage 证据是否持续正常

## 16. 哪里看更完整文档？

- `docs/release/测试与发布验证指南-v1.md`
- `docs/release/internal-release-checklist.md`
- `docs/release/internal-release-note-2026-02-24-governance-rc.md`
