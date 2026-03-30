# Current Engineering Governance Model

Last updated: 2026-03-30  
Status: `authoritative`

This document defines the current engineering governance model for AgentSmith. README, DEVELOPMENT, Make help, workflow checks, and current runbooks must follow this document and the machine-readable manifest in `scripts/governance/current-workflow-manifest.ts`.

Canonical entrypoint rule:
- `npm run` names are the authoritative current command names.
- `make` targets may wrap them for convenience, but they are not a second naming model.

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
