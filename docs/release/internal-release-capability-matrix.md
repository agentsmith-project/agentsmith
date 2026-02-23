# Internal Release Capability Matrix (Notebook-Focused)

This matrix is for internal/controlled releases where the primary supported flow is `Files -> Notebook -> External Agent -> Trace -> Artifacts`.

## Supported (real backend)

- Files / source libraries (core flows)
- Notebook tasks / messages / traces / artifacts
- External agent runtime (Codex runner)
- Notebook attached inputs (task-scoped source details)
- Sources quota (`/sources/quota`)

## UI available, mock-backed / not implemented in local `api-entry-node`

- Audit page (`/audit`)
- Usage page (`/usage`, `/usage/kpi`)
- Members governance (project members, join requests, templates, overrides)
- Resource Policy governance (resource policy read/write + runtime enforcement)

## Permission model note (important)

Current local backend route authorization is enforced with a simplified owner/operator permission resolver.
It does **not** yet apply member templates/custom permissions/resource policy configuration to backend authorization decisions.

## Release guidance

- Use these governance pages in **MSW/demo mode** for UI walkthroughs.
- In real backend mode, treat them as preview/mock-only unless explicitly implemented.
