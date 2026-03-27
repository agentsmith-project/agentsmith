# MVP Core Smoke Runbook

Last updated: 2026-03-04

## Purpose

Provide a single operational path to validate MVP core readiness on real backend:

- No-sandbox deployment baseline (sandbox optional; internal path fail-fast)
- Keycloak login and workspace/project entry
- Endpoint protocol bridge chat streaming (`openai_compatible` / `anthropic_compatible`)
- Chat stream error surfacing and recovery
- Endpoint rate/spending policy effect

Note:

- Current command names use `engineering-*` / `governance-*` naming consistently.
- In current MVP, these commands are used only for focused engineering validation and evidence generation, not for DevOps orchestration.

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
make governance-report REPORT_ARCHIVE=1
```

## One-command Smoke Path

```bash
make engineering-core-smoke
```

This runs:

1. `e2e-int-core-local-api`
2. `governance-policy-requests-rate-effect-smoke`
3. `governance-report REPORT_ARCHIVE=1`

## Auto Bootstrap Path

If API/Web are not running:

```bash
make e2e-int-core-auto PORT_API=20000 PORT_WEB=3001
```

## Evidence Outputs

- Smoke artifacts (command name kept for compatibility):
  - `artifacts/governance-reports/` latest markdown/json outputs
- Integration logs:
  - `artifacts/backend-real/current/integration/api.log`
  - `artifacts/backend-real/current/integration/web.log`

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


## Config Audit Smoke

```bash
make governance-config-audit-effect-smoke
```

This smoke verifies that project configuration changes appear in `Audit` with both success and failure outcomes:

1. `credential.create`
2. `endpoint.create`
3. failed `endpoint.create` (`ENDPOINT_MODEL_CONFLICT`)
4. `endpoint.update`
