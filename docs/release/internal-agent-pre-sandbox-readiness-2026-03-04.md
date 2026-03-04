# Internal Agent Pre-Sandbox Readiness Report (2026-03-04)

## Scope

This report captures AgentSmith-side readiness before joint integration with sandbox manager.

## What Was Verified

1. Runtime flow hardening was delivered:
   - runner `WORKSPACE_PATH` cwd support
   - runner filesystem session resume detection
   - notebook internal branch preflight simplification
   - chat internal keepalive timer + cleanup
2. UI + UX updates were delivered:
   - agent create/edit endpoint selection dropdown
   - internal env editing in edit dialog
   - notebook cold-start hint (`sandbox_starting`)
   - agents page presence labeling (`running/managed/online/offline`)
3. Regression coverage was expanded:
   - agent dialogs tests
   - notebook conversation panel cold-start hint test
   - agents page internal presence test
   - backend keepalive timer behavior test (chat internal stream path)

## Evidence Collected

## Environment

- API: `http://localhost:20000`
- Web: `http://localhost:3001`
- Date of verification: **2026-03-04**

## Demo / Smoke

- `make notebook-agent-demo-up` passed (after providing `GLM_API_KEY`)
- `make notebook-agent-demo-check` passed
- `make notebook-agent-smoke-task` passed
- `make e2e-int-agent-local-api` passed (`6/6`)

## Gates

- `npx tsc --noEmit` passed
- `npm run lint` passed
- Targeted UI tests passed
- Targeted backend tests passed

## Release Smoke Archive

- Command: `make release-core-smoke`
- Result: PASS
- Generated artifacts:
  - `artifacts/release-reports/report-20260304-133945.json`
  - `artifacts/release-reports/report-20260304-133945.md`
  - `artifacts/release-runs/report-20260304-133945.json`
  - `artifacts/release-escalations/report-20260304-133945.json`
  - `artifacts/release-reports/report-20260304-133956.json` (archive copy)

## Known Blocker (Expected, Non-AgentSmith)

- Internal agent end-to-end cannot run yet in this environment because sandbox manager is not configured.
- Current response is fail-fast and expected:
  - `AGENT_SANDBOX_NOT_CONFIGURED`
- Required integration config:
  - `SANDBOX_MANAGER_URL`
  - `SANDBOX_SERVICE_KEY`

## Readiness Decision

- AgentSmith side is **ready for sandbox joint integration**.
- Remaining risk is integration-environment completeness, not local product behavior.

## Recommended Next Trigger

Start joint integration once sandbox service is available, then execute the checklist in:

- `docs/plans/internal-agent-sandbox-joint-dev-checklist.md`
