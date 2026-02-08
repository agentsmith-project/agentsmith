# Frontend Verification Summary

**Project:** `mbos-frontend-v1`  
**Last updated:** 2026-02-08

## Current Automated Verification Status

### Latest run (local)

- `npm run test:e2e -- --project=chromium`
- Result: `213 passed`, `1 skipped`, `0 failed`

### Notes

- This is the current best-confidence regression signal for frontend-only MVP quality.
- Route-gate assertions have been aligned with the current naming and filter semantics:
  - sidebar key uses `studio` test id family for AI Studio nav item
  - usage filter label/placeholder uses `Resource ID`

## Manual UAT Script (MVP)

Use this script for business-flow validation before freeze.  
Assumption: backend/edge auth is healthy; focus on frontend behavior, gating, and UX continuity.

### 1) Login and Workspace Bootstrap

1. Open login page and complete quick login.
2. Switch workspace from topbar selector.
3. Confirm projects list loads and row click enters project shell.
4. Confirm no unexpected permission-denied page for valid member.

### 2) Project Navigation and Baseline UX

1. Verify sidebar routes: `Overview`, `Chat`, `AI Studio`, `Sources`, `Agents`, `Endpoints`, `Resource Policy`, `Credentials`, `Members`, `Audit`, `Usage`, `Settings`.
2. Verify topbar workspace/project switchers remain functional after route changes.
3. Verify no hard layout break on wide screen (except immersive pages: Chat/AI Studio).

### 3) Members and Governance

1. Open Members page and validate People/Templates/Groups tabs.
2. Invite member flow: validation, submit success/failure handling.
3. Group flow: create group, select members, apply template, delete group.
4. Ensure status filter does not include unsupported state values.

### 4) Resource and Policy Flows

1. Endpoints: create, edit, toggle, delete.
2. Sources: upload, library switch, manage libraries dialog, selection bar.
3. Agents: create/edit/toggle; external agent key flow and listing.
4. Resource Policy: edit endpoint/source/agent policies, add/remove subject overrides, save, and verify summary updates.

### 5) Usage and Audit

1. Validate filters and table structure are consistent across Audit and Usage.
2. Validate KPI cards render and refresh behavior is stable.
3. Validate text filters and clear behavior.

### 6) Settings and Project Lifecycle

1. Verify General and Runtime Preferences tabs.
2. Save settings and confirm success feedback.
3. Validate project delete confirmation flow and cancellation path.

### 7) Smoke Visual Sanity

1. Open each core page once and check for:
   - broken primary actions
   - major spacing misalignment
   - unreadable contrast
   - permission gate mismatch

## Freeze Readiness Criteria

Frontend can be considered freeze-ready when all conditions hold:

1. `npm run lint` passes.
2. `npx tsc --noEmit` passes.
3. `npm run test:run` passes.
4. `npm run test:e2e -- --project=smoke` passes.
5. `npm run test:e2e -- --project=chromium` passes.
6. Manual UAT script above completed with no P0/P1 defects.

## Related Canonical Docs

- `docs/contracts/frontend-token-interaction-contract.md`
- `docs/contracts/frontend-resource-policy-governance-v1.md`
- `docs/contracts/frontend-backend-gating-matrix.md`
- `docs/contracts/auth-permission-model.md`
