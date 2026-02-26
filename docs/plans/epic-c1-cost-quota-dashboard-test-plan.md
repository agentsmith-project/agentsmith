# Epic C1: Cost & Quota Dashboard - TDD Test Plan

**Date:** 2026-02-27
**Owner:** dev-3
**Status:** Planning Phase (Blocked by M2)

---

## Overview

This document outlines the comprehensive test plan for the Cost & Quota Dashboard feature, following Test-Driven Development (TDD) principles.

**Requirements (from PRD):**
- Daily/weekly/monthly trends
- Top users/resources
- Anomaly peaks detection
- Filter by workspace/project/resource_type
- Chart drill-down capability

**Acceptance Criteria:**
1. Support filtering by workspace/project/resource_type
2. Charts and details can be linked and drilled down
3. Dashboard displays at project level (workspace aggregation deferred to next release)

---

## Data Structures (API Contracts)

### 1. CostDashboardData

```typescript
interface CostDashboardData {
  time_range: {
    start: string; // ISO 8601
    end: string;   // ISO 8601
    granularity: 'day' | 'week' | 'month';
  };

  // Trend data
  trends: {
    requests: TrendDataPoint[];
    tokens: TrendDataPoint[];
    errors: TrendDataPoint[];
    cost_usd?: TrendDataPoint[];
  };

  // Top N lists
  top_resources: ResourceUsageRank[];
  top_users: UserUsageRank[];

  // Anomalies
  anomalies: AnomalyAlert[];

  // Summary
  summary: {
    total_requests: number;
    total_tokens: number;
    total_errors: number;
    total_cost_usd?: number;
    avg_response_time_ms?: number;
  };
}

interface TrendDataPoint {
  timestamp: string;  // ISO 8601
  value: number;
  change_percent?: number;  // vs previous period
}

interface ResourceUsageRank {
  resource_id: string;
  resource_type: 'endpoint' | 'agent' | 'source_library';
  resource_name: string;
  requests: number;
  tokens?: number;
  errors: number;
  cost_usd?: number;
}

interface UserUsageRank {
  end_user_id: string;
  user_name?: string;
  requests: number;
  tokens?: number;
  errors: number;
  cost_usd?: number;
}

interface AnomalyAlert {
  id: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
  type: 'requests_spike' | 'errors_spike' | 'cost_spike' | 'unusual_pattern';
  description: string;
  value: number;
  expected_range: { min: number; max: number };
  affected_resources: Array<{ type: string; id: string; name: string }>;
}
```

### 2. QuotaUsageData

```typescript
interface QuotaUsageData {
  project_id: string;
  time_range: {
    start: string;
    end: string;
  };

  // Overall quota status
  overall: {
    requests_today: number;
    requests_limit: number;
    requests_remaining: number;
    requests_reset_at: string;

    tokens_today: number;
    tokens_limit: number;
    tokens_remaining: number;
    tokens_reset_at: string;

    storage_bytes_used: number;
    storage_bytes_limit: number;
  };

  // Per-resource quotas
  by_resource: ResourceQuotaUsage[];

  // Historical trend
  trend: QuotaTrendPoint[];
}

interface ResourceQuotaUsage {
  resource_id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_name: string;

  requests_today: number;
  requests_limit: number;
  requests_remaining: number;

  tokens_today?: number;
  tokens_limit?: number;
  tokens_remaining?: number;
}

interface QuotaTrendPoint {
  date: string;  // YYYY-MM-DD
  requests_percent: number;  // 0-100
  tokens_percent?: number;   // 0-100
}
```

### 3. API Endpoints

```
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/cost-dashboard
Query Params:
  - start_time: string (ISO 8601)
  - end_time: string (ISO 8601)
  - granularity: 'day' | 'week' | 'month'
  - resource_type?: string
  - resource_id?: string
  - end_user_id?: string

Response: CostDashboardData

---

GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/quota-usage
Query Params:
  - start_time?: string (ISO 8601, optional)
  - end_time?: string (ISO 8601, optional)

Response: QuotaUsageData
```

---

## Component Structure

```
src/components/cost-dashboard/
├── CostDashboardPage.tsx          # Main page component
├── DashboardKPICards.tsx          # Summary cards (requests, tokens, cost)
├── TrendChart.tsx                 # Line chart for trends
├── TopResourcesList.tsx           # Top resources table
├── TopUsersList.tsx               # Top users table
├── AnomalyAlertsPanel.tsx         # Anomaly alerts display
├── DashboardFilters.tsx           # Filter controls
├── DrillDownDrawer.tsx            # Detail drawer for drill-down
├── __tests__/
│   ├── CostDashboardPage.test.tsx
│   ├── DashboardKPICards.test.tsx
│   ├── TrendChart.test.tsx
│   ├── TopResourcesList.test.tsx
│   ├── TopUsersList.test.tsx
│   ├── AnomalyAlertsPanel.test.tsx
│   └── DashboardFilters.test.tsx

src/lib/hooks/
├── use-cost-dashboard.ts          # React Query hook for dashboard data
├── use-quota-usage.ts             # React Query hook for quota data
└── __tests__/
    ├── use-cost-dashboard.test.ts
    └── use-quota-usage.test.ts

src/lib/utils/
├── dashboard/
│   ├── aggregate-trends.ts        # Time aggregation utilities
│   ├── detect-anomalies.ts        # Anomaly detection algorithm
│   ├── format-metrics.ts          # Metric formatting
│   └── __tests__/
│       ├── aggregate-trends.test.ts
│       ├── detect-anomalies.test.ts
│       └── format-metrics.test.ts
```

---

## Unit Tests

### 1. DashboardKPICards.test.tsx

```typescript
describe('DashboardKPICards', () => {
  it('renders loading skeleton when loading=true', () => {
    // Test: Show skeleton placeholders
  });

  it('renders all KPI cards with data', () => {
    // Test: Display requests, tokens, errors, cost cards
  });

  it('displays trend indicator (up/down) for each metric', () => {
    // Test: Show percentage change vs previous period
  });

  it('formats large numbers correctly (K/M/B suffixes)', () => {
    // Test: 1.2M, 345K, 1.5B formatting
  });

  it('hides optional cost card when cost data unavailable', () => {
    // Test: Cost card is optional
  });

  it('applies error color for error trend increase', () => {
    // Test: Errors going up = red/orange
  });

  it('applies success color for requests trend increase', () => {
    // Test: Requests going up = green (usually good)
  });
});
```

### 2. TrendChart.test.tsx

```typescript
describe('TrendChart', () => {
  it('renders line chart with data points', () => {
    // Test: Chart renders with all data points
  });

  it('handles empty data gracefully', () => {
    // Test: Show "No data available" message
  });

  it('switches between daily/weekly/monthly granularity', () => {
    // Test: Granularity selector updates chart
  });

  it('shows tooltip on hover with details', () => {
    // Test: Tooltip displays timestamp, value, change
  });

  it('handles drill-down click on data point', () => {
    // Test: Clicking point opens detail drawer
  });

  it('formats x-axis labels based on granularity', () => {
    // Test: Day=MM-DD, Week=MM-DD, Month=YYYY-MM
  });

  it('formats y-axis with appropriate scale', () => {
    // Test: Auto-scale y-axis (K/M/B)
  });
});
```

### 3. TopResourcesList.test.tsx

```typescript
describe('TopResourcesList', () => {
  it('renders table with sorted resources', () => {
    // Test: Resources sorted by requests (desc)
  });

  it('displays resource type badge', () => {
    // Test: endpoint/agent/source_library badges
  });

  it('handles empty state', () => {
    // Test: Show "No resources found" message
  });

  it('handles row click for drill-down', () => {
    // Test: Clicking row opens resource detail
  });

  it('displays progress bar for quota percentage', () => {
    // Test: Visual quota usage bar
  });
});
```

### 4. TopUsersList.test.tsx

```typescript
describe('TopUsersList', () => {
  it('renders table with sorted users', () => {
    // Test: Users sorted by requests (desc)
  });

  it('displays user avatar/name', () => {
    // Test: Show user identification
  });

  it('handles empty state', () => {
    // Test: Show "No users found" message
  });

  it('handles row click for drill-down', () => {
    // Test: Clicking row opens user detail
  });
});
```

### 5. AnomalyAlertsPanel.test.tsx

```typescript
describe('AnomalyAlertsPanel', () => {
  it('renders list of anomalies', () => {
    // Test: Display all detected anomalies
  });

  it('displays severity badge (low/medium/high)', () => {
    // Test: Color-coded severity indicators
  });

  it('shows anomaly type icon', () => {
    // Test: spike/pattern icons
  });

  it('handles empty state when no anomalies', () => {
    // Test: Show "No anomalies detected" message
  });

  it('handles click to view anomaly details', () => {
    // Test: Click opens detail drawer
  });

  it('displays affected resources for each anomaly', () => {
    // Test: Show which resources are impacted
  });
});
```

### 6. DashboardFilters.test.tsx

```typescript
describe('DashboardFilters', () => {
  it('renders date range picker', () => {
    // Test: Date range input visible
  });

  it('renders granularity selector (day/week/month)', () => {
    // Test: Granularity dropdown
  });

  it('renders resource type filter', () => {
    // Test: Resource type multi-select
  });

  it('renders resource ID filter when type selected', () => {
    // Test: Conditional resource ID input
  });

  it('calls onChange with filter values', () => {
    // Test: Filter changes trigger callback
  });

  it('calls onClear when clear button clicked', () => {
    // Test: Clear resets filters
  });

  it('shows active filter count badge', () => {
    // Test: Display number of active filters
  });
});
```

---

## Unit Tests - Utilities

### 7. aggregate-trends.test.ts

```typescript
describe('aggregateTrends', () => {
  it('aggregates hourly data to daily buckets', () => {
    // Test: Sum values by day
  });

  it('aggregates daily data to weekly buckets', () => {
    // Test: Sum values by week (Mon-Sun)
  });

  it('aggregates daily data to monthly buckets', () => {
    // Test: Sum values by month
  });

  it('handles timezone correctly', () => {
    // Test: Uses project timezone or UTC
  });

  it('fills missing buckets with zeros', () => {
    // Test: No gaps in time series
  });

  it('calculates change percent vs previous period', () => {
    // Test: Compare same bucket from previous period
  });
});
```

### 8. detect-anomalies.test.ts

```typescript
describe('detectAnomalies', () => {
  it('detects request spike (>2x median)', () => {
    // Test: Spike threshold triggers alert
  });

  it('detects error spike (>5x baseline)', () => {
    // Test: Error spike uses higher threshold
  });

  it('detects cost spike (>1.5x average)', () => {
    // Test: Cost spike threshold
  });

  it('detects unusual pattern (low traffic)', () => {
    // Test: Drop below 50% of expected
  });

  it('assigns severity based on deviation', () => {
    // Test: <2x=low, 2-5x=medium, >5x=high
  });

  it('returns empty array for normal data', () => {
    // Test: No false positives
  });

  it('excludes recent data points from baseline', () => {
    // Test: Use historical data for baseline calc
  });
});
```

### 9. format-metrics.test.ts

```typescript
describe('formatMetrics', () => {
  it('formats numbers with K suffix (thousands)', () => {
    // Test: 1234 → 1.2K
  });

  it('formats numbers with M suffix (millions)', () => {
    // Test: 1234567 → 1.2M
  });

  it('formats numbers with B suffix (billions)', () => {
    // Test: 1234567890 → 1.2B
  });

  it('formats percentages with appropriate precision', () => {
    // Test: 0.1% for small, 1% for large values
  });

  it('formats duration (ms to s/m/h)', () => {
    // Test: 500ms, 1.5s, 2m
  });

  it('formats bytes (KB/MB/GB)', () => {
    // Test: 1024 → 1KB, 1048576 → 1MB
  });
});
```

---

## Integration Tests

### 10. use-cost-dashboard.test.ts

```typescript
describe('useCostDashboard', () => {
  it('fetches dashboard data with correct params', () => {
    // Test: API called with workspaceId, projectId, filters
  });

  it('caches responses with React Query', () => {
    // Test: Subsequent calls use cache
  });

  it('refetches when filters change', () => {
    // Test: New filter triggers refetch
  });

  it('handles API errors gracefully', () => {
    // Test: Error state exposed
  });

  it('respects enabled flag for conditional fetching', () => {
    // Test: Can pause fetching
  });
});
```

### 11. CostDashboardPage.integration.test.tsx

```typescript
describe('CostDashboardPage Integration', () => {
  it('renders full dashboard with real data hook', () => {
    // Test: Page renders with all components
  });

  it('updates chart when granularity changes', () => {
    // Test: Granularity filter updates chart
  });

  it('drills down to resource detail when row clicked', () => {
    // Test: Row click opens detail drawer
  });

  it('refreshes data when refresh clicked', () => {
    // Test: Refresh button triggers refetch
  });
});
```

---

## E2E Tests

### 12. e2e/cost-dashboard.spec.ts

```typescript
test.describe('Cost Dashboard', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'cost-dashboard');
  });

  test('page loads successfully', async ({ authedPage }) => {
    // Test: Reach page-state__success
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible();
  });

  test('KPI cards display summary metrics', async ({ authedPage }) => {
    // Test: Cards show requests, tokens, errors
    await expect(authedPage.getByText(/requests/i)).toBeVisible();
    await expect(authedPage.getByText(/tokens/i)).toBeVisible();
  });

  test('trend chart renders with data', async ({ authedPage }) => {
    // Test: Chart canvas exists and has data points
    await expect(authedPage.getByTestId('dashboard__trend-chart')).toBeVisible();
  });

  test('granularity selector updates chart', async ({ authedPage }) => {
    // Test: Switching granularity refreshes chart
    await authedPage.getByRole('button', { name: /weekly/i }).click();
    await expect(authedPage.getByTestId('dashboard__trend-chart')).toBeVisible();
  });

  test('top resources list renders', async ({ authedPage }) => {
    // Test: Resources table visible with data
    await expect(authedPage.getByTestId('dashboard__top-resources')).toBeVisible();
  });

  test('top users list renders', async ({ authedPage }) => {
    // Test: Users table visible with data
    await expect(authedPage.getByTestId('dashboard__top-users')).toBeVisible();
  });

  test('anomaly panel shows alerts when present', async ({ authedPage }) => {
    // Test: Anomaly alerts visible in mock data
    await expect(authedPage.getByTestId('dashboard__anomalies')).toBeVisible();
  });

  test('filter by resource type works', async ({ authedPage }) => {
    // Test: Selecting resource type filters data
    await authedPage.getByRole('combobox', { name: /resource type/i }).click();
    await authedPage.getByRole('option', { name: /endpoint/i }).click();
    // Verify filtered results
  });

  test('date range filter works', async ({ authedPage }) => {
    // Test: Changing date range updates data
    await authedPage.getByPlaceholder(/start date/i).fill('2026-02-01');
    await authedPage.getByRole('button', { name: /apply/i }).click();
    // Verify updated data
  });

  test('drill-down to resource detail works', async ({ authedPage }) => {
    // Test: Clicking resource row opens drawer
    const resourceRow = authedPage.getByTestId('dashboard__resource-row').first();
    await resourceRow.click();
    await expect(authedPage.getByTestId('dashboard__detail-drawer')).toBeVisible();
  });

  test('refresh button updates data', async ({ authedPage }) => {
    // Test: Refresh button triggers data reload
    await authedPage.getByRole('button', { name: /refresh/i }).click();
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible();
  });
});
```

---

## Test Data Fixtures

### MSW Mock Data

```typescript
// src/mocks/fixtures/cost-dashboard.ts
export const mockCostDashboardData: CostDashboardData = {
  time_range: {
    start: '2026-02-01T00:00:00Z',
    end: '2026-02-27T23:59:59Z',
    granularity: 'day',
  },
  trends: {
    requests: [
      { timestamp: '2026-02-01T00:00:00Z', value: 4500, change_percent: 5.2 },
      { timestamp: '2026-02-02T00:00:00Z', value: 4800, change_percent: 6.7 },
      // ... more data points
    ],
    tokens: [
      { timestamp: '2026-02-01T00:00:00Z', value: 2400000, change_percent: 3.1 },
      // ...
    ],
    errors: [
      { timestamp: '2026-02-01T00:00:00Z', value: 23, change_percent: -2.5 },
      // ...
    ],
  },
  top_resources: [
    {
      resource_id: 'ep_1',
      resource_type: 'endpoint',
      resource_name: 'GPT-4',
      requests: 15230,
      tokens: 8450000,
      errors: 45,
      cost_usd: 12.50,
    },
    // ... more resources
  ],
  top_users: [
    {
      end_user_id: 'user_1',
      user_name: 'Alice Johnson',
      requests: 8450,
      tokens: 4500000,
      errors: 12,
      cost_usd: 6.20,
    },
    // ... more users
  ],
  anomalies: [
    {
      id: 'anom_1',
      timestamp: '2026-02-15T14:30:00Z',
      severity: 'high',
      type: 'requests_spike',
      description: 'Unusual spike in requests',
      value: 12500,
      expected_range: { min: 3000, max: 6000 },
      affected_resources: [
        { type: 'endpoint', id: 'ep_1', name: 'GPT-4' },
      ],
    },
  ],
  summary: {
    total_requests: 124500,
    total_tokens: 67800000,
    total_errors: 567,
    total_cost_usd: 89.50,
    avg_response_time_ms: 450,
  },
};

export const mockQuotaUsageData: QuotaUsageData = {
  project_id: 'proj_1',
  time_range: {
    start: '2026-02-01T00:00:00Z',
    end: '2026-02-27T23:59:59Z',
  },
  overall: {
    requests_today: 4523,
    requests_limit: 10000,
    requests_remaining: 5477,
    requests_reset_at: '2026-02-28T00:00:00Z',
    tokens_today: 2456000,
    tokens_limit: 5000000,
    tokens_remaining: 2544000,
    tokens_reset_at: '2026-02-28T00:00:00Z',
    storage_bytes_used: 52428800,
    storage_bytes_limit: 1073741824,
  },
  by_resource: [
    {
      resource_id: 'ep_1',
      resource_type: 'endpoint',
      resource_name: 'GPT-4',
      requests_today: 2340,
      requests_limit: 5000,
      requests_remaining: 2660,
      tokens_today: 1450000,
      tokens_limit: 3000000,
      tokens_remaining: 1550000,
    },
  ],
  trend: [
    { date: '2026-02-01', requests_percent: 45.2, tokens_percent: 49.1 },
    { date: '2026-02-02', requests_percent: 48.0, tokens_percent: 51.2 },
    // ... more trend points
  ],
};
```

---

## Implementation Order (TDD Red-Green-Refactor)

### Phase 1: Utilities (Week 1, Days 1-2)
1. Write tests for `aggregate-trends.ts` → Watch fail → Implement
2. Write tests for `detect-anomalies.ts` → Watch fail → Implement
3. Write tests for `format-metrics.ts` → Watch fail → Implement

### Phase 2: Data Hooks (Week 1, Days 3-4)
1. Write tests for `use-cost-dashboard.ts` → Watch fail → Implement
2. Write tests for `use-quota-usage.ts` → Watch fail → Implement
3. Add MSW handlers for dashboard endpoints

### Phase 3: Components (Week 2, Days 1-3)
1. Write tests for `DashboardKPICards` → Watch fail → Implement
2. Write tests for `TrendChart` → Watch fail → Implement
3. Write tests for `TopResourcesList` → Watch fail → Implement
4. Write tests for `TopUsersList` → Watch fail → Implement
5. Write tests for `AnomalyAlertsPanel` → Watch fail → Implement
6. Write tests for `DashboardFilters` → Watch fail → Implement

### Phase 4: Page Integration (Week 2, Days 4-5)
1. Write tests for `CostDashboardPage` → Watch fail → Implement
2. Write integration tests for full page flow
3. Create route layout and page component

### Phase 5: E2E Tests (Week 2, Day 5)
1. Write E2E tests for dashboard page
2. Add to visual regression suite
3. Verify responsive layout

---

## Open Questions

1. **Chart Library:** Which chart library to use? (Recharts, Chart.js, Victory?)
   - Recommendation: Recharts (React-friendly, good TypeScript support)

2. **Anomaly Algorithm:** What detection method?
   - Recommendation: Statistical (median absolute deviation) for MVP

3. **Real-time Updates:** Should dashboard auto-refresh?
   - Recommendation: Manual refresh only for MVP (avoid polling complexity)

4. **Data Retention:** How far back can users query?
   - Recommendation: 90 days max for performance

---

## Dependencies

- **Blocked by:** M2 (P0 Main Development) - Must complete first
- **Depends on:** Usage API data structure (already exists)
- **Related:** Epic C2 (Alert Center) - May share alert types

---

## Sign-Off

**Test Plan Created By:** dev-3
**Date:** 2026-02-27
**Status:** ✅ Ready for Review

**Next Steps:**
1. Product-manager to review and approve test plan
2. M2 to complete (unblock development)
3. Begin TDD implementation following Red-Green-Refactor cycle
