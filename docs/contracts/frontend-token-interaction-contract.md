# Frontend Token & Interaction Contract (MVP Draft)

> Note (2026-02-07): This document remains valid for operation-level tokens.
> Resource access/usage behavior should follow
> `docs/contracts/frontend-resource-policy-governance-v1.md`.

## Purpose

Define permission tokens and UI interaction gating for frontend MVP, aligned with role/governance requirements and UX rules.

Related source of truth:
- `frontend-mvp-role-governance-requirements.md`

## Global Principles

1. Keycloak scope ends at:
- workspace membership
- workspace admin identity

2. MBOS internal policy controls:
- wheel/user governance group
- project admin assignment
- project policy/resource permissions
- resource policy (access + rate/quota)

3. MVP resource policy baseline:
- all project members can access resources by default
- new resources inherit project defaults
- project admin can apply per-resource/per-subject overrides

4. Credentials dual gate:
- must be `wheel`
- must pass project credential/resource tokens

5. Wheel boundary:
- wheel is project-creation eligibility, not cross-project super-admin
- wheel users can manage/delete only projects where they are project admin

## Token Catalog (MVP)

### Workspace scope

- `workspace:governance:read`
- `workspace:governance:update`
- `workspace:project:create`

### Project admin scope

- `project:admin:grant`
- `project:admin:revoke`

### Project policy scope

- `project:policy:read`
- `project:policy:update`

### Project resource scope

- `project:resource:read`
- `project:resource:create`
- `project:resource:update`
- `project:resource:delete`

### Diagnostics/Audit/Usage scope

- `project:audit:read`
- `project:usage:read`

## Role Baseline Mapping (Default Templates)

This is default template behavior for UX and initial grants. It can be overridden by policy templates.

1. Workspace Admin
- inherits wheel behavior
- grants: `workspace:governance:*`, `workspace:project:create`

2. Wheel User
- grants: `workspace:project:create`
- no implicit cross-project admin tokens

3. Project Admin
- grants in that project:
  - `project:policy:read/update`
  - `project:resource:read/create/update/delete`
  - `project:admin:grant/revoke`

4. Normal User
- default usage tokens from project templates
- no policy/admin/resource-policy management tokens

## Interaction Contract Matrix

## 1) Workspace Settings

Action: View governance assignments
- Preconditions:
  - workspace member
  - token `workspace:governance:read`
- Failure:
  - page state `permission_denied`

Action: Change member group (`wheel`/`user`)
- Preconditions:
  - workspace admin identity
  - token `workspace:governance:update`
- Failure:
  - control disabled + tooltip `insufficient_permissions`

## 2) Project List

Action: Create project
- Preconditions:
  - token `workspace:project:create`
  - governance group `wheel`
- On success:
  - creator becomes project admin
- Failure:
  - primary CTA hidden or disabled

Action: Delete project
- Preconditions:
  - user is project admin for target project
  - project delete token (mapped by project admin template)
- Failure:
  - delete action not rendered

## 3) Project Members

Action: Grant project admin
- Preconditions:
  - current user is project admin of this project
  - token `project:admin:grant`
- Failure:
  - action disabled

Action: Revoke project admin
- Preconditions:
  - current user is project admin of this project
  - token `project:admin:revoke`
- Failure:
  - action disabled

## 4) Project Policy

Action: View policy (runtime/general)
- Preconditions:
  - token `project:policy:read`

Action: Update policy
- Preconditions:
  - token `project:policy:update`
- Failure:
  - readonly mode

## 5) Shared Libraries

Action: View libraries
- Preconditions:
  - token `project:resource:read`
  - resource visible by policy

Action: Create/edit/delete library
- Preconditions:
  - token `project:resource:create/update/delete`

Action: Upload file to visible library
- Preconditions:
  - library visible by policy
- Notes:
  - record `uploaded_by`, `uploaded_at`

## 6) Shared Endpoints

Action: View endpoints
- Preconditions:
  - token `project:resource:read`
  - resource visible by policy

Action: Create/edit/delete endpoint
- Preconditions:
  - token `project:resource:create/update/delete`

## 7) Credentials

Action: View credentials module
- Preconditions:
  - `wheel == true`
  - token `project:resource:read` (or stronger resource token)

Action: Create/rotate/delete credential
- Preconditions:
  - `wheel == true`
  - token `project:resource:create/update/delete`

Security constraints:
- never show secret value after creation
- list fields: `name`, `fingerprint`, timestamps only

## 8) Resource Policy (Draft Alignment)

Action: View/Update resource policy
- Preconditions:
  - project admin capability (`project:resource:update` or stronger)
- Draft FE/BE direction:
  - endpoint/library/agent use unified `resource policy`
  - policy includes access subjects + per-user/per-group rate/quota limits
  - `agent` rate key: `agent.max_concurrency`
  - `endpoint` quota key: `endpoint.daily_token_limit`
  - `source_library` quota keys: `source_library.max_total_files`, `source_library.max_file_size_bytes`
  - resolution order: subject override > resource override > project default

## 9) Project Groups (Template-Oriented)

Action: View group list
- Preconditions:
  - `project:member:read`

Action: Create/edit/delete group
- Preconditions:
  - `project:admin:grant` or `project:admin:revoke`

Action: Bind permission template to group
- Preconditions:
  - `project:admin:grant` or `project:admin:revoke`
- Notes:
  - one active permission template per group

Action: Apply group template to group members
- Preconditions:
  - `project:admin:grant` or `project:admin:revoke`
- Notes:
  - frontend applies the bound template to all members currently in that group
  - backend response should include member-level `results[]` for failed-member retry UX

## Failure and UX Feedback Contract

1. Page-level hard denial:
- render standard `permission_denied` page state

2. Action-level denial:
- keep page visible
- disable action and show `insufficient_permissions` tooltip/toast

3. Data-level denial (policy-hidden resource):
- do not render resource in list
- optionally show filtered count in diagnostics view only

4. Validation/security errors:
- use standard `validation_error` state/message

## Backend Contract Expectations (for handoff)

1. Every protected endpoint must declare required token set.
2. Credentials endpoints must enforce wheel gate + token gate.
3. Resource policy payload format must support:
- resource id/type
- policy mode (`allow_all_members` / `allow_list`)
- allow subjects (group/member ids)
- rule lists (`rules[]`) with resource-type key validation
4. Membership removal should not break policy reads:
- stale subjects ignored
- cleanup API available

## Open Items Before Freeze

1. Confirm exact backend endpoint names for project defaults + resource policy updates.
2. Confirm delete-project token naming if backend does not reuse `project:resource:delete`.
3. Confirm whether workspace admin has emergency override over project policy/admin assignment.
