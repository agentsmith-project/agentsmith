# Frontend Token & Interaction Contract (MVP)

Last updated: 2026-04-07
Owner: Frontend
Audience: Frontend, Backend Auth, QA

## Purpose

Define the single-source token contract used by frontend route permission gates and interaction controls for MVP.

This document is token-only:
- backend operation authorization depends on permission tokens only
- role/group names are governance labels only
- no backend-operation auth decision should depend on role names

Related docs:
- `docs/contracts/auth-permission-model.md`
- `docs/contracts/frontend-backend-gating-matrix.md`
- `docs/contracts/frontend-resource-policy-governance-v1.md`

## Core Principles

1. Keycloak handles identity and workspace membership.
2. Frontend route/action permission gates are token-only.
3. Backend authorization is final.
4. Resource usage control is policy-driven, not role-name-driven.

## Canonical Token Set (MVP)

### Workspace
- `workspace:read`
- `workspace:project:create`

### Project
- `project:endpoint:use`
- `project:agent:use`
- `project:terminal:use`
- `project:agent:manage`
- `project:agent:public`
- `project:audit:read`
- `project:governance:update`
- `project:membership:update`
- `project:admins:update`
- `project:lifecycle:update`
- `project:files:update`

## Route-Level Permission Gate Contract

- Projects list: `workspace:read`
- Project overview: `project:endpoint:use`
- Chat: `project:endpoint:use`
- Notebook list/detail: `project:endpoint:use`
- Notebook terminal session use: `project:terminal:use`
- Files: `project:endpoint:use`
- Endpoints: `project:endpoint:use`
- Agents: `project:agent:use` or `project:agent:manage`
- Members: `project:membership:update`
- Shared context: `project:governance:update`
- Project secrets: `project:governance:update`
- Resource Policy: `project:governance:update`
- Settings: `project:governance:update` or `project:admins:update` or `project:lifecycle:update`
- Audit: `project:audit:read`
- Usage: `project:endpoint:use`
- Access guide: `project:endpoint:use`

Current split-token status:
- Files mutations are now governed by `project:files:update` end to end.
- Notebook terminal session use remains on `project:terminal:use`.
- Shared context remains on `project:governance:update`.
- Project secrets remain on `project:governance:update`.
- Resource Policy remains on `project:governance:update`.
- Members governance writes remain on `project:membership:update`.
- Project owner/admin assignment remains on `project:admins:update`.
- Project lifecycle settings and delete remain on `project:lifecycle:update`.
- Audit read remains on `project:audit:read`.

## Action-Level Permission Gate Contract

- Endpoint create/update/delete: `project:governance:update`
- File/library create/update/delete: `project:files:update`
- Project secret create/rotate/delete: `project:governance:update`
- Resource policy save: `project:governance:update`
- Member/template/group management and join request decisions: `project:membership:update`
- Agent create/update/delete/key issue/key revoke: `project:agent:manage`
- Agent publish/unpublish visibility changes: `project:agent:public`

Current action split status:
- Endpoint governance writes: `project:governance:update`
- File/library create/update/delete/move/upload/share-link: `project:files:update`
- Project secret create/rotate/delete: `project:governance:update`
- Resource policy save: `project:governance:update`
- Member/template/group management and join request decisions: `project:membership:update`
- Project admin assignment: `project:admins:update`
- Project delete / owner transfer / lifecycle settings: `project:lifecycle:update`

## UI Behavior Contract

1. Missing route token:
- render `permission_denied` state

2. Missing action token while route is accessible:
- keep page visible
- disable or hide mutating control

3. Invalid route params:
- render `validation_error` state

4. Persisted auth state is stale (token expired/revoked):
- frontend retries once with refresh token
- refresh failure clears auth store + query cache
- redirect to localized login route (`/{locale}/login`)
- show explicit session-expired feedback with one-step recovery action

## Backend Handoff Requirements

1. Backend endpoint ACL must match the token mapping above.
2. Backend returns deterministic `401`/`403`.
3. Resource policy API supports:
- project default rules
- resource override rules
- subject override rules
- consistent rule-key validation by resource type

## Freeze Checklist

- No route permission gate depends on role names.
- Canonical token set contains only active tokens in this contract.
- `npm run contracts:check` passes.
