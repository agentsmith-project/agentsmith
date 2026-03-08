# Current Baseline (Whitelist)

更新时间：2026-03-08  
状态：`authoritative`

本文件是当前唯一白名单。新人入项、评审、实施、验收都以本清单为准。

## 1. 治理主线（唯一）

1. 项目级治理（project scope）
2. LLM endpoint 统一约束链路
3. Chat / Notebook / API 共用同一套 rate / spending / audit / usage 约束
4. 不做发布管理平台，不做组织级总控治理主线

术语边界（必须一致）：

- 文档中的 `release` / `gate` 仅表示 AgentSmith 本项目研发治理与验收流程命名。
- 不代表 AgentSmith 产品对外提供 DevOps 发布编排、发布门禁平台能力。

## 2. 必读文档（必须）

1. [项目宪法](./项目宪法.md)
2. [产品研发与治理方法论](./design/agentsmith-product-engineering-governance-methodology-v1.md)
3. [Contracts Index](./contracts/README.md)
4. [User Guides Index](./user-guides/README.md)
5. [Troubleshooting Guide](./troubleshooting-guide-v1.md)

## 3. 设计与交互规范（必须遵循）

1. `docs/UXUI/00-设计系统/*`
2. `docs/UXUI/01-通用规范/*`
3. `docs/UXUI/02-组件规格/*`
4. `docs/UXUI/2026-02-05-前端-testid-规范.md`

## 4. 合同与接口规范（实施依据）

1. `docs/contracts/README.md` 中列出的现行合同
2. `docs/contracts/specs/openapi.yaml`
3. `docs/contracts/specs/asyncapi.yaml`

## 5. 运行操作文档（按需）

1. [Agent Codex Notebook Runbook](./agent-codex-notebook-runbook.md)
2. [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

## 6. 执行规则

1. 白名单之外文档不作为需求与评审依据。
2. 若需新增治理维度，先改宪法与合同，再做代码。
3. 文档冲突时：宪法 > 合同 > UXUI 规范 > 用户指南。
