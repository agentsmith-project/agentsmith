# Frontend MVP Governance Requirements

Last updated: 2026-03-03

## Purpose

Capture current MVP frontend governance requirements for identity, project authorization, and resource access.

## Identity Boundary

1. Keycloak handles identity and workspace membership.
2. Project/resource authorization is handled by MBOS domain policy.
3. Frontend runtime gates are token-only; group names are labels, not auth conditions.

## Workspace Governance

1. Workspace admin can manage workspace governance groups.
2. Workspace-level admin identity stays in workspace claim/group model.

## Project Governance

1. `project:manage` is the project owner-grade permission and can manage all project resources and governance configuration.
2. Endpoint and credential lifecycle operations are controlled by `project:manage`.
3. Runtime usage entry points (chat/notebook/endpoints invocation) are controlled by `project:endpoint:use`.

## Agent Governance

1. `project:agent:manage`
- create and manage own agents
- use agents that are visible to current user

2. `project:agent:public`
- publish/unpublish agent visibility to the whole project

3. Visibility model
- non-`project:manage` users can see/use only:
  - their own agents
  - agents published to project
- `project:manage` can manage any project agent

## Files Governance (MVP)

1. Each member has a default personal file library.
2. Personal file libraries are isolated between members.
3. File-library governance is not part of unified resource-policy scope.

## Resource Policy Model (MVP)

1. Unified resource-policy scope includes only:
- `endpoint`
- `agent`

2. Policy subjects:
- project groups
- individual members

3. Resolution order:
- subject override > resource override > project default
- same-level conflict: most restrictive wins

4. Runtime stale-member handling:
- stale subjects are ignored at runtime
- UI exposes stale-subject cleanup actions

## Credentials Visibility Rule

1. Credentials view/manage gate: `project:manage`.
2. Secret values are shown once at creation only; never shown again.

## Current Frontend Scope

1. Route/action gates use permission tokens only.
2. Resource policy page is resource-centric (endpoint/agent).
3. Governance write operations use explicit token gates at route/action level.

## Remaining MVP Gaps

1. Backend persistence and enforcement must stay aligned to this contract.
2. Policy/audit explainability should remain deterministic for release verification.
