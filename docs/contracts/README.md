# Contracts Index

This directory is the single source of truth for frontend permission and governance contracts.

## Canonical Documents (Read in this order)

1. `cf-private-hybrid-architecture-guide-v1.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `auth-permission-model.md`
6. `route-gate-test-checklist.md`

## Current MVP Contract Baseline

- Dual-deploy architecture is contract-first: Cloudflare trial path + private deployment path share the same domain/application semantics.
- Runtime authorization is token-only.
- Role/group names are governance template labels, not runtime gate inputs.
- Chat and AI Studio are access-only gated modules.
- Resource usage control is defined by resource policy (defaults + resource override + subject override).
- Active resource types: `endpoint`, `source_library`, `agent`.

## Operational References

- `../../DEVELOPMENT.md`
  - Playwright runbook and gate-hook safety rule.
  - Manual UAT flow and freeze-ready criteria.
- `../../docs/verification-summary.md`
  - Latest automated verification status and business-flow UAT script.
- `chat-frontend-module-map.md`
  - Chat page module boundaries and growth guardrails.
- `chat-manual-acceptance-checklist.md`
  - Manual release gate checklist for chat UX/runtime changes.
- `endpoints-frontend-module-map.md`
  - Endpoints page closeout baseline and target decomposition map.
- `resource-policy-frontend-module-map.md`
  - Resource Policy page module boundaries and helper ownership.
- `projects-frontend-module-map.md`
  - Projects page module boundaries and reusable view ownership.

## Update Policy

- Update existing canonical docs in place.
- Do not create parallel snapshot versions for active contracts.
- Remove stale or conflicting contract documents instead of keeping both old and new wording.
