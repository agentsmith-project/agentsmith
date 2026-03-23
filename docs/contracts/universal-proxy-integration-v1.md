# Universal Proxy Integration v1

## Purpose

本文件定义 AgentSmith 与 `llm-universal-proxy` 的 v1 集成边界。

目标：

- AgentSmith 继续作为控制面真相源
- `llm-universal-proxy` 作为独立协议转换层
- runner 只面对 AgentSmith 的统一接口，不再关心上游是 OpenAI Chat、OpenAI Responses 还是 Anthropic Messages

## Responsibility Split

### AgentSmith

- 鉴权
- 工作区/项目/endpoint 选择
- 凭据治理
- 审计与用量归属
- endpoint 级配置快照生成
- 向协议层推送运行时配置

### Universal Proxy

- 请求协议识别
- upstream capability 判断
- passthrough / translate
- stream / non-stream 转换

## Runtime Contract

### Control Plane Push

AgentSmith 通过命名空间配置接口向协议层推送完整配置快照：

- `POST /admin/namespaces/{namespace}/config`

当前命名空间粒度：

- `workspaceId__projectId__endpointId`

每次推送都是完整替换，不做 patch。

### Request Path

AgentSmith 在 endpoint proxy 主路径上优先把支持的聊天协议请求转发到：

- `/namespaces/{namespace}/openai/v1/chat/completions`
- `/namespaces/{namespace}/openai/v1/responses`
- `/namespaces/{namespace}/anthropic/v1/messages`

当前 v1 已切到 universal proxy 的范围：

- chat/completions
- responses
- messages

当前 v1 仍保留在 AgentSmith 本地 bridge 的范围：

- `messages/count_tokens`
- image / video / rerank 等非聊天路径

## Fail-Fast Rules

- endpoint protocol 不在支持矩阵内时，不进入 universal proxy
- proxy path 不在支持矩阵内时，不进入 universal proxy
- 配置快照校验失败时，整份拒绝，不部分生效
- namespace 不存在时，协议层返回显式错误

## Verification Gate

最小 gate：

1. Rust `cargo test`
2. AgentSmith `universal-proxy-service` 单测
3. `npx tsc --noEmit`

后续完整 gate 应继续补到：

- endpoint proxy 经 universal proxy 的真实集成测试
- runner -> AgentSmith -> universal proxy -> upstream 的 stream / non-stream 测试
- unsupported path 的 fail-fast 测试

