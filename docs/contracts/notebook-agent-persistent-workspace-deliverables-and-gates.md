# Notebook 持久化工作空间与 Internal Agent 预期交付成果和测试 Gate

Last updated: 2026-03-17
Owner: Frontend + API entry + Agent runner + Sandbox
Audience: 产品、研发、测试、发布负责人

## 1. 文档目的

本文件定义这条功能线的：

- 预期交付成果
- 对应工程门禁
- 真实线验证要求

本文件用于后续讨论“做到了什么才算完成”，不替代具体实施排期。

## 2. 交付范围

本功能线包含三种运行方式：

- `external-bare`
- `external-docker`
- `internal-k8s`

统一目标：

- notebook task 必选 `agent` + `file library`
- `file library` 成为 task 的持久化工作空间
- agent CLI 永远在该工作空间中执行

当前已锁定：

- 先交付：
  - `external-bare`
  - `external-docker`
- `internal-k8s` 作为下一阶段交付
- artifact 旧的“保存到文件库”交互彻底删除
- `artifacts` 面板只展示 task workspace 下 `.artifacts/` 目录内容
- 多个 task 可以绑定同一个 `file library`
- `file library` 根目录就是 task cwd
- internal k8s 资源采用 lazy provisioning
- external offline agent 后端拒绝创建 task
- runner 只能拿当前 task 绑定的最小 workspace access
- `workspace_file_library_id` 创建后不可变
- `internal-k8s` 的 `workspace_path` 固定为 `/workspace`

## 3. 预期交付成果

## 3.1 产品与交互

### D1. Notebook 创建任务必须选择文件库

用户在创建 task 时必须显式选择：

- agent
- file library

验收结果：

- 没有 file library 时不能创建 task
- external agent 未连接时不能创建 task
- internal agent 可创建 task，即使 pod 尚未存在
- task 创建后不可修改 workspace file library

### D2. Task 详情可见工作空间绑定信息

task 详情页至少要能看到：

- 当前 agent
- 当前 workspace file library
- 当前运行模式

### D3. Files 与 notebook 语义一致

- task 绑定的 file library 在 Files 页面可见
- notebook 运行产生的文件会出现在该 file library

### D3.1 Artifact 语义收敛

必须做到：

- notebook `artifacts` 面板仅展示 `.artifacts/` 目录内容
- 不再提供“保存到文件库”交互
- deliverables 通过 `AGENTS.md` 最佳实践写入 `.artifacts/`

## 3.2 后端与执行模型

### D4. Task 模型持久化 workspace file library

task 持久化新增：

- `workspace_file_library_id`
- `workspace_file_library_name`

### D5. 新增 runner 专用 workspace access 能力

后端需向 runner 提供 task 级 workspace 访问元信息。

要求：

- 只能按 `taskId` 获取
- 不允许按任意 `file_library_id` 自由兑换
- 只返回当前 task 已绑定 file library 的最小 mount 元信息

### D6. External runner 支持任务级 JuiceFS workspace

external-bare / external-docker 都应支持：

- 为每个 task 准备独立工作目录
- 通过 JuiceFS 挂载该 task 选择的 file library
- 该 file library 根目录就是 task cwd

### D7. Internal runner 支持 task 级预挂载 workspace

internal-k8s 应支持：

- task 首条消息 lazy create pod
- pod 使用该 task 对应 file library 的持久化工作目录
- pod idle reclaim 后，后续消息可重新恢复
- `workspace_path` 固定为 `/workspace`

### D8. Snapshot 机制删除

对于这条 internal agent 路线：

- 不再使用 snapshot/restore
- 不留兼容

## 3.3 平台与部署

### D9. External docker 运行约束文档化

需要形成明确运行前提：

- `juicefs` CLI
- `/dev/fuse`
- capability / privileged 要求

### D10. Internal k8s 采用 JuiceFS CSI Driver

需要形成正式平台能力：

- file library 对应 Secret/PV/PVC
- sandbox workload 可挂载 PVC
- internal workload 可关闭 snapshot
- k8s 资源采用 lazy provisioning

## 4. 分阶段交付清单

## Phase A：External Bare

必须交付：

- notebook task create 选择 file library
- task 模型新增 workspace file library 字段
- bare runner 自动 mount JuiceFS
- notebook 在持久化工作目录执行
- Web / local mount / notebook 三者可见同一份文件
- artifact 展示收敛为 `.artifacts/` 目录模型
- file library 根目录就是 task cwd

## Phase B：External Docker

必须交付：

- docker runner 镜像支持 JuiceFS
- docker runner 启动说明
- 容器权限要求文档
- docker 环境下 notebook 持久化工作目录可用
- docker 环境下 `.artifacts/` 语义与 bare 一致
- file library 根目录就是 task cwd

## Phase C：Internal K8s

必须交付：

- sandbox 支持 workload 级 PVC 挂载
- internal workload 去 snapshot
- internal agent lazy pod create
- internal pod idle reclaim
- reclaim 后后续消息恢复同一 file library 工作目录
- k8s 资源采用 lazy provisioning
- `workspace_path` 固定为 `/workspace`

## 5. 工程测试 Gate

## 5.1 类型与 contract gate

每个阶段至少要通过：

```bash
npx tsc --noEmit
npm run contracts:check-openapi
npm run openapi:check-generated
```

## 5.2 单元 / 集成 gate

必须新增并通过：

- task create request validation
- task model persistence for workspace file library
- external agent selectable rule
- internal agent lazy selectable rule
- runner workspace access resolution
- external mount state handling
- internal workload lifecycle handling
- artifact `.artifacts/` 映射与列表逻辑
- 删除旧 save-to-library 路径后的回归
- workspace access task-bound security validation
- immutable workspace file library validation

## 5.3 Files / notebook / agent 真实联动 gate

### G1. External bare notebook workspace real gate

要求证明：

- 创建 notebook task 时选择 file library
- bare runner 能挂载并执行
- notebook 产生文件后，Files 页面能看到
- 本地 local mount 也能看到
- `.artifacts/` 中的 deliverables 能在 notebook 面板和 Files 页面中一致出现
- cwd 与 file library 根目录一致

### G2. External docker notebook workspace real gate

要求证明：

- docker runner 具备挂载权限
- notebook 能在挂载目录中运行
- 文件同步成立
- `.artifacts/` 行为与 bare 一致
- cwd 与 file library 根目录一致

### G3. Internal k8s notebook workspace real gate

要求证明：

- internal agent 在未起 pod 时可选
- 首条消息触发 lazy start
- pod 内工作目录来自 file library
- pod 回收后再次消息可恢复
- k8s 资源按需创建并可复用

## 5.4 Files 双向同步 gate

必须继续保留并增强：

- Web -> local mount
- local mount -> Web
- Web -> notebook workspace
- notebook workspace -> Web

## 5.5 Visual gate

需要新增或保留关键截图：

- notebook task create 选择 agent + file library
- notebook task detail 展示 workspace 绑定
- file library mount access
- notebook 运行后 Files 页面中的产物
- internal agent lazy start / preparing state
- internal agent task 成功完成态

## 5.6 发布级真实 gate

最终应聚合为：

```bash
npm run test:mainline:strict:real
npm run test:files:release:strict
npm run test:agents:real:codex
npm run test:smoke:real:notebook-mainline
npm run test:release:real:full
```

说明：

- 在功能上线前，应新增对应专项真实 gate
- `internal-k8s` 完成后，必须再增加 internal 专项真实 gate

## 6. 每项交付对应的完成判定

### External Bare 完成判定

- task 必选 file library
- bare runner 自动 mount
- notebook cwd 已切到 file library
- Files / local mount / notebook 文件一致
- 真实 gate 通过

### External Docker 完成判定

- docker 权限与镜像基线明确
- docker runner 自动 mount
- notebook 文件一致
- 真实 gate 通过

### Internal K8s 完成判定

- sandbox PVC 挂载能力可用
- snapshot 已删除
- internal lazy start / reclaim / restore 成立
- 真实 gate 通过

## 7. 不在本阶段交付范围

本阶段不要求：

- chat 独立工作空间绑定
- file library 多目录级细粒度隔离
- 自动文件冲突解决
- 多 file library 同时挂载到同一 task
- snapshot 兼容迁移
- 旧 artifact save-to-library 交互兼容保留

## 8. 交付评审建议

后续评审建议按下面顺序进行：

1. 数据模型与 contract 是否正确
2. external-bare 是否先闭环
3. external-docker 权限方案是否明确
4. sandbox 是否已具备 PVC/CSI 所需能力
5. internal-k8s 是否真正删掉 snapshot
6. 真实 gate 与 visual 是否足够证明产品亮点
