# Frontend MVP Resource Policy & Governance (v1)

Last updated: 2026-02-08
Status: active working contract
Owner: Frontend

## Purpose

Define the MVP model for resource access and consumption governance.
This contract supersedes ACL-first wording in older contracts.

## Scope

1. MVP resources do not distinguish private/shared at data model level.
2. Resource types in scope:
- `endpoint`
- `source_library`
- `agent`
3. Only `project admin` can create/update/delete resources.

## Core Principles

1. Keep permission tokens for operation authorization (manage actions).
2. Use resource policy for runtime usage control:
- who can access a resource
- how much each user can consume on that resource
3. Default posture:
- all project members can access all resources
- all resources inherit project default governance rules
4. New resources inherit project defaults immediately at creation time.
5. `allow_list` mode requires at least one valid subject (`user` or `group`).
6. Subject selection in frontend should come from project members and project groups selectors (no free-text by default).

## Terminology

1. `permission token`: can/cannot perform management operations.
2. `resource policy`: access + rate/quota constraints on usage path.
3. `project defaults`: baseline governance per resource type.
4. `resource override`: per-resource exception to defaults.
5. `subject override`: per-user/per-group exception to resource/default policy.

## Policy Resolution Order

From highest priority to lowest:

1. `subject override` (user/group on a resource)
2. `resource override` (resource instance)
3. `project defaults` (resource type defaults)

Conflict rule:
- priority: `subject override` > `resource override` > `project defaults`
- same-level conflicts: `most restrictive wins`

## Policy Schema

```yaml
project_policy:
  defaults:
    endpoint:
      access: allow_all_members
      quota_limits:
        rules:
          - key: endpoint.daily_token_limit
            value: number | null
            window: day
    source_library:
      access: allow_all_members
      quota_limits:
        rules:
          - key: source_library.max_total_files
            value: number | null
          - key: source_library.max_file_size_bytes
            value: number | null
    agent:
      access: allow_all_members
      rate_limits:
        rules:
          - key: agent.max_concurrency
            value: number | null

resource_overrides:
  - resource_type: endpoint | source_library | agent
    resource_id: string
    access: allow_all_members | allow_list
    allowed_subjects:
      - subject_type: user | group
        subject_id: string
    rate_limits:
      rules: []
    quota_limits:
      rules: []

subject_overrides:
  - resource_type: endpoint | source_library | agent
    resource_id: string
    subject_type: user | group
    subject_id: string
    rate_limits:
      rules: []
    quota_limits:
      rules: []
```

## Resource Type Rule Matrix (MVP)

1. `agent`
- allowed rate keys: `agent.max_concurrency`
- allowed quota keys: none

2. `endpoint`
- allowed rate keys: none
- allowed quota keys: `endpoint.daily_token_limit`

3. `source_library`
- allowed rate keys: none
- allowed quota keys:
  - `source_library.max_total_files`
  - `source_library.max_file_size_bytes`

## Extensibility Constraints (Freeze)

1. Limit payloads use rule-list format (`rules[]`) instead of fixed fields.
2. Frontend validates rule keys by resource-type matrix before request.
3. New limits are introduced by adding rule keys + form renderer registration, not changing core schema.
4. Policy resolution is centralized, not duplicated in page components.
5. Backend should expose supported rule keys/version for forward compatibility.

## Runtime Enforcement Flow

1. Check operation permission token.
2. Resolve resource policy (subject > resource > default).
3. Check access allow.
   - if `access_mode=allow_list`, at least one subject must be present
4. Check rate limits.
5. Check quota limits.
6. Return standard deny/limit errors when blocked.

## Default Limits (To Be Decided)

Defaults should be configurable in project policy and not hardcoded in frontend.
Unset (`null`) means no limit for that field.

## API Contract Direction

1. Read/update project defaults:
- `GET /workspaces/{ws}/projects/{project}/governance/defaults`
- `PATCH /workspaces/{ws}/projects/{project}/governance/defaults`
2. Read/update resource policy:
- `GET /workspaces/{ws}/projects/{project}/resources/{type}/{id}/policy`
- `PATCH /workspaces/{ws}/projects/{project}/resources/{type}/{id}/policy`
3. Read/update subject override:
- `PUT /workspaces/{ws}/projects/{project}/resources/{type}/{id}/subjects/{subjectType}/{subjectId}/policy`
- `DELETE /workspaces/{ws}/projects/{project}/resources/{type}/{id}/subjects/{subjectType}/{subjectId}/policy`

## Audit Requirements

Every policy mutation should record:

1. actor (`changed_by`)
2. timestamp (`changed_at`)
3. target (`resource_type`, `resource_id`, optional `subject`)
4. before/after diff
5. action type (`defaults_update`, `resource_policy_update`, `subject_policy_update`)

## Out of Scope (MVP)

1. File-level policy inside source library.
2. Advanced override conflict UI explainers beyond basic preview.
3. Cross-project governance templates.

## Contract Notes

1. Subject selectors in MVP use project members and project groups.
2. Backend error code naming must stay stable across policy save and runtime limit enforcement paths.
