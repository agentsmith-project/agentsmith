# Documentation Index

Central index for AgentSmith documentation. Product scope and principles are in the constitution and contracts; implementation details are in DEVELOPMENT.md and AGENTS.md.

## Top-level

| Doc | Description |
|-----|-------------|
| [项目宪法 (Project Constitution)](./项目宪法.md) | 产品目标、设计风格与功能范围之最高指导；防漂移 |
| [Product Engineering Governance Methodology](./design/agentsmith-product-engineering-governance-methodology-v1.md) | 产品设计、工程交付与治理方法论基线 |
| [Project Maturity & Productization Review v1](./design/project-maturity-productization-review-v1.md) | 当前项目成熟度、产品化进度与下一阶段主要缺口评估 |
| [Governance Explainability Closure Review v1](./design/governance-explainability-closure-review-v1.md) | 治理解释性与有效访问控制台第一阶段收口结论与基线定义 |
| [AI Ops Home UX Strategy v1](./design/ai-ops-home-ux-strategy-v1.md) | 当前 UX 基线的设计原则与任务化信息架构 |
| [AI Ops Home UX Closure Review v1](./design/ai-ops-home-ux-closure-review-v1.md) | 当前 UX 主线的收口结论、残余低优先级债与基线定义 |

## Contracts (`./contracts/`)

Normative API, permission, and module boundaries. See [contracts/README.md](./contracts/README.md) for the full list.

- **Core:** auth, token interaction, resource policy, gating matrix, route-gate-test checklist, product terminology
- **Module maps:** chat, notebook, files, agents, endpoints, members, resource-policy, projects
- **Specs:** `contracts/specs/openapi.yaml`, `contracts/specs/asyncapi.yaml`

## UX/UI (`./UXUI/`)

- **00-设计系统:** [视觉设计系统-v1.md](./UXUI/00-设计系统/视觉设计系统-v1.md), 错误码映射表, 状态与文案规范, 对话框与侧边栏使用规范
- **01-通用规范:** [i18n 内部指南](./UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md), 页面清单与权限可见性, 技术栈与国际化策略, i18n 键空间与文案清单
- **02-组件规格:** AppShell, 列表批量操作栏设计规范
- **Test ID:** [2026-02-05-前端-testid-规范.md](./UXUI/2026-02-05-前端-testid-规范.md)

## Root guides

- [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) — design system index (links to UXUI)
- [DEVELOPMENT.md](../DEVELOPMENT.md) — runbook, env, Makefile, project structure
- [AGENTS.md](../AGENTS.md) — AI/dev onboarding, architecture, commands, testing

## Release / Validation

- [Release Verification](./user-guides/release-verification.md) — 当前发布验证、lane/gate、report、runner 与排障入口
- [Release Governance Control Plane](./user-guides/release-governance-control-plane.md) — 运行与发布治理控制面的操作基线
- [internal-release-checklist](./release/internal-release-checklist.md) — 内部发布检查清单
- [internal-release-capability-matrix](./release/internal-release-capability-matrix.md) — 当前内部发布能力边界（主线 + 治理）
- [internal-release-note-2026-02-28-closure](./release/internal-release-note-2026-02-28-closure.md) — 当前 release 基线与最终收口记录

## Current Baselines

- [llm-runtime-final-implementation-plan-v2](./plans/llm-runtime-final-implementation-plan-v2.md) — Runtime / Usage / Release Governance 产品与工程基线
- [ai-ops-home-ux-closure-review-v1](./design/ai-ops-home-ux-closure-review-v1.md) — 当前 UX 主线收口与基线定义
- [governance-explainability-closure-review-v1](./design/governance-explainability-closure-review-v1.md) — 当前治理解释性主线收口与基线定义
- [internal-release-note-2026-02-28-closure](./release/internal-release-note-2026-02-28-closure.md) — 当前 release closure 基线
- [governance-explainability-effective-access-console-plan-v1](./plans/governance-explainability-effective-access-console-plan-v1.md) — 当前 explainability 与 effective access 已完成实施计划

## Other

- [Agent Collaboration Playbook](./agent-collaboration-playbook.md) — contract-first workflow for human/agent collaboration
- 历史计划、旧版发布说明和过程性评审已归档到 `design/archive`、`plans/archive`、`release/archive`
