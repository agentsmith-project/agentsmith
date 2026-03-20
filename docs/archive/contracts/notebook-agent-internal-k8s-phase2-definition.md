# Notebook 持久化工作空间 Phase 2 定义（Internal K8s）

Last updated: 2026-03-17
Owner: Frontend + API entry + Agent runner + Sandbox
Audience: 产品、研发、测试、发布负责人

## 1. 目标

本文件定义 `notebook 持久化工作空间` 功能线的 **Phase 2**：

- `internal-k8s`
- JuiceFS CSI
- internal lazy start / idle reclaim / resume
- 删除 snapshot

本文件只定义：

- 交付边界
- 职责划分
- 完成标准
- 测试 gate

不展开具体实施排期。

## 2. 前提

Phase 2 建立在 Phase 1 之后：

- notebook task 已必选 `agent + file library`
- `external-bare` 已打通
- `external-docker` 已打通
- `.artifacts/` 已成为 notebook deliverables 的唯一展示目录

## 3. 总体原则

### 3.1 sandbox manager 只为当前需求服务

Phase 2 对 sandbox 的要求是：

- 只为 AgentSmith internal agent 这条完整需求服务
- 尽量简单
- 尽量少做平台泛化
- 优先保证稳定和可维护

这意味着：

- 不做过度抽象的 volume/plugin 平台
- 不做历史 snapshot 兼容
- 不为与当前需求无关的场景提前设计复杂扩展面

### 3.2 file library 到 k8s 卷映射由 AgentSmith 控制面维护

职责划分固定为：

#### AgentSmith

- 理解 `file_library_id`
- 维护 file library 到 k8s 资源的映射
- 决定 internal workload 需要挂载哪个 PVC
- 调用 sandbox manager 创建 workload
- 在真正需要 internal workload 时再执行 lazy provisioning

#### sandbox manager

- 不理解 `file_library_id`
- 只理解：
  - 给某个 workload 挂哪个 PVC
  - 挂载到哪个路径
  - 是否关闭 snapshot

### 3.3 internal 与 external 在工作空间语义上保持一致

这里的一致是：

- 对 runner 来说，始终拿到一个明确的 `workspace_path`
- 对 agent 来说，始终在持久化工作目录中执行
- 对用户来说，Files / 本地 mount / notebook 看到的是同一份目录树

不要求：

- bare / docker / k8s 使用完全相同的绝对路径字符串

### 3.4 internal 恢复不依赖 snapshot

idle reclaim 后的恢复语义固定为：

1. pod 已被回收
2. 用户再次发送消息
3. 系统重新创建 pod
4. 重新挂载之前同一个 file library 对应的目录
5. 重新启动 runner
6. 正常继续执行

恢复依赖：

- file library 持久化文件
- AgentSmith 保存的 task / trace / message 元数据

恢复不依赖：

- snapshot
- restore

### 3.5 internal task 的 workspace 绑定在创建后不可变

对 internal task：

- `workspace_file_library_id` 在 task 创建后不可修改
- internal resume 依赖这条稳定绑定关系
- runner 不能在执行阶段切换到其它 file library

### 3.6 internal workspace_path 固定为 `/workspace`

Phase 2 已锁定：

- internal pod 中的 `workspace_path` 固定为 `/workspace`
- `/workspace` 直接对应 task 绑定 file library 的根目录
- 不再引入 `/workspace/<task-slug>` 子目录语义

## 4. 交付范围

Phase 2 必须交付：

### D1. internal agent 可在未起 pod 时被选择

- 用户创建 notebook task 时可以选择 internal agent
- 不要求 pod 预先存在

### D2. 首条消息触发 lazy start

- 首条 notebook 消息到来时：
  - 创建 internal workload
  - 挂载持久化工作目录
  - 启动 runner
  - 回连 agent websocket
  - 执行任务

### D3. internal workload 使用 JuiceFS CSI 持久化工作目录

- internal-k8s 使用 **JuiceFS CSI Driver**
- pod 不在容器内自己运行 `juicefs mount`
- pod 启动后工作目录已经可用
- 该 file library 根目录就是 task cwd

### D4. sandbox manager 支持 workload 级 PVC 挂载

sandbox manager 需要支持：

- 在 workload 创建请求中声明 PVC 挂载
- 为 AgentSmith internal workload 挂载指定 PVC

并且：

- 采用 lazy provisioning
- 只在真正拉 pod 时创建缺失的 Secret / PV / PVC

### D5. snapshot 删除

对这条 internal 线路：

- snapshot / restore 完全删除
- finalizer snapshot 逻辑不再参与 internal notebook 工作流
- 不留兼容路径

### D6. idle reclaim 后可恢复

- internal workload 被回收后
- 后续 notebook 消息可再次触发创建
- 重新获得同一持久化工作目录
- 继续执行

### D7. internal 产物与文件同步成立

- internal task 写入 `.artifacts/`
- notebook artifacts 面板可见
- Files 页面可见
- 本地 mount 可见

## 5. 不在 Phase 2 范围内

本阶段不要求：

- chat 也绑定持久化工作空间
- 一个 task 同时挂多个 file library
- 目录级更细粒度隔离
- snapshot 兼容保留已明确不做
- 通用 sandbox 平台化抽象

## 6. 技术方案边界

## 6.1 推荐挂载路径

internal pod 中推荐：

- `workspace_path = /workspace`

- runner 拿到明确 `workspace_path`
- `.artifacts/` 规则稳定
- 与 external 工作空间语义一致

### 6.2 推荐 k8s 资源模型

建议：

- 一个 `file library` 对应一套稳定的 k8s 挂载资源：
  - Secret
  - PV
  - PVC

internal workload 创建时直接引用 PVC。

资源创建时机固定为：

- 不在 file library 创建时就预先生成
- 仅在 internal workload 首次真正需要时 lazy provisioning
- 后续复用同一套 k8s 资源

### 6.3 sandbox manager 最小扩展面

建议最小增加：

- workload create 请求支持 PVC 挂载描述
- workload create 请求支持关闭 snapshot/finalizer

不建议在 Phase 2 增加：

- 通用 volume plugin 框架
- 多类型 storage adapter 抽象
- 不相关的运行时策略面

## 7. 完成标准

Phase 2 只有同时满足下面条件才算完成：

1. internal agent 可以在 pod 不存在时被选择
2. 首条消息可成功触发 lazy start
3. internal pod 使用 file library 对应持久化工作目录
4. snapshot 已从该路线完全移除
5. idle reclaim 后再次消息可恢复
6. `.artifacts/` 产物在 notebook / Files / local mount 三处一致
7. real gate 和 visual 证据完整

## 8. 测试 Gate

## 8.1 工程 gate

至少通过：

```bash
npx tsc --noEmit
npm run contracts:check-openapi
npm run openapi:check-generated
```

## 8.2 单元 / 集成 gate

必须新增并通过：

- internal agent selectable rule
- internal lazy start dispatch logic
- internal workload create payload includes PVC mapping
- internal workload delete/reclaim logic
- no-snapshot behavior
- internal resume after reclaim
- immutable workspace file library binding
- task-bound workspace access validation

## 8.3 real gate 建议

### G1. internal lazy start real gate

要求证明：

- internal agent 未起 pod时可创建 task
- 首条消息触发 pod 创建
- runner 回连成功
- task 执行成功
- cwd 与该 task 绑定 file library 根目录一致

### G2. internal workspace persistence real gate

要求证明：

- 第一次执行写入工作目录
- pod 被回收
- 第二次消息再次拉起
- 复用同一 task 绑定的 file library
- 同一工作目录文件仍然存在并可继续使用

### G3. internal files sync real gate

要求证明：

- internal task 写入 `.artifacts/`
- notebook artifacts 面板可见
- Files 页面可见
- 本地 `juicefs mount` 可见

### G4. internal reclaim real gate

要求证明：

- internal pod idle 后被回收
- 页面状态正确
- 后续消息恢复成功

## 8.4 visual gate 建议

建议至少补这些截图：

- internal agent 可选但尚未启动时的 task create
- notebook task `preparing / starting` 状态
- internal task 成功完成后的 detail 页
- Files 页面中看到 internal task 生成的 deliverables
- internal managed agent 状态页或等价状态区域

## 9. 评审建议

Phase 2 评审建议按下面顺序进行：

1. sandbox manager 扩展面是否足够小
2. AgentSmith 是否承担了 file library 到 PVC 的映射真相
3. snapshot 是否已明确退出
4. internal 恢复语义是否完全依赖 file library
5. real gate 是否足以证明 internal 的产品亮点

## 10. 最终判断

Phase 2 应定义成：

- 一个围绕 internal-k8s 的独立能力阶段
- 重点不是继续扩 external，而是：
  - CSI
  - lazy start
  - reclaim / resume
  - 去 snapshot

如果上述边界保持不变，Phase 2 将是：

- 目标明确
- 平台改造面可控
- 与 Phase 1 清晰解耦
