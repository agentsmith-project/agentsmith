# Legacy E2E Specs

These specs are kept for scoped regression and historical coverage, but are not part of default MVP release gates.

Current legacy specs:

1. `runtime-console.spec.ts`
2. `alerts.spec.ts`
3. `route-redirect.spec.ts`

Run explicitly when needed:

```bash
npx playwright test --project=chromium e2e/legacy/runtime-console.spec.ts
npx playwright test --project=chromium e2e/legacy/alerts.spec.ts
npx playwright test --project=chromium e2e/legacy/route-redirect.spec.ts
```
