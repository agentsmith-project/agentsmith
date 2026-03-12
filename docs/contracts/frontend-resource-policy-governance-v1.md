# Frontend MVP Resource Policy & Governance (v1)

Last updated: 2026-03-03  
Status: active working contract  
Owner: Frontend

## Purpose

Define the MVP model for resource access and consumption governance across managed resource types.

## Scope

1. Resource policy management scope includes:
- `endpoint` (LLM endpoint only, MVP scope)
2. Only users with `project:manage` can create/update/delete resource policy.
3. Runtime use-path checks remain resource-driven and policy-driven.

## Core Principles

1. Keep permission tokens for operation authorization.
2. Use resource policy for request usage control:
- who can access a resource
- how much each user can consume on that resource
3. Default posture:
- all project members can access resources unless overridden
- resources inherit project defaults and can be overridden
4. `allow_list` mode requires at least one valid subject (`user` or `group`).

## Terminology

1. `permission token`: can/cannot perform management operations.
2. `resource policy`: access + rate/spending constraints on usage path.
3. `project defaults`: baseline governance rules.
4. `resource override`: per-resource exception to defaults.
5. `subject override`: per-user/per-group exception to resource/default policy.

## Policy Resolution Order

From highest priority to lowest:

1. `subject override` (user/group on resource)
2. `resource override` (resource instance)
3. `project defaults`

Conflict rule:
- priority: `subject override` > `resource override` > `project defaults`
- same-level conflicts: `most restrictive wins`

## Resource Type Rule Matrix (MVP)

1. `endpoint`
- rate: `endpoint.requests_per_minute`, `endpoint.requests_per_5_hours`, `endpoint.requests_per_day`
- spending: `endpoint.spending_usd_per_minute`, `endpoint.spending_usd_per_5_hours`, `endpoint.spending_usd_per_day`

2. `agent`
- out of scope in MVP (no policy management and no runtime enforcement)

## Runtime Enforcement Flow

1. Check operation permission token.
2. Resolve policy (subject > resource > default).
3. Check access allow.
4. Check rate limits.
5. Check spending limits.
6. Return deterministic deny/limit errors when blocked (`deny`, `rate_limited`, `spending_limit_exceeded`).

MVP execution guard:
- resource policy execution must deny non-`endpoint` resource types to prevent scope drift.

## API Contract Direction

1. Read/update resource policy:
- `GET /workspaces/{ws}/projects/{project}/resources/{resourceType}/{id}/policy`
- `PATCH /workspaces/{ws}/projects/{project}/resources/{resourceType}/{id}/policy`

2. `resourceType` in MVP:
- `endpoint`

3. Route semantics:
- `POST /workspaces/{ws}/projects/{project}/spending-limits/check` is the canonical limit check route in MVP.
- Response naming follows unified limit semantics (`used` / `remaining` / `max` / `reset_at`).
4. Usage projection contract:
- `GET /workspaces/{ws}/projects/{project}/limits/summary` projection and FE rendering rules are defined in `usage-limits-summary-contract.md`.

## Audit Requirements

Every policy mutation should record:

1. actor (`changed_by`)
2. timestamp (`changed_at`)
3. target (`resource_type`, `resource_id`, optional `subject`)
4. before/after diff
5. action type (`resource_policy_update`)

## Out of Scope (MVP)

1. Cross-project governance templates.
2. Advanced override conflict explainers beyond current preview UX.
3. Chat/Notebook-specific independent spending dimensions.
