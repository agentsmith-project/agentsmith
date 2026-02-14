# Contracts Index

This directory contains only current-state documents: functional contracts, architecture boundaries, and governance rules.

## Core Architecture and Governance

1. `cf-private-hybrid-architecture-guide-v1.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `auth-permission-model.md`
6. `route-gate-test-checklist.md`
7. `product-terminology.md`

## Module Contracts

- `chat-frontend-module-map.md`
- `endpoints-frontend-module-map.md`
- `endpoints-capability-contract.md`
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

## Validation Commands

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
