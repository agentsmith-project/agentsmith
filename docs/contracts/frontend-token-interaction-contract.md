# Frontend Token & Interaction Contract (MVP)

Last updated: 2026-03-03
Owner: Frontend
Audience: Frontend, Backend Auth, QA

## Purpose

Define the single-source token contract used by frontend route gates and interaction controls for MVP.

This document is token-only:
- runtime authorization depends on permission tokens only
- role/group names are governance labels only
- no runtime auth decision should depend on role names

Related docs:
- `docs/contracts/auth-permission-model.md`
- `docs/contracts/frontend-backend-gating-matrix.md`
- `docs/contracts/frontend-resource-policy-governance-v1.md`

## Core Principles

1. Keycloak handles identity and workspace membership.
2. Frontend route/action gates are token-only.
3. Backend authorization is final.
4. Resource usage control is policy-driven, not role-name-driven.

## Canonical Token Set (MVP)

### Workspace
- `workspace:read`
- `workspace:project:create`

### Project
- `project:endpoint:use`
- `project:agent:manage`
- `project:agent:public`
- `project:manage`

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

- Endpoint create/update/delete: `project:manage`
- Credential create/rotate/delete: `project:manage`
- Resource policy save: `project:manage`
- Member/template/group management: `project:manage`
- Agent create/update/delete/key issue/key revoke: `project:agent:manage`
- Agent publish/unpublish visibility changes: `project:agent:public`

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

- No route gate depends on role names.
- Canonical token set contains only active tokens in this contract.
- `npm run contracts:check` passes.
