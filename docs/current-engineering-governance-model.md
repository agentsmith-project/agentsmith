# Current Engineering Governance Model

Last updated: 2026-03-30  
Status: `authoritative`

This document defines the current engineering governance model for AgentSmith. README, DEVELOPMENT, Make help, workflow checks, and current runbooks must follow this document and the machine-readable manifests in `scripts/governance/current-workflow-manifest.ts`, `scripts/governance/current-gate-manifest.ts`, and `scripts/governance/current-runtime-line-manifest.ts`.

Product terminology alignment:
- `docs/contracts/product-terminology.md` is the authoritative source for product-facing object names and IA boundaries.
- Engineering docs and tests must use `Execution target`, `Project secrets`, `Shared context`, `Access guide`, and `Files` when referring to the current product surfaces.
- Do not collapse `Endpoint` and `Agent` into a generic model-source concept in product-facing explanations, UI narratives, or verification language.

Canonical entrypoint rule:
- `make` is the authoritative entrypoint for environment and rehearsal orchestration.
- `npm run` is the authoritative entrypoint for tests, gates, verification lanes, and release validation.
- `make` and `npm run` are both current command surfaces, but they must not describe the same path with conflicting semantics.

Current gate truth:
- `scripts/governance/current-gate-manifest.ts` is the machine-readable source for gate composition, visual ownership, backend-real ownership, and CI/checklist alignment.
- `gate:default` does not own the full visual lane.
- `lane:visual` is the only current command that owns full visual verification.

<!-- current-runtime-lines:governance-model:start -->
For current runtime-line methodology and release/rehearsal topology, use:

- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)
- [Local Runtime Flows](./user-guides/local-runtime-flows.md)
- Machine-readable source: `scripts/governance/current-runtime-line-manifest.ts`

Current local baseline:
- One shared local substrate backs local-manual, demo-rehearsal, and cluster-rehearsal on a development host.
- Only one local flow should be active at a time; switch flows by stopping or resetting the current one first.
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
### 环境

```bash
make substrate-up
make substrate-reseed
make substrate-status
make substrate-down
make substrate-reset
make local-manual-up
make local-manual-seed-notebook
make local-manual-internal-up
make local-manual-internal-status
make local-manual-internal-down
make local-manual-internal-reset
make local-manual-status
make local-manual-down
make local-manual-reset
make demo-rehearsal-up
make demo-rehearsal-status
make demo-rehearsal-down
make demo-rehearsal-reset
make demo-rehearsal-bootstrap
make demo-rehearsal-verify
make demo-rehearsal-report
make cluster-rehearsal-up
make cluster-rehearsal-status
make cluster-rehearsal-down
make cluster-rehearsal-reset
make cluster-rehearsal-bootstrap
make cluster-rehearsal-verify
make cluster-rehearsal-report
```

### 测试

```bash
npm run test:default-e2e
npm run test:visual
npm run test:governance
npm run test:backend-real:core
npm run test:demo-bundle:inputs
npm run test:demo-rendered-env
npm run test:notebook:backend-real:smoke
```

### 门禁

```bash
npm run gate:fast
npm run gate:default
npm run gate:release
```

### 验证通道

```bash
npm run lane:mock
npm run lane:visual
npm run lane:backend-real:core
npm run lane:backend-real:release
```

### 发布

```bash
npm run backend-real:reset
npm run backend-real:bootstrap
npm run backend-real:ready
npm run backend-real:run
npm run backend-real:report
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
- `lane:visual` is the only current full visual lane.

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
