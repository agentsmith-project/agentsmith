# Governance Lean Closure Plan v1

<!-- markdownlint-disable MD013 -->

Status: `team_reviewed_handoff_ready`
Date: 2026-05-13
Owner: Engineering governance maintainers

## 1. Purpose

This plan defines a small, convergent follow-up to recent test, gate, and deploy rehearsal governance work.

The goal is not to add a new governance platform. The goal is to make the existing governance path easier to understand, faster to run, and harder to misuse.

The plan is successful when a developer can answer three questions without reading internal adapter code:

1. What clean command should I run?
2. Why did it stop?
3. What is the one safe next command?

## 2. Core Decision

Keep the current public surface:

- `npm run verify`
- `npm run verify -- --goal=<pr|real|visual> --run`
- `npm run release:ready`
- `npm run release:status`
- `make local-real-up`
- `make local-real-status`
- `make local-real-down`
- `make local-real-reset`

Do not add new public gates, lanes, campaigns, or release commands.

All improvements must be implemented as simplification inside the existing entrypoints, manifests, and helper scripts.

`release:ready` remains the only ordinary release-grade sign-off command. Any existing release-real or owner-specific diagnostic path must stay behind runbooks, manifests, or failure projection and must not become a new public release lane.

## 3. Non-goals

- No new governance lane.
- No new release campaign type.
- No cross-run runtime cache.
- No generic distributed scheduler.
- No new broad evidence schema unless it replaces an existing duplicate.
- No new developer-facing command family.
- No automatic destructive cleanup for resources whose owner cannot be proven.
- No doc expansion that requires future developers to learn another governance taxonomy.

## 4. Problems To Solve

### 4.1 Repeated work inside one command

Recent runs showed repeated dependency startup, repeated readiness waits, repeated image preparation, and repeated status checks.

Required direction:

- Reuse readiness only inside the same `verify` or `release:ready` process.
- Keep cross-command behavior simple: every new command starts a new run.
- Replace fixed sleeps with bounded readiness polling.
- Pass verified preflight/readiness state from parent orchestration to child adapters through existing campaign or report roots.
- First clarify bootstrap command semantics. A command named `ready` must not also perform unconditional `up` work if callers already ran `up`.

### 4.2 Too many scripts look authoritative

`package.json` still contains many `test:*`, `gate:*`, `lane:*`, and low-level maintenance scripts. They are needed as owner diagnostics and evidence producers, but they should not become the ordinary mental model.

Required direction:

- Human docs show only clean entrypoints.
- Internal docs may mention adapter identities only when they say `internal adapter`, `owner diagnostic`, or `not a verdict`.
- `verify` and `release:ready` remain the only ordinary verdict entrypoints.

### 4.3 Checks are powerful but scattered

The current checks catch many issues, but some product-facing terminology drift was still found manually in README, DEVELOPMENT, and marketing docs.

Required direction:

- Extend the existing product terminology check; do not create a new standalone governance line.
- Keep the rule table small and explicit.
- Require product-facing and customer-facing docs to pass.
- Treat active internal docs as limited-context scans, not broad prose policing.
- Allow restricted historical terms only inside `product-terminology.md` and implementation/API contexts.

### 4.4 Failure output still exposes internals

Some failures force users to infer which layer failed by reading internal step names, evidence paths, or adapter output.

Required direction:

- Every clean command failure should render one primary blocker.
- Output should include only `Blocker`, `Stage`, `Why`, `Fix`, `Rerun`, and `Evidence`.
- `Rerun` must be a clean command, not an internal adapter.
- `release:status` must be read-only and must not imply it can fix or rerun anything.

### 4.5 Heavy visual and backend-real work can be triggered too eagerly

Visual and backend-real evidence are valuable but expensive.

Required direction:

- Do not reduce release requirements.
- Do avoid heavy visual/backend-real review for env-only or docs-only changes.
- Keep heavy evidence tied to impact selection and release closure, not to every small focused fix.

### 4.6 Campaign evidence and standalone diagnostics can be confused

Release authority belongs to campaign-scoped evidence. Standalone lane evidence is useful for diagnosis, but it must not be treated as release sign-off.

Required direction:

- `npm run release:ready` is the only ordinary release-grade human entrypoint.
- `npm run release:status` is read-only projection, not a new readiness probe and not a fixer.
- Standalone artifacts such as `artifacts/backend-real-visual/` or `artifacts/unified-deploy/` must be labeled as diagnostics unless they are explicitly linked from the campaign root.
- Run-local readiness state is operational state only. It is not release sign-off evidence and must not be cited directly by the release conclusion.

### 4.7 Some duplicate-looking checks are intentional

Not every repeated action is waste. Some checks protect evidence authority or deployment safety.

Required direction:

- Keep wrapper `result.json` and native `result.json` layering when it preserves producer versus wrapper truth.
- Keep terminal aggregate evidence re-validation.
- Keep rollout-time image pull/preflight when it verifies the image is actually consumable by the rollout target.
- Keep route smoke before product flows when it prevents expensive flows from hiding a basic availability failure.

## 5. Implementation Plan

### Slice 0. Inventory And Invariants

Before changing behavior, produce a small inventory of the current governance surface.

The inventory must list:

- public human entrypoints
- internal adapters and owner diagnostics
- evidence authority roots
- run-local state roots
- cleanup commands and ownership proofs
- scripts that call dependency startup or readiness

Rules:

- This slice changes no runtime behavior.
- It must identify which repeated checks are intentional safety checks.
- It must label campaign authority separately from standalone diagnostics.

Acceptance:

- Developers can see which scripts are public, internal, diagnostic, or authority-producing.
- The inventory identifies every current `integration:deps:up` and `make deps-ready` caller.
- The inventory becomes the review baseline for later script deletion or merging.

Required verification:

```bash
npm run contracts:check-current-workflows
npm run contracts:check-engineering-governance
```

### Slice A. Dependency Bootstrap Semantics

Make dependency commands single-purpose before adding reuse.

Required decision:

- `deps-up` starts or updates dependencies.
- `deps-ready` performs readiness polling only.
- If a combined command is needed, it must be named as bootstrap, for example `deps-bootstrap`, and it must be the only caller-facing combined operation.

Decision output:

- A command semantics table in the existing runtime/development docs.
- One canonical combined bootstrap command if the team keeps a combined operation.
- One canonical readiness-only command that child adapters may call safely.

Actions:

- Find every script that runs `integration:deps:up` immediately before `make deps-ready`.
- Replace each duplicate pair with the canonical operation after the `deps-ready` decision is implemented.
- Add a lightweight contract check that prevents reintroducing `integration:deps:up` followed by `make deps-ready`.

Acceptance:

- A single slice does not call compose up twice through different wrappers.
- `deps-ready` can be safely called by child adapters without mutating dependency lifecycle.
- The check fails if a script reintroduces the duplicate pattern.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/clean-status-entrypoints.test.ts
npm run contracts:check-current-runtime-lines
```

### Slice B. Single Process Readiness State

After Slice A, implement minimal run-local readiness state under the existing report root:

- verify: `artifacts/verification/<run-id>/state/readiness.json`
- release: `artifacts/release-runs/<campaign-run-id>/state/readiness.json`

This file is operational state, not release authority evidence.

The state file may record only:

- integration deps ready
- local-real substrate ready
- unified-deploy substrate ready
- runner image digest prepared
- AFSCP image digest prepared
- local kind image import completed

Rules:

- Valid only for the current command process.
- Must include `invocation_id` or `process_nonce` generated by the parent command.
- Child adapters must receive and verify the same nonce before reading the state file.
- Must include input digest, git SHA, allowlisted env digest, and timestamp.
- Env digest must be built from allowlisted env names and hashed normalized values only.
- Never write raw env values, tokens, Project secrets, managed credentials, or credential paths.
- Must fail closed when required fields are missing.
- Must not be reused by a later command.
- It has one writer: the parent orchestration. Child adapters are read-only consumers.

Acceptance:

- One `release:ready` run does not start integration deps more than once when inputs match.
- One `release:ready` run does not repeat local kind image import when image digest and cluster identity match.
- A new `release:ready` command does not trust the previous command's runtime readiness state.
- `verify` steps within one invocation/process can reuse already-produced fast/default evidence where current gate scripts already support that reuse.
- Release summaries do not cite readiness state as release sign-off evidence.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/verify-entrypoints.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts
npm run test:run -- scripts/governance/__tests__/pure-check-runtime-shadow.test.ts
```

### Slice C. Bounded Readiness Polling

Replace fixed waits in high-frequency paths with bounded readiness polling.

Targets:

- integration deps readiness
- API/web readiness in backend-real gates
- unified-deploy substrate readiness
- local kind registry availability

Rules:

- Poll with a clear timeout and last observed reason.
- Write the reason to existing evidence output.
- Do not add new long retry loops around assertion failures.

Acceptance:

- Healthy integration deps continue as soon as probes pass.
- Failed readiness reports the failed probe and suggested clean command.
- No fixed sleep remains on the main happy path where a probe exists.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/sentinel-preflight.test.ts
npm run test:run -- scripts/governance/__tests__/clean-status-entrypoints.test.ts
```

### Slice D. One Blocker Renderer

Consolidate failure presentation into one small renderer used by `verify`, `release:ready`, and `release:status`.

Canonical fields:

- `Blocker`
- `Stage`
- `Why`
- `Fix`
- `Rerun`
- `Evidence`

Rules:

- `Rerun` must be one of the clean commands.
- `Fix` may be an owner cleanup command only when ownership is proven.
- If ownership is unclear, show `Inspect`, not `Fix`.
- Internal adapter names may appear only in evidence paths or owner diagnostics sections.

Acceptance:

- Port conflict, precheck failure, missing evidence, and product-flow failure all render the same shape.
- Failure summary stays short enough to fit on one terminal screen.
- `gate:release:full` without campaign context must point humans to `npm run release:ready`, not to internal campaign commands.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/status-projection.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts
```

### Slice E. Product-facing Terminology Check Extension

Extend `contracts:check-product-terminology` instead of adding a new command.

Scan:

- `README.md`
- `DEVELOPMENT.md`
- `docs/项目宪法.md`
- `docs/user-guides/**/*.md`
- `marketing/**/*.md`

Limited-context scan:

- `docs/UXUI/**/*.md`
- `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`

Do not broad-scan:

- generated specs
- API field references
- implementation code
- historical docs explicitly marked `historical_superseded_reference`

Rules:

- Current product-facing docs must use the canonical names from `docs/contracts/product-terminology.md`, including `Model`, `Agent tasks`, `Agent Runners`, `Files`, `Project secrets`, `Personal connections`, `Workspace integrations`, `Access guide`, and `Shared context`.
- Forbidden terms are allowed only in `docs/contracts/product-terminology.md`, quoted API/path names, or explicit historical/implementation context.
- The allowlist must be small and reviewed like code.
- Do not infer product renames from grep output or one reviewer finding. The terminology contract is the authority.

Acceptance:

- The drift found in README, DEVELOPMENT, and marketing docs would fail the check.
- Marketing screenshot directory descriptions stay aligned with `e2e/capture-screenshots.spec.ts` or are explicitly marked historical.
- The check remains fast and does not require running Playwright or backend services.

Required verification:

```bash
npm run contracts:check-product-terminology
npm run contracts:check-doc-governance
```

### Slice F. Heavy Evidence Selector Simplification

Keep the existing impact selector, but make the heavy-evidence decision easier to inspect.

Rules:

- Docs-only and non-runtime env metadata changes do not trigger full visual or backend-real visual review.
- Runtime, deploy, auth, API base, Keycloak, MSW production, or env contract changes must go through the corresponding real/release selector path.
- UI shell, design token, component recipe, navigation, Chat, Agent tasks, Files, Agent Runners, Endpoints, Audit, Usage, Settings, and auth changes may trigger visual according to current manifest ownership.
- Release closure still runs required release evidence.

Acceptance:

- `npm run verify -- --goal=pr --run` prints whether heavy visual/backend-real is required and why.
- The reason is derived from one selector result, not duplicated prose across scripts.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/verify-impact-selector.test.ts scripts/governance/__tests__/verify-entrypoints.test.ts
```

### Slice G. Campaign Evidence Boundary Cleanup

Clarify which paths are release authority and which paths are standalone diagnostics.

Actions:

- Keep campaign-scoped evidence under `artifacts/release-runs/<campaign-run-id>` as release authority.
- Update docs that list standalone `artifacts/backend-real-visual/` or `artifacts/unified-deploy/` as release conclusion inputs so they say those paths are diagnostics unless referenced by the campaign root.
- Ensure `release:status` does not perform new readiness probes or imply revalidation.
- Ensure release summaries do not ask users to manually chain internal lanes before final release sign-off.

Acceptance:

- Release docs point to campaign root first.
- Standalone evidence paths are described as diagnostics or focused owner evidence.
- `release:status` output is clearly read-only.
- Readiness state under `state/readiness.json` is excluded from release authority evidence.

Required verification:

```bash
npm run test:run -- scripts/governance/__tests__/release-full-aggregate-gate.test.ts scripts/governance/__tests__/release-readiness-entrypoints.test.ts
npm run contracts:check-current-verification-campaigns
```

### Slice H. Script Surface Cleanup

Reduce script complexity without removing needed owner diagnostics.

Actions:

- Group shared shell helpers for readiness, blocker rendering, and owner preflight.
- Delete or inline wrappers that only call another wrapper with no added ownership, evidence, or readability.
- Keep `package.json` script names stable unless a script is unused and not referenced by manifests/docs/tests.
- Add a small "why this script exists" comment to non-obvious owner adapters.

Acceptance:

- No new public command family is added.
- At least one redundant wrapper path is removed or documented as intentionally retained.
- `contracts:check-current-workflows` still owns command surface truth.
- Safety duplicates listed in Section 4.7 are preserved unless a replacement proves the same authority boundary.

Required verification:

```bash
npm run contracts:check-current-workflows
npm run contracts:check-engineering-governance
```

## 6. Development Order

1. Slice 0 first. Do not simplify what has not been inventoried.
2. Slice A next. Do not build reuse on top of unclear dependency command semantics.
3. Slice E can run in parallel if a separate owner works only on terminology checks.
4. Slice B and C together for the largest time reduction.
5. Slice D after B/C so failure projection can consume readiness/preflight truth.
6. Slice G after D so release authority paths use the same blocker and status language.
7. Slice F after D/G so heavy evidence decisions are visible in the same summary shape.
8. Slice H last, only after tests prove which wrappers are truly redundant.

Do not start Slice H by deleting scripts. Start by mapping references and proving redundancy.

## 7. Test Strategy

Use TDD for each slice.

Minimum focused tests:

- Inventory: add reference checks proving public/internal/evidence/state boundaries are listed.
- Dependency bootstrap semantics: add a failing scanner test for `integration:deps:up` followed by `make deps-ready`.
- Product terminology extension: add failing fixture expectations before changing allowlists.
- Readiness state: unit tests for nonce mismatch, same-process reuse, digest mismatch, redaction, and new-command fail-closed behavior.
- Readiness polling: tests for healthy immediate pass, bounded timeout, and last observed failure reason.
- Blocker renderer: snapshot-like tests for port conflict, evidence missing, precheck failure, and unknown owner.
- Campaign evidence boundary: tests that release status and aggregate errors recommend clean commands only.
- Heavy selector: tests for docs-only, env-only, UI/token, backend-real, and release closure cases.
- Script cleanup: reference scanner tests before deleting or merging wrappers.

Baseline verification for every slice closure:

This is the slice handoff/closure check. It does not replace focused TDD tests while implementing the slice.

```bash
npm run contracts:check
npm run verify -- --goal=pr --run
```

Slice-specific verification is listed above and is required in addition to the baseline.

Release-specific behavior changes also require:

```bash
npm run release:ready
```

## 8. Handoff Checklist

- The plan does not add a new public governance line.
- Every slice has a clear stop condition.
- Every slice has tests that fail before implementation.
- Any new helper replaces duplicate logic instead of creating another layer.
- Any new state file is run-local, has one parent writer, and has read-only child consumers.
- Any new state file has nonce validation and redacted allowlisted digests.
- User-facing failure output keeps one blocker and one clean rerun command.
- Docs changes update existing current docs instead of creating parallel guidance.
- Intentional evidence/safety duplicates are documented before any de-duplication work starts.

## 9. Explicit Stop Rule

Stop after these outcomes are true:

1. Product-facing terminology drift is automatically caught.
2. `deps-ready` and dependency bootstrap semantics are unambiguous.
3. One command process does not repeat the most expensive readiness/build/import checks.
4. Fixed sleeps on main healthy paths are replaced with bounded polling.
5. Clean command failures show one blocker, one fix or inspect action, and one rerun command.
6. Campaign-scoped release evidence is clearly separated from standalone diagnostics.
7. Heavy visual/backend-real work is triggered only by selector truth or release closure.
8. Readiness state cannot be reused across commands and cannot leak secrets.

Do not continue into generalized caching, generalized scheduling, or new gate/lane design unless a separate incident review approves it.
