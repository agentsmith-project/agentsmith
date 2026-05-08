# Current Governance Observability Contract

Current truth source: `scripts/governance/current-governance-observability-manifest.ts`.

This contract registers P0 observability and diagnostics objects that explain current runs without becoming a second gate result system.

## Registered Objects

- `status_projection_schema`: read-only status projection. It may point to aggregate status and stage diagnostics, but it must not produce `release_verdict` or `automated_release_verdict`; terminal summaries rendered through `release:status` and `make local-real-status` must stay inside the redaction boundary.
- `run_diagnostics_artifacts`: diagnostic audit artifact family for `stage-events.jsonl`, `performance.json`, and `skip-decisions.ndjson`. These artifacts do not participate in evidence completeness.
- `sentinel_preflight`: fail-fast preflight diagnostic. Its output is redacted diagnostic context, not a canonical result.
- `lease_status_shadow`: read-only shadow for active run, destructive command, port family, and secret profile state. It does not acquire or release leases.
- `redaction_boundary`: safe output boundary for diagnostics and failure bundles. Runtime output is limited to `presence`, `profile_digest`, `public_endpoint`, and `port_family`.

## Non-Verdict Boundary

These objects are current truth for observability only:

- They must not write canonical `result.json`.
- They must not produce release verdicts.
- They must not satisfy evidence completeness.
- They must not carry evidence claim truth.
- Stage diagnostics must use `diagnostic_reason_code` or `stage_failure_reason`, not `failure_class`.

## Forbidden Fields

`run_diagnostics_artifacts` must reject verdict/evidence-truth fields:

- `passed`
- `reusable`
- `verdict`
- `claim_id`
- `failure_class`
- `result_status`

`status_projection_schema` must reject release truth fields:

- `release_verdict`
- `automated_release_verdict`

It must also keep `redaction_required=true` because projection summaries can include terminal aggregate text.

Skip invalidation metadata may carry `target`, `operation`, `input_digest`, `existing_artifact_digest`, `skip_reason`, and `validator` only. It must not carry verdict, claim, reusable, or result-status fields.

Secret-bearing diagnostics must not output raw token, ticket, API key, OAuth token, password, cookie, client secret, or managed credential values.

## Contract Check

Run `npm run contracts:check-current-governance-observability` to verify the manifest, schema alignment, safe output boundary, docs index, and `contracts:check` integration.
