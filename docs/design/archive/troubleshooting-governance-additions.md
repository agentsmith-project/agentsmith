# Troubleshooting Guide - Governance & Authorization Additions

## Authorization-Specific Troubleshooting (Epic A Integration)

The following additions enhance the troubleshooting guide with governance-specific patterns from Epic A.

### New Section: Authorization Issues (Enhanced)

Add after "Permission Issues" section:

---

## Authorization & Governance Issues (Enhanced)

### Symptoms
- `access denied`
- `not authorized`
- `insufficient permissions`
- `role required`
- `Permission denied by policy`
- `Subject not in allow list`

### Root Causes (Epic A Patterns)

1. **Missing permission** - User lacks specific permission point
2. **Template downgrade** - Role changed from admin to user
3. **Resource policy deny** - Resource policy blocks access
4. **Group membership** - Not in allowed group
5. **Quota exceeded** - Usage limit reached
6. **Rate limited** - Too many requests

### Enhanced Troubleshooting Steps

#### Step 1: Use Unified Authorization Explain (Epic A1)

The `explainPermissionDecision()` API can tell you WHY access was denied:

```bash
# Check permission explanation via API
curl -X POST http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/authorize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permission": "project:member:manage",
    "resource_context": {
      "workspace_id": "ws-1",
      "project_id": "proj-1"
    }
  }'
```

Response includes:
```json
{
  "granted": false,
  "source": {
    "type": "custom",
    "description": "Granted from custom permissions"
  },
  "denial_reason": "Permission 'project:member:manage' is not granted to this member"
}
```

#### Step 2: Check Member Permissions

```typescript
// In browser console (when logged in):
// Check current user's permissions
const auth = JSON.parse(localStorage.getItem('agentsmith-auth') || '{}');
console.log('User:', auth.user);
console.log('Permissions:', auth.currentProject?.permissions);
```

Or via API:
```bash
curl -X GET http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/members/user-1/permissions \
  -H "Authorization: Bearer $TOKEN"
```

#### Step 3: Check Resource Policy (Epic A2)

```bash
# Check endpoint policy
curl -X GET http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/resources/endpoint/ep-1/policy \
  -H "Authorization: Bearer $TOKEN"
```

Look for:
- `access_mode: "allow_all_members"` vs `"allow_list"`
- `allowed_subjects` - Is your user/group listed?
- `rate_limits` - Are you rate limited?
- `quota_limits` - Have you exceeded quota?

#### Step 4: Verify Permission Change Propagation

After permissions change, they should take effect within 1 request cycle:

```bash
# Get permissions with version
curl -X GET http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/members/user-1/permissions \
  -H "Authorization: Bearer $TOKEN" | jq '.version'
```

If version doesn't update after permission change, cache may be stale.

#### Step 5: Check Audit Trail for Authorization

```bash
# Query audit events for authorization decisions
curl -X GET "http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/audit?start_time=2026-02-27T00:00:00Z&end_time=2026-02-27T23:59:59Z&action=authz.check" \
  -H "Authorization: Bearer $TOKEN"
```

### Authorization Error Patterns (for Failure Classifier)

Add to `FAILURE_PATTERNS` in `scripts/release/failure-classifier.ts`:

```typescript
// Authorization failure patterns
const AUTHZ_PATTERNS = [
  // Permission denied
  { pattern: /permission.*denied/i, category: 'authorization' as FailureCategory },
  { pattern: /access.*denied/i, category: 'authorization' as FailureCategory },
  { pattern: /not.*authorized/i, category: 'authorization' as FailureCategory },
  { pattern: /insufficient.*permissions/i, category: 'authorization' as FailureCategory },

  // Resource policy
  { pattern: /quota.*exceeded/i, category: 'quota' as FailureCategory },
  { pattern: /rate.*limit.*exceeded/i, category: 'rate_limit' as FailureCategory },
  { pattern: /subject.*not.*allowed/i, category: 'authorization' as FailureCategory },

  // Template/role
  { pattern: /role.*required/i, category: 'authorization' as FailureCategory },
  { pattern: /group.*required/i, category: 'authorization' as FailureCategory },
];
```

### Evidence Chain Verification

To verify the complete evidence chain for authorization:

```bash
# 1. Check authorization decision
curl -X POST http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/authorize \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"permission": "project:endpoint:use"}' | jq '.audit_id'

# 2. Check audit event was created
AUDIT_ID="<from-above>"
curl -X GET "http://localhost:20000/api/v1/audit/$AUDIT_ID" \
  -H "Authorization: Bearer $TOKEN"

# 3. Check policy evaluation (if applicable)
curl -X POST http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/policy/evaluate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "resource_type": "endpoint",
    "resource_id": "ep-1",
    "subject_id": "user-1",
    "subject_type": "user",
    "action": "use"
  }' | jq '.usage_record_id'
```

### Governance-Specific Prevention

1. **Use permission explain API** - Get detailed denial reasons
2. **Check policy version** - Verify you're using the latest policy
3. **Monitor quota/rate limits** - Set alerts before hitting limits
4. **Review audit trail** - Understand what changed when access broke
