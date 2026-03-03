# Resource Policy Frontend Module Map (2026-02-10)

Target route:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx`

## Boundaries

- `page.tsx`
- Owns route param validation, permission gating, query/mutation wiring, and top-level state orchestration.

- `src/components/resource-policy/ResourcePolicyTable.tsx`
- Owns managed resource list rendering and selection UI.
- Receives resolved row status from parent; does not fetch policy data directly.

- `src/lib/resource-policy/editor-utils.ts`
- Owns draft-to-rule transformation and effective-rule formatting helpers.
- Must remain pure and reusable (no React or hooks).

## Governance audit timeline

- The page shows a "Policy change history" section using `AuditAPI.list` with `resource_type: 'resource_policy'`. Subject-level stale detection and the "Remove stale" action are implemented in the same page.
- Frontend already requests audit with `resource_type: 'resource_policy'` and displays the list. Backend must emit audit events for policy create/update/delete with `resource_type` set to `resource_policy` so the timeline is populated.

## Guardrails

- Keep API calls and mutation orchestration in `page.tsx` or dedicated hooks.
- Keep resource list rendering concerns in `ResourcePolicyTable.tsx`.
- Keep rule parsing/merging/formatting logic in pure utility modules.
- Resource policy management scope includes `endpoint` and `agent`.
- Add tests in:
1. Route-level behavior: `.../resource-policy/__tests__/page.test.tsx`
2. Pure rule helpers: `src/lib/resource-policy/__tests__/*` when helper logic expands.
