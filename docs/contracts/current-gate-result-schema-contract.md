# Current Gate Result Schema Contract

Canonical `result.json` rules:

- Canonical file location is `<evidence_dir>/result.json`.
- Canonical JSON keys use `snake_case` only; `camelCase` aliases are forbidden.
- Writer truth is defined by `gate_id + line_kind`.
- `failure_class` is a gate-level verdict field and must use one of:
  `none`, `product_regression`, `infra_setup_failure`, `environment_conflict`, `contract_drift`, `evidence_missing`.

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
