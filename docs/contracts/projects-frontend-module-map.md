# Projects Frontend Module Map (2026-02-10)

Target route:
`src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

## Boundaries

- `page.tsx`
- Owns route-level validation, permission gating, data/query wiring, and navigation handlers.

- `src/components/projects/ProjectCard.tsx`
- Owns pinned-project card rendering and card-level interactions.

- `src/components/projects/ProjectsTable.tsx`
- Owns tabular rendering, per-row actions, and table column definition.

- `src/lib/projects/project-view.ts`
- Owns pure project-view helpers:
  - role alias formatting
  - permission checks
  - admin summary formatting

## Guardrails

- Keep route component focused on orchestration, not table/card markup internals.
- Keep reusable project rendering concerns under `src/components/projects`.
- Keep pure formatting and projection logic in `src/lib/projects`.
- Route tests remain at:
`src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`.
