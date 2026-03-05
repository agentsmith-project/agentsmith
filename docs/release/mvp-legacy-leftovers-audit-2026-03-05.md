# MVP Legacy Leftovers Audit (2026-03-05)

This file tracks legacy surfaces that still exist after scope contraction to MVP.

## A. Confirmed leftovers

1. `runtime-console` route/tests still exist in codebase/docs (already removed from default MVP mock lane).
2. `source_library` governance/resource types still appear in frontend/backend types and test fixtures.
3. Old `quota template` / `permission template` copy still exists in i18n/messages and some member/governance tests.
4. Release docs still include older governance-heavy narratives that exceed current MVP focus.

## B. Current impact

1. Not all leftovers block MVP release.
2. Some leftovers are only documentation/i18n noise.
3. Some leftovers increase test surface and cognitive load in release verification.

## C. Cleanup order (recommended)

1. Docs/gate text alignment first (done in this freeze cycle).
2. Remove or archive non-MVP e2e specs from default mock chromium lane (runtime-console, legacy governance extras) in a dedicated cleanup PR.
   - 2026-03-05 batch-1: `runtime-console.spec.ts` removed from default `chromium` mock lane whitelist.
   - 2026-03-05 batch-2: `governance-member-permission-effect-smoke` removed from default `governance-release-smoke` bundle (kept as optional legacy command).
   - 2026-03-05 batch-3: core baseline docs removed explicit `permission/quota template` wording from active MVP references.
   - 2026-03-05 batch-4: user guide navigation switched to MVP-first index to reduce accidental use of legacy-heavy runbooks.
3. Purge obsolete i18n keys and message blocks for quota-template/source-library governance once page contracts are finalized.
4. Narrow backend/frontend type unions from `endpoint|source_library|agent` to true MVP set where contracts already changed.

## D. Guardrail

Do not mix this cleanup with new features. Execute as dedicated refactor batches, each with:

1. contract check pass
2. lane-mock-chromium pass
3. release-core-smoke pass
