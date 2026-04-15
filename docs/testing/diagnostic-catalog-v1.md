# Diagnostic Catalog v1

Last updated: 2026-04-14
Status: `current reference`

This guide is for developers who need to choose the smallest useful command before they run an expensive gate or release campaign.

Diagnostic commands are not final verdicts. They help you find the failing layer, prove a focused fix, and decide which gate or lane must be rerun next.

## 1. Start With The Entry Path

Use the entry path selector before choosing a command:

| Entry path | Use it when | First useful commands |
| --- | --- | --- |
| `ui_only` | You changed UI copy, layout, client state, or a mock-only interaction. | `npm run dev`, `npm run gate:fast`, `npm run test:e2e` |
| `local_manual` | You need the real local API, Notebook, Terminal, runner, files, or backend behavior. | `make substrate-up`, `make local-manual-up`, `make local-manual-seed-notebook` |
| `release_grade` | You are preparing a release, closing a cross-domain refactor, or verifying an incident fix. | `npm run test:release:precheck`, `npm run release:campaign:full`, then owner reruns such as `npm run gate:release`, `npm run lane:demo-rehearsal`, `npm run lane:cluster-rehearsal` only when diagnosing a failed campaign |

If you are unsure, start with `ui_only` for frontend-only work, `local_manual` for real runtime behavior, and `release_grade` only when you need a release-level answer.

## 2. Plain-Language Rule

- A diagnostic command answers: "Where is the problem?"
- A gate answers: "Is this layer acceptable?"
- A lane answers: "Did this verification channel produce the required evidence?"
- A campaign answers: "Did all required steps for this goal finish?"
- A verdict answers: "Can we accept this change at this level?"

Do not use a diagnostic success as a release sign-off. If `npm run test:integration` passes after a fix, that only proves the integration slice. You still need to return to the owning gate or lane.

## 3. Diagnostic Commands

| Command | Use when | Next step |
| --- | --- | --- |
| `npm run test:e2e` | The default mock UI path may be broken. | Fix the smallest UI slice, then rerun the owning gate. |
| `npm run test:e2e:all` | You need the broader mock range, including visual-adjacent coverage. | If it fails visually, inspect screenshots before updating baselines. |
| `npm run test:integration` | The issue crosses API/client/store/component boundaries. | Rerun the affected integration slice, then the current gate wave. |
| `npm run test:run` | You want the cheapest unit and small-suite signal first. | Do not continue to expensive lanes while this is red. |
| `npm run contracts:check-openapi` | OpenAPI contract or route behavior changed. | Fix contract drift before typecheck or e2e. |
| `npm run openapi:check-generated` | Generated API types may be stale. | Regenerate or fix generated artifacts, then rerun typecheck. |
| `npm run ws:typecheck` | Workspace shell, store, or shared library types changed. | Follow with the related integration or e2e slice. |
| `npm run ws:test` | Workspace logic needs fast Vitest coverage. | Follow with the user-facing gate or lane. |
| `npm run test:release:precheck` | You are about to enter release-grade verification and want local readiness first. | Treat success as readiness only, not a release verdict. |
| `npm run lane:mock` | You need a governed mock verification channel but not full visual or backend-real. Stable gate id: `lane-mock`. | Use it as a diagnostic lane surface, then return to `gate:default` or higher. |
| `npm run gate:release` | A release campaign failed in the backend-real release evidence owner. | Rerun this owner, preserve `ux_trace_bundle`, then return to `npm run release:campaign:full`. |
| `npm run lane:demo-rehearsal` | A release campaign failed in the demo deployment rehearsal evidence owner. | Rerun from the lane's clean reset, then return to `npm run release:campaign:full`. |
| `npm run lane:cluster-rehearsal` | A release campaign failed in the cluster deployment rehearsal evidence owner. | Rerun from the lane's clean reset, then return to `npm run release:campaign:full`. |
| `RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full` | You already have explicit campaign context and only need to re-aggregate the terminal verdict. | This command is aggregate-only and does not execute suites; without explicit context, run `npm run release:campaign:full` instead. |

## 4. Do / Don't

Do:
- Start with the cheapest command that can reproduce the failure.
- Keep the failing command and the final gate separate in your notes.
- Preserve evidence when a lane fails.
- Rerun the owning gate after a diagnostic command turns green.

Don't:
- Do not update visual baselines without reading the screenshots.
- Do not treat `lane:mock` as release evidence.
- Do not skip `lane:visual` when the release scope needs full visual proof.
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
3. owning gate or lane
4. release campaign only if the change is release-grade
