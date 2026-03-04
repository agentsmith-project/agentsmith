# Internal Release Checklist (Mainline + Governance)

Last updated: 2026-02-26

## Scope
- This checklist is for the current internal/controlled release focused on:
  - Files (object-first inputs)
  - Notebook task + external agent (Codex CLI)
  - Execution trace panel
  - Artifacts (including output-to-input loop)
  - Governance pages and effect paths (Audit / Usage / Members / Resource Policy) in real backend mode
- Governance in real backend is release-gated with strict page smoke + policy/member effect smokes.
  - See: `docs/release/internal-release-capability-matrix.md`

## Preconditions
- Keycloak is running (`http://localhost:18080`)
- API dependencies are available (Mongo/MinIO/etc. if your chosen backend mode requires them)
- `GLM_API_KEY` is available for endpoint init

## 1. Demo Environment Bootstrap
### One-command demo bootstrap
```bash
GLM_API_KEY='***' make notebook-agent-demo-up
```

Expected:
- API/Web/runner start or are reused
- Notebook URL is printed
- Health summary is printed (`API/Web/Runner/Token/Agent`)

### Stop demo environment
```bash
make notebook-agent-demo-down
```

## 2. Demo Health / Readiness Checks
### Show current status (non-destructive)
```bash
make notebook-agent-demo-status
```

### Run readiness check (non-destructive)
```bash
make notebook-agent-demo-check
```

What `demo-check` validates:
- token file exists and token is valid
- `/tmp/agentsmith_*` metadata files are present
- endpoint metadata exists on current API instance
- endpoint proxy is reachable
- agent websocket metadata files look sane

### No-sandbox baseline check (required for current MVP deployment model)
```bash
make notebook-agent-no-sandbox-smoke
```

What `notebook-agent-no-sandbox-smoke` validates:
- `demo-check` passes (mainline path healthy)
- internal-agent path fails fast with explicit `AGENT_SANDBOX_NOT_CONFIGURED` when sandbox is not configured

Common remediation:
- Token expired:
```bash
BASE_URL=http://localhost:3001 make notebook-agent-refresh-token
```
- Stale endpoint/agent/project metadata (e.g. API reset / new backend instance):
```bash
GLM_API_KEY='***' make notebook-agent-init-resources
make notebook-agent-demo-restart-runner
```

### Restart runner only (keep API/Web)
```bash
make notebook-agent-demo-restart-runner
```

## 3. Release Smoke (Mainline Validation)
### One-command release smoke (recommended)
```bash
make notebook-agent-release-smoke-full
```

Behavior:
- runs `demo-check`
- if `demo-check` fails, performs one-shot demo self-heal (`api/web/runner/token`) and re-checks readiness
- runs bundled release smoke set

### Upstream instability acceptance rule (internal release)
- Expected transient failures (`429` / provider saturation / network jitter / timeout) are **non-blocking** only when:
  - retry path succeeds in the same lane rerun, and
  - no non-transient product failures remain.
- Non-transient failures (contract/type/assertion/backend logic regressions) are **blocking**.
- Release report must include `summary.upstream_transient` evidence when transient failures are observed.

## 3.1 Governance Release Smoke (Strict Gate)
```bash
make governance-release-smoke
```

Behavior:
- uses strict page gate (`governance-pages-real-backend-smoke-strict`)
- uses strict interaction gate (`governance-pages-real-backend-interaction-smoke-strict`)
- runs governance effect smokes (policy/member/source/agent)
- auto-refreshes token and retries once on token-expiry failures for eligible smoke steps

### Bundled release smoke only
```bash
make notebook-agent-release-smoke
```

Default bundle includes:
- `notebook-agent-smoke-task` (basic notebook external-agent roundtrip)
- `notebook-agent-source-read-mount-smoke` (assert task workspace has `.codex/skills/source-read`)
- `notebook-agent-inputrefs-loop-smoke` (URL input -> artifact -> artifact input loop)

### Optional image/artifact smoke (matplotlib)
```bash
RUN_MATPLOTLIB_SMOKE=1 make notebook-agent-release-smoke
```

### Governance smoke bundle includes
- `governance-pages-real-backend-smoke-strict` (open routes, fail on product error states)
- `governance-pages-real-backend-interaction-smoke-strict` (basic interactions, fail on product error states)
- `governance-policy-access-effect-smoke` (endpoint policy allow-list access deny -> allow + audit/usage evidence)
- `governance-policy-group-access-effect-smoke` (endpoint policy group-subject allow-list effect + audit/usage evidence)
- `governance-policy-effect-smoke` (endpoint policy rate-limit effect + audit/usage evidence)
- `governance-policy-spending-effect-smoke` (endpoint policy spending-limit effect + audit/usage evidence)
- `governance-policy-requests-rate-effect-smoke` (endpoint policy requests/day rate-limit effect + audit/usage evidence)
- `governance-member-permission-effect-smoke` (member permission route authz deny -> allow effect)
- `governance-member-lifecycle-effect-smoke` (member lifecycle active -> suspended -> removed -> restore effect)

## 4. Contract / Quality Gates
### Required checks
```bash
make verify-contracts
```

Equivalent expanded commands:
```bash
npm run ws:typecheck
npm run openapi:check-generated
npm run contracts:check-openapi
```

### High-value targeted tests (recommended)
```bash
npm run test:run -- packages/api-entry-node/src/agent-runtime-contract-sync.test.ts
npm run test:run -- packages/api-entry-node/src/input-ref-runtime-resolver.test.ts
npm run test:run -- src/components/notebook/__tests__/TaskPage.test.tsx
npm run test:run -- src/components/chat/__tests__/Composer.test.tsx
```

## 5. Manual UX Acceptance (Notebook Mainline)
- Open Notebook page from `demo-up` output URL
- Verify:
  - Send message -> input disabled during active run -> re-enabled after completion
  - Trace panel expands and Raw/Timeline works
  - Add Files from file library and see attached inputs
  - Add URL input and task completes
  - Generate artifact and download/view/save works (local backend supports text/data-url fallback)
  - Add artifact as input and run next turn successfully

## 5.1 Manual UX Acceptance (Governance Pages, Real Backend)
- Open `Members`, `Resource Policy`, `Audit`, `Usage` in real backend mode
- Verify:
  - Pages load without mock-only banners for `Audit/Usage`
  - `Members` page lists data and core controls are interactive
  - `Resource Policy` editor opens and save action is available
  - `Audit` filters and table render real data
  - `Usage` KPI and records render real data

## 6. Deployment Constraints (Internal Release)
- Notebook runtime coordination is instance-local in current implementation.
- Deploy with one of:
  - single API instance
  - sticky routing for notebook runtime traffic

If not enforced, behavior may be inconsistent for:
- active-run guard
- SSE replay/history
- task runtime stream behavior

## 7. Known Accepted Risk (Internal Only)
- SSE/EventSource auth currently may use JWT in query (`ticket`) as fallback.
- Accepted for internal/controlled release only.
- Public/external release should implement short-lived ticket exchange (`/sse-ticket`) first.

## 8. Go/No-Go Rule
Release is **GO** (internal/controlled) when all are true:
- `notebook-agent-no-sandbox-smoke` passes (for non-sandbox deployment baseline)
- `demo-up` works and prints healthy status
- `demo-check` passes
- `release-smoke-full` passes
- `governance-release-smoke` passes
- contract/typecheck gates pass
- deployment constraint (single instance or sticky) is confirmed
- SSE risk is explicitly accepted for this release
