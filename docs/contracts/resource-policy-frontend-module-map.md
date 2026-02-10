# Resource Policy Frontend Module Map (2026-02-10)

Target route:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx`

## Boundaries

- `page.tsx`
- Owns route param validation, permission gating, query/mutation wiring, and top-level state orchestration.

- `src/components/resource-policy/ResourcePolicyTable.tsx`
- Owns left-side resource grouping/list rendering and selection UI only.
- Receives resolved row status from parent; does not fetch policy data directly.

- `src/lib/resource-policy/editor-utils.ts`
- Owns draft-to-rule transformation and effective-rule formatting helpers.
- Must remain pure and reusable (no React or hooks).

## Guardrails

- Keep API calls and mutation orchestration in `page.tsx` or dedicated hooks.
- Keep resource list rendering concerns in `ResourcePolicyTable.tsx`.
- Keep rule parsing/merging/formatting logic in pure utility modules.
- Add tests in:
1. Route-level behavior: `.../resource-policy/__tests__/page.test.tsx`
2. Pure rule helpers: `src/lib/resource-policy/__tests__/*` when helper logic expands.
