# Current Engineering Governance Model

Last updated: 2026-04-14
Status: `authoritative`

This document defines the current engineering governance model for AgentSmith. Machine-readable manifests and contracts are the enforcement truth; README, DEVELOPMENT, Make help, workflow checks, and current runbooks are synchronized presentation surfaces that must follow `scripts/governance/current-workflow-manifest.ts`, `scripts/governance/current-gate-manifest.ts`, `scripts/governance/current-gate-result-schema.ts`, and `scripts/governance/current-runtime-line-manifest.ts`.

Product terminology alignment:
- `docs/contracts/product-terminology.md` is the authoritative source for product-facing object names and IA boundaries.
- Engineering docs and tests must use `Execution target`, `Project secrets`, `Shared context`, `Access guide`, and `Files` when referring to the current product surfaces.
- Do not collapse `Endpoint` and `Agent` into a generic model-source concept in product-facing explanations, UI narratives, or verification language.

UI design guide alignment:
- `DESIGN.md` is the current UI design guide used for style direction and global design rules.
- It does not define product terminology, IA, permission gates, or engineering governance truth.
- `docs/UXUI/` only defines active interaction and module-specific UX behavior that references `DESIGN.md`.
- `docs/testing/visual-baseline-policy-v1.md` owns visual evidence policy; it does not replace `DESIGN.md`.

Canonical entrypoint rule:
- `make` and `npm run` are the current command surfaces and adapter layers.
- stable gate identity lives in `scripts/governance/current-gate-manifest.ts` `id`, not in a launcher string.
- adapter surfaces such as `npmScript`, `command`, and `ciJob` may change presentation, but they must keep pointing back to the same stable gate id.
- structured execution target fidelity lives in `npmScript`, optional `ciJob`, and manifest `executionTargets`, not in scattered prose.
- free-form `command` is an operator hint for humans and generated command blocks, not enforcement truth.

Plain-language glossary:
- `e2e`: a testing method. It means walking a complete user flow, usually with Playwright in this repo. It is not a gate or a lane.
- `lane`: a verification channel. It says which truth path is being used, such as mock, full visual, backend-real, or deployment rehearsal.
- `gate`: an acceptance point. It gives the formal pass/fail verdict for one engineering tier.
- `campaign`: a group of verification actions for one goal, such as release-grade verification. It consumes gates and lanes; it is not a second gate truth.
- `diagnostic`: a focused command or lane used to locate a problem. It helps fix the issue but does not replace the owning gate.
- `verdict`: the formal conclusion for a layer. A verdict must include required evidence completeness when the owning gate or lane declares evidence.

Workflow role model:
- `scripts/governance/current-workflow-manifest.ts` classifies command surfaces as `environment_setup`, `diagnostic`, `diagnostic_lane`, `evidence_lane`, `gate_verdict`, `terminal_gate_verdict`, or `release_operation`.
- `lane:mock` uses stable gate id `lane-mock`, but its workflow role is still diagnostic lane surface. It is useful for mock-channel diagnosis, but it is not release evidence and does not replace `gate:default`.
- `release:ready` is the human-friendly release readiness launcher. It runs the non-verdict precheck first, then delegates to `release:campaign:full` when precheck passes.
- `release:campaign:full` remains the campaign launcher behind `release:ready`. It orchestrates required gates, evidence lanes, rehearsal lanes, and the terminal aggregate verdict.
- `gate:release:full` is aggregate-only. It should be used only with explicit campaign context, such as `RELEASE_CAMPAIGN_ROOT=<campaign-root>`, and must not be described as a suite launcher or daily release entrypoint.
- `gate:release:full` recomputes required release evidence from the current verification campaign manifest. It must not trust stale `evidence.json.required_paths` from an older campaign shape.

Current gate truth:
- `scripts/governance/current-gate-manifest.ts` is the machine-readable source for stable gate ids, gate composition, visual ownership, backend-real ownership, and CI/checklist alignment.
- story evidence is part of current gate truth, not a release-only prose convention.
- `visual_scene_catalog` is the machine-readable evidence kind owned by `test:visual` / `lane:visual`, with scene linkage defined in `e2e/visual-baseline-support.ts`.
- `ux_trace_bundle` is the machine-readable evidence kind owned by both default-tier and release-tier backend-real commands:
  - `test:backend-real:core` / `lane:backend-real:core` own default-tier daily/self-service trace bundles under `artifacts/backend-real/runs/<run-id>/ux-traces`
  - standalone `gate:release` / `lane:backend-real:release` runs own release-grade trace bundles under `artifacts/backend-real-visual/<run-id>/ux-traces`
  - `release:campaign:full` writes its release-grade trace bundles under `<campaign-root>/gate-release/backend-real-visual/ux-traces`
- missing story evidence is blocking only for the tiers declared in `storyEvidenceRequiredFor`; this rule is machine-readable and must not live only in prose.
- `scripts/governance/current-gate-result-schema.ts` is the machine-readable source for canonical `result.json` output, gate-level `failure_class`, and the currently registered backend-real runtime result writers.
- for gate/lane pairs registered in `scripts/governance/current-gate-result-schema.ts`, canonical gate-result artifact location is `<evidence_dir>/result.json`; fixed `current/result.json` paths are not valid governance truth.
- gate-result writer truth is `gate_id + line_kind`; adapter fields such as `npm_script` and `ci_job` are runtime metadata, not identity.
- `failure_class` is a gate-level verdict field, not a best-effort log tag. Current enum: `none`, `product_regression`, `infra_setup_failure`, `environment_conflict`, `contract_drift`, `evidence_missing`.
- `gate:default` does not own the full visual lane.
- `lane:visual` is the internal full visual evidence owner / verification owner; human execution uses clean entrypoints such as `npm run verify -- --goal=visual --run` outside release and `npm run release:ready` for release-grade sign-off.

Verification governance rules:
- Focused `测试` commands and targeted `验证通道` runs are diagnosis paths used to localize failures, verify one subsystem, or regenerate one evidence family.
- Stable engineering acceptance still comes from the machine-readable gate ids in `scripts/governance/current-gate-manifest.ts`; focused reruns never replace the final gate verdict they support.
- `gate:fast`, `gate:default`, and `gate:release` are authoritative gate verdict surfaces for their tiers. `release:ready` is the human-facing release-grade execution entrypoint; it delegates to `release:campaign:full` after the non-verdict precheck passes. `gate:release:full` is the terminal aggregate verifier inside or after an explicit campaign context.
- `lane:visual` and `lane:backend-real:release` remain authoritative evidence-owning lanes for full visual review and release-grade backend-real evidence, but they do not replace the final release verdict.
- For any gate or lane that owns required machine-readable evidence, `command passed` and evidence completeness are same-level acceptance conditions. Missing required review artifacts, missing `visual_scene_catalog`, or missing required `ux_trace_bundle` output is a failure, not a soft warning.
- Where a current result writer is registered in `scripts/governance/current-gate-result-schema.ts`, evidence completeness also requires canonical `<evidence_dir>/result.json`.
- Evidence must be producer-owned. Wrappers and aggregate verifiers may relay or validate authority artifacts, but they must not synthesize replacement authority truth from the current checkout.
- `lane:visual` authority artifact is producer-owned `run-manifest.json` plus run-scoped actual captures under the same review root; committed baselines remain comparison input, not release authority.
- backend-real UX trace authority is producer-owned `ux-trace-index.json` plus per-bundle `contract-snapshot.json`; aggregate verification must consume those snapshots instead of reloading current repo story definitions.
- `failure_class` in canonical `result.json` is a gate-verdict taxonomy only. It must not be treated as the same thing as troubleshooting categories produced by local diagnosis tools or incident notes.
- Automated release-grade verification and operator-only checks must stay separated. Current manual Feishu steps belong in release operator guidance, not in machine-readable gate identity or gate-result truth.
- Human-oriented campaign guidance lives in [Verification Campaigns v1](./testing/verification-campaigns-v1.md); if it conflicts with manifests or contracts, machine-readable governance truth wins.

<!-- current-runtime-lines:governance-model:start -->
For current runtime-line methodology and release/rehearsal topology, use:

- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)
- [Local Runtime Flows](./user-guides/local-runtime-flows.md)
- Machine-readable source: `scripts/governance/current-runtime-line-manifest.ts`

Current local operational baseline:
- One shared local substrate backs local-manual, demo-rehearsal, and cluster-rehearsal on a development host.
- Only one local flow should be active at a time; switch flows by stopping or resetting the current one first.

Still-binding runtime contracts:
- Demo and cluster rehearsal each own their local kind world and registry identity instead of sharing one generic local cluster.
- Rehearsal lines validate release paths on a development host; deploy lines operate on target-host release roots.
<!-- current-runtime-lines:governance-model:end -->

## 1. Allowed top-level terms

Current engineering guidance only uses these top-level terms:

1. `环境`
- Start, stop, or inspect local development and manual-test environments.

2. `测试`
- Run one specific verification target, such as a Vitest suite, one Playwright spec, or one shell-based check.

3. `门禁`
- A required engineering check bundle that must pass before a change can be accepted at a given level.

4. `验证通道`
- A full verification path with a distinct source of truth, such as mock, visual, or real backend.

5. `发布`
- Demo deployment and release-grade verification flow.

### Terms that are not current top-level workflow terms

The following may still appear in file names or legacy script names, but they must not be used as the top-level explanation of the current workflow:

- `mainline`
- `strict`
- `smoke`
- `run`
- `check`
- `workflow`
- `runtime`

## 2. Runtime baseline

Current engineering runtime baseline:

- `Node 24.14.1 LTS` for local development, CI, build images, and deployment images
- do not mix Node 20/22/25 across current engineering paths
- repo version files are `.nvmrc`, `.node-version`, `package.json` `engines.node`, and `package.json` `packageManager` (`npm@11.11.0`)

## 3. Current command model

<!-- current-workflow:governance-model:start -->
Human-facing command blocks intentionally list clean entrypoints only.

Internal adapters and evidence producers remain in `scripts/governance/current-workflow-manifest.ts`, `scripts/governance/current-gate-manifest.ts`, and `package.json`, but are not rendered here as copyable human defaults.

### 环境

```bash
npm run dev
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

### 测试

```bash
npm run verify
```

### 发布

```bash
npm run release:ready
npm run release:status
npm run rehearse:demo
npm run rehearse:cluster
```
<!-- current-workflow:governance-model:end -->

## 4. Playwright model

Current Playwright projects map to the workflow model as follows:

1. `默认 e2e`
- Playwright project: `chromium`
- Meaning: the default parallel UI regression range for the current product surface

2. `默认 e2e（串行）`
- Playwright project: `chromium-serial`
- Meaning: the default current UI regression range that must run serially

3. `视觉验证`
- Playwright project: `visual`

4. `真实后端验证`
- Playwright integration config / backend-real tests

Important:
- `默认 e2e` is not “all e2e”.
- A spec not included in the default Playwright range is not automatically broken or removed.

## 5. Visual evidence rules

1. `整页视觉基线`
- For page-level structure and layout changes.

2. `局部视觉基线`
- For dialogs, side panels, notification dropdowns, CTA areas, and other local interaction changes.

3. Update rule
- Update only the affected visual scenes.
- Review the updated images.
- Re-run the same scenes without snapshot update.

4. Blocking rule
- Default engineering gates do not fail solely because visual baselines are missing.
- The visual verification lane fails when visual checks fail.
- Release-grade visual review requirements must be stated explicitly in release guidance.

5. Ownership rule
- `gate:default` may contain targeted visual checks inside domain gates.
- `lane:visual` is the internal full visual evidence owner / verification owner.
- Human full visual execution outside release uses `npm run verify -- --goal=visual --run`; release-grade sign-off uses `npm run release:ready`.
- `lane:visual` owns `visual_scene_catalog` evidence through `e2e/visual-baseline-support.ts` and the committed baseline set under `e2e/__screenshots__/visual.spec.ts`.
- `lane:visual` release authority is producer-owned `artifacts/visual-baseline-reviews/<run-id>/run-manifest.json` with run-scoped `captured/<scenario-id>/<file>` actual screenshots.
- `test:backend-real:core` and `lane:backend-real:core` own default-tier `ux_trace_bundle` evidence through `artifacts/backend-real/runs/<run-id>/ux-traces`.
- `gate:release` and `lane:backend-real:release` own release-grade `ux_trace_bundle` evidence through `artifacts/backend-real-visual/<run-id>/ux-traces`.
- backend-real trace bundles must publish `ux-trace-index.json` at the trace root and `contract-snapshot.json` inside each bundle directory.
- Checklists and contracts must use these machine-readable evidence kinds instead of inventing parallel release-only names.

## 6. Current configuration language

Current provider-neutral names:

- `PRESET_ENDPOINT_*`
- `BACKEND_REAL_*`
- `DEPLOY_*`
- `OpenAI-compatible`
- `Anthropic-compatible`

Historical provider-specific names and descriptions do not belong in current workflow guidance.

## 7. Maintenance rules

1. When adding a new command, classify it first as:
- 环境 / 测试 / 门禁 / 验证通道 / 发布

2. New current documentation must not invent new top-level engineering terms.

3. When adding a visual scene, decide first:
- 整页视觉基线 or 局部视觉基线

4. When changing the current workflow, update `scripts/governance/current-workflow-manifest.ts` first, then sync:
- `README.md`
- `DEVELOPMENT.md`
- `docs/CURRENT_BASELINE.md` if current baseline meaning changes
- `docs/testing/verification-campaigns-v1.md` if command inventory or verification semantics changed
- `Makefile` help
- workflow/governance static checks

## 8. Web / Desktop release separation

Current delivery governance for AgentSmith companion surfaces:

1. `AgentSmith Web` and `AgentSmith Desktop` are separate release surfaces.
2. They may share contracts, address truth, and joint verification evidence, but they do not share a mandatory same-version or same-day release rule.
3. A failure in one surface blocks the other only when:
- the shared contract changes
- the shared address truth changes
- a required joint verification path fails
4. Repository-local gates must stay local by default. Cross-surface verification belongs in explicit joint rehearsal or release guidance, not in unrelated default gates.
For gate/lane pairs currently registered in `scripts/governance/current-gate-result-schema.ts`, canonical `result.json` must use `snake_case` only and live at `<evidence_dir>/result.json`; examples remain anchored in `docs/contracts/current-gate-result-schema-contract.md`.
