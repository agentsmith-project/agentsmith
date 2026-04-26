# Current Gate Result Schema Contract

Canonical `result.json` rules:

- This contract applies only to gate/lane pairs currently registered in `scripts/governance/current-gate-result-schema.ts`.
- Canonical file location is `<evidence_dir>/result.json`.
- Canonical JSON keys use `snake_case` only; `camelCase` aliases are forbidden.
- Writer truth is defined by `gate_id + line_kind`.
- A campaign is not a writer identity. Internal adapter `release:campaign:full` is not a writer identity; it may orchestrate multiple gate/lane results, but each canonical writer still belongs to a registered gate/lane pair.
- Internal verifier `gate:release:full` is an aggregate-only terminal verifier for an explicit campaign context. It does not create or replace the evidence owners' native canonical `result.json` files.
- Internal verifier `gate:release:full` must validate campaign wrapper results and native results with the same canonical traceability fields: `schema_version`, `gate_id`, `line_kind`, `gate_adapter.npm_script`, `evidence_dir`, and enum-safe `failure_class`.
- `gate_adapter.ci_job` is a traceability field, not a writer identity. Writers must resolve it in this order: explicit `CURRENT_GATE_RESULT_CI_JOB`; manifest `ciJob`; GitHub Actions `GITHUB_JOB`; campaign step fallback as `campaign:<step-id>` when `CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID` is present and no job was resolved earlier; deterministic local fallback `local`.
- Campaign launchers that already know the step id should prefer `CURRENT_GATE_RESULT_CI_JOB=campaign:<step-id>` before invoking a native gate writer. `CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID=<step-id>` is only the safe fallback for writers without a manifest/GitHub job. This keeps native result files traceable to the campaign step without changing `gate_id + line_kind` writer truth.
- Internal verifier `gate:release:full` must recompute required evidence from the current verification campaign manifest instead of trusting stale or incomplete `evidence.json.required_paths`.
- For registered writers, `status` and evidence completeness are same-level verdict conditions. If the command exits successfully but the canonical `result.json` is missing from the evidence root, the canonical verdict is still failure.
- `failure_class` is a gate-level verdict field and must use one of:
  `none`, `product_regression`, `infra_setup_failure`, `environment_conflict`, `contract_drift`, `evidence_missing`.
- `failure_class` is only the canonical gate-verdict taxonomy in `result.json`; it does not define local troubleshooting categories, incident labels, or ad-hoc diagnosis tags.
- When a registered writer fails to emit the required `result.json`, the canonical verdict must use `failure_class: evidence_missing` instead of silently reporting `none`.

Canonical sample:

```json
{
  "schema_version": "1.0.0",
  "gate_id": "lane-backend-real-core",
  "gate_adapter": {
    "npm_script": "lane:backend-real:core",
    "ci_job": "lane-backend-real-core"
  },
  "status": "passed",
  "failure_class": "none",
  "stage": "backend_real",
  "line_kind": "backend_real",
  "evidence_dir": "artifacts/backend-real/runs/<run-id>/integration",
  "summary": "Gate lane-backend-real-core passed during backend_real.",
  "generated_at": "2026-04-14T00:00:00.000Z"
}
```
