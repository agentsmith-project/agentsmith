# Route Gate and Test Contract (Shell Routes)

Applies to:
- `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/**/page.tsx`
- `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

## 1. Route Safety Contract

- Validate URL params with:
  - `validateWorkspaceParam()`
  - `validateProjectParam()` when `[project]` exists
- Permission hooks must be called unconditionally.
  - Do not short-circuit hooks (`useHasPermission('a') || useHasPermission('b')` is forbidden).
  - Combine boolean results after hook calls.

## 2. Permission Contract

- Use explicit route-level permission gates for protected modules.
  - Chat: `project:endpoint:use`
  - Notebook: `project:endpoint:use`
- Workspace project list route (`/workspaces/[workspace]/projects`) may bootstrap with authenticated workspace context before project context exists.
- Backend remains the final authorization authority (`401/403`).

## 3. Test Contract

Each route must include `__tests__/page.test.tsx` with:
- successful render case
- invalid-param case
- forbidden/denied case for permission-gated routes

Workspace project list route must include:
- denied bootstrap case (`no auth + no workspace context`)
- authenticated bootstrap pass-through case

## 4. Enforcement Contract

`npm run contracts:check` must fail when any of the following are missing:
- known permission name usage
- required param validation
- route test file
- invalid-param coverage
- forbidden coverage for permission-gated routes (including wrapper permission hooks)
