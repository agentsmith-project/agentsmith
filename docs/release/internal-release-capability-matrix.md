# Internal Release Capability Matrix (Notebook-Focused)

This matrix is for internal/controlled releases where the primary supported flow is `Files -> Notebook -> External Agent -> Trace -> Artifacts`.

## Supported (real backend)

- Files / source libraries (core flows)
- Notebook tasks / messages / traces / artifacts
- External agent runtime (Codex runner)
- Notebook attached inputs (task-scoped source details)
- Sources quota (`/sources/quota`)

## Available in local `api-entry-node` (real backend)

- Audit page (`/audit`)
  - Real backend route with persisted audit events, paging, filtering, sorting
  - Currently covers core Notebook / Chat governance-relevant actions and runtime outcomes
- Usage page (`/usage`, `/usage/kpi`)
  - Real backend routes with persisted usage facts and KPI aggregation
  - Currently covers Notebook / Chat / Endpoint usage facts (first-stage coverage)

## Partially available in local `api-entry-node` (real backend)

- Members governance
  - baseline read APIs
  - join request approve/reject actions
  - groups CRUD + apply-template (minimal)
  - permission/quota template CRUD (minimal)
  - member permissions / quota overrides / history (minimal)
- Resource Policy governance
  - read/write configuration API baseline
  - minimal runtime enforcement for `endpoint` and notebook/chat `agent` paths via allow-all / allow-list rules
  - user-subject and group-subject allow-list matching are supported (baseline)
  - advanced limits/enforcement (`rate_limits`, `quota_limits`) still not applied

## Permission model note (important)

Current local backend route authorization is enforced with a simplified owner/operator permission resolver.
It does **not** yet apply member templates/custom permissions/resource policy configuration to backend authorization decisions.

## Release guidance

- Use these governance pages in **MSW/demo mode** for UI walkthroughs.
- In real backend mode:
  - Audit/Usage are available for internal governance workflows (first-stage coverage)
- Members is now partial in real backend mode (read baseline + join request actions + groups CRUD + permission/quota templates CRUD + member permissions/quota overrides/history).
- Resource Policy is partial in real backend mode (read/write configuration API baseline + minimal runtime enforcement for endpoint/agent allow-list rules, including group subjects, plus endpoint `requests_per_minute` rate limiting).
