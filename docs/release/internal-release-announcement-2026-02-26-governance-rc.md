# Internal Release Announcement (Governance RC Update)

Date: 2026-02-26

## Summary

Governance real-backend RC has been extended from page-level availability to runtime-effect verification.

Current status:
- `Audit` / `Usage` real-backend UX is productized (unified error state + i18n + retry)
- Governance release smoke is token-expiry tolerant
- Governance release smoke now covers real effect paths for:
  - `Resource Policy` rate limit
  - `Members` endpoint quota
  - `Members` route authorization (deny -> grant -> allow)

## Validation (Real Environment)

Executed:

```bash
make governance-release-smoke
```

Result: ✅ Passed

Included checks:
- `governance-pages-real-backend-smoke`
- `governance-pages-real-backend-interaction-smoke`
- `governance-policy-effect-smoke`
- `governance-member-quota-effect-smoke`
- `governance-member-permission-effect-smoke`

## Important Fix Included

- Fixed endpoint success usage recording to persist `tokens_total`
  - This enables real runtime enforcement for member endpoint `daily_token_limit`

## Commit Range (RC governance extension)

- Base (previous governance smoke/token refresh RC): `21bd82c`
- Current head: `87c3bdd`
- Incremental range: `21bd82c..87c3bdd`

Key commits in this increment:
- `9e155d3` `test(governance): add member quota effect smoke`
- `cf5dcc1` `fix(governance): fail fast on member quota smoke endpoint timeout`
- `53aa0ae` `test(governance): auto-detect member quota smoke user`
- `da59eec` `fix(governance): record endpoint tokens for member quota enforcement`
- `1f96992` `test(governance): add member permission effect smoke`
- `87c3bdd` `docs(release): update governance RC note with member effect coverage`

## References

- Engineering record: `docs/release/internal-release-note-2026-02-24-governance-rc.md`
- Release checklist: `docs/release/internal-release-checklist.md`
- Capability matrix: `docs/release/internal-release-capability-matrix.md`

## Next Recommended Focus

1. Governance Phase 2: broader `Resource Policy` enforcement coverage
2. Governance Phase 2: deeper `Members` lifecycle/permission closure
