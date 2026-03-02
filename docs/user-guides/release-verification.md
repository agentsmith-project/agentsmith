# Release Verification User Guide

## Overview

The Release Verification tool automates testing and validation for releases, providing:

- **Automated Test Execution**: Runs smoke tests, integration tests, and validation checks
- **Structured Reports**: JSON and Markdown reports with test results
- **Failure Classification**: Categorizes failures by type (token/network/backend/assertion/timeout/rate_limit/etc.)
- **Transient Acceptance Signal**: Marks recoverable upstream instability in `summary.upstream_transient`
- **Runtime Release Evidence**: Captures runtime guardrails and `pricing_version` coverage from the real-lane runtime proxy/billing workflow
- **Release Governance Control**: feeds `Release Ops` with gate runs, escalations, incident linkage, and policy enforcement state
- **Troubleshooting Guidance**: Actionable recommendations for fixing issues

## Quality Lanes and Gates

Use a lane-based model to avoid mixing MSW baseline assertions with real-backend runtime checks:

- **Mock lane** (`NEXT_PUBLIC_USE_MSW=true`):
  - `make lane-mock-smoke` (L1)
  - `make lane-mock-full` (L2 = smoke + chromium + visual)
- **Real lane** (manual/controlled env):
  - `make lane-real-smoke` (L3)
  - Playwright integration tests are explicitly tagged `@lane-real` and run via `playwright.config.integration.ts`.

Tagging convention:

- `@lane-real`: tests that require real backend/services.
- Mock lane config excludes `@lane-real` by default.

Local convenience: you can persist `GLM_API_KEY` in `.env.local` (local-only) so real-lane commands do not require repeated inline key input.

Gate levels:

- `make gate-l0`: lint + typecheck + OpenAPI/contract checks
- `make gate-l1`: L0 + mock smoke
- `make gate-l2`: L0 + mock full matrix
- `make gate-l3`: L0 + real-lane smoke
- `make gate-pr`: recommended PR gate (L1)
- `make gate-premerge`: recommended pre-merge gate (L2)
- `make gate-release`: recommended release gate (L0 + L2 + L3)

## Release Ops Linkage

`release:report` no longer only writes report artifacts. It also feeds the release-governance control plane with:

1. `artifacts/release-reports/*.json`
2. `artifacts/release-runs/*.json`
3. `artifacts/release-escalations/*.json`

These artifacts are correlated by `incident_id` so `Release Ops` can show:

1. policy enforcement
2. gate run history
3. escalation ownership and SLA
4. override workflow
5. incident trace and incident summary

Operational guide:

- [Release Governance Control Plane](./release-governance-control-plane.md)

## Running Release Verification

### Basic Usage

Run from command line:

```bash
# Quick verification with dry-run mode (fastest)
npm run release:report -- --dry-run

# Full verification with lane-based release gate (L0 + L2 + L3)
make verify-release

# Generate structured report after verification
npm run release:report -- --name release-$(date +%Y%m%d-%H%M%S)
# Custom output directory
npm run release:report -- --output ./reports

# Named report
npm run release:report -- --name my-release
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--output` | Output directory for reports | `./artifacts/release-reports` |
| `--name` | Report name (without extension) | `release-YYYYMMDD-HHMMSS` |
| `--commit-range` | Git commit range to test | Current HEAD |
| `--dry-run` | Skip actual tests, use mock data | false |
| `--archive` | Create timestamped archive | false |
| `--runtime-evidence` | Reuse an existing runtime evidence JSON artifact | auto-managed |
| `--usage-report-evidence` | Reuse an existing usage report evidence artifact | auto-managed |
| `--governance-evidence` | Reuse an existing governance release evidence artifact | auto-managed |
| `--build-reliability-evidence` | Reuse an existing build reliability evidence artifact | auto-managed |
| `--workspace-governance-evidence` | Reuse an existing workspace governance release evidence artifact | auto-managed |

## CI Execution

Use GitHub Actions workflow **Release Gate** (`.github/workflows/release-gate.yml`) for auditable release runs:

1. Open Actions -> `Release Gate` -> `Run workflow`.
2. Optionally set `report_name`.
3. Workflow runs:
- `make verify-release` (strict lane-based gate)
- `make release-report REPORT_ARCHIVE=1`
4. Download `release-gate-artifacts` for archived reports, logs, and test outputs.

## Usage Report Runner Operations

The usage report scheduler now has an in-process runner inside the node API. This is the execution path that turns active schedules into delivery records and release evidence.

### Startup Flags

Pass these through the API process:

```bash
USAGE_REPORT_RUNNER_ENABLED=true
USAGE_REPORT_RUNNER_INTERVAL_MS=60000
```

`make api-dev` and `make api-dev-min` now forward both variables to `npm run api:node:dev`.

### Operator Endpoints

These internal endpoints require a bearer token:

- `GET /api/v1/internal/usage-report-runner`
- `POST /api/v1/internal/usage-report-runner/run-due`

They return runner status and a single authenticated sweep result across all projects with due schedules.

### Local Operator Commands

These targets use `/tmp/agentsmith_user_token.txt` by default:

```bash
make usage-report-runner-status
make usage-report-run-due
```

If you need a fresh token first:

```bash
make notebook-agent-refresh-token
```

### Release Readiness

Release verification now depends on delivery evidence, not only schedule definitions. If a required schedule is active but has failing or unacknowledged required deliveries, release evidence will surface it in `summary.usage_report_evidence`.

Build reliability also contributes dedicated evidence. `make build-reliability-release-smoke` validates:

1. chat recovery integration
2. notebook external runtime integration
3. realtime / trace / explainability contract tests

When this smoke succeeds, it writes `build-reliability-release-evidence.json`, and `release:report` attaches it as `summary.build_reliability_evidence`.

Workspace governance now contributes dedicated evidence as well. `make workspace-governance-release-smoke` validates:

1. workspace governance overview
2. workspace member administration surface
3. cross-project governance actions
4. workspace explainability panels and drill-down links

When this smoke succeeds, it writes `workspace-governance-release-evidence.json`, and `release:report` attaches it as `summary.workspace_governance_evidence`.

## Report Structure

### JSON Report

Structured machine-readable output:

```json
{
  "metadata": {
    "timestamp": "2026-02-27T10:00:00Z",
    "duration_ms": 14532,
    "environment": {
      "node_version": "v22.12.0",
      "platform": "linux"
    },
    "git": {
      "commit_hash": "abc123...",
      "commit_short": "abc1234",
      "branch": "main",
      "commit_message": "feat: add new feature",
      "author": "Developer Name"
    }
  },
  "execution": {
    "total_checks": 20,
    "passed": 18,
    "failed": 2,
    "checks": [
      {
        "name": "API Health Check",
        "category": "backend",
        "status": "pass",
        "duration_ms": 1234
      },
      {
        "name": "Authentication Test",
        "category": "token",
        "status": "fail",
        "error": "Invalid auth token",
        "duration_ms": 567
      }
    ]
  },
  "summary": {
    "status": "fail",
    "runtime_release_evidence": {
      "source": "artifact",
      "generated_at": "2026-02-28T10:02:00Z",
      "guardrails": {
        "target": "combo:prod-chat",
        "release_readiness": "ready",
        "blockers": [],
        "warnings": ["runtime_guardrail_fallback_connection_unavailable"],
        "planned_attempts": 2
      },
      "pricing_version_coverage": {
        "total_usage_facts": 3,
        "covered_usage_facts": 2,
        "missing_usage_facts": 1,
        "missing_price_facts": 1,
        "coverage_ratio": 0.67
      }
    },
    "usage_report_evidence": {
      "source": "artifact",
      "generated_at": "2026-02-28T10:02:30Z",
      "release_readiness": "ready",
      "blockers": [],
      "warnings": [],
      "active_schedules": 2,
      "required_schedules": 1,
      "successful_deliveries_last_7d": 1,
      "failed_deliveries_last_7d": 0,
      "unacknowledged_required_deliveries": 0
    },
    "failure_categories": [
      {
        "category": "token",
        "count": 1,
        "checks": ["Authentication Test"]
      },
      {
        "category": "backend",
        "count": 1,
        "checks": ["User API"]
      }
    ],
    "upstream_transient": {
      "count": 1,
      "categories": ["rate_limit"],
      "checks": ["Mainline release smoke"],
      "acceptance": "acceptable_with_retry",
      "note": "Only recoverable upstream instability was detected (429/timeout/network). Retry lane can be accepted once rerun succeeds."
    },
    "recommendations": [
      "Refresh auth token",
      "Check backend service status"
    ]
  }
}
```

### Markdown Report

Human-readable summary for release notes:

```markdown
# Release Verification Report

## Summary
**Status**: ❌ FAIL
**Passed**: 18/20 tests

### Runtime Release Evidence
- Guardrails: ready
- Pricing Version Coverage: 67.0% (2/3)
- Missing Price Facts: 1

## Execution Results
| Category | Status | Tests |
|----------|--------|-------|
| Backend | ✅ | 5/5 passed |
| Token | ❌ | 2/3 passed |
| Network | ✅ | 4/4 passed |
| Assertion | ✅ | 7/8 passed |

## Failure Details
### Token Issues
- Authentication Test: Invalid auth token

## Recommendations
1. Refresh auth token before retry
2. Check backend service status
```

## Test Categories

### 1. Token Tests

Validate authentication and authorization:

- **Auth Token Valid**: Token exists and not expired
- **API Authentication**: Can authenticate with backend
- **Permission Checks**: User has required permissions

**Common Failures**:
- Token expired → Refresh token
- Invalid token → Re-authenticate
- Missing permissions → Update role

### 2. Network Tests

Verify connectivity and network operations:

- **API Reachable**: Backend server responds
- **DNS Resolution**: Hostnames resolve correctly
- **Port Connectivity**: Required ports are open
- **Response Time**: API responds within SLA

**Common Failures**:
- Connection refused → Check firewall
- DNS failure → Verify network config
- Timeout → Check backend health

### 3. Backend Tests

Validate backend functionality:

- **Health Check**: Backend health endpoint
- **CRUD Operations**: Create/read/update/delete works
- **Data Validation**: API accepts valid data
- **Error Handling**: Proper error responses

**Common Failures**:
- 500 errors → Check backend logs
- Schema validation → Review API changes
- Data constraints → Verify test data

### 4. Assertion Tests

Test application logic and invariants:

- **Response Format**: API returns expected structure
- **Data Integrity**: Relationships maintained
- **Business Rules**: Core logic validations
- **Edge Cases**: Boundary conditions handled

**Common Failures**:
- Format changed → Update tests
- Logic error → Review code changes
- Missing test coverage → Add tests

## Failure Classification

### By Category

| Category | Description | Common Fix |
|----------|-------------|------------|
| **token** | Auth/permission issues | Refresh token, update permissions |
| **network** | Connectivity problems | Check firewall, DNS, backend status |
| **backend** | API/server errors | Review logs, restart services |
| **assertion** | Test expectation failures | Update tests for new behavior |
| **timeout** | Operation/step timeout | Increase timeout budget or fix slow path |
| **rate_limit** | Upstream/provider throttling (429/retry limit) | Retry with backoff, validate saturation handling |
| **authorization/quota/permission** | Governance policy denial | Verify policy and member permissions |

### Severity Levels

- **Critical**: Blocks release (must fix)
- **High**: Important but workaround exists
- **Medium**: Nice to have fix
- **Low**: Cosmetic or minor issue

### Upstream transient acceptance

Use `summary.upstream_transient.acceptance` from report JSON:

- `acceptable_with_retry`:
  - only transient categories observed (`network/timeout/rate_limit`)
  - rerun succeeds
  - can be accepted for internal release
- `mixed_or_blocking`:
  - transient failures co-exist with non-transient categories
  - treat as blocking until non-transient failures are resolved

## Troubleshooting

### Quick Diagnosis

1. **Check Summary Status**: `pass` or `fail`
2. **Review Failure Categories**: Which type of failures?
3. **Read Recommendations**: Suggested fixes
4. **Check Specific Tests**: See error details

### Common Issues

#### All Tests Failing

- **Cause**: Environment or configuration issue
- **Fix**: Verify env vars, backend running, network access

#### Token Failures Only

- **Cause**: Authentication problem
- **Fix**: Refresh auth token, check login

#### Network Failures Only

- **Cause**: Connectivity issue
- **Fix**: Check backend status, firewall, DNS

#### Single Test Failing

- **Cause**: Code change broke test
- **Fix**: Review code changes, update test if behavior changed

### Getting More Detail

For specific test failures:

1. Open JSON report
2. Find failed test in `execution.checks`
3. Review `error` field for details
4. Check `duration_ms` for timeout issues

## Release Workflow

### Pre-Release Verification

Before tagging a release:

```bash
# Run full verification
make verify-release
npm run release:report -- --name pre-release-check

# Review report
cat artifacts/release-reports/pre-release-check.md
```

### Post-Release Verification

After deploying:

```bash
# Verify deployed version
make verify-release
npm run release:report -- --name post-release-check

# Compare with pre-release
diff artifacts/release-reports/pre-release-check.json artifacts/release-reports/post-release-check.json
```

### Continuous Verification

Automate in CI/CD:

```yaml
# .github/workflows/verify.yml
- name: Run Release Verification
  run: npm run release:report -- --dry-run

- name: Upload Reports
  uses: actions/upload-artifact@v3
  with:
    name: verification-reports
    path: reports/
```

## Best Practices

### Before Running Verification

1. **Ensure Clean State**: Start from known-good configuration
2. **Check Backend Status**: Verify services are running
3. **Update Dependencies**: Ensure latest test framework
4. **Clear Caches**: Remove stale test data

### Interpreting Results

- **Pass with Warnings**: Review but can proceed
- **Single Failure**: Investigate, may be flaky test
- **Multiple Failures**: Likely real issue, fix before release
- **Category Pattern**: Points to specific problem area

### Using Dry-Run Mode

For quick validation without full tests:

```bash
# Fast validation (mock data)
npm run release:report -- --dry-run

# Use when:
# - Testing report format
# - CI pipeline validation
# - Quick smoke check
```

### Archiving Reports

Keep historical records:

```bash
# Create timestamped archive
npm run release:report -- --archive

# Archive naming:
# release-20260227-100000.json
# release-20260227-100000.md
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Release Verification

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
      - run: npm ci
      - name: Run Verification
        run: npm run release:report -- --dry-run
      - name: Upload Reports
        uses: actions/upload-artifact@v3
        with:
          name: verification-report
          path: reports/
```

### GitLab CI Example

```yaml
verify:
  script:
    - npm ci
    - npm run release:report -- --dry-run
  artifacts:
    paths:
      - reports/
    expire_in: 1 week
```

## Permissions

Required to run verification:

- **Local Development**: No special permissions needed
- **CI/CD**: Need `npm` and network access
- **Full Verification**: Auth token for backend access

## Related Features

- [Testing Guide](../../DEVELOPMENT.md#testing) - Unit and E2E tests
- [Release Checklist](../release/internal-release-checklist.md) - Manual release steps
- [Documentation Index](../README.md) - Current active guides and baselines

## FAQ

**Q: How long does verification take?**
A: Dry-run: ~5 seconds; Full verification: 30-90 seconds depending on test count.

**Q: Can I run verification offline?**
A: Use `--dry-run` mode for offline verification with mock data.

**Q: What's the difference between dry-run and full verification?**
A: Dry-run uses mock data for fast validation; full verification runs actual tests against the backend.

**Q: How do I fix a failing test?**
A: Check the report's `recommendations` section, then see the `error` field for the specific test.

**Q: Can I customize the tests run?**
A: Yes, edit the verification script to add/remove checks for your specific needs.

**Q: Are reports version controlled?**
A: Recommended: Add `reports/` to `.gitignore` and archive separately.
