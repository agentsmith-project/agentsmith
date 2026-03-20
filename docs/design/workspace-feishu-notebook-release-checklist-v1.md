# Workspace Feishu + Notebook Release Checklist

这份清单是当前 `AgentSmith` 进入产品化发布前的最小验收基线。

适用范围：

- workspace 级飞书接入
- workspace 内用户飞书连接
- notebook task file library 持久化运行环境
- external / internal agent 使用当前用户飞书凭据

## 1. 产品入口与心智

必须满足：

1. `workspace admin` 进入 `/{locale}/workspaces/{workspace}` 后，能直接看到 `工作区设置`
2. `工作区设置` 中能看到 `Feishu integration` 入口
3. `enabled` 后默认是只读锁定态
4. 普通用户的飞书主入口只在：
   - `/{locale}/workspaces/{workspace}/connections`
5. `Third-Party Accounts` 不再承载飞书主入口

验收标准：

- visual 基线存在并通过
- 文案中不再混淆 workspace 配置与个人授权

## 2. OAuth 与回调

必须满足：

1. Feishu callback 是一条无 locale 的技术回调
2. `admin_verify` 与 `user_connect` 共用同一 callback
3. 回调通过 `state.intent` 分流
4. callback 完成接口幂等
5. 管理员验证成功后自动回到 workspace Feishu 设置页
6. 用户连接成功后自动回到 workspace `connections`

验收标准：

- 不再出现带 locale callback 死循环
- 不再出现重复 state 导致的 loading 卡死

## 3. File Library 运行环境

必须满足：

1. 一个 file library 是完整的持久化 notebook/agent 环境
2. task 级运行时状态进入正式命名空间：
   - `.codex/tasks/<taskId>/`
   - `.mbos/tasks/<taskId>/`
   - `.artifacts/tasks/<taskId>/`
3. artifact 扫描只看当前 task namespace
4. file library 稳定目录名不再按 task title/id 派生
5. internal workspace binding 对 orchestration 暴露的是稳定 mount contract，而不是匿名 PVC 原语

验收标准：

- 同一 file library 下两个 task 并发运行时，task namespace 不互相污染
- Codex session/credential/artifact 都按 task 隔离
- internal orchestration 与 sandbox pod manager 的边界可由文档解释清楚：
  - [internal-agent-workspace-binding-model-v1.md](../contracts/internal-agent-workspace-binding-model-v1.md)

## 4. Internal / External 执行

必须满足：

1. external agent 能使用当前用户飞书凭据搜索 `中证数据`
2. internal agent 能使用同一 file library 和同一用户飞书凭据搜索 `中证数据`
3. 两条链路都能产出 artifact 到 `.artifacts/tasks/<taskId>/...`
4. internal sandbox/JuiceFS 配置只通过显式 env 或正式平台配置注入

验收标准：

- real lane 真实通过
- 不再依赖主依赖工厂中的隐式 fallback

## 5. 依赖项目边界

必须满足：

1. `mbos-sandbox-v1` README 与架构文档明确写清：
   - snapshot/restore 是 legacy shell-session 路径
   - AgentSmith 当前依赖的是 PVC/CSI-backed workload path
2. workload volume 输入的基本约束在依赖项目中有显式校验
3. JuiceFS CSI 配置项有清晰文档，不靠口头知识

验收标准：

- 另一位工程师只看文档即可理解当前运行真相
- 依赖项目文档与当前实际集成路径不再冲突

## 6. 最终门禁

发布前至少通过：

- `npx tsc --noEmit`
- 相关定向 `vitest`
- 相关定向 `eslint`
- `npm run test:mainline:strict`
- full visual lane
- 至少一轮真实手工或脚本化验证：
  - workspace admin 配置并启用 Feishu
  - 用户连接 Feishu
  - external agent 搜索 `中证数据`
  - internal agent 搜索 `中证数据`

只有以上全部满足，才能给出“产品级发布 ready”的结论。
