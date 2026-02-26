# Internal Release Note (Governance UX + Smoke Stabilization RC)

Date: 2026-02-24

## Release Summary

This RC closes the real-backend governance page UX gap for `Audit` / `Usage` and improves release smoke resilience for token-expiry scenarios.

Outcome:
- Governance pages (`Audit` / `Usage`) have product-grade error states in real backend mode (unified `ErrorState` + i18n + retry).
- `governance-release-smoke` can auto-refresh token and retry policy effect smoke once when token expiry causes failure.
- Real-environment validation for the governance smoke bundle passed end-to-end.

## Version / Baseline

- App version baseline: `0.1.0` (`package.json`)
- Branch: `main`
- RC record date: `2026-02-24`
- RC commit (HEAD at validation record time): `21bd82c`

## Commit Range (This RC Increment)

Governance release hardening sequence captured in this RC:

- `fbef5f2` `test(governance): add real-backend page smoke command`
- `5cf266d` `test(governance): add real-backend interaction smoke for governance pages`
- `a4d84f1` `chore(release): bundle governance smoke into release checklist`
- `d43c94a` `test(governance): add policy effect smoke to release bundle`
- `d121975` `refactor(governance): dedupe endpoint preflight failure handling`
- `a5bd051` `refactor(governance): normalize endpoint preflight failure specs`
- `daeffaa` `fix(governance): use product error states for audit and usage pages`
- `21bd82c` `fix(release): retry governance smoke after token refresh`

Suggested range notation for release notes / changelog references:
- `fbef5f2..21bd82c`

## What Changed

### 1. Audit / Usage real-backend UX closure

- Replaced hardcoded English error panels with product `ErrorState`
- Switched to i18n-based user-facing copy
- Added retry action wired to existing page refresh logic

Impact:
- Real backend failures now match product UX patterns
- Better consistency with the rest of the app shell and error handling experience

### 2. Governance release smoke token-expiry resilience

- `governance-release-smoke` now retries `governance-policy-effect-smoke` once after running `notebook-agent-refresh-token` when failure is caused by expired token

Impact:
- Improves release smoke reliability in long-running local/demo sessions
- Reduces false negatives during RC verification and internal release checks

## Validation Record (Real Environment)

Executed command:

```bash
make governance-release-smoke
```

Result:
- `governance-pages-real-backend-smoke` ✅
- `governance-pages-real-backend-interaction-smoke` ✅
- `governance-policy-effect-smoke` ✅
  - Includes verified expired-token scenario: auto refresh + one retry succeeds
  - Includes policy rate-limit effect / audit evidence / usage evidence checks
  - Includes policy restore path

## Current Release Readiness (Internal)

### Mainline (Notebook / Agent / Files / InputRefs)

- Stable / demoable / regression-ready ✅

### Governance (real backend)

- `Audit` / `Usage`: product-usable v1 ✅
- `Members` / `Resource Policy`: partial, but real backend routes + real effect path + page-level real-backend smoke available ✅

### Release toolchain

- Mainline smoke / governance smoke / demo ops commands available ✅
- Token-expiry tolerance improved ✅

## Known Scope Boundaries

- This RC does not make `Members` / `Resource Policy` fully product-complete in real backend mode.
- Governance backend authorization/enforcement depth remains partial (see `docs/release/internal-release-capability-matrix.md`).

## Recommended Next Step (Post-RC)

1. Publish internal release note with exact release identifier/tag (fill in if assigned)
2. Start Governance Phase 2 planning:
   - richer `Resource Policy` enforcement coverage
   - fuller `Members` permissions and lifecycle closure

## Fill-in Template (If You Need a Distribution Header)

- Internal release ID/tag: `TODO`
- Release owner: `TODO`
- Validation operator: `TODO`
- Validation environment: `TODO` (host / API base / web base)
- Commit range finalized: `fbef5f2..21bd82c` (or replace with tagged range)
