# MVP Freeze Checklist

Last updated: 2026-03-05

This checklist is for pre-staging / pre-release freeze when scope is intentionally limited to MVP core paths.

## 1. One-command baseline

Run:

```bash
make mvp-freeze-check
```

This executes:

1. `make verify-contracts`
2. `make release-core-smoke`
3. `make notebook-agent-demo-check`

If any step fails, freeze is blocked.

## 2. Manual demo checklist (must-pass)

After `mvp-freeze-check` passes, manually verify:

1. Login flow works (Keycloak -> workspace -> project).
2. Endpoint path works:
   - provider endpoint creation
   - custom endpoint creation
   - endpoint test request succeeds
3. Chat path works:
   - choose configured endpoint
   - receive stream output
   - force one error case and confirm user-visible error message (no dead waiting)
4. Notebook path works:
   - create task
   - send prompt
   - receive agent output and trace progression
5. Third-party accounts:
   - Feishu bind callback round-trip completes
   - Jira token entry persists and can be read back

## 3. Rollback baseline

Freeze requires recording one rollback baseline:

1. Git commit SHA
2. Image tag(s) used for API/Web/Runner
3. `.env` template version used in deployment
4. Release report artifact path under `artifacts/release-reports/`

If production/staging verification fails, rollback must target this exact baseline.

## 4. Common fail triage

1. Keycloak/session issues:
   - run `make notebook-agent-refresh-token`
   - run `make notebook-agent-demo-check`
2. Agent offline / no response:
   - run `make notebook-agent-demo-status`
   - if needed `make notebook-agent-demo-restart-runner`
3. Endpoint upstream 429/timeout:
   - confirm error is surfaced in UI
   - re-run `make governance-policy-requests-rate-effect-smoke` to separate policy block vs upstream instability

## 5. Scope guard (MVP)

During freeze:

1. no new feature branches
2. no UX redesign outside blocking bug fix
3. no new gate category; only stabilize existing MVP lanes
4. all release decisions based on commands and artifacts above, not ad-hoc manual claims
