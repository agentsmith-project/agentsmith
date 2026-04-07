# Historical Note

This handoff captures the original staged refactor discussion. The active code path has already hard-cut to `upstream_protocol` as the only protocol truth, canonical protocol-prefixed proxy paths as the only supported client ingress, and `/endpoints/import-bulk` as the active bulk import route. Treat this file as historical context, not the active contract.

# Endpoint Upstream Protocol Refactor Handoff v1

## 摘要

当前 AgentSmith 的 endpoint 模型把两种不同的 OpenAI 上游协议都压成了一个 `openai_compatible`，而 `llm-universal-proxy` 明确区分三种主要上游协议：

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages

这已经开始带来实际问题：

- 编辑 endpoint 时，“兼容接口”显示可能不反映 endpoint 当前真实协议。
- 编辑保存时，协议还有被 provider 默认值误覆盖的风险。
- AgentSmith 给 universal proxy 下发的上游格式信息不够精确，无法表达“这个 endpoint 原生就是 Responses upstream”。

本任务不是单纯的 UI 修复，而是一个 **endpoint 数据模型、协议治理、universal proxy 对接一致性** 的收敛任务。

目标是把 AgentSmith 的 endpoint 真相模型从“粗粒度兼容类型”升级为“明确的上游协议类型”，并让前端、后端、universal proxy 对接、测试全部围绕这个新真相收敛。

## 当前问题与根因

### 用户层面已暴露的问题

用户反馈：

- 创建某些 anthropic 接口 endpoint 后，进入编辑页时“兼容接口”仍显示为 `OpenAI 兼容`。

这不是理想行为，而且风险不只是显示错。

### 已确认的根因

1. 当前 endpoint 协议模型过粗。
   - 前端和后端当前主要使用：
     - `openai_compatible`
     - `anthropic_compatible`
   - 但 `llm-universal-proxy` 明确区分：
     - `openai-completion`
     - `openai-responses`
     - `anthropic`

2. 编辑页显示协议时，不是优先读 endpoint 自身真相。
   - `EditEndpointForm` 中，“兼容接口”显示使用的是：
     - `selectedProvider.protocol`
   - 而不是：
     - `endpoint.protocol`
   - 这意味着 UI 显示的是“当前 provider 默认协议”，不是“endpoint 当前真实协议”。

3. 编辑提交时也有覆盖风险。
   - `EditEndpointDialog` 中，非 custom endpoint 提交时：
     - `protocolForSubmit = selectedProvider.protocol`
   - 也就是说，保存时可能把 endpoint 原本真实协议改成 provider 默认协议。

4. 后端目前只能把 `openai_compatible` 映射成 `openai-completion`。
   - `universal-proxy-service.ts` 当前固定映射是：
     - `anthropic_compatible -> anthropic`
     - `openai_compatible -> openai-completion`
   - 无法表达：
     - “这个 endpoint 上游本来就是 Responses-native”。

### 为什么这是结构问题

`llm-universal-proxy` 的设计和文档已经明确把下面三类视为不同协议：

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages

AgentSmith 如果继续只保留：

- `openai_compatible`
- `anthropic_compatible`

就会长期处于“概念比 universal proxy 更粗”的状态，导致：

- UI/编辑逻辑容易混淆。
- protocol passthrough / translation 行为不够可解释。
- 后续 capability matrix 和 routing 也会越来越难收。

## 代码现状与关键位置

### 当前协议类型

- 前端共享类型：
  - `src/lib/api/types/endpoints-core.ts`
    - `Endpoint.protocol?: EndpointProtocol`
    - `EndpointProtocol = 'openai_compatible' | 'anthropic_compatible' | 'google_gemini' | 'glm_native' | 'dashscope_native'`
- 前端自定义 endpoint 类型：
  - `src/lib/api/types/endpoints.ts`
    - `CustomEndpointProtocol = 'openai_compatible' | 'anthropic_compatible'`

### Provider 默认协议来源

- `src/lib/endpoints/provider-catalog.ts`
  - OpenAI family 默认 `openai_compatible`
  - Anthropic family 默认 `anthropic_compatible`
  - custom wizard 当前也只提供两种协议选择

### 编辑页当前问题点

- `src/components/endpoints/EditEndpointDialog.tsx`
  - 非 custom endpoint 当前保存使用 `selectedProvider.protocol`
- `src/components/endpoints/edit-endpoint-dialog/EditEndpointForm.tsx`
  - “兼容接口”当前显示使用 `selectedProvider.protocol`

### 后端 endpoint 持久化与推断

- `packages/api-entry-node/src/endpoint-resource-service.ts`
  - `inferProtocol(...)`
  - `inferCompatibilityInterface(...)`
  - `createEndpoint(...)`
  - `updateEndpoint(...)`

### universal proxy 对接

- `packages/api-entry-node/src/universal-proxy-service.ts`
  - 当前 `fixed_upstream_format` 只能精确表达：
    - `openai-completion`
    - `anthropic`
    - `google`

### 参考文档

- `../llm-universal-proxy/README.md`
- `../llm-universal-proxy/docs/DESIGN.md`
- `../llm-universal-proxy/docs/protocol-compatibility-matrix.md`
- 本仓库相关合同：
  - `universal-proxy-integration-v1.md`
  - `endpoint-proxy-protocol-bridge-contract.md`
  - `endpoints-capability-contract.md`

## 建议目标模型

### 新的 endpoint 真相字段

新增一个更明确的字段，推荐命名：

- `upstream_protocol`

候选值：

- `openai_chat_completions`
- `openai_responses`
- `anthropic_messages`
- 预留未来扩展：
  - `google_gemini`

### 旧字段的角色调整

现有字段不要立刻全删，但要降级成兼容层：

- `protocol`
  - 过渡兼容读取用
  - 不再作为未来唯一真相
- `meta.compatibility_interface`
  - 仅保留展示 / 兼容
  - 不再用于推断 endpoint 真相
- `provider_family`
  - 继续做供应商归类
  - 不再承担协议真相角色

### 下游客户端协议保持独立

必须明确区分两件事：

1. **上游协议**
   - endpoint 自己实际对接上游 LLM 的 wire format
2. **下游客户端入口**
   - AgentSmith 暴露给用户 / CLI / agent 的访问格式

也就是说：

- endpoint 的 `upstream_protocol` 决定：
  - universal proxy 如何配置 `fixed_upstream_format`
  - 哪种请求可以 passthrough
  - 哪种请求需要转换
- 客户端仍然可以通过：
  - `/proxy/openai/chat/completions`
  - `/proxy/openai/responses`
  - `/proxy/anthropic/messages`
  访问同一个 endpoint

这和 universal proxy 的模型完全一致。

## 具体实施方案

## 1. 数据模型与持久化

### 新增字段

在前后端共享 endpoint 类型上增加：

- `upstream_protocol`

优先修改：

- `src/lib/api/types/endpoints-core.ts`
- `packages/api-entry-node/src/resource-models.ts`
- `packages/api-entry-node/src/endpoint-resource-service.ts`

### 兼容策略

第一阶段不要直接移除旧 `protocol`，采用兼容过渡：

读取时优先级：

1. `endpoint.upstream_protocol`
2. 旧 `endpoint.protocol` 映射
3. 最后再按 `base_url` 推断

映射规则建议固定为：

- `openai_compatible -> openai_chat_completions`
- `anthropic_compatible -> anthropic_messages`
- `google_gemini -> google_gemini`
- 旧 native 类型如有保留，按现有语义映射

### 写入策略

新建和编辑 endpoint 时：

- 必须写 `upstream_protocol`
- 过渡期可同步回写 `protocol` 作为兼容镜像，但 `upstream_protocol` 才是权威真相

### 数据迁移策略

本次不要求先做离线 migration。  
采用在线兼容策略：

- 新写入都带 `upstream_protocol`
- 旧数据读取时自动推断并在返回层表现正常
- 后续如果需要，可再做一次后台 migration，把旧 endpoint 补齐

## 2. 前端创建与编辑页重构

### 设计原则

UI 必须分清：

- 供应商分类
- 上游协议
- 下游接入格式

不能再把 “OpenAI 兼容” 这类词既当上游真相、又当下游客户端入口、又当 provider 默认值。

### 创建 endpoint

创建页改成两层：

#### 标准 provider 模式

当用户选标准 provider 时：

- provider 仍决定默认 family / base_url / 推荐模型
- 但表单里应明确显示该 provider 的默认上游协议
- 如果 provider 有多个可能的上游协议，必须让用户显式选择

特别是 OpenAI 家族：

- 不再只用一个 `openai_compatible`
- 必须明确区分：
  - OpenAI Chat Completions upstream
  - OpenAI Responses upstream

#### 自定义 endpoint 模式

Custom endpoint wizard 的协议选项扩成至少三种：

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages

### 编辑 endpoint

编辑页必须改成：

显示优先级：

1. `endpoint.upstream_protocol`
2. 兼容映射值

提交规则：

- 默认提交当前 endpoint 的真实 `upstream_protocol`
- 除非用户明确改协议，否则不能被 provider 默认值覆盖

### 文案建议

把现在模糊的“兼容接口”改成更准确的词，例如：

- 中文：`上游协议`
- 英文：`Upstream protocol`

同时单独说明：

- `客户端接入格式` 由 API 接入手册中的 OpenAI / Anthropic tab 决定
- 不是这里这个字段决定

## 3. 后端路由与 universal proxy 对接

### `EndpointResourceService`

在：

- `createEndpoint`
- `updateEndpoint`
- `inferProtocol`
- `inferCompatibilityInterface`

这几处改成围绕 `upstream_protocol` 工作。

#### 新的推断函数

推荐新增：

- `inferUpstreamProtocol(baseUrl, fallbackUpstreamProtocol, legacyProtocol)`

规则建议：

- 如果用户明确传 `upstream_protocol`，优先使用
- 否则从旧 `protocol` 兼容映射
- 否则按 base_url 猜测：
  - 含 `/v1/messages` 或 anthropic 域 -> `anthropic_messages`
  - 含 `/responses` 或明显 Responses upstream -> `openai_responses`
  - 其他 OpenAI 风格默认 -> `openai_chat_completions`

### `universal-proxy-service.ts`

这里是本次改造的关键之一。

当前 `fixedUpstreamFormat(...)` 需要改成：

- `openai_chat_completions -> openai-completion`
- `openai_responses -> openai-responses`
- `anthropic_messages -> anthropic`
- `google_gemini -> google`

这样 AgentSmith 才能把 endpoint 上游格式准确传给 universal proxy。

### `endpoint-protocol-router.ts`

能力支持矩阵也要改成基于新的三种主协议判断。特别要明确：

- 哪些 capability 是三种协议都支持
- 哪些只支持某些协议
- Responses 和 Chat Completions 是否在某些能力上要区别对待

如果当前 capability 还没有需要区分 Responses vs Chat Completions 的场景，可以先保持保守矩阵，但实现上必须用新协议类型。

## 4. API 接入手册与 endpoint / gateway 使用心智

### endpoint 配置页

强调：

- 这里配置的是 **上游协议**
- 不是客户端使用方式

### API 接入手册

继续保持现在的心智：

- 用户选 endpoint
- 再选下游客户端协议：
  - OpenAI-compatible
  - Anthropic-compatible

因为客户端协议和上游协议是由 AgentSmith + universal proxy 连接起来的，不应该在接入页里暴露为同一个概念。

### 关系说明

建议在文案里明确一条：

- endpoint 设置页决定的是“这个 endpoint 的上游协议”
- API 接入手册决定的是“你用什么客户端格式访问 AgentSmith”

## 5. 测试计划

## 后端单测 / 集成测试

必须新增或修改：

### `EndpointResourceService`

- 新建 endpoint 时能保存：
  - `openai_chat_completions`
  - `openai_responses`
  - `anthropic_messages`
- 旧 `protocol` 兼容映射正确
- `base_url` 推断不会把 Responses upstream 误判成 Chat Completions
- 更新 endpoint 时不会被 provider 默认协议覆盖

### `universal-proxy-service`

- `upstream_protocol = openai_chat_completions` -> `fixed_upstream_format = openai-completion`
- `upstream_protocol = openai_responses` -> `fixed_upstream_format = openai-responses`
- `upstream_protocol = anthropic_messages` -> `fixed_upstream_format = anthropic`

### endpoint proxy / gateway 集成测试

至少覆盖：

- OpenAI Responses client -> Responses upstream passthrough
- OpenAI Responses client -> Chat Completions upstream translation
- OpenAI Responses client -> Anthropic upstream translation
- Anthropic client -> Anthropic upstream passthrough
- Anthropic client -> Responses upstream translation
- Anthropic client -> Chat Completions upstream translation

## 前端测试

### 创建 / 编辑页

补测试覆盖：

- 编辑 anthropic endpoint 时，表单显示 `Anthropic Messages`
- 编辑 responses endpoint 时，表单显示 `OpenAI Responses`
- 编辑 chat-completions endpoint 时，表单显示 `OpenAI Chat Completions`
- 打开编辑页但不改协议直接保存，不会把协议改回 provider 默认值

### API 接入手册

不用因为这次改造去改用户接入心智，但要确保：

- endpoint 切换后 Base URL 正常
- 协议 tab 仍然只是客户端格式，不受上游协议误限制

## backend-real / smoke

建议补 1 组最小 backend-real：

- 建一个 Responses upstream endpoint
- 建一个 Anthropic upstream endpoint
- 从 API key + endpoint proxy 路径分别调：
  - `/proxy/openai/responses`
  - `/proxy/openai/chat/completions`
  - `/proxy/anthropic/messages`
- 断言 AgentSmith -> universal proxy -> upstream 正常工作，且 passthrough / translation 路径符合新 `upstream_protocol`

## 实施顺序

1. 先引入 `upstream_protocol`，不删旧 `protocol`
2. 改后端 create/update/read 逻辑，让新字段成为真相
3. 改 `universal-proxy-service`，按新真相输出 `fixed_upstream_format`
4. 改前端创建/编辑页，显示和保存都改用新真相
5. 补后端测试
6. 补前端测试
7. 最后补一组 backend-real endpoint/proxy 回归

## 影响评估

### 影响范围

中等偏大，涉及：

- endpoint 类型
- endpoint CRUD
- 编辑表单
- universal proxy 配置下发
- endpoint / gateway 测试

### 风险

主要风险不是运行期大面积故障，而是：

- 兼容旧 endpoint 数据时逻辑不一致
- 前端 UI / 保存逻辑半改导致协议被误写
- universal proxy format 映射漏改

### 为什么值得做

因为现在的协议模型已经开始影响：

- UI 正确性
- 编辑安全性
- endpoint 真相表达能力
- 和 universal proxy 的一致性

如果不改，这类问题后面还会继续出现。

## 默认决策

- 采用新增 `upstream_protocol` 的渐进式改造，不做一次性硬切
- 把三种主要上游协议定为：
  - `openai_chat_completions`
  - `openai_responses`
  - `anthropic_messages`
- 继续让 API 接入手册维持“客户端协议选择”的心智，不把上游协议暴露给终端用户当主入口
- 不在这一轮同时重构所有 provider family 命名，只聚焦协议真相收敛
- 不立刻删除旧 `protocol` 字段，先作为兼容读写层保留
