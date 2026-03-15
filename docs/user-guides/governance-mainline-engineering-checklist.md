# Governance Mainline Engineering Checklist

Last updated: 2026-03-14  
Owner: Frontend

## 1. Scope

This checklist is the strict gate for the current project governance judgment chain:

1. `Members` can show effective access for a selected member.
2. Admins can run an authorization check for an endpoint action.
3. `Resource Policy` can validate the same subject/resource/action combination.
4. `Audit` keeps governance drilldown links to the correct management page.
5. Alerts and notifications keep the same governance action wording and do not leak raw keys.

This gate does not add a new product surface.  
It validates the current governance workflow already present in `members / resource policy / audit / alerts`.

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

## 3. Quality Gate

Run:

```bash
npm run test:governance:strict
```

Expected:

1. Lint + typecheck pass for explainability surfaces.
2. Targeted unit tests pass for members, resource policy, audit, alerts, and explainability helpers.
3. Backend authorization explainability tests remain green.
4. Mock lane governance E2E passes.
5. Targeted visual baselines pass for governance pages and overlays.

## 4. Covered Mock Lane Workflow

The strict gate validates this business flow:

1. Open a member from `Members`.
2. Run an endpoint authorization check.
3. Move into `Resource Policy` with the same subject/resource context.
4. Validate the decision again after policy changes.
5. Return to `Members` with the same subject/resource context preserved.

## 5. Visual Gate

The strict script also runs targeted visual coverage for:

1. members
2. members - effective access drawer
3. resource policy
4. audit detail drawer
5. alerts - notifications tab

If the UI intentionally changes, update those baselines and rerun the same command without snapshot updates.
