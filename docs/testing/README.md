# Testing Docs Index

This directory holds current testing policy, evidence rules, and verification guidance.

Current entries:
- [diagnostic-catalog-v1](./diagnostic-catalog-v1.md)
  - entry path selector for `ui_only`, `local_manual`, and `release_grade`
  - explains which focused commands to run before an expensive gate
  - makes clear that diagnostics do not replace verdicts
- [verification-campaigns-v1](./verification-campaigns-v1.md)
  - release-grade automated verification campaign guidance
  - human entrypoints are `npm run product:ready` and read-only `npm run product:status`; `npm run release:ready` / `npm run release:status` stay deprecated transition aliases
  - internal adapter `release:campaign:full` stays behind the product readiness entrypoint after precheck
  - explains diagnostic path vs verdict path
  - explains evidence completeness, story truth, and visual admission rules
- [visual-baseline-policy-v1](./visual-baseline-policy-v1.md)
  - current visual evidence ownership and baseline policy
- [story-source-of-truth-and-generated-specs](./story-source-of-truth-and-generated-specs.md)
  - explains canonical story markdown vs generated specs and trace bindings
- [2026-02-05-前端-testid-规范](./2026-02-05-前端-testid-规范.md)

Recommended reading order:
1. [diagnostic-catalog-v1](./diagnostic-catalog-v1.md)
2. [verification-campaigns-v1](./verification-campaigns-v1.md)
3. [visual-baseline-policy-v1](./visual-baseline-policy-v1.md)
4. [story-source-of-truth-and-generated-specs](./story-source-of-truth-and-generated-specs.md)
