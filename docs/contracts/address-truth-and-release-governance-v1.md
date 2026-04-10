# 地址真相与发布治理指南 v1

## 目的
这份文档定义 AgentSmith 在开发、测试、本地完整部署、远端部署中的统一方法。

目标只有三个：

1. 地址配置只有一套真相
2. 问题尽可能在打镜像和打包前暴露
3. 最终部署后仍有完整 verify 兜底

这份文档不是排障手册，也不是部署 runbook。  
它是这条工作线的指导原则和执行规范。

---

## 一、核心原则

### 1. 唯一真相
- operator 只编辑一个 `site.env`
- `site.env` 只表达稳定角色，不表达 docker bridge、kind gateway、容器内临时 IP
- `resolve-runtime-addresses` 是唯一环境解析步骤
- `render-env` 是唯一 env 生成步骤
- `deploy` 只应用，不改写真相

### 2. Fail Fast
- 缺配置、地址解析失败、角色不一致时必须立即失败
- 不允许静默 fallback 到：
  - `172.18.0.1`
  - `host.docker.internal`
  - 任何未声明的默认 bridge IP
- 不允许部署时用 `sed` 或手工补丁修 env

### 3. 按访问者角色建模，不按机器位置建模
系统里最容易出问题的，不是“地址是不是存在”，而是“这个地址到底给谁访问”。

正式角色只有这些：
- `PUBLIC_*`
  - 浏览器、redirect、issuer、用户访问入口
- `COMPOSE_INTERNAL_*`
  - Compose 容器之间互相访问
- `HOST_LOCAL_*`
  - 宿主机人工访问、本机调试、人工 mount
- `K8S_EXPOSED_*`
  - kind/k8s 对宿主机暴露出来的稳定入口

禁止把某一个地址同时当作：
- 浏览器地址
- 容器内地址
- runner 执行地址
- k8s workload 地址

### 4. Runner 运行模式是正式 Runtime Truth
Agent 的业务语义仍然只有两种：
- `external`
- `internal`

但运行方式必须单独建模：
- `dev_direct`
- `docker_manual`
- `compose_managed`
- `k8s_internal`

规则：
- external 可运行在 `dev_direct` / `docker_manual` / `compose_managed`
- internal 固定运行在 `k8s_internal`
- 除 `dev_direct` 外，runner 仍必须受统一的地址解析、workspace access 与运行时合约约束，但 notebook/chat 作为不同 runner app 时可以使用不同 runner image
- 地址解析、workspace access、file library access 都必须按 `runner_runtime` 分流，而不是靠“是不是 external”去猜

### 5. Email 选人，ID 落库
- 界面和 preset 配置用 email/username 选人
- 系统内部唯一主键仍然是 `user_id = Keycloak sub`
- `sub` 必须运行时解析，不能写死进部署输入

### 6. 不靠最后一次部署才发现问题
- 开发测试和本地预检必须提前覆盖最容易晚暴露的真相问题
- 最终 deploy verify 仍然保留，而且必须更完整
- 不是“把 verify 简化”，而是“把关键检查前移一遍，再在 verify 中完整兜底”

---

## 二、统一配置模式

### operator 唯一输入
- `infra/deploy/demo/env/site.env.example`
- 实际环境使用同 schema 的 `site.env`

### 配置模式要求
- 开发、本地完整部署、远端部署，字段集合必须完全一致
- 允许值不同，不允许 schema 不同
- 不允许某个环境引入额外关键地址字段

### `site.env` 里应该出现的内容
- public base URLs
- compose 暴露端口
- host local 手工访问入口
- kind/k8s 对外暴露端口
- 业务凭据与模型配置

### `site.env` 里不应该出现的内容
- docker bridge IP
- `host.docker.internal`
- kind gateway IP
- external/internal agent 的执行地址成品值
- internal JuiceFS host override 的最终值

这些都必须由系统解析得到，而不是让 operator 手填。

---

## 三、正式地址解析流程

地址真相的唯一流程固定为：

1. `site.env`
2. `resolve-runtime-addresses.sh`
3. `render-env.sh`
4. `deploy.sh`

### 1. `site.env`
只表达稳定角色，不表达环境偶然值。

### 2. `resolve-runtime-addresses.sh`
职责：
- 基于当前运行环境解析：
  - runner 可见 host
  - kind/k8s 可见 host
  - sandbox manager 对应入口
  - file library 对 `dev_direct` / `docker_manual` / `compose_managed` / `k8s_internal` 可见的地址

要求：
- 解析失败立即退出
- 不允许 fallback 到静态 bridge IP

### 3. `render-env.sh`
职责：
- 根据 `site.env + runtime-addresses.env`
- 生成：
  - `base.env`
  - `api.env`
  - `web.env`
  - `keycloak.env`
  - `internal.env`
  - `runner.env`

要求：
- 这是唯一 env 真相生成器
- 不允许后续部署阶段再修改这些值

### 4. `deploy.sh`
职责：
- 使用已经生成好的 env 与产物执行部署

要求：
- 不再用 `sed` 修配置
- 不再扮演“真相修正器”

---

## 四、文件库访问模型

文件库不能再复用“一套 mount access”给所有执行方。

必须明确区分三种 contract：

### 1. `client_mount_access`
用途：
- 人在自己的电脑上执行 `juicefs mount`
- UI 展示给用户的挂载信息

特点：
- 必须是客户端可达地址
- 禁止 loopback
- 不能复用容器内或 kind 内地址

### 2. `external_runner_mount_access`
用途：
- external runner 自动挂载任务工作区

特点：
- 必须是 runner 可见地址
- 禁止 loopback
- 不能复用 client 地址
- 其中：
  - `dev_direct` 使用 host-local truth
  - `docker_manual` / `compose_managed` 使用 runner-visible truth

### 3. `internal_agent_mount_access`
用途：
- internal agent / sandbox / kind workload

特点：
- 必须是 internal/k8s-safe truth
- 必须通过稳定的 Kubernetes service name 访问外部依赖
- 不能复用 client 地址

### 规则
- UI 只展示 client mount access
- API 根据执行模式返回 external/internal 对应 access
- runner 和 internal agent 不再接收 client mount access

---

## 五、开发方式

### 目标
开发阶段要尽早发现：
- 真实认证链问题
- 动态身份漂移问题
- 页面入口权限时序问题
- workspace 发布后端不可用问题
- 文件库 external/internal 地址错配问题

### 开发阶段必须遵守
- 新增地址相关逻辑时，先写 contract 和测试，再改实现
- 不允许再把环境偶然地址写进正式配置
- 不允许再用“运行时猜环境”的方式补丁式修复
- 开发机直接运行 external runner 必须走正式入口 `scripts/run-external-runner-dev.sh`

### 开发阶段必须覆盖的测试
- token claims / callback auth chain
- admin-binding 的 JWT + JWKS
- stale binding repair
- workspace entry loading vs denied
- workspace publish usable
- directory search truth
- runtime address resolution
- file library local/external/internal access 分流
- runner runtime resolution
- external runner access 不能返回 loopback
- internal agent access 不能返回 host-local truth

---

## 六、测试分层

### Layer A：开发快速 gate
作用：
- 最快发现运行时真相不一致

必须通过：
- 类型检查
- 关键单测/集成
- 地址解析与 contract 测试
- `npm run test:client-public-runtime`

### Layer B：本地真实预检
作用：
- 在打镜像、打 bundle 前，用真实服务和真实浏览器把关键入口走一遍

固定入口：
- `npm run test:release:precheck`

当前必须覆盖：
- `system_admin_entry`
- `public_auth`
- `workspace_public_login_truth`
- `workspace_entry`
- `workspace_publish_usable`
- `workspace_settings_directory`
- `system_to_notebook_mainline`

应继续保持：
- external runner file library mount truth
- internal agent workspace access truth

### Layer C：部署后完整 verify
作用：
- 在真实部署产物、真实部署配置、真实 kind/k8s/sandbox 环境里做最终兜底

固定入口：
- `scripts/demo-deploy/verify.sh`

必须完整保留，不做轻量化。

至少包含：
- `public_auth`
- `workspace_entry`
- `workspace_publish_usable`
- `release_story`

并在真实部署态再次确认：
- external runner mount access truth
- internal agent mount access truth
- notebook / files / `.artifacts` / usage

---

## 七、发布方式

### 正常顺序
以后固定按这个顺序工作：

1. 开发快速 gate
2. `npm run test:demo-bundle:inputs`
3. `npm run test:demo-rendered-env`
4. `npm run test:client-public-runtime`
5. `npm run test:release:precheck`
6. `build-offline-bundle.sh`
7. fresh 本地完整部署
   - `prepare -> reset -> deploy -> bootstrap -> verify -> report`
8. 远端部署
   - `prepare -> reset -> deploy -> bootstrap -> verify -> report`

### 规则
- 任何一步失败，都不进入下一步
- 不允许“先打包再看有没有问题”
- 不允许“先部署再顺手修”

### 目标
- 便宜的问题在前面发现
- 昂贵的问题只留给最终 verify 去兜底，不再让它承担“第一次发现设计漏洞”的职责

---

## 八、Fail Fast 具体要求

以下情况必须立即失败：
- `site.env` 出现废弃 key
- runtime address 无法解析
- rendered env 关键角色缺失
- public/internal truth 矛盾
- external runner 收到 loopback mount access
- internal agent 收到 host-local mount access
- workspace 发布后 system 侧 ready 但后端仍不可访问

不允许：
- 静默 fallback
- 手工 patch env
- 手工 patch 编译产物
- 手工补数据库/Keycloak/容器配置来“救活”部署

---

## 九、这条工作线的长期约束

以后任何涉及地址、挂载、执行方访问、部署配置的修改，都要先回答这四个问题：

1. 这个地址是给谁访问的？
2. 这个值属于 operator 输入，还是运行时派生？
3. 这个真相是否已经被 `render-env` 统一生成？
4. 这个路径是否已经被：
   - 开发测试
   - 本地 precheck
   - deploy verify
   三层中的合适位置覆盖？

如果回答不清楚，就不应该合入。

---

## 十、最终判断标准

只有同时满足下面这些，才算这条工作线做完：

- 配置 schema 在开发、本地部署、远端部署中完全一致
- operator 不再填写 docker/kind 特有 IP
- `deploy` 不再改写真相
- external runner / internal agent / 浏览器 / 宿主机都使用各自正确地址
- 浏览器 public 配置属于运行时真相，不允许再依赖 Next.js 构建期 `NEXT_PUBLIC_*` 固化

## Browser Public Config Rule

浏览器侧的 `api_base`、Keycloak URL/realm/client_id、MSW 开关、SSE 开关等 public 配置，必须通过运行时注入提供，不能作为“同一个 bundle 在不同环境下共用”的构建期常量。

约束：
- 同一个 bundle 必须可以在本地完整部署和远端部署中复用
- 浏览器读取 public 配置时，优先读取运行时注入的 `window.__MBOS_PUBLIC_RUNTIME_CONFIG__`
- `NEXT_PUBLIC_*` 只允许作为服务器生成该运行时配置时的输入，不允许再成为浏览器逻辑的最终真相
- 当页面 origin 不是 loopback 时，runtime public config 也不允许指向 loopback 地址
- 浏览器侧页面、示例文案、网关样例和连接入口，必须通过运行时 public config 构造 public URL，不允许直接把 `localhost`、docker bridge 地址或 `host.docker.internal` 写进客户端代码
- 最容易晚暴露的问题已经前移到打包前
- 最终 deploy verify 仍完整兜底
- fresh 本地完整部署验证通过
- 远端正式部署验证通过

这就是这条工作线的收口标准。
