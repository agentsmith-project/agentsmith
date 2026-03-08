# MVP Core Smoke Runbook

Last updated: 2026-03-04

## Purpose

Provide a single operational path to validate MVP core readiness on real backend:

- No-sandbox deployment baseline (sandbox optional; internal path fail-fast)
- Keycloak login and workspace/project entry
- Endpoint protocol bridge chat streaming (`openai_compatible` / `anthropic_compatible`)
- Chat stream error surfacing and recovery
- Endpoint rate/spending policy effect

## Prerequisites

- Docker deps available (`postgres/redis/mongo/minio/keycloak`)
- Node dependencies installed
- Default ports:
  - API: `20000`
  - Web: `3001`
- Keycloak client configured for `http://localhost:3001/*` callback

Default test user:

- `dev-admin / dev-admin-123`

## Fast Path (services already running)

```bash
make notebook-agent-no-sandbox-smoke
make e2e-int-core-local-api
make governance-policy-requests-rate-effect-smoke
make release-report REPORT_ARCHIVE=1
```

## One-command Release Baseline

```bash
make release-core-smoke
```

This runs:

1. `e2e-int-core-local-api`
2. `governance-policy-requests-rate-effect-smoke`
3. `release-report REPORT_ARCHIVE=1`

## Auto Bootstrap Path

If API/Web are not running:

```bash
make e2e-int-core-auto PORT_API=20000 PORT_WEB=3001
```

## Evidence Outputs

- Release report:
  - `artifacts/release-reports/` latest markdown/json outputs
- Integration logs:
  - `/tmp/agentsmith-api-node-integration.log`
  - `/tmp/agentsmith-web-integration.log`

## Failure Triage

1. Login failure (`/login/callback` loop)
- Validate Keycloak redirect URI and web origins
- Re-run `make notebook-agent-refresh-token`

2. Chat no response
- Verify selected endpoint protocol and base URL
- Re-run `make e2e-int-core-local-api`

3. Policy rate/spending limits not taking effect
- Re-run `make governance-policy-requests-rate-effect-smoke`
- Check audit/usage evidence for deny/rate-limit records
