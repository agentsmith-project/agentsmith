# Workspace / Project Default Engineering Gate Checklist

Last updated: 2026-03-14  
Owner: Frontend

## 1. Default Scope

This checklist documents the default engineering gate for the current workspace/project path:

1. `system 管理侧` can create and publish a workspace.
2. Published workspace exposes a valid `用户访问入口`.
3. Workspace users can reach workspace home and project list.
4. `workspace admin` can manage `project creators`.
5. `project creator` can create a project without gaining workspace administration.
6. Newly created project lands in project overview and remains governed by permission checks.

This checklist does not validate every product page.  
It validates the default business chain that everything else depends on.

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

## 3. Default Engineering Gate

Run the clean PR verification entry:

```bash
npm run verify -- --goal=pr --run
```

Use `npm run verify` when you only need the dry-run plan.

Expected:

1. Default-route lint and typecheck pass.
2. Default-route component and route tests pass.
3. Backend permission and workspace governance tests pass.
4. Mock lane E2E and targeted visual both pass.
5. Full visual verification runs through `npm run verify -- --goal=visual --run`, not through this default gate; internal evidence ownership remains `lane:visual`.

Owner diagnostics:

```bash
npm run test:default-e2e
```

`npm run test:default-e2e` is a focused diagnostics / evidence-owner producer rerun. Do not treat it as completion of the default PR gate.

## 4. Default E2E Coverage

The PR verification default gate includes these E2E specs through its internal evidence producers:

1. `e2e/system-workspace-default.spec.ts`
2. `e2e/workspace-settings.spec.ts`

Expected:

1. `system 管理侧 -> workspace 发布 -> 用户访问入口 -> 项目创建` is green.
2. `workspace admin` and `project creator` differences are enforced.
3. Project creation lands in project overview.

## 5. Visual Coverage

This gate owns targeted visual coverage only. Run full visual verification with `npm run verify -- --goal=visual --run`; internal evidence ownership remains `lane:visual`.

The default gate also runs targeted visual coverage for the default entry pages:

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
NEXT_PUBLIC_USE_MSW=true BASE_URL=http://localhost:3001 \
npx playwright test e2e/visual.spec.ts --project=visual \
  --grep 'workspace selection|workspace login|workspace home|workspace home - project creator|projects list|projects empty state|workspace settings|workspace settings create project dialog|overview' \
  --update-snapshots
```

Then rerun the same command without `--update-snapshots`.

## 6. Optional Real Backend Verification

When day-to-day verification needs the real backend lane, run:

```bash
npm run verify -- --goal=real --run
```

When you need focused owner diagnostics or prerequisite evidence before the release gate, rerun the owner producer:

```bash
npm run test:backend-real:core
```

`npm run test:backend-real:core` is a focused diagnostics / evidence-owner producer rerun, not the daily real-backend gate entry and not product-side readiness / handoff sign-off. Product-side readiness / handoff sign-off remains `npm run release:ready`.

This adds:

1. `e2e/integration-minimal.spec.ts` against the real backend lane
2. required `ux_trace_bundle` evidence for the default-tier backend-real daily/self-service stories

Notes:

1. The real-core script will auto start integration dependencies, API, and frontend on dedicated ports.
2. You can still override ports with `INTEGRATION_API_PORT` and `INTEGRATION_WEB_PORT` if needed.
3. The canonical default-tier trace bundle root is `artifacts/backend-real/runs/<run-id>/ux-traces`.
4. Missing `ux_trace_bundle` evidence means the `test:backend-real:core` run itself is incomplete, even though this backend-real verification remains optional for the default checklist.

## 7. Engineering Notes Required In PR

Include:

1. Whether the default workspace/project flow changed at all.
2. Whether `workspace admin / project creator / member` behavior changed.
3. Whether any visual baselines were updated.
4. Whether backend-real was run, and if not, why not.
