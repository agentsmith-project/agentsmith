# 后端数据持久化成熟度改进清单

Last updated: 2026-03-18  
Owner: API entry  
Audience: 架构评审、后端、发布负责人

## 1. 目标

本清单用于把当前系统从：

- 主数据已经产品化

继续提升到：

- 多实例更稳
- 故障恢复更强
- 部署前提更明确
- 运维排障更简单

本清单不是对当前系统“必须修复的阻塞问题”列表，而是**下一阶段成熟度提升路线图**。

## 2. 当前判断

当前系统已经完成：

- 主数据统一进入 `docStore` / Mongo
- 共享运行态关键项进入 Redis / shared cache
- workspace 配置 JSON legacy 已清理
- 旧 in-memory governance/file-library 真相已清理

当前剩余需要增强的，不再是“数据没真正落库”，而是以下 4 类成熟度议题：

1. 进程内瞬态运行控制的 HA 边界
2. SSE 与 gateway 等连接态的多实例边界
3. 条件通过模块的部署前提文档化
4. 内部工程证据链与产品主数据边界继续收口

## 3. 优先级清单

### P1：Notebook 执行控制共享化（条件化提升项）

对象：

- `task-runtime-state`
- `notebook-task-sse-broker`

当前问题：

- task 主数据已持久化
- 但 active run、cancel handle、部分热缓存仍在当前进程

建议目标：

- 若未来目标是多实例 HA notebook 执行控制：
  - 把 active run registry / cancel control 外部化
  - 让 orchestrator 与执行控制脱离单 API 进程

完成标准：

- API 进程切换后，运行中的 task 控制状态可恢复或重新接管

### P2：SSE ticket 共享化（条件化提升项）

对象：

- `sse-ticket-store`

当前问题：

- ticket 只保存在当前进程内存

当前影响：

- 单实例或粘性路由场景可接受
- 若未来要做无粘性多实例，SSE ticket 会变成薄弱点

建议目标：

- 迁到 Redis TTL

完成标准：

- 多实例无粘性部署下，SSE ticket 仍可正确验证

### P3：文件库 gateway 运行态外部化（条件化提升项）

对象：

- `file-library-runtime`

当前问题：

- gateway session / child process state 是当前进程内会话管理

当前影响：

- 当前可用
- 但多实例和 HA 场景下，不适合作为强一致连接管理器

建议目标：

- 视未来规模决定是否外部化成专门 gateway manager
- 或保持单实例约束，并在 runbook 中明确

完成标准：

- file library gateway 的运行控制边界清楚
- 部署和排障方式稳定

### P4：发布前提与运维 runbook 收口

对象：

- `backend-persistent-state-boundary.md`
- 本次新增架构总表
- system / governance / notebook / files runbook

要做：

- 把哪些依赖共享 cache、哪些依赖持久卷写清楚
- 把“条件通过”的模块的部署前提明确写成 runbook
- 把 full release gate 与这些前提对应起来

完成标准：

- 新工程师和运维同学可以明确判断：
  - 哪些能力单机即可
  - 哪些能力要求 Redis
  - 哪些能力要求粘性路由

### T1：内部工程证据链边界固化

对象：

- `artifacts/governance-reports/`
- `artifacts/governance-runs/`
- `artifacts/governance-incidents/`
- `governance-report-store`
- `governance-run-store`
- `governance-incident-store`

当前判断：

- 这条线当前属于研发验收、发布审查、内部治理工具链
- 不属于系统对外产品主数据

要做：

- 在文档和 runbook 中明确它们的边界
- 不再把它们混入产品主数据持久化成熟度结论
- 如果未来要增强这条线，再单独立项

完成标准：

- 产品主数据问题和工程证据链问题口径完全分开

## 4. 最佳实践判断

### 当前已经符合最佳实践的部分

- 主数据统一持久化
- 共享运行态与主数据分层
- 测试和生产真相对齐
- workspace 配置不再依赖 JSON 镜像

### 当前属于“工程上可接受，但不是终局形态”的部分

- notebook active run / cancel 仍是进程内控制
- SSE ticket 仍是进程内 TTL
- gateway sessions 仍是进程内会话

## 5. 推荐执行顺序

建议按以下顺序推进：

1. 先把条件通过模块的部署前提写进 runbook
2. 再决定 notebook active run 是否升级到共享控制
3. 然后按需要处理 SSE ticket 共享化
4. 最后再评估 file library gateway manager 是否值得外部化
5. 内部工程证据链单独治理，不混入产品主线

## 6. 与当前发布结论的关系

本清单不改变当前结论：

- 当前系统已经达到“主数据产品级持久化”要求
- 当前 full real release gate 已通过

本清单描述的是：

- 进一步提高到更强 HA / 多实例 / 大规模运行成熟度时，产品主线下一步该做什么
