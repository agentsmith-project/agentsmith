# Route Gate Test Checklist (Shell Routes)

Use this checklist for every new route under:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/**/page.tsx`
and for:
`src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

## Required Implementation

1. Validate route params with:
- `validateWorkspaceParam()`
- `validateProjectParam()` for routes that include `[project]`

2. Add route-level permission gate when page has access control requirements.

3. Permission hook safety rule:
- Do not short-circuit hooks (for example `useHasPermission('a') || useHasPermission('b')`).
- Call each permission hook unconditionally, then combine booleans in plain expressions.

4. Workspace-scoped route note (`/workspaces/[workspace]/projects`):
- This route has no `[project]` param, so project-scoped permission context may be empty during bootstrap.
- FE may use authenticated/workspace-loaded fallback for initial route render.
- Backend remains authoritative for actual API authorization (`401/403`).

## Required Tests

Create `__tests__/page.test.tsx` beside the route.

Each route test file must include:

1. Happy path render test.
2. Invalid param test (unsafe workspace/project should produce validation error state).
3. Forbidden/permission denied test for permission-gated routes.
4. For workspace-scoped project list route, include both:
- permission-denied case (`no auth + no workspace context`)
- authenticated fallback case (`auth true` should not hard-fail gate before backend response)

## CI Enforcement

`npm run contracts:check` enforces:

1. Known permission names only.
2. Route param validation presence.
3. Route test file existence.
4. Invalid-param test coverage.
5. Forbidden coverage for routes that use `useHasPermission(...)`.

If any rule is missing, CI fails.
