# Diagnostic Catalog v1

Last updated: 2026-04-14
Status: `current reference`

This guide is for developers who need to choose the smallest useful command before they run an expensive verification or release campaign.

Diagnostic commands are not final verdicts. They help you find the failing layer, prove a focused fix, and decide which clean verification entrypoint must be rerun next.

## 1. Start With The Entry Path

Use the entry path selector before choosing a command:

| Entry path | Use it when | First useful commands |
| --- | --- | --- |
| `ui_only` | You changed UI copy, layout, client state, or a mock-only interaction. | `npm run dev`, then `npm run verify` for the dry-run plan |
| `local_manual` | You need the real local API, Notebook, Terminal, runner, files, or backend behavior. | `make local-real-up`, `make local-real-status` |
| `release_grade` | You are preparing a release, closing a cross-domain refactor, or verifying an incident fix. | `npm run release:ready`, then `npm run release:status`; failed campaigns name internal owner adapters such as `gate:release`, `lane:demo-rehearsal`, or `lane:cluster-rehearsal` |

If you are unsure, start with `ui_only` for frontend-only work, `local_manual` for real runtime behavior, and `release_grade` only when you need a release-level answer.

## 2. Plain-Language Rule

- A diagnostic command answers: "Where is the problem?"
- A gate answers: "Is this layer acceptable?"
- A lane answers: "Did this verification channel produce the required evidence?"
- A campaign answers: "Did all required steps for this goal finish?"
- A verdict answers: "Can we accept this change at this level?"

Do not use a diagnostic success as a release sign-off. If `npm run test:integration` passes after a fix, that only proves the integration slice. You still need to return to `npm run verify -- --goal=... --run`, or to `npm run release:ready` when the change is release-grade.

## 3. Diagnostic Commands

| Command or owner | Use when | Next step |
| --- | --- | --- |
| `npm run test:e2e` | The default mock UI path may be broken. | Fix the smallest UI slice, then rerun `npm run verify -- --goal=pr --run`. |
| `npm run test:e2e:all` | You need the broader mock range, including visual-adjacent coverage. | If it fails visually, inspect screenshots before updating baselines. |
| `npm run test:integration` | The issue crosses API/client/store/component boundaries. | Rerun the affected integration slice, then the current `npm run verify -- --goal=... --run` entrypoint. |
| `npm run test:run` | You want the cheapest unit and small-suite signal first. | Do not continue to expensive verification while this is red. |
| `npm run contracts:check-openapi` | OpenAPI contract or route behavior changed. | Fix contract drift before typecheck or e2e. |
| `npm run openapi:check-generated` | Generated API types may be stale. | Regenerate or fix generated artifacts, then rerun typecheck. |
| `npm run ws:typecheck` | Workspace shell, store, or shared library types changed. | Follow with the related integration or e2e slice. |
| `npm run ws:test` | Workspace logic needs fast Vitest coverage. | Follow with the matching `npm run verify -- --goal=... --run` entrypoint. |
| `npm run test:release:precheck` | You are about to enter release-grade verification and want local readiness first. | Treat success as readiness only, not a release verdict. |
| Internal adapter `lane:mock` | You need a governed mock verification channel but not full visual or backend-real. Stable gate id: `lane-mock`. | Treat it as an owner diagnostic surface, then return to the current human entrypoint or owner runbook. |
| Internal adapter `gate:release` | A release campaign failed in the backend-real release evidence owner. | Preserve `ux_trace_bundle`, use the owner runbook if rerun is needed, then return to `npm run release:ready`. |
| Internal adapter `lane:demo-rehearsal` | A release campaign failed in the demo deployment rehearsal evidence owner. | Prefer `npm run rehearse:demo` for the clean human path; owner reruns still follow the owner runbook reset. |
| Internal adapter `lane:cluster-rehearsal` | A release campaign failed in the cluster deployment rehearsal evidence owner. | Prefer `npm run rehearse:cluster` for the clean human path; owner reruns still follow the owner runbook reset. |
| Internal verifier `gate:release:full` | You already have explicit campaign context and only need to understand the terminal aggregate verifier. | This verifier is aggregate-only and does not execute suites; without explicit context, run `npm run release:ready` instead. |

## 4. Do / Don't

Do:
- Start with the cheapest command that can reproduce the failure.
- Keep the failing command and the final clean entrypoint separate in your notes.
- Preserve evidence when an evidence owner fails.
- Rerun `npm run verify -- --goal=... --run` after a diagnostic command turns green; use `npm run release:ready` for release-grade scope.

Don't:
- Do not update visual baselines without reading the screenshots.
- Do not treat `lane:mock` as release evidence.
- Do not skip full visual proof: use `npm run verify -- --goal=visual --run` outside release, or `npm run release:ready` for release-grade scope.
- Do not call `gate:release:full` a release execution path. It is aggregate-only and needs explicit campaign context.

## 5. When To Stop And Escalate

Stop the current wave and investigate root cause when:
- a command fails because of environment conflict, leftover process, or stale generated state
- required evidence is missing even though the command exited successfully
- a visual diff is not clearly expected
- a gate result reports a `failure_class` other than `none`

After the root cause is fixed, rerun in this order:
1. smallest reproducible diagnostic command
2. owning subsystem suite
3. `npm run verify -- --goal=... --run` for the affected scope
4. `npm run release:ready` only if the change is release-grade
5. internal adapter only when the owner runbook explicitly requires it
