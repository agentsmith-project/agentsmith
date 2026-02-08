# Contracts Index

This directory is the single source of truth for frontend permission and governance contracts.

## Canonical Documents (Read in this order)

1. `frontend-token-interaction-contract.md`
2. `frontend-resource-policy-governance-v1.md`
3. `frontend-backend-gating-matrix.md`
4. `auth-permission-model.md`
5. `route-gate-test-checklist.md`

## Current MVP Contract Baseline

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

## Update Policy

- Update existing canonical docs in place.
- Do not create parallel snapshot versions for active contracts.
- Remove stale or conflicting contract documents instead of keeping both old and new wording.
