# API Guide

Last updated: 2026-03-08  
Status: `current-baseline`

## Purpose

This document is a navigation entry for API consumers.

Authoritative API truth must come from machine-readable contracts:

1. `docs/contracts/specs/openapi.yaml` / `openapi.json`
2. `docs/contracts/specs/asyncapi.yaml` / `asyncapi.json`

This guide does not define independent endpoint semantics.

## Scope Boundary

- AgentSmith MVP focuses on AI frontend usage, agent runtime management, and project-scoped resource policy/limits.
- Any `release` / `gate` naming in repo scripts is engineering workflow terminology, not product DevOps capability.

## How To Use API Contracts

1. Read auth and permission rules in `auth-permission-model.md`.
2. Use OpenAPI for REST route/path/params/error schema.
3. Use AsyncAPI and runtime protocol contracts for stream/websocket semantics.
4. Run contract checks before merge:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

## Key Contract Index

- Auth & Permission: `auth-permission-model.md`
- Frontend Token Interaction: `frontend-token-interaction-contract.md`
- Resource Governance: `frontend-resource-policy-governance-v1.md`
- Endpoint Capabilities: `endpoints-capability-contract.md`
- Endpoint Proxy Bridge: `endpoint-proxy-protocol-bridge-contract.md`
- Notebook/Chat/Files/Projects module maps: see `docs/contracts/README.md`

## Notes for Consumers

- Backend is the only authority for authorization and policy enforcement.
- Frontend permission gates are UX and routing guards, not security substitutes.
- For audit/usage and policy verification, prefer evidence from real-backend smoke outputs.
