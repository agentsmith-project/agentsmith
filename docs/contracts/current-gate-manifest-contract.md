# Current Gate Manifest Contract

Last updated: 2026-04-10  
Status: `authoritative`

This contract defines the current engineering gate truth for AgentSmith.

Machine-readable source:

- `scripts/governance/current-gate-manifest.ts`

Use this contract when you need to answer:

1. which `npm run` commands are the canonical engineering gates and verification lanes
2. whether a command owns no visual, targeted visual, or full visual evidence
3. whether a command requires backend-real infrastructure
4. which checklist or CI job is supposed to carry that gate
5. which machine-readable story evidence kinds and artifact roots that gate must produce
6. for which tiers missing story evidence is blocking

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
- the only current command that owns the full visual verification lane
- must stay separate from `gate:default`
- owns required `visual_scene_catalog` story evidence
- missing catalog evidence is blocking for `visual` and `release`
- scene linkage source: `e2e/visual-baseline-support.ts`
- committed evidence root: `e2e/__screenshots__/visual.spec.ts`

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

6. `lane:demo-rehearsal` and `lane:cluster-rehearsal`
- release-only deployment rehearsal lanes
- consume the same release bundles that target hosts consume
- start from their own scenario-owned local clean reset
- keep rehearsal-generated handoff state under scenario-owned generated paths instead of shared operator config roots
- are not part of the default CI path, but are part of release evidence

7. `gate:release:full`
- the full release acceptance command
- combines `gate:release`, `lane:visual`, `lane:demo-rehearsal`, and `lane:cluster-rehearsal`
- requires both `visual_scene_catalog` and `ux_trace_bundle` evidence to be present in their canonical roots

8. domain gates such as `test:default-e2e` and `test:governance`
- may own targeted visual checks with explicit `--grep` scopes
- must not silently expand into the full visual lane
- do not become implicit owners of `visual_scene_catalog` or `ux_trace_bundle`

## 3. Story evidence kinds

1. `visual_scene_catalog`
- owned by `test:visual` and `lane:visual`
- scene metadata source: `e2e/visual-baseline-support.ts`
- baseline root: `e2e/__screenshots__/visual.spec.ts`

2. `ux_trace_bundle`
- owned by default-tier and release-tier backend-real owners
- default-tier evidence root:
  - `artifacts/backend-real/runs/<run-id>/ux-traces`
- release evidence roots:
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces`

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
- default/release engineering gate checklists
- contracts checks

If one of those changes, update the manifest first, then sync the rest.
