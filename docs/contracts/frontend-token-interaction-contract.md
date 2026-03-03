# Frontend Token & Interaction Contract (MVP)

Last updated: 2026-02-10
Owner: Frontend
Audience: Frontend, Backend Auth, QA

## Purpose

Define the **single-source token contract** used by frontend route gates and interaction controls for MVP.

This document is token-only:
- runtime authorization depends on permission tokens only
- role/group names are template labels for governance UX only
- no runtime auth decision should depend on role names

Related docs:
- `docs/contracts/auth-permission-model.md`
- `docs/contracts/frontend-backend-gating-matrix.md`
- `docs/contracts/frontend-resource-policy-governance-v1.md`

## Core Principles

1. Keycloak responsibility ends at identity/workspace membership.
2. Frontend runtime gate is token-only.
3. Chat and Notebook are access-only modules in MVP.
4. Resource usage limits are governed by resource policy rules, not by extra chat/notebook quotas.
5. Credentials are governed by `project:manage` only in MVP.

## Canonical Token Set (MVP)

### Workspace
- `workspace:read`
- `workspace:project:create`
- `workspace:governance:update`

### Project base and access
- `project:endpoint:use`
- `project:endpoint:use`
- `project:endpoint:use`

### Resources
- `project:endpoint:use`
- `project:manage`
- `project:endpoint:use`
- `project:manage`
- `project:agent:manage`
- `project:agent:manage`

### Governance
- `project:manage`
- `project:manage`
- `project:manage`
- `project:manage`
- `project:manage`

### Observability
- `project:endpoint:use`
- `project:endpoint:use`

## Route-Level Gate Contract

- Projects list: `workspace:read`
- Project overview: `project:endpoint:use`
- Chat: `project:endpoint:use`
- Notebook list/detail: `project:endpoint:use`
- Files: `project:endpoint:use`
- Endpoints: `project:endpoint:use`
- Agents: `project:agent:manage`
- Members: `project:manage`
- Credentials: `project:manage`
- Resource Policy: `project:manage`
- Settings: `project:manage`
- Audit: `project:endpoint:use`
- Usage: `project:endpoint:use`

## Action-Level Gate Contract

- Source create/update/delete: `project:manage`
- Endpoint create/update/delete: `project:manage`
- Agent create/update/delete/key issue/key revoke: `project:agent:manage`
- Members invite/remove/template/group/policy apply: `project:manage`
- Settings update/delete project: `project:manage`
- Resource policy save: `project:manage`
- Credentials create/rotate/delete: `project:manage`

## UI Behavior Contract

1. Missing route token:
- render `permission_denied` page state

2. Missing action token while route is accessible:
- keep page visible
- disable or hide mutating control

3. Invalid route params:
- render `validation_error` page state

4. Persisted auth state is stale (token expired/revoked):
- detect via API `401` during authenticated bootstrap pages (for example workspace selection)
- frontend runtime must handle `401` globally with refresh-first semantics:
  - attempt one token refresh with stored refresh token
  - if refresh succeeds, retry original request exactly once
  - if refresh fails or refresh token missing, clear auth and redirect to localized login
- logout path must clear both auth store and query cache before redirect
- must provide explicit session-expired UI feedback
- must offer one-step recovery action:
  - clear persisted auth state
  - redirect to localized login route (`/{locale}/login`)
- must not leave user in silent empty-state with no recovery path

## Backend Handoff Requirements

1. Backend endpoint ACL must match the token mapping above.
2. Backend returns deterministic `403 forbidden` for missing token.
3. Resource policy API supports:
- project default rules
- resource override rules
- subject override rules
- consistent rule key validation by resource type

## Freeze Checklist

- No route gate depends on role names.
- Canonical token set contains only active tokens in this contract.
- `npm run contracts:check` and `npm run contracts:check-release-sync` pass.
