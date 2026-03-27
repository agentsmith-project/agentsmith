# Current Engineering Governance Model

Last updated: 2026-03-24  
Status: `authoritative`

This document defines the current engineering governance model for AgentSmith. README, DEVELOPMENT, Make help, workflow checks, and current runbooks must follow this document.

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

## 2. Current command model

### 环境

```bash
make dev-real-up
make dev-real-seed-notebook
make dev-real-status
make dev-real-down
make dev-real-reset
```

### 测试

```bash
npm run test:default-e2e
npm run test:visual
npm run test:governance
npm run test:real-core
npm run test:notebook:real-smoke
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
npm run lane:real:core
npm run lane:real:release
```

### 发布

```bash
npm run release:real:reset
npm run release:real:bootstrap
npm run release:real:ready
npm run release:real:run
npm run release:real:report
```

## 3. Playwright model

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
- Playwright integration config / real-lane tests

Important:
- `默认 e2e` is not “all e2e”.
- A spec not included in the default Playwright range is not automatically broken or removed.

## 4. Visual evidence rules

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

## 5. Current configuration language

Current provider-neutral names:

- `DEMO_ENDPOINT_*`
- `REAL_LANE_*`
- `DEPLOY_*`
- `OpenAI-compatible`
- `Anthropic-compatible`

Historical provider-specific names and descriptions do not belong in current workflow guidance.

## 6. Maintenance rules

1. When adding a new command, classify it first as:
- 环境 / 测试 / 门禁 / 验证通道 / 发布

2. New current documentation must not invent new top-level engineering terms.

3. When adding a visual scene, decide first:
- 整页视觉基线 or 局部视觉基线

4. When changing the current workflow, update together:
- `README.md`
- `DEVELOPMENT.md`
- `docs/CURRENT_BASELINE.md` if current baseline meaning changes
- `Makefile` help
- workflow/governance static checks
