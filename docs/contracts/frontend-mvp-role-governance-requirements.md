# Frontend MVP Governance Requirements

> Note (2026-02-07): This file is partially superseded by
> `docs/contracts/frontend-resource-policy-governance-v1.md`.
> For resource access and usage governance, follow v1 contract.

## Purpose

Capture the current business requirements for frontend MVP around identity, group governance, and resource access.
This document is the product-facing source for UX behavior; API-level details remain in existing contract documents.

## Identity Boundary

1. Keycloak handles:
- user -> workspace membership (0..N workspaces)
- workspace admin identity via `ws_admin_{workspace_id}` style claim/group mapping

2. Keycloak stops at AuthN/AuthZ boundary above.
- All project-level and resource-level authorization is handled by MBOS domain policy.

## Workspace Governance

1. Workspace admin can classify workspace members into governance groups:
- `wheel`
- `user`

2. Workspace admin is always treated as `wheel`.

3. Governance group is a management label only.
- Frontend runtime gates are token-only.
- Group names are not used as authorization conditions.

## Project Governance

1. Project admin can manage project policy:
- runtime preferences
- governance policy
- resource limits

2. Project admin can manage shared resources:
- shared sources library
- shared LLM endpoints
- project-scoped credentials

3. Project admin can manage project groups:
- create/edit/delete project-scoped groups
- assign one permission template per group
- maintain group members
- apply group template to group members in batch

4. Project admin scope is per-project:
- a user can only administer projects where they hold `project admin`
- project admin rights do not automatically grant rights in other projects
- wheel users manage/delete only projects where they are project admin

5. Shared sources behavior:
- any project member can upload files
- uploader identity and timestamp must be retained

## Credentials Visibility Rule

1. Credentials module gate is token-only in frontend navigation and page access.
2. Effective access condition for credentials is:
- must have `project:credential:manage`
3. Even for authorized users, credentials display is metadata-only:
- name
- fingerprint
- timestamps
4. Secret values are never shown after creation.

## Resource Access Rule

1. Users (including admins) can use:
- chat
- AI Studio
- private file library
- completion endpoints API

2. MVP resource types are unified and do not distinguish private/shared in data model:
- endpoint
- source library
- agent
3. Simplification rule for MVP:
- all project members can access resources by default
- new resources inherit project defaults
- project admin can add per-resource/per-subject overrides when needed
4. Chat / AI Studio page access uses dedicated access tokens:
- `project:chat:access`
- `project:studio:access`
5. Chat / AI Studio do not define independent quota/rate rules in MVP.
- usage constraints are surfaced from endpoint/source_library/agent policy outcomes

## Resource Policy Model (MVP Draft Alignment)

1. Policy granularity is resource-level only:
- endpoint
- source library
- agent
- no file-level policy in MVP

2. Policy subjects:
- project groups (group alias)
- individual members

3. Default policy:
- all members allowed by default
- default rate/quota comes from project policy
- new resources inherit defaults on creation

4. Conflict resolution:
- apply resolution priority: subject override > resource override > project default
- same-level conflicts resolve to stricter limits

5. Member lifecycle handling:
- when member leaves workspace/project, stale member policy subjects are ignored at runtime
- UI should mark stale subjects and provide one-click cleanup

6. Audit requirements for policy/resource governance actions:
- actor (`changed_by`)
- timestamp (`changed_at`)
- target resource
- action type (create/update/delete/policy-change)

## Token & Template Strategy (Canonical)

1. Keep permission tokens as system contract language.
2. Simplify configuration with:
- default group templates
- custom templates for advanced cases
3. UI default path must be template-first; raw token editing is advanced mode.

## Current Frontend Prototype Scope (2026-02-07)

1. Added workspace governance grouping UI in workspace settings (`wheel` / `user`) as frontend prototype state.
2. Runtime permission checks are token-only for project and resource operations.
3. Governance write operations follow token gates at route/action level.
4. Credentials gate follows token condition: `project:credential:manage`.
5. Projects list interaction and admin clarity:
- unpinned project table rows are directly clickable to open project overview
- pinned project cards and table action buttons are clickable and no longer blocked by row-level event conflicts
- project list shows `Project Admin` summary (first two admins, then ellipsis)

## Remaining MVP Gaps

1. Workspace governance group persistence currently frontend-local prototype state; backend contract still needed.
2. Project admin assignment UX should be template-first across all member flows.
3. Shared library first-class CRUD is implemented in Sources page, but advanced governance UX (library ownership transfer, archive lifecycle, bulk policy assignment) is not yet implemented.
4. Unified `Resource Policy` page should be the single resource-centric policy entry for endpoint/library/agent with subject-based overrides.
5. Policy stale-subject cleanup UX and governance audit timeline are not yet implemented.
