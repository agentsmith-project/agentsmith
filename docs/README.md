# Documentation Index

Central index for AgentSmith documentation. Product scope and principles are in the constitution and contracts; implementation details are in DEVELOPMENT.md and AGENTS.md.

## Top-level

| Doc | Description |
|-----|-------------|
| [项目宪法 (Project Constitution)](./项目宪法.md) | 产品目标、设计风格与功能范围之最高指导；防漂移 |
| [开发推进情况 (Development Progress)](./开发推进情况.md) | 截止当前的开发进度说明（路由/门禁/测试/契约） |

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
- [internal-release-checklist](./release/internal-release-checklist.md) — 内部发布检查清单
- [internal-release-note-2026-02-24-governance-rc](./release/internal-release-note-2026-02-24-governance-rc.md) — 治理 RC 发布记录

## Other

- [Agent Collaboration Playbook](./agent-collaboration-playbook.md) — contract-first workflow for human/agent collaboration
