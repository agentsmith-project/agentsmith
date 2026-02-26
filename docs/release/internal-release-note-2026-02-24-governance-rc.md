# Internal Release Note (Governance UX + Smoke Stabilization RC)

Date: 2026-02-24

## Release Summary

This RC closes the real-backend governance page UX gap for `Audit` / `Usage`, improves release smoke resilience for token-expiry scenarios, and expands governance real-backend effect coverage for `Members`.

Outcome:
- Governance pages (`Audit` / `Usage`) have product-grade error states in real backend mode (unified `ErrorState` + i18n + retry).
- `governance-release-smoke` can auto-refresh token and retry policy effect smoke once when token expiry causes failure.
- `governance-release-smoke` now validates `Members` real-backend effect paths:
  - member endpoint quota enforcement (`deny + audit/usage evidence`)
  - member route authorization enforcement (`deny -> grant -> allow`)
- `governance-release-smoke` now validates `Resource Policy` quota enforcement (`endpoint.daily_token_limit`) in addition to rate limiting.
- `governance-release-smoke` now validates `Resource Policy` allow-list access control (`deny -> allow`) with audit/usage evidence.
- `governance-release-smoke` now validates `Resource Policy` group-subject allow-list matching effect (`deny -> group-allow`).
- Endpoint success usage recording now persists `tokens_total`, enabling real member quota enforcement on endpoint traffic.
- Real-environment validation for the governance smoke bundle passed end-to-end.

## Version / Baseline

- App version baseline: `0.1.0` (`package.json`)
- Branch: `main`
- RC record date: `2026-02-24`
- RC commit (current HEAD at validation record time): `c7afb99`

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
- `9e155d3` `test(governance): add member quota effect smoke`
- `cf5dcc1` `fix(governance): fail fast on member quota smoke endpoint timeout`
- `53aa0ae` `test(governance): auto-detect member quota smoke user`
- `da59eec` `fix(governance): record endpoint tokens for member quota enforcement`
- `1f96992` `test(governance): add member permission effect smoke`
- `bc8ba8b` `docs(release): add governance RC internal announcement draft`
- `4499bcb` `test(governance): add policy quota effect smoke`
- `c7afb99` `test(governance): add policy access effect smoke`
  - includes `resource_policy.access_denied` usage evidence consistency fix (`end_user_id`)

Suggested range notation for release notes / changelog references:
- `fbef5f2..c7afb99`

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

### 3. Governance real-backend effect smoke coverage expansion

- Added `governance-policy-quota-effect-smoke`
  - verifies `RESOURCE_POLICY_QUOTA_EXCEEDED` on endpoint `daily_token_limit`
  - verifies `Audit` / `Usage` evidence and restores original endpoint policy
- Added `governance-policy-access-effect-smoke`
  - verifies `RESOURCE_POLICY_DENIED` on endpoint allow-list deny
  - verifies `Audit` / `Usage` evidence for denied preflight
  - verifies allow-list grant clears deny (allow path may time out under slow upstream and is tolerated after deny-path preflight evidence)
- Added `governance-policy-group-access-effect-smoke`
  - verifies group-subject allow-list matching can clear deny for current user via group membership
  - verifies deny-path `Audit` / `Usage` evidence and restores policy/group state

- Added `governance-member-quota-effect-smoke`
  - verifies member endpoint quota enforcement returns `MEMBER_QUOTA_EXCEEDED`
  - verifies `Audit` / `Usage` evidence and restores original member quota overrides
- Added `governance-member-permission-effect-smoke`
  - verifies member route authorization deny (`403`) before grant
  - grants `project:member:manage` and verifies allow (`200`)
  - restores original member permissions
- Bundled all governance effect smokes into `governance-release-smoke`

Impact:
- Governance release smoke now covers `Resource Policy` user-access + group-access + rate + quota and `Members` quota + permission runtime effects
- Real backend `Members` functionality has stronger regression protection
- `Resource Policy` quota path has real-environment regression protection

### 4. Endpoint token usage recording fix (enables member quota enforcement)

- Fixed endpoint success-path usage recording to persist `tokens_total` from upstream model responses
- Added unit coverage for token extraction in `proxyJsonRequest`

Impact:
- `endpoint.daily_token_limit` member quota enforcement now works in real backend runtime
- `Usage` data better reflects actual endpoint token consumption

### 5. Policy access-denied usage evidence consistency fix

- `resource_policy.access_denied` endpoint preflight failures now record `end_user_id` in usage facts

Impact:
- `Usage` evidence for policy access denies can be queried consistently by user
- Enables stable real-backend smoke assertions for policy allow-list deny paths

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
- `governance-policy-access-effect-smoke` ✅
  - Includes policy allow-list deny (`RESOURCE_POLICY_DENIED`) + `Audit/Usage` evidence + allow-path verification + restore
- `governance-policy-group-access-effect-smoke` ✅
  - Includes policy group-subject allow-list effect verification + deny-path `Audit/Usage` evidence + restore
- `governance-policy-quota-effect-smoke` ✅
  - Includes policy quota deny (`RESOURCE_POLICY_QUOTA_EXCEEDED`) + `Audit/Usage` evidence + restore
- `governance-member-quota-effect-smoke` ✅
  - Includes member quota deny (`MEMBER_QUOTA_EXCEEDED`) + `Audit/Usage` evidence + restore
- `governance-member-permission-effect-smoke` ✅
  - Includes member route authz deny (`403`) -> grant -> allow (`200`) + restore

## Current Release Readiness (Internal)

### Mainline (Notebook / Agent / Files / InputRefs)

- Stable / demoable / regression-ready ✅

### Governance (real backend)

- `Audit` / `Usage`: product-usable v1 ✅
- `Members` / `Resource Policy`: partial, but real backend routes + real effect paths + page-level real-backend smoke available ✅

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
- Commit range finalized: `fbef5f2..c7afb99` (or replace with tagged range)
