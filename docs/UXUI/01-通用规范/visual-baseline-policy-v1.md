# Visual Baseline Policy v1

Last updated: 2026-03-08  
Owner: Frontend

## 1. Policy

1. Visual snapshots are **non-blocking** for default CI release gate.
2. Default e2e gate is functional only: `smoke + chromium`.
3. Visual baseline files under `e2e/__screenshots__/` are local working artifacts and are ignored by git.

## 2. Default Gates

Use these as mandatory quality gate:

```bash
npm run test:e2e
```

Equivalent to:

```bash
playwright test --project=smoke --project=chromium
```

## 3. Manual Visual Workflow

When UI changes need visual review:

1. Refresh local visual baselines:
   ```bash
   npm run test:e2e:lane:mock:visual:update
   ```
2. Review generated images locally.
3. Capture review evidence in PR description (target pages + key diffs).
4. Optional CI artifact run: trigger `Quality Gates` with `run_visual=true`.

## 4. Scope Control

1. Do not block MVP delivery on missing visual baseline files.
2. Do not mix visual baseline churn with unrelated feature/refactor changes.
3. For Usage/Audit UX changes, prioritize role boundary and low-cognitive readability over pixel-perfect stability.
