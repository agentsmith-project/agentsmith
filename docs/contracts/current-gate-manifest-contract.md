# Current Gate Manifest Contract

Last updated: 2026-04-14
Status: `authoritative`

This contract defines the current engineering gate truth for AgentSmith.

Machine-readable source:

- `scripts/governance/current-gate-manifest.ts`

Use this contract when you need to answer:

1. which stable gate ids define the current engineering gates and verification lanes
2. whether a command owns no visual, targeted visual, or full visual evidence
3. whether a command requires backend-real infrastructure
4. which checklist, launcher surface, or CI job is supposed to carry that gate
5. which machine-readable story evidence kinds and artifact roots that gate must produce
6. for which tiers missing story evidence is blocking

Stable gate ids are the gate identity truth. Fields such as `npmScript`, `command`, and `ciJob` are adapter surfaces that point presentation and automation layers back to that stable id. Structured execution target fidelity lives in manifest `executionTargets` plus `npmScript` / optional `ciJob`; free-form `command` is only an operator hint for generated docs and human operators.

Plain-language boundary:
- `gate` means verdict identity and acceptance responsibility.
- `lane` means verification channel and evidence responsibility.
- `e2e` means one testing method that a gate or lane may use.
- `campaign` means a release or incident verification plan that consumes gates and lanes; it is not a stable gate id.
- `diagnostic lane surface` means a lane-like command used for diagnosis and local narrowing, without release evidence ownership.

## 1. Scope

This contract only covers engineering-governance truth:

- gate composition
- visual ownership
- backend-real ownership
- story evidence ownership
- CI/checklist alignment

It does not redefine product permissions, route gates, or OpenAPI behavior.

## 2. Current rules

1. `gate:fast`
- fast engineering gate
- no visual ownership
- no backend-real requirement

2. `gate:default`
- the default engineering gate
- composed from `test:default-e2e` and `test:governance`
- owns only targeted visual checks that are already embedded in those domain gates
- does **not** run the full visual lane

3. `lane:visual`
- the internal evidence owner / registered owner for full visual verification
- must stay separate from `gate:default`
- owns required `visual_scene_catalog` story evidence
- missing catalog evidence is blocking for `visual` and `release`
- scene linkage source: `e2e/visual-baseline-support.ts`
- committed evidence root: `e2e/__screenshots__/visual.spec.ts`
- release authority artifact: producer-owned `run-manifest.json`
- current schema: `visual_baseline_run_manifest/v2`
- each screenshot entry must bind `actual_url`, `actual_relpath`, `actual_sha256`, and `baseline_sha256`
- `actual_url` uses canonical `pathname + search`
- standalone `lane:visual` must still reject partial catalog evidence; campaign context does not change its full-visual ownership semantics
- wrappers and aggregate verifiers may copy or validate this manifest, but must not synthesize a replacement manifest from committed baselines or current checkout metadata

4. `test:backend-real:core` and `lane:backend-real:core`
- default-tier backend-real daily/self-service verification owners
- own required `ux_trace_bundle` story evidence for the `default` tier
- canonical artifact root: `artifacts/backend-real/runs/<run-id>/ux-traces`

5. `gate:release`
- release-grade engineering gate
- depends on backend-real release verification
- does not replace `lane:visual`
- owns required `ux_trace_bundle` story evidence through release verification
- missing release trace evidence is blocking for `release`
- required producer-owned release trace root contents:
  - `ux-trace-index.json` at the trace root
  - `contract-snapshot.json` inside every bundle directory
- standalone release trace validation and release aggregate must bind bundle acceptance to the current `gate-release` campaign topology membership, not just “any self-consistent backend-real bundle”
- current authoritative release membership:
  - `suite = integration-release-user-story`
  - `story_id = release-user-story-end-to-end`
  - `scenario_id = integration-release-user-story`
- aggregate verification must consume those producer snapshots and must not rebuild trace truth from current repo story files

6. `lane:demo-rehearsal` and `lane:cluster-rehearsal`
- release-only deployment rehearsal lanes
- consume the same release bundles that target hosts consume
- start from their own scenario-owned local clean reset
- keep rehearsal-generated handoff state under scenario-owned generated paths instead of shared operator config roots
- are not part of the default CI path, but are part of release evidence

7. `gate:release:full`
- the terminal aggregate verifier for an existing release campaign
- depends on the release evidence owned by `gate:release`, `lane:visual`, `lane:demo-rehearsal`, and `lane:cluster-rehearsal`
- requires both `visual_scene_catalog` and `ux_trace_bundle` evidence to be present in their canonical roots
- does not execute suites, gates, or lanes itself; the human-facing release execution entrypoint is `npm run release:ready`, which delegates to internal adapter `release:campaign:full` after precheck passes
- requires explicit campaign context such as `RELEASE_CAMPAIGN_ROOT=<campaign-root>` or an equivalent explicit run id context
- must evaluate evidence completeness from the current verification campaign manifest, not from whatever paths an older `evidence.json` happened to declare
- must reject stale evidence pointers that omit current required check ids, even when all referenced dummy paths exist

8. domain gates such as `test:default-e2e` and `test:governance`
- may own targeted visual checks with explicit `--grep` scopes
- must not silently expand into the full visual lane
- do not become implicit owners of `visual_scene_catalog` or `ux_trace_bundle`

9. `lane:mock`
- stable gate id: `lane-mock`
- is a current workflow diagnostic lane surface exposed by `scripts/governance/current-workflow-manifest.ts`
- is useful for mock-channel diagnosis and daily narrowing
- does not own release evidence and must not replace `gate:default`

## 3. Story evidence kinds

1. `visual_scene_catalog`
- owned by `test:visual` and `lane:visual`
- scene metadata source: `e2e/visual-baseline-support.ts`
- baseline root: `e2e/__screenshots__/visual.spec.ts`

2. `ux_trace_bundle`
- owned by default-tier and release-tier backend-real owners
- default-tier evidence root:
  - `artifacts/backend-real/runs/<run-id>/ux-traces`
- standalone release backend-real evidence roots:
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces`
- standalone release trace root must include `ux-trace-index.json`
- official release campaign evidence roots:
  - `<campaign-root>/gate-release/backend-real-visual/review.md`
  - `<campaign-root>/gate-release/backend-real-visual/ux-traces`
- official release trace root must include `ux-trace-index.json`, and each bundle under it must include `contract-snapshot.json`
- for release-tier evidence, bundle membership is authoritative only through the current `gate-release` topology declaration in `scripts/governance/current-gate-manifest.ts`

## 4. Missing-evidence semantics

1. `storyEvidenceRequiredFor`
- each story-evidence owner must declare the tiers where missing evidence is blocking
- `default` means the owning default-tier backend-real command cannot pass without its trace bundle
- `visual` means the visual lane cannot pass without its scene catalog
- `release` means release-grade gates cannot pass without the declared evidence

## 5. Cognitive-load rules

1. `make` is not a second gate model.
- Canonical gate names live under `npm run`.

2. Full visual evidence has one owner.
- `lane:visual`

3. Domain gates may keep small targeted visual checks.
- This is allowed only to protect business-critical surfaces without duplicating the full visual lane.

4. Release guidance must state when both are required.
- `gate:default` for default business/gating proof
- `lane:visual` for full visual proof

## 6. Required alignment

The following must stay aligned with `current-gate-manifest.ts`:

- `package.json` scripts
- `.github/workflows/quality-gates.yml`
- `README.md`
- `DEVELOPMENT.md`
- `docs/current-engineering-governance-model.md`
- `docs/contracts/current-gate-result-schema-contract.md`
- default/release engineering gate checklists
- contracts checks

If one of those changes, update the manifest first, then sync the rest.

For canonical `result.json` output and `failure_class` semantics, use:

- `scripts/governance/current-gate-result-schema.ts`
