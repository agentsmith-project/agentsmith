# Endpoints Quality Improvement - Sprint Plan

**Created**: 2026-03-03
**Status**: `active`
**PM**: pm-lead
**Sprint Duration**: 1 week

---

## Executive Summary

This sprint focuses on **quality hardening** for the endpoints improvement v2 feature. The implementation is largely complete, but we need to:

1. Fix E2E test expectation mismatches
2. Complete i18n coverage
3. Add integration tests for API layer
4. Add comprehensive E2E tests for new features
5. Run visual regression tests

**Governance Principles Applied**:
- Contract First - All types defined before tests
- Evidence Driven Delivery - Gate requirements for each task
- TDD - Tests written/verified before completion
- Mock Lane vs Real Lane - MSW for development, real backend for integration

---

## Task Breakdown

### Task #1: Review and Plan (COMPLETED)
**Owner**: pm-lead
**Status**: `completed`
**Outcome**: This sprint plan created

---

### Task #2: Fix E2E Test Expectation Mismatch
**Owner**: dev1-wizard
**Priority**: P0
**Estimate**: 0.5 day
**Status**: `pending`

**Issue**: E2E test at e2e/endpoints.spec.ts:389 expects create button to be disabled before validation, but implementation allows creation without validation (validation is optional/recommended).

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | E2E test at line 389 updated to match actual behavior | Unit test |
| AC2 | Documentation clarifies validation is optional | Code review |
| AC3 | All wizard E2E tests pass | `npm run test:e2e` |

**Gates**:
```bash
npm run test:e2e -- e2e/endpoints.spec.ts
```

---

### Task #3: Fix Missing i18n Keys
**Owner**: dev2-dialog
**Priority**: P0
**Estimate**: 0.5 day
**Status**: `pending`

**Issue**: CustomEndpointWizard uses translation keys that may not exist.

**Missing Keys to Verify/Add**:
- `endpoints.custom_wizard.use_default`
- `endpoints.custom_wizard.summary_title`
- `endpoints.custom_wizard.summary_name`
- `endpoints.custom_wizard.summary_protocol`
- `endpoints.custom_wizard.summary_base_url`
- `endpoints.custom_wizard.summary_model`
- `endpoints.custom_wizard.summary_model_id`
- `endpoints.custom_wizard.summary_capability`
- `endpoints.custom_wizard.config_summary`
- `endpoints.custom_wizard.endpoint_ready`
- `endpoints.custom_wizard.error_type`
- `endpoints.custom_wizard.cancel_button`
- `endpoints.custom_wizard.back_button`
- `endpoints.custom_wizard.next_button`

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All keys exist in en-US.json and zh-CN.json | Lint check |
| AC2 | No missing i18n key warnings in console | Manual test |
| AC3 | Lint check passes for i18n completeness | `npm run lint` |

**Gates**:
```bash
npm run lint
npx tsc --noEmit
```

---

### Task #4: Add Integration Tests for Endpoints API
**Owner**: dev3-msw
**Priority**: P0
**Estimate**: 1 day
**Status**: `pending`

**Issue**: No integration tests exist for the endpoints API layer.

**File to Create**: `src/lib/api/endpoints/__tests__/endpoints.integration.test.ts`

**Test Coverage Required**:
1. `validateEndpoint()` - success and failure cases
2. `getHealth()` - endpoint health retrieval
3. `batchHealthCheck()` - multiple endpoints
4. `getPricing()` / `updatePricing()` - pricing CRUD

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All API methods have integration test coverage | Coverage report |
| AC2 | MSW handlers properly mock success/error cases | Test execution |
| AC3 | Tests use stable test IDs and fixtures | Code review |
| AC4 | No `any` types in test code | `npx tsc --noEmit` |

**Gates**:
```bash
npm test -- endpoints.integration.test
npx tsc --noEmit
```

---

### Task #7: Add Visual Regression Tests
**Owner**: test-engineer
**Priority**: P1
**Estimate**: 0.5 day
**Status**: `pending`

**Components to Test**:
1. CustomEndpointWizard - all 3 steps
2. EndpointStatusBadge - all status variants
3. ErrorTag - all error categories
4. PricingConfigDialog - default and editing states
5. ProviderLogo - all provider variants

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All new components have visual baselines | `npm run test:e2e -- --project=visual` |
| AC2 | Visual tests pass with no regressions | Test execution |
| AC3 | Test IDs follow format: `visual__endpoints__*` | Code review |

---

### Task #8: Verify Endpoints Types File (COMPLETED)
**Owner**: dev1-bugs
**Status**: `completed`
**Outcome**: Verified - src/lib/api/types/endpoints.ts exists with all required types

---

### Task #9: Add E2E Tests for Pricing Configuration
**Owner**: test-engineer
**Priority**: P1
**Estimate**: 1 day
**Status**: `pending`

**Test Cases Required**:
1. Open pricing dialog from endpoint table
2. View current pricing values
3. Update pricing and save
4. Cancel and verify original values
5. Validation for negative prices

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All pricing E2E scenarios covered | Test file review |
| AC2 | Tests use stable test IDs | `e2e/endpoints__pricing-*` |
| AC3 | MSW handlers cover pricing API endpoints | Test execution |
| AC4 | All tests pass consistently | `npm run test:e2e` |

---

### Task #10: Add E2E Tests for Health Check and Error Recovery
**Owner**: test-engineer
**Priority**: P1
**Estimate**: 1 day
**Status**: `pending`

**Test Cases Required**:
1. Display healthy status badge
2. Display error tag for failed health check
3. Manual health check retry
4. Error state recovery (network, auth, rate limit)
5. Error category display (AUTH, 429, 5XX, NET, TIMEOUT)

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All health check scenarios covered | Test file review |
| AC2 | Error categories properly tested | Test execution |
| AC3 | MSW handlers mock different error types | Mock review |
| AC4 | All tests pass consistently | `npm run test:e2e` |

---

### Task #5: Final Closure Check and Verification
**Owner**: pm-lead
**Priority**: P0
**Status**: `pending` (blocked by #2, #3, #4, #9, #10)

**Gate Checklist**:
| Gate | Command | Expected Result |
|------|---------|-----------------|
| Type Check | `npx tsc --noEmit` | No errors |
| Lint | `npm run lint` | No errors, all i18n keys present |
| Unit Tests | `npm test` | All pass |
| E2E Tests | `npm run test:e2e -- --project=chromium` | All pass |
| Visual Tests | `npm run test:e2e -- --project=visual` | No regressions |
| Contract Check | `npm run contracts:check` | Pass |

**Acceptance Criteria**:
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | All P0 tasks completed | Task list review |
| AC2 | All gates pass | Gate execution |
| AC3 | Documentation updated | File review |
| AC4 | Release report generated | Report file |

---

## Dependencies and Parallel Execution

```
                    ┌─────────────┐
                    │   Task #2   │
                    │   Task #3   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌───────────┐  ┌───────────┐  ┌───────────┐
     │ Task #9   │  │ Task #10  │  │  Task #7  │
     │ (E2E)     │  │ (E2E)     │  │ (Visual)  │
     └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
           │             │             │
           └──────────────┼─────────────┘
                          ▼
                   ┌─────────────┐
                   │   Task #5   │
                   │ (Final Gate)│
                   └─────────────┘

    Task #4 (Integration) can run in parallel with #2, #3
```

**Parallel Strategy**:
- **Day 1**: Task #2, #3, #4 in parallel (different developers)
- **Day 2-3**: Task #9, #10, #7 in parallel (test engineer)
- **Day 4**: Bug fixes from test results
- **Day 5**: Task #5 closure

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Backend API not ready | Low | High | MSW mocks already in place |
| Test flakiness | Medium | Medium | Use stable test IDs, proper waits |
| Visual regression baseline drift | Low | Low | Update baselines in sprint |
| Scope creep | Medium | High | PM strictly enforces P0 first |

---

## Success Criteria

The sprint is **successful** when:

1. ✅ All P0 tasks (#2, #3, #4, #5) are complete
2. ✅ All gates pass (type check, lint, tests, E2E, visual)
3. ✅ Test coverage for endpoints module ≥ 40%
4. ✅ No `any` types in production or test code
5. ✅ All i18n keys exist for both en-US and zh-CN
6. ✅ Release closure note generated

---

## Communication Plan

| Frequency | Format | Participants |
|-----------|--------|--------------|
| Daily | Async status in task comments | All team members |
| Mid-sprint | Sync call if blockers | PM + leads |
| End-of-sprint | Closure document | All team members |

---

## References

- **Governance Methodology**: `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
- **Delivery Maturity**: `docs/development-delivery-maturity-guide.md`
- **Test Plan**: `docs/plans/test-plan-endpoints-improvement.md`
- **Implementation Plan**: `docs/plans/endpoints-improvement-plan.md`
