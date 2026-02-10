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
3. Chat and AI Studio are access-only modules in MVP.
4. Resource usage limits are governed by resource policy rules, not by extra chat/studio quotas.
5. Credentials are governed by `project:credential:manage` only in MVP.

## Canonical Token Set (MVP)

### Workspace
- `workspace:read`
- `workspace:project:create`
- `workspace:governance:update`

### Project base and access
- `project:read`
- `project:chat:access`
- `project:studio:access`

### Resources
- `project:source:use`
- `project:source:manage`
- `project:endpoint:use`
- `project:endpoint:manage`
- `project:agent:use`
- `project:agent:manage`

### Governance
- `project:resource_policy:manage`
- `project:credential:manage`
- `project:settings:manage`
- `project:member:view`
- `project:member:manage`

### Observability
- `project:audit:view`
- `project:usage:view`

## Route-Level Gate Contract

- Projects list: `workspace:read`
- Project overview: `project:read`
- Chat: `project:chat:access`
- AI Studio list/detail: `project:studio:access`
- Sources: `project:source:use`
- Endpoints: `project:endpoint:use`
- Agents: `project:agent:use`
- Members: `project:member:view`
- Credentials: `project:credential:manage`
- Resource Policy: `project:resource_policy:manage`
- Settings: `project:settings:manage`
- Audit: `project:audit:view`
- Usage: `project:usage:view`

## Action-Level Gate Contract

- Source create/update/delete: `project:source:manage`
- Endpoint create/update/delete: `project:endpoint:manage`
- Agent create/update/delete/key issue/key revoke: `project:agent:manage`
- Members invite/remove/template/group/policy apply: `project:member:manage`
- Settings update/delete project: `project:settings:manage`
- Resource policy save: `project:resource_policy:manage`
- Credentials create/rotate/delete: `project:credential:manage`

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
