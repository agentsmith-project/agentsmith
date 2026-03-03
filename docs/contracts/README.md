# Contracts Index

This directory contains only current-state documents: functional contracts, architecture boundaries, and governance rules.

## API Documentation

1. **[API_GUIDE.md](API_GUIDE.md)** - Developer guide for MBOS REST API
   - Authentication & authorization
   - API endpoints by module
   - Error codes & response formats
   - Rate limiting & SSE events

## Core Architecture and Governance

1. `cf-private-hybrid-architecture-guide-v1.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `auth-permission-model.md`
6. `route-gate-test-checklist.md`
7. `product-terminology.md`
8. `workspace-governance-backend-contract.md` (workspace governance persistence API for backend)

## Module Contracts

- `chat-frontend-module-map.md`
- `endpoints-frontend-module-map.md`
- `endpoints-capability-contract.md`
- `endpoint-proxy-protocol-bridge-contract.md`
- `models-catalog-offline.md`
- `files-frontend-module-map.md` (Files module contract)
- `files-object-browser-contract.md` (Files object browser backend contract)
- `resource-policy-frontend-module-map.md`
- `projects-frontend-module-map.md`
- `notebook-frontend-module-map.md` (Notebook module contract)
- `api-entry-node-module-map.md`
- `agent-runtime-protocol.md`

## Machine-Readable Specs

- `specs/openapi.json` / `specs/openapi.yaml` - HTTP API contract
- `specs/asyncapi.json` / `specs/asyncapi.yaml` - External agent runtime WS protocol
- `specs/notebook-traces.openapi.json` / `specs/notebook-traces.openapi.yaml` - notebook execution trace route supplement snapshot (reference; now merged into `specs/openapi.*`)
- `specs/agent-runtime-ws-supplement.asyncapi.json` / `specs/agent-runtime-ws-supplement.asyncapi.yaml` - additive WS frame supplement snapshot (reference; now merged into `specs/asyncapi.*`)

Note:
- `specs/openapi.*` and `specs/asyncapi.*` now include notebook trace API and external-agent runtime notebook extensions, including `agent.response.event`, `agent.response.artifact`, and notebook `runtime_context` fields (for example `notebook_mode`, `task_inputs`, `api_base`).
- Supplement specs are retained as change-isolated reference snapshots and should not diverge from the canonical main specs.
- Internal observability endpoints (for example `/api/v1/internal/notebook-runtime-metrics` and `/prometheus`) are auth-protected operational interfaces and are documented in runbooks; they are not currently part of the public OpenAPI contract unless explicitly added.

## Validation Commands

Before merge / pre-release: run `npm run contracts:check` (permission gates, route tests) and `npm run contracts:check-openapi` (core, route-kind, breaking); ensure OpenAPI-generated types are in sync (`npm run openapi:check-generated`).

- `npm run contracts:check` — permission gates and route test coverage
- `npm run contracts:check-openapi-core`
- `npm run contracts:check-openapi-route-kinds`
- `npm run contracts:check-openapi-breaking`
- `npm run contracts:check-openapi`
- `npm run openapi:generate`
- `npm run openapi:check-generated`
- `npm run openapi:changelog`

`contracts:check-openapi-breaking` runs in strict mode on CI (fails if `origin/main` baseline is unavailable).

Route-kind mapping source: `specs/openapi-route-kind-map.json`.
OpenAPI diff changelog output: `specs/CHANGELOG.md`.

## Contract Maintenance Rules

- Keep documents normative and current-state only.
- Merge updates into canonical files; do not keep temporary/process snapshots.
- Remove stale or conflicting wording immediately.
