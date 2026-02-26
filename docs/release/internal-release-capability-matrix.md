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
  - Currently covers Notebook / Chat / Endpoint usage facts plus Agent request-level usage
  - Agent usage is requests-only; token totals are not part of agent governance semantics

## Partially available in local `api-entry-node` (real backend)

- Members governance
  - baseline read APIs
  - join request create / approve / reject actions (approve creates active membership baseline)
  - groups CRUD + apply-template (minimal)
  - permission/quota template CRUD (minimal)
  - member permissions / quota overrides / history (minimal)
  - backend route authz partially influenced by groups + permission templates (allow-only union)
  - member quota overrides/templates can enforce endpoint `daily_token_limit` (baseline)
- Resource Policy governance
  - read/write configuration API baseline
  - minimal runtime enforcement for `endpoint`, `source_library`, and notebook/chat `agent` paths via allow-all / allow-list rules
  - source AI-ready routes now follow source_library allow-list enforcement baseline
  - user-subject and group-subject allow-list matching are supported (baseline)
  - endpoint `requests_per_minute` rate limiting is enforced
  - endpoint policy quota enforcement baseline supports `endpoint.daily_token_limit` and `endpoint.requests_per_day`
  - broader `rate_limits` / `quota_limits` enforcement across all resource types is still pending

## Permission model note (important)

Current local backend route authorization is enforced with a simplified owner/operator permission resolver.
It does **not** yet apply member templates/custom permissions/resource policy configuration to backend authorization decisions.

## Release guidance

- Use these governance pages in **MSW/demo mode** for UI walkthroughs.
- In real backend mode:
  - Audit/Usage are available for internal governance workflows (first-stage coverage)
- Members is now partial in real backend mode (read baseline + join request create/approve/reject actions with minimal membership activation on approve + groups CRUD + permission/quota templates CRUD + member permissions/quota overrides/history), and backend route authorization is now partially influenced by both group permission templates and member custom/template permissions (allow-only union model). Member quota overrides/templates also have a first-stage endpoint `daily_token_limit` runtime effect.
- Resource Policy is partial in real backend mode (read/write configuration API baseline + minimal runtime enforcement for endpoint/source_library/agent allow-list rules, including group subjects, plus endpoint `requests_per_minute` rate limiting and endpoint (`daily_token_limit`, `requests_per_day`) quota enforcement baseline).
