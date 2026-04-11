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

## 1. Scope

This contract only covers engineering-governance truth:

- gate composition
- visual ownership
- backend-real ownership
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

4. `gate:release`
- release-grade engineering gate
- depends on backend-real release verification
- does not replace `lane:visual`

5. `lane:demo-rehearsal` and `lane:cluster-rehearsal`
- release-only deployment rehearsal lanes
- consume the same release bundles that target hosts consume
- start from their own scenario-owned local clean reset
- are not part of the default CI path, but are part of release evidence

6. `gate:release:full`
- the full release acceptance command
- combines `gate:release`, `lane:visual`, `lane:demo-rehearsal`, and `lane:cluster-rehearsal`

7. domain gates such as `test:default-e2e` and `test:governance`
- may own targeted visual checks with explicit `--grep` scopes
- must not silently expand into the full visual lane

## 3. Cognitive-load rules

1. `make` is not a second gate model.
- Canonical gate names live under `npm run`.

2. Full visual evidence has one owner.
- `lane:visual`

3. Domain gates may keep small targeted visual checks.
- This is allowed only to protect business-critical surfaces without duplicating the full visual lane.

4. Release guidance must state when both are required.
- `gate:default` for default business/gating proof
- `lane:visual` for full visual proof

## 4. Required alignment

The following must stay aligned with `current-gate-manifest.ts`:

- `package.json` scripts
- `.github/workflows/quality-gates.yml`
- `README.md`
- `DEVELOPMENT.md`
- `docs/current-engineering-governance-model.md`
- default/release engineering gate checklists
- contracts checks

If one of those changes, update the manifest first, then sync the rest.
