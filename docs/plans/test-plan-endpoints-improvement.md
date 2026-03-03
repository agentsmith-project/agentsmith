# Endpoints Improvement Test Plan

**Owner**: test-engineer
**Created**: 2026-03-03
**Status**: `draft`
**Related**: docs/plans/endpoints-improvement-plan.md

---

## Overview

This test plan covers integration, E2E, and visual regression tests for the endpoints improvement v2 project, following the governance methodology's layered verification approach.

## Test Principles

1. **Mock Lane vs Real Lane Separation**: MSW mocks for stable UI testing, real backend for integration validation
2. **Test ID Format**: `scope__element__state` (e.g., `endpoints__create-button`)
3. **Layered Verification**: Type/Contract → Unit → Integration → E2E → Visual → Release Report
4. **Evidence Driven**: Test results as formal artifacts for governance

---

## 1. Integration Tests (API Layer)

**Location**: `src/lib/api/endpoints/__tests__/`

### 1.1 Existing Coverage ✅

| Test File | Coverage | Status |
|-----------|----------|--------|
| `endpoints-extended.test.ts` | validate, getHealth, batchHealthCheck, getPricing, updatePricing | Complete |

### 1.2 Additional Tests Needed

#### A. Error Categorization Tests

```typescript
// error-categorizer.test.ts
describe('Error Categorizer', () => {
  it('should categorize 401 as auth error');
  it('should categorize 429 as rate_limit error');
  it('should categorize 5XX as upstream error');
  it('should categorize ETIMEDOUT as timeout error');
  it('should categorize ECONNREFUSED as network error');
  it('should return unknown for unhandled errors');
});
```

#### B. Batch Health Check Edge Cases

```typescript
// batch-health-check.test.ts
describe('Batch Health Check', () => {
  it('should handle empty endpoint list');
  it('should handle partial failures');
  it('should aggregate results correctly');
  it('should respect mode: all vs selected');
  it('should handle timeout on individual endpoints');
});
```

#### C. Pricing Calculation Tests

```typescript
// pricing-calculator.test.ts
describe('Pricing Calculator', () => {
  it('should calculate cost per 1M tokens');
  it('should handle different currencies');
  it('should format price display correctly');
  it('should round to 2 decimal places');
});
```

---

## 2. E2E Tests (User Flows)

**Location**: `e2e/`

### 2.1 Existing Coverage ⚠️

| Test File | Coverage | Gaps |
|-----------|----------|------|
| `endpoints.spec.ts` | Basic CRUD, custom wizard opening | Missing full flows |

### 2.2 New E2E Tests Needed

#### A. Custom Endpoint Creation Flow

```typescript
// e2e/endpoints-custom-creation.spec.ts
test.describe('Custom Endpoint Creation', () => {
  test('should complete full wizard flow - OpenAI compatible', async ({ authedPage }) => {
    // Step 1: Fill basic info
    // Step 2: Configure model
    // Step 3: Validate and create
    // Verify: Endpoint appears in table
  });

  test('should complete full wizard flow - Anthropic compatible', async ({ authedPage }) => {
    // Same as above, different protocol
  });

  test('should show validation errors for invalid URL', async ({ authedPage }) => {
    // Test http:// (not https)
    // Test missing /v1 suffix
  });

  test('should disable create button before validation passes', async ({ authedPage }) => {
    // Verify create button disabled
    // Run validation
    // Verify create button enabled on success
  });

  test('should handle validation failure gracefully', async ({ authedPage }) => {
    // Mock auth failure
    // Verify error message shows correct category
    // Verify retry button available
  });
});
```

#### B. Pricing Configuration Flow

```typescript
// e2e/endpoints-pricing.spec.ts
test.describe('Pricing Configuration', () => {
  test('should open pricing dialog from endpoint table', async ({ authedPage }) => {
    // Click pricing column
    // Verify dialog opens
    // Verify current values displayed
  });

  test('should update pricing and save', async ({ authedPage }) => {
    // Modify input price
    // Modify output price
    // Click save
    // Verify success toast
    // Verify value updated in table
  });

  test('should reset to defaults on cancel', async ({ authedPage }) => {
    // Modify value
    // Click cancel
    // Reopen - verify original value
  });

  test('should show validation for negative prices', async ({ authedPage }) => {
    // Enter negative value
    // Verify error shown
    // Verify save disabled
  });
});
```

#### C. Health Check and Status

```typescript
// e2e/endpoints-health.spec.ts
test.describe('Endpoint Health Status', () => {
  test('should display healthy status badge', async ({ authedPage }) => {
    // Mock health check pass
    // Verify green badge
    // Verify latency shown
  });

  test('should display error tag for failed health check', async ({ authedPage }) => {
    // Mock health check fail
    // Verify red badge
    // Verify error category tag
  });

  test('should allow manual health check retry', async ({ authedPage }) => {
    // Trigger health check
    // Wait for result
    // Click retry
    // Verify new request
  });
});
```

#### D. Error State Recovery

```typescript
// e2e/endpoints-error-recovery.spec.ts
test.describe('Error State Recovery', () => {
  test('should recover from network error', async ({ authedPage }) => {
    // Mock network failure
    // Verify error message
    // Mock recovery
    // Verify success
  });

  test('should show appropriate error for auth failure', async ({ authedPage }) => {
    // Mock 401
    // Verify AUTH tag
    // Verify helpful message
  });

  test('should show appropriate error for rate limit', async ({ authedPage }) => {
    // Mock 429
    // Verify 429 tag
    // Verify retry suggestion
  });
});
```

---

## 3. Visual Regression Tests

**Location**: `e2e/visual.spec.ts`

### 3.1 New Visual Tests Needed

```typescript
test.describe('Visual - Endpoints Enhancement', () => {
  // Custom Wizard Screenshots
  test('custom wizard - step 1', async ({ authedPage }) => {
    // Navigate to wizard
    // Screenshot basic info step
  });

  test('custom wizard - step 2', async ({ authedPage }) => {
    // Navigate to step 2
    // Screenshot model config step
  });

  test('custom wizard - step 3 success', async ({ authedPage }) => {
    // Navigate to step 3
    // Mock successful validation
    // Screenshot success state
  });

  test('custom wizard - step 3 failure', async ({ authedPage }) => {
    // Navigate to step 3
    // Mock failed validation
    // Screenshot error state
  });

  // Pricing Dialog
  test('pricing dialog - default state', async ({ authedPage }) => {
    // Open pricing dialog
    // Screenshot
  });

  test('pricing dialog - editing state', async ({ authedPage }) => {
    // Open pricing dialog
    // Modify a value
    // Screenshot (showing enabled save button)
  });

  // Status Badges
  test('status badge - healthy', async ({ authedPage }) => {
    // Mock healthy endpoint
    // Screenshot badge
  });

  test('status badge - degraded', async ({ authedPage }) => {
    // Mock degraded endpoint
    // Screenshot badge
  });

  test('status badge - unavailable', async ({ authedPage }) => {
    // Mock failed endpoint
    // Screenshot badge with error tag
  });

  // Error Tags
  test('error tag - AUTH', async ({ authedPage }) => {
    // Mock auth error
    // Screenshot red AUTH tag
  });

  test('error tag - 429', async ({ authedPage }) => {
    // Mock rate limit
    // Screenshot yellow 429 tag
  });

  test('error tag - 5XX', async ({ authedPage }) => {
    // Mock upstream error
    // Screenshot orange 5XX tag
  });

  // Provider Logos
  test('provider logos - all variants', async ({ authedPage }) => {
    // Screenshot table showing all provider logos
  });
});
```

---

## 4. Gate Check Requirements

### 4.1 Developer Gates (Before Delivery to QA)

| Gate | Command | Expected Result |
|------|---------|-----------------|
| Type Check | `npx tsc --noEmit` | No type errors |
| Contract Check | `npm run contracts:check` | Pass |
| OpenAPI Check | `npm run contracts:check-openapi` | Aligned with backend |
| Generated Check | `npm run openapi:check-generated` | Latest client |
| Unit Tests | `npm test` | All pass |
| Lint | `npm run lint` | No errors, all i18n keys present |

### 4.2 QA Gates (Before Sign-off)

| Gate | Command | Expected Result |
|------|---------|-----------------|
| E2E Tests | `npm run test:e2e` | All pass |
| Visual Tests | `npm run test:e2e --project=visual` | No regressions |
| Manual Testing | Smoke tests | Critical flows pass |

---

## 5. Test Data Strategy

### 5.1 MSW Handlers

Existing handlers in `src/mocks/handlers/` need extensions:

```typescript
// New handlers needed
export const customEndpointHandlers = [
  // POST /endpoints/validate
  // GET /endpoints/:id/health
  // POST /endpoints:health-batch
  // GET /endpoints/:id/pricing
  // PUT /endpoints/:id/pricing
];
```

### 5.2 Test Fixtures

Add to `e2e/fixtures/`:

```typescript
// endpoint-fixture.ts
export const mockEndpoints = {
  healthyOpenAI: { id: 'ep-1', status: 'active', health: 'pass' },
  failingAuth: { id: 'ep-2', status: 'active', health: 'fail', errorCategory: 'auth' },
  rateLimited: { id: 'ep-3', status: 'active', health: 'fail', errorCategory: 'rate_limit' },
  customOpenAI: { id: 'ep-4', type: 'custom', protocol: 'openai_compatible' },
  customAnthropic: { id: 'ep-5', type: 'custom', protocol: 'anthropic_compatible' },
};
```

---

## 6. Execution Timeline

| Phase | Tests | Duration | Dependencies |
|-------|-------|----------|--------------|
| 1 | Integration tests | 1 day | Task #2 (API types) complete |
| 2 | E2E test writing | 2 days | Tasks #3, #4, #5 components ready |
| 3 | Visual baselines | 1 day | UI finalized |
| 4 | Full test execution | 0.5 day | All tests written |
| 5 | Bug verification | As needed | Bug reports from developers |

---

## 7. Success Criteria

- ✅ All unit tests pass (40% coverage target maintained)
- ✅ All E2E tests for new features pass
- ✅ Visual regression tests have updated baselines
- ✅ No `any` types in test code
- ✅ All test IDs follow `scope__element__state` format
- ✅ MSW handlers cover all new API endpoints
- ✅ Error scenarios have dedicated test cases

---

**Next Steps**: Await Task #6 (sprint plan) to unblock Task #2, then begin integration test creation.
