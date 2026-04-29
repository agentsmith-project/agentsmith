# Governance Default Engineering Gate Checklist

Last updated: 2026-04-11  
Owner: Frontend

## 1. Scope

This checklist documents the default engineering gate for the current project governance chain:

1. `Members` can show effective access for a selected member.
2. Admins can run an authorization check for an endpoint action.
3. `Policy` can validate the same subject/resource/action combination.
4. `Audit` keeps governance drilldown links to the correct management page.
5. Alerts and notifications keep the same governance action wording and do not leak raw keys.

This gate does not add a new product surface.  
It validates the current governance workflow already present in `members / policy / audit / alerts`.

Persistence baseline:
- member governance, policy, join request, and notifications are backend-owned persisted truth
- this workflow must remain stable across API restart

## 2. Contract Gate

Run:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

Expected:
1. Permission gates remain aligned.
2. OpenAPI coverage stays green.
3. Generated frontend API types are in sync.

## 3. Default Engineering Gate

Run the clean PR verification entry:

```bash
npm run verify -- --goal=pr --run
```

Use `npm run verify` when you only need the dry-run plan.

Expected:
1. Targeted unit and integration tests pass for members, policy, audit, alerts, and explainability helpers.
2. Backend authorization explainability tests remain green.
3. Mock lane governance E2E passes.
4. Targeted visual baselines pass for governance pages and overlays.
5. Governance data does not silently disappear after API restart.
6. Full visual verification runs through `npm run verify -- --goal=visual --run`, not through this governance gate; internal evidence ownership remains `lane:visual`.

Owner diagnostics:

```bash
npm run test:governance
```

`npm run test:governance` is a focused diagnostics / evidence-owner producer rerun. Do not treat it as completion of the default PR gate.

## 4. Covered Workflow

The default governance gate validates this business flow:

1. Open a member from `Members`.
2. Run an endpoint authorization check.
3. Move into `Policy` with the same subject/resource context.
4. Validate the decision again after policy changes.
5. Return to `Members` with the same subject/resource context preserved.

## 5. Visual Coverage

This gate owns targeted visual coverage only. Run full visual verification with `npm run verify -- --goal=visual --run`; internal evidence ownership remains `lane:visual`.

The governance gate also runs targeted visual coverage for:
1. members
2. members effective-access drawer
3. policy
4. audit detail drawer
5. alerts notifications tab
