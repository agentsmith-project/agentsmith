# AgentSmith Demo 安装包 simple 模式部署手册（中文）

这份文档是给实施运维看的。

目标很简单：

- 拿到离线安装包
- 解压
- 改几项配置
- 用 `simple` 模式把整套 demo 系统跑起来

`simple` 模式的意思是：

- 只部署 external agent
- 不部署 internal agent
- 不需要主机预装和运维 kind / kubectl
- 不需要实际部署 JuiceFS CSI
- 不需要实际部署 sandbox-manager

如果你只是要在一台机器上把 demo 给别人用，`simple` 模式就是最省事的。

---

## 1. 先搞清楚 simple 模式会部署什么

simple 模式会部署这些服务：

- Web
- API
- Keycloak
- Mongo
- Postgres
- Redis
- MinIO
- universal-proxy
- external-runner

simple 模式不会部署这些东西：

- kind
- internal sandbox
- JuiceFS CSI
- sandbox-manager
- internal agent

所以如果你的目标只是：

- 局域网里给别人访问网页
- 演示 chat / notebook / files / endpoint / external agent

那 simple 模式就够了。

---

## 2. 对主机的最基本要求

部署机器上至少要有这些命令：

- `docker`
- `docker compose`
- `tar`
- `sha256sum`
- `curl`

建议先确认：

```bash
docker --version
docker compose version
tar --version
sha256sum --version
curl --version
```

如果这些命令都能用，再继续。

---

## 3. 把安装包放到一台目录里

假设你拿到的安装包叫：

```bash
agentsmith-xxxxxx.tar.gz
```

先选一个工作目录，例如：

```bash
mkdir -p ~/agentsmith-demo
cd ~/agentsmith-demo
```

把压缩包放进来以后，解压：

```bash
tar -xzf agentsmith-xxxxxx.tar.gz
```

解压后会出现一个目录，例如：

```bash
agentsmith-xxxxxx/
```

进入这个目录：

```bash
cd agentsmith-xxxxxx
```

后面所有命令，都默认你在这个解压目录里执行。

---

## 4. 先复制一份站点配置

安装包里会带一个示例配置：

```bash
env/site.env.example
```

先复制成真正要使用的配置文件：

```bash
cp env/site.env.example env/site.env
```

---

## 5. 修改 `env/site.env`

这是最关键的一步。

你至少要改下面这些配置。

### 5.1 改成 simple 模式

```bash
DEMO_DEPLOY_MODE=simple
```

### 5.2 配置对外服务地址

如果这台机器在局域网里的 IP 是 `192.168.0.210`，推荐直接这样配：

```bash
PUBLIC_WEB_BASE_URL=http://192.168.0.210:3001
PUBLIC_API_BASE_URL=http://192.168.0.210:20000
PUBLIC_KEYCLOAK_BASE_URL=http://192.168.0.210:18080
```

这三个地址是给：

- 浏览器
- 局域网用户
- 外部 CLI

访问用的。

不要写 `localhost`，不然别人只能在这台机器自己访问。

### 5.3 配置文件库客户端对外地址

如果你也要让局域网里的客户端能访问文件库相关能力，建议一起改成这台主机 IP：

```bash
CLIENT_PUBLIC_POSTGRES_HOST=192.168.0.210
CLIENT_PUBLIC_POSTGRES_PORT=15432
CLIENT_PUBLIC_MINIO_ENDPOINT=http://192.168.0.210:19000
```

### 5.4 填 LLM API Key

把你的模型 API Key 填进去。

当前这版 bundle 里，直接填写这个字段：

```bash
PRESET_ENDPOINT_API_KEY=你的真实大模型 API Key
```

如果你们已经有固定 provider，比如 MiniMax，就按包里的默认 preset endpoint 配置直接使用。

### 5.5 不要手改这些内部地址

有些地址是系统内部互联专用的，不要为了“看起来统一”手工改成公网或局域网 IP。

尤其不要乱改：

- compose 服务内部地址
- `host.docker.internal`
- docker-manual runner 的内部覆盖地址

原则很简单：

- **对外地址** 给浏览器和局域网用户
- **内部地址** 给容器之间自己通信

你只要认真改 `PUBLIC_*` 和 `CLIENT_PUBLIC_*` 就够了。

---

## 6. 先做准备检查

先执行：

```bash
bash scripts/prepare.sh
```

这个步骤会检查：

- 必要命令是否存在
- 配置是否能渲染
- 安装包里的内容是否完整

如果这里失败，先不要继续 deploy。

先看终端报错，通常就是：

- 配置没填
- 端口冲突
- Docker 不可用

---

## 7. 开始部署

执行：

```bash
bash scripts/deploy.sh
```

simple 模式下，这一步会做这些事：

- 加载离线镜像
- 渲染运行时配置
- 启动 substrate
  - Postgres
  - Mongo
  - Redis
  - MinIO
  - Keycloak
- 启动 app
  - API
  - Web
  - universal-proxy
  - external-runner

simple 模式下不会启动：

- kind
- JuiceFS CSI
- sandbox-manager

如果部署成功，终端一般会看到 `deploy ok` 之类的输出。

---

## 8. 做系统初始化

deploy 只是把服务拉起来。  
要让 demo 真正能用，还要做初始化。

执行：

```bash
bash scripts/bootstrap.sh
```

simple 模式下，这一步会创建和初始化：

- default workspace
- preset project
- preset credential
- preset endpoints
- preset external agent
- external runner 运行时连接信息

simple 模式下不会创建：

- preset internal agent

如果 bootstrap 成功，说明 demo 的“基础业务对象”已经准备好了。

---

## 9. 做验收检查

执行：

```bash
bash scripts/verify.sh
```

simple 模式下，这一步会验证：

- Web 可访问
- API 可访问
- Keycloak 可访问
- universal-proxy 正常
- external-runner 正常
- preset project / endpoint / external agent 已创建
- external notebook / files / user story 主链通过

simple 模式下不会检查：

- internal agent
- sandbox-manager
- kind
- internal workload pod

如果 verify 成功，说明 simple 模式的 demo 已经可交付使用。

---

## 10. 生成报告

执行：

```bash
bash scripts/report.sh
```

这一步会输出一份当前部署结果报告，便于你留档和交接。

---

## 11. 部署完成后，别人该访问哪里

如果你前面配置的是：

```bash
PUBLIC_WEB_BASE_URL=http://192.168.0.210:3001
PUBLIC_API_BASE_URL=http://192.168.0.210:20000
PUBLIC_KEYCLOAK_BASE_URL=http://192.168.0.210:18080
```

那么局域网里的使用者通常访问：

- Web 登录入口：

```bash
http://192.168.0.210:3001/en-US/login/workspace
```

或者中文：

```bash
http://192.168.0.210:3001/zh-CN/login/workspace
```

如果是 API 接入，就用：

```bash
http://192.168.0.210:20000
```

---

## 12. 常用操作命令

### 重新生成报告

```bash
bash scripts/report.sh
```

### 清空当前 demo 数据并重来

```bash
bash scripts/reset.sh
```

注意：

- `reset.sh` 会清掉当前 demo 的运行数据
- 如果你只是想重启，不要先跑 reset

---

## 13. 推荐的标准执行顺序

实施人员按下面顺序执行就行：

```bash
cp env/site.env.example env/site.env
vi env/site.env

bash scripts/prepare.sh
bash scripts/deploy.sh
bash scripts/bootstrap.sh
bash scripts/verify.sh
bash scripts/report.sh
```

---

## 14. 遇到问题先看哪里

优先先看 Docker 容器状态：

```bash
docker ps
```

如果 Web 打不开，先看：

- `web`
- `api`
- `keycloak`

如果 agent 不能工作，先看：

- `external-runner`
- `universal-proxy`
- `api`

如果是文件库问题，先看：

- `postgres`
- `minio`
- `api`

---

## 15. simple 模式最容易踩的坑

### 坑 1：把对外地址写成 `localhost`

如果写成：

```bash
PUBLIC_WEB_BASE_URL=http://localhost:3001
```

那别人只能在这台机器自己访问。  
局域网里其他机器是打不开的。

### 坑 2：乱改内部地址

不要为了“统一”去手工改：

- `host.docker.internal`
- compose 内服务名

这些是内部互联专用，不是给浏览器访问的。

### 坑 3：以为 simple 模式完全不需要 bundle 里的 kind / kubectl 文件

simple 模式不需要你在主机上预装和运维 kind / kubectl。  
但同一个安装包也支持 `full` 模式，所以 bundle 里仍然会带这些工具文件。

只要你按 simple 模式部署，不会真的去创建和使用 internal k8s 组件。

### 坑 4：simple 模式下还想验证 internal agent

simple 模式本来就没有 internal agent。  
这不是故障，是预期。

如果你要 internal agent，就应该部署 `full` 模式。

---

## 16. simple 和 full 怎么选

选 `simple`，适合：

- 快速演示
- 只看 external agent
- 不想装 k8s 相关东西
- 只需要一台机器、局域网访问

选 `full`，适合：

- 需要 internal agent
- 需要完整 demo 面
- 需要验证 sandbox / internal workload

---

## 17. 最后一句话

如果你只是想**尽快把 demo 系统跑起来给别人看**，就记住这一套：

```bash
cp env/site.env.example env/site.env
```

把 `DEMO_DEPLOY_MODE` 改成：

```bash
DEMO_DEPLOY_MODE=simple
```

把 `PUBLIC_*` 和 `CLIENT_PUBLIC_*` 改成这台机器的局域网 IP，比如：

```bash
192.168.0.210
```

然后依次执行：

```bash
bash scripts/prepare.sh
bash scripts/deploy.sh
bash scripts/bootstrap.sh
bash scripts/verify.sh
bash scripts/report.sh
```

通过以后，这套 demo 就可以给局域网里的其他人直接访问和使用了。
