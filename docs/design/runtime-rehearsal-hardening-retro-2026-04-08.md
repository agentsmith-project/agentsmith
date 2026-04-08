# Runtime / Rehearsal Hardening Retro (2026-04-08)

Status: `completed`  
Scope: backend-real, demo rehearsal, cluster rehearsal, runtime address truth, release bundle stability

## Summary

This retro records the issues discovered during one clean-room validation pass:

1. reset local AgentSmith resources
2. rebuild substrate from zero
3. rerun engineering gates
4. rerun backend-real
5. rerun demo rehearsal
6. rerun cluster rehearsal

The goal was not to introduce a new workflow. The goal was to prove that the current workflow can be rebuilt and rerun from zero without hidden local assumptions.

## Final outcome

The following paths completed successfully in one continuous validation cycle:

- engineering gates: lint, typecheck, contracts, OpenAPI, unit, integration, mock lane, visual lane
- `backend-real`: `bootstrap -> ready -> run -> report`
- `demo-rehearsal`: `up -> bootstrap -> verify -> report`
- `cluster-rehearsal`: `up -> bootstrap -> verify -> report`

## Incident 1: file-library real gate still used stale localhost defaults

### Symptom

`file-library` real verification failed even though the backend-real stack was healthy.

### Root cause

The real gate path still hard-coded old localhost defaults for Keycloak and file-library dependencies instead of consuming the backend-real address truth.

### Fix

Move the file-library real gate scripts back onto the shared runtime helper and backend-real env loading path.

### Prevention

- keep runtime address truth centralized in `scripts/lib/runtime-verification.sh`
- do not let real-gate helpers define a second set of localhost ports

## Incident 2: sandbox host port drift between internal/demo flows and local rehearsal config

### Symptom

The local kind-backed sandbox path was unstable on this machine when the host port was `29080`.
Later, `demo-rehearsal-up` stalled because the active demo site config still pointed at `29080` while the working nodeport path had already moved to `29180`.

### Root cause

The sandbox host port truth had changed in the runtime/deploy line, but the tracked demo site template and the active rehearsal config were not fully aligned.

### Fix

- standardize the working local sandbox host port to `29180`
- update the demo site template
- keep rendered-env checks asserting the expected port in the tracked site env

### Prevention

- treat tracked site templates as part of release truth, not operator-only notes
- fail rendered-env checks when the tracked template drifts from the current local sandbox contract

## Incident 3: cluster rehearsal active config still carried legacy endpoint protocol values

### Symptom

`cluster-rehearsal-up` failed fast with:

- `unsupported legacy endpoint protocol: anthropic_compatible`

### Root cause

The active cluster rehearsal site config under `artifacts/runtime/scenario/cluster-rehearsal/config/site.env` still carried legacy protocol names even though current endpoint truth is canonical `upstream_protocol` values.

### Fix

- replace legacy protocol values with canonical values
- add rehearsal-side site env validation so the scenario fails before deploy work starts

Canonical values:

- `anthropic_messages`
- `openai_chat_completions`
- `openai_responses`

### Prevention

Rehearsal scenario setup must reject legacy endpoint protocol values before bundle build or deploy begins.

## Incident 4: cluster bundle copied mutable Rust build outputs

### Symptom

`cluster-rehearsal-up` failed while creating the final source snapshot tarball with errors like:

- `File removed before we read it`
- `file changed as we read it`

### Root cause

`scripts/cluster-deploy/build-bundle.sh` copied `../llm-universal-proxy` as a source tree but did not exclude Rust `target/`. During local compilation, that directory was still changing while tar was reading it.

### Fix

Update cluster bundle source copying to exclude `target/`.

### Why this is correct

The cluster bundle already carries the actual deployable outputs as image archives under `images/`. The source snapshot is for audit/debug context, not for transporting local compiler caches.

### Prevention

`cluster-deploy/check-bundle-inputs.sh` now asserts that bundle source copying excludes `target/`.

## What changed structurally

The validation run confirmed these current boundaries:

- runtime address truth belongs to the shared runtime helper
- release bundles carry source snapshots plus image archives, not mutable local build caches
- rehearsal site config must use canonical endpoint protocol values
- demo and cluster rehearsal must be treated as first-class engineering gates, not best-effort local habits

## Follow-up policy

When a future rehearsal or backend-real failure appears, debug in this order:

1. inspect rendered env and active site config
2. inspect runtime evidence (`runtime.json`, `resolved-env.json`, `preflight.json`, `failure-classification.json`)
3. inspect runner/container health
4. only then patch code or deploy logic

This keeps runtime truth, release truth, and scenario evidence aligned.
