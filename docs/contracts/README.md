# Contracts Index

This directory contains frontend-backend permission and gating contracts.

## Working Documents (Latest Editable)

- `frontend-backend-gating-matrix.md`
- `route-gate-test-checklist.md`
- `auth-permission-model.md`
- `frontend-mvp-role-governance-requirements.md`
- `frontend-token-interaction-contract.md`
- `frontend-resource-policy-governance-v1.md`

These are living documents and can evolve during development.

## Operational References (Do Not Skip)

- `../../DEVELOPMENT.md`
  - `Playwright E2E Runbook (Recommended)` for stable `BASE_URL` test execution and triage flow.
  - `Permission Gate Hook Rule (Important)` for safe permission-hook usage.
- `../../AGENTS.md`
  - `Playwright Execution Notes (2026-02)` for practical routing/debugging patterns used in this repo.

## Critical Contract Rules

Before adding/changing route gates or permission checks, align with:

- `route-gate-test-checklist.md`
  - Includes permission hook safety rule (no hook short-circuit patterns).
  - Includes workspace-scoped projects route fallback expectations.
- `frontend-backend-gating-matrix.md`
  - Includes backend-authoritative note for workspace projects bootstrap fallback.

## Cleanup Policy

- Remove outdated contract snapshots instead of keeping parallel versioned docs in-tree.
- Keep a single active contract set in this directory to avoid terminology and gate drift.
- Resource policy contract lives at `frontend-resource-policy-governance-v1.md` and is the only active source for policy schema/rule matrix.
