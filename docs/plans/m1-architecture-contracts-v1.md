# M1: Architecture & Contract Freeze

**Date:** 2026-02-27
**Status:** Final Draft
**Purpose:** Define architecture and API contracts for all epics before development begins

---

## Executive Summary

This document finalizes the architecture designs and API contracts for all 4 epics in the next release:
- **Epic A**: Governance execution consistency
- **Epic B**: Security & compliance (SSE ticket, audit)
- **Epic C**: Operations dashboards & alerts
- **Epic D**: Release engineering

---

## Epic A1: Permission Decision Chain Unification

### Current State
- Permissions stored as string tokens in `Project.members[].permissions[]`
- Client-side checks via `useHasPermission()` hooks
- Resource policy UI exists but backend enforcement is incomplete
- No unified audit trail for authorization decisions

### Target Architecture

#### 1. Unified Authorization Engine (Backend)

**New API Endpoint:**
```http
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/authorize
Authorization: Bearer {jwt}

Request:
{
  "subject": {
    "type": "user" | "group" | "agent",
    "id": string
  },
  "action": string,  // e.g., "endpoint.invoke", "project.delete"
  "resource": {
    "type": "project" | "endpoint" | "source_library" | "agent",
    "id": string
  },
  "context": {
    "end_user_id"?: string,
    "metadata"?: Record<string, unknown>
  }
}

Response:
{
  "allowed": boolean,
  "decision": {
    "source": "permission" | "resource_policy" | "project_default",
    "rule_id"?: string,
    "reason": string
  },
  "matched_policy"?: {
    "id": string,
    "resource_type": string,
    "resource_id": string,
    "access_mode": "allow_all_members" | "allow_list",
    "matched_subject"?: {
      "type": "user" | "group",
      "id": string
    }
  }
}
```

#### 2. Authorization Audit Trail

**New Audit Action Types:**
- `authorization.check` - Permission check request
- `authorization.grant` - Access granted
- `authorization.deny` - Access denied
- `policy.apply` - Resource policy applied

**Enhanced Audit Fields:**
```typescript
interface AuthorizationAuditEvent {
  // Standard audit fields
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  actor_type: 'user' | 'agent' | 'plugin';
  actor_id: string;
  action: 'authorization.check' | 'authorization.grant' | 'authorization.deny' | 'policy.apply';
  request_id: string;
  result: 'ok' | 'error';

  // Authorization-specific fields
  authz_subject: {
    type: 'user' | 'group' | 'agent';
    id: string;
  };
  authz_action: string;
  authz_resource: {
    type: string;
    id: string;
  };
  authz_decision: {
    allowed: boolean;
    source: 'permission' | 'resource_policy' | 'project_default';
    reason: string;
    policy_id?: string;
  };
  end_user_id?: string;
}
```

#### 3. Frontend Changes

**New Hook:** `src/lib/hooks/use-authorization.ts`
```typescript
interface UseAuthorizationOptions {
  resourceType: string;
  resourceId?: string;
  action: string;
  endUserId?: string;
}

interface AuthorizationResult {
  allowed: boolean;
  decision: {
    source: 'permission' | 'resource_policy' | 'project_default';
    reason: string;
    policyId?: string;
  };
  isLoading: boolean;
  error?: Error;
}

export function useAuthorization(options: UseAuthorizationOptions): AuthorizationResult;
```

**Migration Strategy:**
1. Phase 1: New `useAuthorization()` hook runs in parallel with `useHasPermission()`
2. Phase 2: Dual-write audit events from both paths
3. Phase 3: Gradual migration of critical paths to new hook
4. Phase 4: Deprecate `useHasPermission()` for resource-level checks

### Acceptance Criteria
1. ✅ API contract finalized and added to OpenAPI spec
2. ✅ Frontend hook `useAuthorization()` implemented
3. ✅ Authorization audit events written for all checks
4. ✅ Smoke tests cover deny→grant→allow scenarios
5. ✅ Feature flag for gradual rollout

---

## Epic A2: Resource Policy Execution Completion

### Current State
- Resource policy types defined (`ResourcePolicy`, `PolicyRule`)
- Policy UI exists for editing
- Backend API: `GET/PATCH /resources/{resourceType}/{resourceId}/policy`
- **Missing:** Backend policy enforcement, quota/rate limiting verification

### Target Architecture

#### 1. Policy Evaluation Service (Backend)

**Policy Priority Order:**
1. Subject-level policy (user/group override)
2. Resource-level policy (allow-list, rate limits, quotas)
3. Project default (allow_all_members)

**Evaluation Flow:**
```
Request → Extract Subject → Check Resource Policy
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
              Subject Match?          Default Policy
                    ↓                       ↓
              Apply Subject             Apply Default
              Rules                     Rules
                    ↓                       ↓
              Rate Limit Check ←────────────┤
              Quota Check ←─────────────────┤
                    ↓
              Allow/Deny Decision
                    ↓
              Audit Event
```

#### 2. Policy Enforcement Points

**New API Endpoints:**
```http
# Verify quota before operation
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/quota/check
Authorization: Bearer {jwt}

Request:
{
  "subject_id": string,
  "resource_type": "endpoint" | "source_library" | "agent",
  "resource_id": string,
  "operation": "invoke" | "upload" | "create",
  "estimated_cost": number  // Optional: estimated tokens/bytes
}

Response:
{
  "allowed": boolean,
  "quota_remaining": number,
  "quota_limit": number,
  "quota_reset_at": string,  // ISO 8601
  "policy_id": string
}
```

#### 3. Policy Evidence Trail

**New Usage Event Types:**
- `quota.deduct` - Quota consumed
- `quota.exceeded` - Quota limit exceeded (denied)
- `rate_limit.exceeded` - Rate limit exceeded (denied)
- `policy.allow_list.denied` - Not in allow-list

**Enhanced Usage Record:**
```typescript
interface PolicyUsageRecord {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  subject_type: 'user' | 'group' | 'agent';
  subject_id: string;
  resource_type: string;
  resource_id: string;
  event_type: 'quota.deduct' | 'quota.exceeded' | 'rate_limit.exceeded' | 'policy.allow_list.denied';
  quantity: number;  // tokens, bytes, requests
  quota_remaining?: number;
  quota_limit?: number;
  policy_id: string;
  request_id: string;
  metadata_json?: Record<string, unknown>;
}
```

### Acceptance Criteria
1. ✅ Policy evaluation algorithm documented
2. ✅ Quota check API endpoint defined
3. ✅ Policy enforcement audit events defined
4. ✅ Rollback behavior specified and testable
5. ✅ Smoke tests for each policy type (rate, quota, allow-list)

---

## Epic B1: SSE Ticket Migration

### Current State
- SSE uses EventSource API (no custom headers support)
- JWT passed via `?ticket=` query parameter (SECURITY ISSUE)
- Frontend `fetchSSETicket()` function implemented
- **Missing:** Backend `/api/v1/sse-ticket` endpoint

### Target Architecture

#### 1. Ticket Exchange API

**New Endpoint:**
```http
POST /api/v1/sse-ticket
Authorization: Bearer {jwt}

Request:
{
  "workspace_id": string,
  "project_id"?: string,
  "intended_use": "task_events" | "chat_stream" | "other"
}

Response:
{
  "ticket": string,  // Short-lived token (UUID)
  "expires_at": string,  // ISO 8601, ~5 minutes
  "sso_url": string,  // SSE endpoint URL with ticket
  "max_connections": 1  // Single-use enforcement
}
```

**Ticket Format:**
- UUID v4 with expiration timestamp embedded
- Encrypted payload: `{ sub, exp, iat, workspace_id, project_id }`
- Backend validates ticket on SSE connection

#### 2. SSE Connection Flow

**New Flow:**
```
1. Client → POST /api/v1/sse-ticket (with JWT in header)
2. Backend → Validate JWT → Generate ticket (5 min, single-use)
3. Backend → Return { ticket, expires_at, sso_url }
4. Client → new EventSource(sso_url)  // ticket in URL, not JWT
5. Backend → Validate ticket → Establish SSE connection
6. Backend → Invalidate ticket (single-use)
```

**With Fallback (Migration Period):**
```
if (ticket exchange fails) {
  log_warning("SSE ticket endpoint not available, using JWT fallback")
  use_jwt_in_url()  // Existing behavior
}
```

#### 3. Migration Phases

| Phase | Duration | Behavior | Success Criteria |
|-------|----------|----------|-------------------|
| 0 (Current) | - | JWT in URL | Baseline metrics |
| 1 (Dual-stack) | 2 days | Ticket primary, JWT fallback | 95%+ ticket success |
| 2 (Gradual) | 5 days | 10%→30%→60%→100% ticket | Error rate < baseline |
| 3 (Full) | - | Ticket only, fallback disabled | 100% ticket, fallback removed |

#### 4. Monitoring & Metrics

**Metrics to Track:**
- Ticket exchange success rate
- SSE connection success rate
- Time-to-first-byte (TTFB)
- Reconnection rate
- 401/403 error rates
- Fallback activation rate

**Circuit Breaker:**
- If ticket error rate > 5% for 5 minutes → auto-fallback to JWT
- Manual kill switch: `SSE_TICKET_ENABLED=false`

### Acceptance Criteria
1. ✅ Ticket exchange API added to OpenAPI
2. ✅ Frontend migration to ticket flow
3. ✅ Fallback mechanism implemented
4. ✅ Circuit breaker with auto-fallback
5. ✅ Smoke tests pass with 100% ticket coverage
6. ✅ Security scan passes (no JWT query param)

---

## Epic B2: Audit Field Standardization

### Current State
- Audit event type defined with flexible `metadata_json`
- Basic fields: `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`
- Missing structured fields for authorization, policy decisions

### Target Architecture

#### 1. Standardized Audit Event Schema

**Base Event (All Events):**
```typescript
interface BaseAuditEvent {
  // Identity
  id: string;
  timestamp: string;  // ISO 8601, server timezone
  workspace_id: string;
  project_id: string;
  request_id: string;  // For distributed tracing

  // Actor
  actor_type: 'user' | 'agent' | 'plugin' | 'system';
  actor_id: string;
  end_user_id?: string;  // For end-user impersonation

  // Action
  action: string;  // Namespaced: resource.action
  result: 'ok' | 'error';

  // Error (if result=error)
  error_code?: string;
  error_message?: string;
}
```

**Resource Event (CRUD Operations):**
```typescript
interface ResourceAuditEvent extends BaseAuditEvent {
  action: 'project.create' | 'project.update' | 'project.delete' |
           'endpoint.create' | 'endpoint.update' | 'endpoint.delete' |
           'agent.create' | 'agent.update' | 'agent.delete' |
           'source.file.upload' | 'source.file.delete' |
           'member.add' | 'member.update' | 'member.remove';

  resource_type: string;
  resource_id: string;

  // Change tracking
  diff?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    changes: Array<{ field: string; before?: unknown; after?: unknown }>;
  };
}
```

**Authorization Event (Permission/Policy):**
```typescript
interface AuthorizationAuditEvent extends BaseAuditEvent {
  action: 'authorization.check' | 'authorization.grant' | 'authorization.deny' |
           'policy.apply' | 'policy.update';

  authz_subject: {
    type: 'user' | 'group' | 'agent';
    id: string;
  };
  authz_action: string;
  authz_resource: {
    type: string;
    id?: string;
  };
  authz_decision: {
    allowed: boolean;
    source: 'permission' | 'resource_policy' | 'project_default' | 'allow_list';
    reason: string;
    policy_id?: string;
    rule_key?: string;
  };
}
```

**Usage Event (Quota/Rate):**
```typescript
interface UsageAuditEvent extends BaseAuditEvent {
  action: 'quota.deduct' | 'quota.exceeded' | 'rate_limit.exceeded' |
           'endpoint.invoke' | 'agent.run';

  usage_metrics: {
    quantity: number;
    unit: 'tokens' | 'bytes' | 'requests' | 'seconds';
  };
  quota_remaining?: number;
  quota_limit?: number;
  quota_reset_at?: string;
  policy_id?: string;
}
```

#### 2. Export Formats

**CSV Export:**
```csv
id,timestamp,workspace_id,project_id,actor_type,actor_id,action,resource_type,resource_id,result,error_code
audit_123,2026-02-27T10:00:00Z,ws_1,proj_1,user,user_1,endpoint.invoke,endpoint,ep_1,ok,
```

**JSON Export:**
```json
{
  "export_id": "export_123",
  "generated_at": "2026-02-27T10:00:00Z",
  "time_range": {
    "start": "2026-02-01T00:00:00Z",
    "end": "2026-02-27T23:59:59Z"
  },
  "filter": {
    "workspace_id": "ws_1",
    "project_id": "proj_1"
  },
  "events": [...]
}
```

### Acceptance Criteria
1. ✅ Audit event schema finalized
2. ✅ All authorization events include `authz_decision` block
3. ✅ Export API supports CSV and JSON
4. ✅ Governance smoke tests verify audit completeness

---

## Epic D1: Release Report Automation

### Current State
- Comprehensive smoke tests (mainline + governance)
- Contract verification scripts
- Manual release notes
- **Missing:** Automated test result aggregation

### Target Architecture

#### 1. Release Report Schema

**JSON Report Format:**
```json
{
  "$schema": "https://agentsmith.dev/schemas/release-report-v1.json",
  "release_id": "release-2026-02-27-v1.2.0",
  "generated_at": "2026-02-27T15:30:00Z",
  "release_type": "major" | "minor" | "patch",

  "git": {
    "branch": "main",
    "commit_range": {
      "from": "a1b2c3d",
      "to": "e5f6g7h"
    },
    "commits_count": 42,
    "authors": ["dev-1", "dev-2", "dev-3"]
  },

  "environment": {
    "node_version": "v22.12.0",
    "npm_version": "11.2.0",
    "os": "linux",
    "cpu_arch": "x86_64"
  },

  "checks": {
    "contracts": {
      "status": "pass" | "fail" | "skip",
      "duration_ms": 1234,
      "details": {
        "typescript": "pass",
        "openapi_core_coverage": "pass",
        "openapi_breaking": "pass",
        "permission_gates": "pass"
      }
    },
    "smoke_mainline": {
      "status": "pass" | "fail" | "skip",
      "duration_ms": 45678,
      "tests_total": 8,
      "tests_passed": 8,
      "tests_failed": 0,
      "tests_skipped": 0,
      "details": [...]
    },
    "smoke_governance": {
      "status": "pass" | "fail" | "skip",
      "duration_ms": 23456,
      "tests_total": 6,
      "tests_passed": 6,
      "tests_failed": 0,
      "details": [...]
    }
  },

  "overall": {
    "status": "pass" | "fail",
    "total_duration_ms": 70368,
    "checks_total": 3,
    "checks_passed": 3,
    "checks_failed": 0,
    "verdict": "READY_TO_RELEASE" | "NOT_READY"
  },

  "failures": [
    {
      "category": "token" | "network" | "backend" | "assertion",
      "check": "smoke_governance",
      "test": "governance-member-permission-effect-smoke",
      "message": "...",
      "suggestion": "..."
    }
  ],

  "evidence": {
    "log_files": [...],
    "screenshots": [...]
  }
}
```

#### 2. Makefile Targets

```makefile
# Generate release report (JSON)
release-report:
    @node scripts/release/generate-report.js --format json > reports/release-$(shell date +%Y%m%d-%H%M%S).json

# Generate release note (Markdown)
release-note:
    @node scripts/release/generate-note.js > docs/release/internal-release-note-$(shell date +%Y%m%d).md

# Full release verification with report
verify-release-with-report:
    @$(MAKE) release-report && $(MAKE) release-note
```

#### 3. Report Templates

**Markdown Release Note Template:**
```markdown
# Internal Release Note: {Version}

**Date:** {Date}
**Release Type:** {Major|Minor|Patch}
**Commit Range:** {From}...{To}

## Release Summary
{Auto-generated summary}

## What Changed
### Features
{Auto-extracted from commits}

### Fixes
{Auto-extracted from commits}

### Governance
{Auto-extracted from commits}

## Validation Record

### Contract Checks
| Check | Status | Duration |
|-------|--------|----------|
| TypeScript | ✅/❌ | {ms}ms |
| OpenAPI Core | ✅/❌ | {ms}ms |
| OpenAPI Breaking | ✅/❌ | {ms}ms |
| Permission Gates | ✅/❌ | {ms}ms |

### Smoke Tests
| Suite | Passed | Total | Status |
|-------|--------|-------|--------|
| Mainline | {n}/{m} | {m} | ✅/❌ |
| Governance | {n}/{m} | {m} | ✅/❌ |

## Release Readiness
**Status:** {READY_TO_RELEASE | NOT_READY}

## Known Issues
{Auto-populated from failures}

## Recommended Next Step
{Auto-generated recommendation}
```

### Acceptance Criteria
1. ✅ Release report schema finalized
2. ✅ `scripts/release/generate-report.js` implemented
3. ✅ `scripts/release/generate-note.js` implemented
4. ✅ Makefile targets added
5. ✅ Failure classification implemented (token, network, backend, assertion)

---

## Epic D2: Failure Classification & Troubleshooting Manual

### Failure Categories

| Category | Pattern | Suggestion |
|----------|---------|------------|
| **token** | `401 Unauthorized`, `invalid_token`, `expired` | Refresh token via `make notebook-agent-refresh-token` |
| **network** | `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND` | Check `NEXT_PUBLIC_API_BASE`, verify backend running |
| **backend** | `500 Internal Error`, `503 Service Unavailable` | Check backend logs, verify service health |
| **assertion** | `Expected X but got Y`, timeout on element | Update selector, increase timeout, check data-testid |
| **permission** | `403 Forbidden`, `access_denied` | Verify user permissions, check resource policy |
| **quota** | `quota_exceeded`, `rate_limit_exceeded` | Wait for quota reset, request increase |

### Troubleshooting Manual Structure

```markdown
# Troubleshooting Guide

## Quick Diagnosis Flow
1. Check error category from release report
2. Follow category-specific section
3. Verify fix by re-running specific test

## Common Failures

### Token Failures
**Symptoms:** 401 errors, "invalid token" messages
**Diagnosis:** Check token expiration
**Fix:** `make notebook-agent-refresh-token`

### Network Failures
**Symptoms:** ECONNREFUSED, timeout
**Diagnosis:** `curl -v $API_BASE/health`
**Fix:** Start backend service

### Backend Failures
**Symptoms:** 500 errors, service unavailable
**Diagnosis:** Check backend logs
**Fix:** Restart backend, verify dependencies

### Assertion Failures
**Symptoms:** Element not found, value mismatch
**Diagnosis:** Inspect screenshot, check selector
**Fix:** Update test selector, verify data-testid
```

### Acceptance Criteria
1. ✅ Failure classification script implemented
2. ✅ Troubleshooting manual created
3. ✅ Common failure patterns documented
4. ✅ Each failure has actionable suggestion

---

## OpenAPI Contract Updates

The following new endpoints must be added to `docs/contracts/specs/openapi.yaml`:

### Authorization
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/authorize`

### SSE Ticket
- `POST /api/v1/sse-ticket`

### Quota
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/quota/check`

### Audit Export
- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/audit/export`

---

## Sign-Off

**Architecture Approved By:** product-manager
**Date:** 2026-02-27
**Status:** ✅ Ready for Development

**Next Steps:**
1. Assign Epic A to dev-1
2. Assign Epic B to dev-2
3. Assign Epic C to dev-3
4. Assign Epic D to dev-4
