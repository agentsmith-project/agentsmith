# Documentation Index

Central index for AgentSmith documentation. Product scope and principles are in the constitution and contracts; implementation details are in DEVELOPMENT.md and AGENTS.md.

## Top-level

| Doc | Description |
|-----|-------------|
| [项目宪法 (Project Constitution)](./项目宪法.md) | 产品目标、设计风格与功能范围之最高指导；防漂移 |
| [AI Ops Home UX Strategy v1](./design/ai-ops-home-ux-strategy-v1.md) | 下一条 UX/UI 主线：统一企业 AI 运营首页与任务化信息架构 |
| [AI Ops Home UX Closure Review v1](./design/ai-ops-home-ux-closure-review-v1.md) | 当前 UX 主线的收口结论、残余低优先级债与基线定义 |
| [Next Mainline Priority Review v1](./design/next-mainline-priority-review-v1.md) | 基于当前代码/宪章/能力矩阵的下一条产品工程主线优先级评估 |

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

- [测试与发布验证指南-v1](./release/测试与发布验证指南-v1.md) — 面向开发/测试/实施的通俗指南（术语解释、推荐命令、发布前后流程、排障顺序）
- [新手FAQ-v1](./release/新手FAQ-v1.md) — 面向资浅同学的常见问题速查（命令选择、报错处理、发布最小标准）
- [internal-release-checklist](./release/internal-release-checklist.md) — 内部发布检查清单
- [internal-release-note-2026-02-24-governance-rc](./release/internal-release-note-2026-02-24-governance-rc.md) — 治理发布记录（历史留档）
- [internal-release-capability-matrix](./release/internal-release-capability-matrix.md) — 当前内部发布能力边界（主线 + 治理）

## Product Plans

- [next-release-product-roadmap-prd-v1](./plans/next-release-product-roadmap-prd-v1.md) — 下一期产品路线图 PRD（目标、里程碑、验收指标、风险与依赖）
- [ai-ops-home-implementation-plan-v1](./plans/ai-ops-home-implementation-plan-v1.md) — `AI Ops Home` 与任务化导航的实施顺序与验收门禁
- [governance-execution-closure-security-hardening-plan-v1](./plans/governance-execution-closure-security-hardening-plan-v1.md) — 下一主线：治理执行闭环与安全链路收口的实施顺序与验收门禁

## Other

- [Agent Collaboration Playbook](./agent-collaboration-playbook.md) — contract-first workflow for human/agent collaboration
