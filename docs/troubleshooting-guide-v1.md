# AgentSmith Troubleshooting Guide v1

**Last Updated:** 2026-02-27
**Maintained by:** dev-4 (Release Engineering)
**Related:** Epic D2 - Failure Classification & Troubleshooting Manual

---

## Quick Reference

| Error Type | Quick Fix | Command |
|------------|-----------|---------|
| Token expired | Refresh token | `make notebook-agent-refresh-token` |
| Connection refused | Check services | `make notebook-agent-demo-status` |
| 500 Backend error | Check logs | `tail -100 /tmp/agentsmith_demo_api.log` |
| Test timeout | Increase timeout | Edit playwright.config.ts |
| Permission denied | Check roles | Members page in UI |

---

## Table of Contents

1. [Token Issues](#token-issues)
2. [Network Issues](#network-issues)
3. [Backend Issues](#backend-issues)
4. [Assertion Failures](#assertion-failures)
5. [Timeout Issues](#timeout-issues)
6. [Permission Issues](#permission-issues)
7. [Unknown Errors](#unknown-errors)
8. [Debugging Workflow](#debugging-workflow)

---

## Token Issues

### Symptoms
- `401 Unauthorized`
- `403 Forbidden`
- `jwt expired`
- `authentication failed`
- `invalid_token`

### Root Causes
1. **Token expired** - JWT tokens expire after 1 hour
2. **Invalid credentials** - Wrong username/password
3. **Keycloak down** - Authentication service unavailable
4. **Wrong realm/client** - Mismatched Keycloak configuration

### Troubleshooting Steps

#### Step 1: Refresh Token
```bash
make notebook-agent-refresh-token
```

Expected output:
```
[make] refreshing token...
Token refreshed successfully.
```

#### Step 2: Check Keycloak Status
```bash
make notebook-agent-demo-status
```

Look for:
```
[keycloak] Running - http://localhost:18080
```

#### Step 3: Verify Token File
```bash
cat /tmp/agentsmith_user_token.txt
```

Should contain a valid JWT (starts with `eyJ`).

#### Step 4: Check Environment Variables
```bash
echo $KEYCLOAK_URL
echo $KEYCLOAK_REALM
echo $KEYCLOAK_CLIENT_ID
```

Expected values:
- `http://localhost:18080/realms`
- `mbos`
- `agentsmith`

#### Step 5: Re-initialize Keycloak Users (if needed)
```bash
npm run integration:deps:init:keycloak
```

### Prevention
- Refresh token before running long test suites
- Use `make notebook-agent-release-smoke-full` which auto-refreshes

---

## Network Issues

### Symptoms
- `ECONNREFUSED`
- `ETIMEDOUT`
- `ENOTFOUND`
- `socket hang up`
- `Network unreachable`

### Root Causes
1. **Service not running** - API/Web not started
2. **Wrong port** - Connecting to wrong port
3. **Firewall blocking** - Port blocked by firewall
4. **Proxy interference** - HTTP proxy causing issues

### Troubleshooting Steps

#### Step 1: Check Service Status
```bash
make notebook-agent-demo-status
```

All services should show "Running":
```
[api]      Running - PID 12345
[web]      Running - PID 12346
[runner]   Running - PID 12347
```

#### Step 2: Verify Ports
```bash
lsof -i :20000  # API
lsof -i :3001   # Web
```

Expected: Each port should have a listening process.

#### Step 3: Check Environment Variables
```bash
echo $BASE_URL           # Should be http://localhost:3001
echo $NEXT_PUBLIC_API_BASE  # Should be http://localhost:20000/api/v1
```

#### Step 4: Restart Services
```bash
make dev-down
make dev-up
```

#### Step 5: Clear Proxy Settings (if using proxy)
```bash
unset http_proxy
unset https_proxy
unset all_proxy
unset HTTP_PROXY
unset HTTPS_PROXY
unset ALL_PROXY
```

### Prevention
- Always run `make dev-up` before running tests
- Check service status with `make notebook-agent-demo-status`
- Don't use corporate VPN for local development

---

## Backend Issues

### Symptoms
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `PostgreSQL connection failed`
- `Redis connection error`

### Root Causes
1. **Database down** - PostgreSQL not running
2. **Redis down** - Redis not running
3. **Migration missing** - Database schema out of date
4. **Resource exhaustion** - Out of memory/disk

### Troubleshooting Steps

#### Step 1: Check API Logs
```bash
tail -100 /tmp/agentsmith_demo_api.log
```

Look for:
- Error messages
- Stack traces
- Database connection errors

#### Step 2: Check Database Status
```bash
docker ps | grep postgres
docker ps | grep redis
```

Both should be running.

#### Step 3: Check Database Connectivity
```bash
npm run integration:deps:smoke
```

This tests basic connectivity to all services.

#### Step 4: Check Disk Space
```bash
df -h
```

Ensure `/var` has at least 1GB free.

#### Step 5: Restart Backend Services
```bash
make deps-down
make deps-up
npm run integration:deps:init:postgres
```

#### Step 6: Check Backend Process
```bash
ps aux | grep "api:node:dev"
```

Should show a running Node.js process.

### Prevention
- Run `make deps-smoke` after any database changes
- Monitor disk space during development
- Restart services daily for long-running sessions

---

## Assertion Failures

### Symptoms
- `expected "actual" to be "expected"`
- `locator.click: Timeout exceeded`
- `element not found`
- `waiting failed`

### Root Causes
1. **Wrong selector** - Test selector doesn't match UI
2. **Timing issue** - Element appears after test looks for it
3. **Data mismatch** - Test data doesn't match actual data
4. **Race condition** - Async operation not properly awaited

### Troubleshooting Steps

#### Step 1: Review Test Failure Output
```bash
npm run test:e2e -- --project=chromium your-test.spec.ts
```

Read the full error message and stack trace.

#### Step 2: Check Selector
Open browser DevTools and verify the selector:
```javascript
document.querySelector('[data-testid="your-element"]')
```

#### Step 3: Run in Debug Mode
```bash
npm run test:e2e:debug
```

This opens Playwright Inspector for step-by-step debugging.

#### Step 4: Add Wait for Element
```typescript
await expect(page.locator('[data-testid="your-element"]')).toBeVisible();
```

#### Step 5: Check Test Data
```bash
# View test fixtures
cat src/mocks/fixtures/p0.json | jq
```

Verify the data matches what the test expects.

#### Step 6: Increase Timeout (if needed)
```typescript
await page.click('button', { timeout: 60000 }); // 60s
```

### Prevention
- Use `data-testid` attributes (not CSS classes)
- Always use `await` for async operations
- Run `make openapi-check-generated` after API changes
- Keep test data fixtures in sync

---

## Timeout Issues

### Symptoms
- `timeout 30000ms exceeded`
- `operation timed out`
- `playwright timeout`

### Root Causes
1. **Slow network** - High latency
2. **Heavy load** - System under stress
3. **Infinite loop** - Code stuck in loop
4. **Missing await** - Promise not handled

### Troubleshooting Steps

#### Step 1: Check System Load
```bash
top
```

Look for high CPU/memory usage.

#### Step 2: Increase Timeout
In `playwright.config.ts`:
```typescript
export default defineConfig({
  timeout: 60000, // 60 seconds
});
```

#### Step 3: Check for Async Issues
Look for:
```typescript
// Bad - missing await
page.click('button');

// Good - with await
await page.click('button');
```

#### Step 4: Use Specific Locators
```typescript
// Bad - slow xpath
page.locator('//div[1]/div[2]/button')

// Good - fast data-testid
page.locator('[data-testid="submit-button"]')
```

### Prevention
- Use fast selectors (`data-testid`)
- Keep test code simple
- Avoid unnecessary waits

---

## Permission Issues

### Symptoms
- `access denied`
- `not authorized`
- `insufficient permissions`
- `role required`

### Root Causes
1. **Wrong user** - Logged in as wrong user
2. **No role** - User lacks required role
3. **Not in workspace** - User not a workspace member
4. **Resource policy** - Policy blocks access

### Troubleshooting Steps

#### Step 1: Check Current User
In browser DevTools console:
```javascript
JSON.parse(localStorage.getItem('agentsmith-auth'))
```

Check the `user` object.

#### Step 2: Check Workspace Membership
Go to the Members page in the UI and verify your membership.

#### Step 3: Check Resource Policies
Go to the Sources page → Resource Policy tab.

#### Step 4: Re-authenticate
```bash
# Clear auth and login again
make notebook-agent-refresh-token
```

### Prevention
- Use admin user for testing
- Verify user roles before testing
- Check resource policies after changes

---

## Unknown Errors

### When Classification Fails

If the failure classifier returns `unknown`, follow these steps:

#### Step 1: Check Logs
```bash
tail -100 /tmp/agentsmith_demo_api.log
tail -100 /tmp/agentsmith_demo_web.log
tail -100 /tmp/agentsmith_demo_runner.log
```

#### Step 2: Search Error Message
```bash
cd /home/percy/works/mbos-v1/agentsmith
grep -r "YOUR_ERROR_MESSAGE" scripts/ src/
```

#### Step 3: Run with Verbose Output
```bash
VERBOSE=1 npm run test:e2e -- your-test.spec.ts
```

#### Step 4: Check GitHub Issues
Search: https://github.com/your-org/agentsmith/issues

#### Step 5: Report with Context
When reporting unknown errors, include:
- Full error message
- Command you ran
- Environment (OS, Node version)
- Relevant logs

---

## Debugging Workflow

### Decision Tree for Any Error

```
┌─────────────────────────────────────┐
│         Did a test fail?            │
└──────────────┬──────────────────────┘
               │
               ▼
        ┌──────────────┐
        │ Check error  │
        │   message    │
        └──────┬───────┘
               │
     ┌─────────┴─────────┐
     │                   │
     ▼                   ▼
┌─────────┐        ┌──────────┐
│ 401/403 │        │ Contains │
│  Token  │        │ keyword? │
└────┬────┘        └────┬─────┘
     │                  │
     ▼                  ▼
┌─────────┐        ┌──────────────────┐
│Refresh  │        │ Check keyword:   │
│  token  │        │ - ECONNREFUSED   │
└─────────┘        │ - ETIMEDOUT      │
                   │ - 500            │
                   │ - timeout        │
                   └────┬─────────────┘
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
         ┌─────────┐          ┌─────────┐
         │Network  │          │Backend  │
         │issues?  │          │ issues? │
         └────┬────┘          └────┬────┘
              │                    │
              ▼                    ▼
         ┌─────────┐          ┌─────────┐
         │Check    │          │Check    │
         │services │          │logs     │
         └─────────┘          └─────────┘
```

### Quick Diagnostic Commands

```bash
# All-in-one diagnostic
make notebook-agent-demo-status

# Check all logs
tail -50 /tmp/agentsmith_demo_*.log

# Test all dependencies
npm run integration:deps:smoke

# Full reset
make dev-down && make dev-up
```

---

## Classification Accuracy

This guide supports the automated failure classifier in `scripts/release/failure-classifier.ts`.

**Target Accuracy:** ≥ 90%

### Testing Accuracy

Run the classifier tests:
```bash
npm test -- scripts/release/__tests__/failure-classifier.test.ts
```

Current coverage:
- Token errors: 95%
- Network errors: 92%
- Backend errors: 88%
- Assertion errors: 90%

### Contributing Patterns

To add a new failure pattern:

1. Edit `scripts/release/failure-classifier.ts`
2. Add pattern to `FAILURE_PATTERNS` array
3. Add test case in `__tests__/failure-classifier.test.ts`
4. Update this guide with troubleshooting steps
5. Run tests to verify ≥90% accuracy

---

## Authorization & Governance Issues (Epic A Integration)

**From Epic A (Permission Decision Chain & Resource Policy)**

### Symptoms
- `access denied` / `not authorized`
- `Permission denied by policy`
- `Subject not in allow list`
- `quota exceeded`
- `rate limit exceeded`

### Root Causes

1. **Missing permission** - User lacks specific permission point
2. **Template downgrade** - Role changed from admin to user
3. **Resource policy deny** - Resource policy blocks access
4. **Group membership** - Not in allowed group
5. **Quota exceeded** - Usage limit reached
6. **Rate limited** - Too many requests

### Troubleshooting Steps

#### Step 1: Use Unified Authorization Explain (Epic A1)

The `POST /authorize` API can tell you WHY access was denied:

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

```bash
# Via API
curl -X GET http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/members/user-1/permissions \
  -H "Authorization: Bearer $TOKEN"
```

Or in browser console:
```javascript
const auth = JSON.parse(localStorage.getItem('agentsmith-auth') || '{}');
console.log('User:', auth.user);
console.log('Permissions:', auth.currentProject?.permissions);
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

#### Step 5: Check Audit Trail for Authorization

```bash
# Query audit events for authorization decisions
curl -X GET "http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/audit?start_time=2026-02-27T00:00:00Z&end_time=2026-02-27T23:59:59Z&action=authz.check" \
  -H "Authorization: Bearer $TOKEN"
```

### Evidence Chain Verification

To verify the complete evidence chain for authorization:

```bash
# 1. Check authorization decision (returns audit_id)
curl -X POST http://localhost:20000/api/v1/workspaces/ws-1/projects/proj-1/authorize \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"permission": "project:endpoint:use"}' | jq '.audit_id'

# 2. Check audit event was created
AUDIT_ID="<from-above>"
curl -X GET "http://localhost:20000/api/v1/audit/$AUDIT_ID" \
  -H "Authorization: Bearer $TOKEN"

# 3. Check policy evaluation (returns usage_record_id)
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

---

## Appendix: Error Message Examples

### Token Errors
```
jwt expired
Error: Request failed with status code 401
Keycloak: 403 Forbidden
invalid_token
Authorization header missing
```

### Network Errors
```
connect ECONNREFUSED 127.0.0.1:20000
getaddrinfo ENOTFOUND api.local
socket hang up
ETIMEDOUT
Network unreachable
```

### Backend Errors
```
500 Internal Server Error
502 Bad Gateway
PostgreSQL connection failed: password authentication failed
Redis connection to localhost:16379 failed
```

### Assertion Errors
```
expected "actual" to be "expected"
locator.click: Timeout 30000ms exceeded
Error: Target closed
getByTestId failed: not found
```

---

**Document Version:** v1
**Next Review:** After M3 completion
**Feedback:** Contact dev-4 or create GitHub issue
