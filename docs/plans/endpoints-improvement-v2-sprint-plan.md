# Endpoints Improvement v2 - Sprint Plan

**Created**: 2026-03-03
**Sprint**: v2
**Duration**: 1 week (5 business days)
**PM**: pm-lead
**Status**: `draft`

---

## Sprint Overview

### Goals
1. Fix bugs in CustomEndpointWizard (i18n, Next button logic)
2. Enhance pricing configuration UX
3. Improve endpoint list and CRUD UX
4. Complete integration and E2E test coverage

### Scope (P0 + P1)
| Priority | Feature | Status | Owner |
|----------|---------|--------|-------|
| P0 | Fix CustomEndpointWizard bugs | Pending | dev1-bugs |
| P0 | Enhance pricing UX | Pending | dev3-pricing |
| P1 | Improve endpoint list/CRUD | Pending | dev2-crud |
| P0 | Integration + E2E tests | Pending | test-engineer |

---

## Task Breakdown

### Task #4: Fix CustomEndpointWizard Bugs
**Owner**: dev1-bugs
**Priority**: P0
**Estimate**: 0.5 day
**Dependencies**: None

#### Bug Analysis

**Bug 1: Next button disabled incorrectly**
- **Current behavior**: Line 626 has `disabled={!canProceed || credentials.length === 0}`
- **Issue**: The `credentials.length === 0` check applies globally, blocking Step 1 Next button even when credentials aren't needed yet
- **Expected**: Next button on Step 1 should only require name + protocol + valid baseUrl

**Bug 2: i18n keys not rendering (potential)**
- Code uses `useTranslations('endpoints.custom_wizard')` correctly
- Keys exist in messages/en-US.json and messages/zh-CN.json
- May need runtime verification

#### Implementation Plan

```typescript
// Fix for Next button logic (CustomEndpointWizard.tsx:626)
// BEFORE:
disabled={!canProceed || credentials.length === 0}

// AFTER:
disabled={!canProceed || (step === 2 && credentials.length === 0)}
```

#### Acceptance Criteria
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | Next button enables on Step 1 with name + protocol + https URL | Unit test |
| AC2 | Next button enables on Step 2 with model + credential | Unit test |
| AC3 | Create button only enables after validation passes | Unit test |
| AC4 | i18n keys render correctly for en-US and zh-CN | Manual test |

#### Gates
```bash
# Must pass before delivery
npm test -- CustomEndpointWizard.test
npx tsc --noEmit
npm run lint
```

---

### Task #3: Enhance Pricing Configuration UX
**Owner**: dev3-pricing
**Priority**: P0
**Estimate**: 1 day
**Dependencies**: None

#### Current State
- PricingConfigDialog uses table layout with Provider/Model rows
- Fields: input_price, output_price, input_image_price, output_image_price
- Has Save/Reset/Cancel actions

#### UX Improvements Needed

Based on 9router patterns:
1. **Better visual hierarchy** - Group pricing by capability (chat, embedding, etc.)
2. **Inline editing** - Click-to-edit instead of table inputs
3. **Currency selector** - Allow USD/CNY/EUR selection
4. **Bulk edit** - Edit all models of a provider at once

#### Implementation Plan

```typescript
// New features to add:
1. Capability grouping (chat, embedding, multimodal, etc.)
2. Currency selector in header
3. Inline edit mode (click price to edit)
4. Bulk edit button per provider
```

#### Acceptance Criteria
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | Pricing grouped by capability type | Visual E2E |
| AC2 | Currency selector persists across sessions | Unit test |
| AC3 | Inline edit mode activates on click | E2E test |
| AC4 | Bulk edit updates all models in provider | Unit test |

#### Gates
```bash
npm test -- PricingConfigDialog.test
npm test -- pricing-utils.test
npx tsc --noEmit
npm run lint
```

---

### Task #7: Improve Endpoint List and CRUD UX
**Owner**: dev2-crud
**Priority**: P1
**Estimate**: 1.5 days
**Dependencies**: None

#### Current State
- EndpointsPage.tsx with table layout
- EndpointStatusBadge component exists
- ProviderLogo component exists
- ErrorTag component exists

#### UX Improvements Needed

Based on project requirements:
1. **Better status indicators** - Show health check results visually
2. **Improved action buttons** - Group edit/delete/validate actions
3. **Quick actions menu** - Dropdown for less common actions
4. **Provider grouping** - Optional view grouped by provider

#### Implementation Plan

```typescript
// Components to enhance:
1. EndpointStatusBadge - Add animated health indicator
2. EndpointsPage - Add action dropdown menu
3. CreateEndpointDialog - Reuse existing, enhance validation
4. EditEndpointDialog - Reuse existing, enhance layout
```

#### Acceptance Criteria
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | Status badge shows health with color + animation | Visual E2E |
| AC2 | Action menu groups related actions | E2E test |
| AC3 | Provider cards show logo + model count | Unit test |
| AC4 | Empty state guides user to create endpoint | E2E test |

#### Gates
```bash
npm test -- EndpointStatusBadge.test
npm test -- ProviderLogo.test
npm test -- ErrorTag.test
npx tsc --noEmit
npm run lint
```

---

### Task #2: Integration and E2E Tests
**Owner**: test-engineer
**Priority**: P0
**Estimate**: 1.5 days
**Dependencies**: Task #4, #3, #7

#### Test Coverage Required

**Integration Tests** (Vitest)
```typescript
// lib/api/endpoints/__tests__/integration/
- validateEndpoint.integration.test.ts
- pricingAPI.integration.test.ts
- healthCheck.integration.test.ts
```

**E2E Tests** (Playwright)
```typescript
// e2e/endpoints/
- custom-endpoint-creation.spec.ts
- pricing-configuration.spec.ts
- endpoint-crud.spec.ts
- health-check.spec.ts
```

**Visual Tests** (Playwright)
```typescript
// e2e/visual/
- endpoints-page.spec.ts
- custom-wizard.spec.ts
- pricing-dialog.spec.ts
```

#### Test Data Strategy
- Use MSW mock handlers for API responses
- Create test fixtures for common scenarios
- Isolate test data per test (cleanup after)

#### Acceptance Criteria
| AC | Description | Verification |
|----|-------------|--------------|
| AC1 | Integration tests cover API contracts | Run with `npm test` |
| AC2 | E2E tests cover critical user flows | Run with `npm run test:e2e -- project=chromium` |
| AC3 | Visual tests prevent UI regressions | Run with `npm run test:e2e -- project=visual` |
| AC4 | All tests use stable test IDs | Manual review |

#### Gates
```bash
npm test
npm run test:e2e -- project=chromium
npm run test:e2e -- project=visual
```

---

## Sprint Schedule

```
Day 1 (Mon):
├── dev1-bugs: Fix CustomEndpointWizard bugs
├── dev3-pricing: Start pricing UX enhancements
└── dev2-crud: Start endpoint list improvements

Day 2 (Tue):
├── dev1-bugs: Complete + gates
├── dev3-pricing: Continue pricing UX
├── dev2-crud: Continue list UX
└── test-engineer: Start integration tests

Day 3 (Wed):
├── dev3-pricing: Complete + gates
├── dev2-crud: Complete + gates
└── test-engineer: Continue integration + E2E tests

Day 4 (Thu):
├── test-engineer: Complete test coverage
└── All: Fix bugs from test results

Day 5 (Fri):
├── All: Final gate verification
├── pm-lead: Acceptance testing
└── All: Sprint retrospective
```

---

## Dependencies and Blockers

| Task | Blocked By | Unblocks |
|------|------------|----------|
| #3 (pricing) | None | #2 (tests) |
| #4 (wizard bugs) | None | #2 (tests) |
| #7 (list UX) | None | #2 (tests) |
| #2 (tests) | #3, #4, #7 | #5 (closure) |
| #5 (closure) | #1, #2, #3, #4, #7 | None |

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Backend API not ready | Medium | High | Use MSW mocks for development |
| Test coverage gaps | Low | Medium | Test engineer works in parallel |
| Design system limitations | Low | Low | Reuse existing components |
| Scope creep | Medium | Medium | PM strictly enforces P0+P1 |

---

## Definition of Done

A task is **Complete** when:
1. ✅ Code is peer reviewed (or self-reviewed with checklist)
2. ✅ All unit tests pass (`npm test`)
3. ✅ Type check passes (`npx tsc --noEmit`)
4. ✅ Lint passes (`npm run lint`)
5. ✅ E2E tests pass (if applicable)
6. ✅ i18n keys exist for both en-US and zh-CN
7. ✅ Test IDs follow `scope__element__state` format

The sprint is **Complete** when:
1. ✅ All P0 tasks are complete
2. ✅ P1 tasks are complete OR documented as deferred
3. ✅ All gates pass
4. ✅ Acceptance testing passes
5. ✅ Release report is generated

---

## Communication Plan

| Frequency | Format | Participants |
|-----------|--------|--------------|
| Daily | Async status updates | All team members |
| Mid-sprint | Sync call if needed | PM + leads |
| End-of-sprint | Retrospective document | All team members |

---

## References

- **Governance Methodology**: `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
- **Delivery Maturity**: `docs/development-delivery-maturity-guide.md`
- **Project Constitution**: `docs/项目宪法.md`
- **Implementation Plan**: `docs/plans/endpoints-improvement-plan.md`
