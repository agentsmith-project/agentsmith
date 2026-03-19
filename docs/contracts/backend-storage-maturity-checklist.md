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

1. 文件证据型存储的发布级部署模式
2. 进程内瞬态运行控制的 HA 边界
3. SSE 与 gateway 等连接态的多实例边界
4. 文档、门禁和运维说明的继续收口

## 3. 优先级清单

### P1：治理证据型存储外部化

对象：

- `governance-report-store`
- `governance-run-store`
- `governance-incident-store`

当前问题：

- 这些模块已经持久化到磁盘，但默认是本地文件
- 若部署环境是无状态容器、无共享卷，本地文件证据并不具备稳定产品级保障

建议目标：

- 中期：明确共享持久卷/持久盘为发布前提
- 长期：迁移到对象存储 + 元数据索引

完成标准：

- 证据文件不再依赖单实例本地盘
- 文档中明确治理证据的存储前提和恢复方式

### P2：Notebook 执行控制共享化

对象：

- `task-runtime-state`
- `notebook-task-sse-broker`

当前问题：

- task 主数据已持久化
- 但 active run、cancel handle、部分热缓存仍在当前进程

当前影响：

- API 重启后，历史不会丢
- 但当前运行中的 notebook 任务控制权不会跨实例接管

建议目标：

- 若未来目标是多实例 HA notebook 执行控制：
  - 把 active run registry / cancel control 外部化
  - 让 orchestrator 与执行控制脱离单 API 进程

完成标准：

- API 进程切换后，运行中的 task 控制状态可恢复或重新接管

### P3：SSE ticket 共享化

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

### P4：文件库 gateway 运行态外部化

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

### P5：发布前提与运维 runbook 收口

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
  - 哪些能力要求持久卷或对象存储

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
- governance evidence 仍是磁盘文件主路径

## 5. 推荐执行顺序

建议按以下顺序推进：

1. 先收治理证据型存储的部署前提
2. 再决定 notebook active run 是否升级到共享控制
3. 然后按需要处理 SSE ticket 共享化
4. 最后再评估 file library gateway manager 是否值得外部化

## 6. 与当前发布结论的关系

本清单不改变当前结论：

- 当前系统已经达到“主数据产品级持久化”要求
- 当前 full real release gate 已通过

本清单描述的是：

- 进一步提高到更强 HA / 多实例 / 大规模运行成熟度时，下一步该做什么
