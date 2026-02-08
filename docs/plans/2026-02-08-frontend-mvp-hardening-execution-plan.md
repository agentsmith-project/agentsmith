# Frontend MVP Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 收敛并修复当前评审发现的 P0/P1 问题，使前端达到可冻结的 MVP 质量（不依赖后端联调）。

**Architecture:** 采用“先门禁一致性、再术语/路由一致性、再文案一致性、最后构建与回归”的顺序。每个任务都先写失败测试，再最小实现，再回归验证，避免大范围回归风险。文档直接更新现有文档，不新增版本分叉文档。

**Tech Stack:** Next.js 15 App Router, TypeScript, React Query, Zustand, next-intl, Vitest, Playwright

---

## Tasks

1. 参数校验与门禁入口收敛（P0）
2. Studio 命名与路由一致性收敛（P0）
3. 去除页面硬编码英文文案并完成 i18n 收口（P1）
4. 构建环境一致性（SWC 版本）与脚本稳定性（P1）
5. 文档整合更新（不新增版本分叉）+ 最终回归

## Acceptance

- 路由参数全部经过 validate 函数
- 项目内页面主路由统一使用 `/studio`
- agents/endpoints 页面无硬编码英文
- lint、关键单测、smoke e2e 通过
