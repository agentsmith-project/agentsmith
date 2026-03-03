# Frontend MVP Resource Policy & Governance (v1)

Last updated: 2026-03-03
Status: active working contract
Owner: Frontend

## Purpose

Define the MVP model for endpoint resource access and consumption governance.
This contract supersedes older multi-resource policy wording.

## Scope

1. Resource policy management scope is endpoint-only.
2. Managed resource type in scope:
- `endpoint`
3. Only `project admin` can create/update/delete resource policy.
4. Chat / Notebook do not define independent rate/quota rules in MVP.
   - Usage feedback comes from resolved endpoint policy results.

## Core Principles

1. Keep permission tokens for operation authorization (manage actions).
2. Use endpoint resource policy for runtime usage control:
- who can access an endpoint
- how much each user can consume on that endpoint
3. Default posture:
- all project members can access all endpoints
- all endpoints inherit project default governance rules
4. New endpoints inherit project defaults immediately at creation time.
5. `allow_list` mode requires at least one valid subject (`user` or `group`).
6. Subject selection in frontend should come from project members and project groups selectors (no free-text by default).

## Terminology

1. `permission token`: can/cannot perform management operations.
2. `resource policy`: access + rate/quota constraints on usage path.
3. `project defaults`: baseline governance for endpoints.
4. `resource override`: per-endpoint exception to defaults.
5. `subject override`: per-user/per-group exception to endpoint/default policy.

## Policy Resolution Order

From highest priority to lowest:

1. `subject override` (user/group on an endpoint)
2. `resource override` (endpoint instance)
3. `project defaults` (endpoint defaults)

Conflict rule:
- priority: `subject override` > `resource override` > `project defaults`
- same-level conflicts: `most restrictive wins`

## Policy Schema

```yaml
project_policy:
  defaults:
    endpoint:
      access: allow_all_members
      rate_limits:
        rules:
          - key: endpoint.requests_per_minute
            value: number | null
      quota_limits:
        rules:
          - key: endpoint.daily_token_limit
            value: number | null
            window: day
          - key: endpoint.requests_per_day
            value: number | null
            window: day

resource_overrides:
  - resource_type: endpoint
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
  - resource_type: endpoint
    resource_id: string
    subject_type: user | group
    subject_id: string
    rate_limits:
      rules: []
    quota_limits:
      rules: []
```

## Resource Type Rule Matrix (MVP)

1. `endpoint`
- allowed rate keys: `endpoint.requests_per_minute`
- allowed quota keys: `endpoint.daily_token_limit`, `endpoint.requests_per_day`

## Extensibility Constraints (Freeze)

1. Limit payloads use rule-list format (`rules[]`) instead of fixed fields.
2. Frontend validates rule keys by endpoint matrix before request.
3. New limits are introduced by adding rule keys + form renderer registration, not changing core schema.
4. Policy resolution is centralized, not duplicated in page components.
5. Backend should expose supported rule keys/version for forward compatibility.

## Runtime Enforcement Flow

1. Check operation permission token.
2. Resolve endpoint policy (subject > resource > default).
3. Check access allow.
   - if `access_mode=allow_list`, at least one subject must be present
4. Check rate limits.
5. Check quota limits.
6. Return standard deny/limit errors when blocked.

## API Contract Direction

1. Read/update project defaults:
- `GET /workspaces/{ws}/projects/{project}/governance/defaults`
- `PATCH /workspaces/{ws}/projects/{project}/governance/defaults`
2. Read/update endpoint policy:
- `GET /workspaces/{ws}/projects/{project}/resources/endpoint/{id}/policy`
- `PATCH /workspaces/{ws}/projects/{project}/resources/endpoint/{id}/policy`
3. Read/update subject override:
- `PUT /workspaces/{ws}/projects/{project}/resources/endpoint/{id}/subjects/{subjectType}/{subjectId}/policy`
- `DELETE /workspaces/{ws}/projects/{project}/resources/endpoint/{id}/subjects/{subjectType}/{subjectId}/policy`

## Audit Requirements

Every policy mutation should record:

1. actor (`changed_by`)
2. timestamp (`changed_at`)
3. target (`resource_type`, `resource_id`, optional `subject`)
4. before/after diff
5. action type (`defaults_update`, `resource_policy_update`, `subject_policy_update`)

## Out of Scope (MVP)

1. File-library policy management in resource policy page.
2. Agent policy management in resource policy page.
3. Advanced override conflict UI explainers beyond basic preview.
4. Cross-project governance templates.
5. Chat/Notebook-specific quota or rate-limit dimensions.

## Contract Notes

1. Subject selectors in MVP use project members and project groups.
2. Backend error code naming must stay stable across policy save and runtime limit enforcement paths.
