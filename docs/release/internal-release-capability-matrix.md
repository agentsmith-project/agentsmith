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

## UI available, mock-backed / not implemented in local `api-entry-node`

- Members governance (advanced quota/member history and enforcement-related parts still partial)
- Resource Policy governance (read/write may be available in local backend; runtime enforcement remains pending)

## Permission model note (important)

Current local backend route authorization is enforced with a simplified owner/operator permission resolver.
It does **not** yet apply member templates/custom permissions/resource policy configuration to backend authorization decisions.

## Release guidance

- Use these governance pages in **MSW/demo mode** for UI walkthroughs.
- In real backend mode:
  - Audit/Usage are available for internal governance workflows (first-stage coverage)
- Members is now partial in real backend mode (read baseline + join request actions + groups CRUD + permission/quota templates CRUD + member permissions/quota overrides/history).
- Resource Policy is partial in real backend mode (read/write configuration API baseline available; runtime enforcement still pending).
