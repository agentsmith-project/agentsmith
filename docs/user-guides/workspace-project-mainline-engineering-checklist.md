# Workspace / Project Mainline Engineering Checklist

Last updated: 2026-03-14  
Owner: Frontend

## 1. Mainline Scope

This checklist is the strict gate for the current mainline:

1. `system 管理侧` can create and publish a workspace.
2. Published workspace exposes a valid `用户访问入口`.
3. Workspace users can reach workspace home and project list.
4. `workspace admin` can manage `project creators`.
5. `project creator` can create a project without gaining workspace administration.
6. Newly created project lands in project overview and remains governed by permission checks.

This checklist does not validate every product page.  
It validates the mainline business chain that everything else depends on.

## 2. Contract Gate

Run:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

Expected:

1. Route permission gates remain valid.
2. OpenAPI coverage and breaking checks stay green.
3. Generated API types are in sync.

## 3. Quality Gate

Run:

```bash
npx tsc --noEmit
npm run test:mainline:strict
```

Expected:

1. Mainline-targeted lint and typecheck pass.
2. Mainline route/component tests pass.
3. Backend permission and workspace governance tests pass.
4. Mock lane E2E and targeted visual both pass.

## 4. Mock Lane Functional Gate

The strict script already runs these:

1. `e2e/system-workspace-mainline.spec.ts`
2. `e2e/workspace-settings.spec.ts`

Expected:

1. `system 管理侧 -> workspace 发布 -> 用户访问入口 -> 项目创建` is green.
2. `workspace admin` and `project creator` differences are enforced.
3. Project creation lands in project overview.

## 5. Visual Gate

The strict script also runs targeted visual coverage for the mainline entry pages:

1. workspace selection
2. workspace login
3. workspace home
4. workspace home - project creator
5. projects list
6. projects empty state
7. workspace settings
8. workspace settings create project dialog
9. overview

If the UI intentionally changes:

```bash
NEXT_PUBLIC_USE_MSW=true BASE_URL=http://localhost:3000 \
npx playwright test e2e/visual.spec.ts --project=visual \
  --grep 'workspace selection|workspace login|workspace home|workspace home - project creator|projects list|projects empty state|workspace settings|workspace settings create project dialog|overview' \
  --update-snapshots
```

Then rerun the same command without `--update-snapshots`.

## 6. Optional Real Lane Gate

Before release-oriented verification, also run:

```bash
npm run test:mainline:strict:real
```

This adds:

1. `e2e/integration-minimal.spec.ts` against the real backend lane

Notes:

1. The strict script will auto start integration dependencies, API, and frontend on dedicated ports.
2. You can still override ports with `INTEGRATION_API_PORT` and `INTEGRATION_WEB_PORT` if needed.

## 7. Engineering Notes Required In PR

Include:

1. Whether the mainline flow changed at all.
2. Whether `workspace admin / project creator / member` behavior changed.
3. Whether any visual baselines were updated.
4. Whether real lane was run, and if not, why not.
