# Epic C: Technical Design & Implementation Plan

**Date:** 2026-02-27
**Author:** dev-5
**Status:** Draft - Preparatory Research

---

## Executive Summary

This document provides technical research and design recommendations for Epic C features:
- **C1: Cost & Quota Dashboard** - Visual operations dashboard for cost and quota monitoring
- **C2: Alert Center (Basic Version)** - Alert management and notification system

---

## Part 1: Current State Analysis

### 1.1 Existing Infrastructure

#### Components Already Available
```
src/components/audit-usage/
├── UsagePage.tsx           # Full usage page with filters, KPI cards
├── UsageKPICards.tsx       # KPI cards with trend indicators
├── UsageTable.tsx          # Paginated usage records table
├── UsageFilters.tsx        # Filter controls
├── TimeRangePicker.tsx     # Time range selector
├── AuditPage.tsx           # Audit log viewer
└── AuditTable.tsx          # Audit records table
```

#### API Layer
- `src/lib/api/endpoints/audit-usage.ts` - AuditAPI and UsageAPI classes
- `src/lib/hooks/use-audit-usage.ts` - React Query hooks
- `src/lib/api/types/index.ts` - Type definitions

#### Data Types
```typescript
// Current UsageKPI structure
interface UsageKPI {
  requests_today: number;
  errors_today: number;
  tokens_today?: number;
  requests_yesterday?: number;
  errors_yesterday?: number;
  tokens_yesterday?: number;
}

// Current UsageRecord structure
interface UsageRecord {
  id: string;
  time_bucket: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
}
```

### 1.2 Charting Library Analysis

**Finding: No charting library is currently installed.**

#### Recommended Options

| Library | Bundle Size | React Integration | Pros | Cons | Recommendation |
|---------|-------------|-------------------|------|-------|----------------|
| **Recharts** | ~95KB gzipped | First-class | Declarative, TypeScript-friendly, composable | Less customizable than D3 | **RECOMMENDED** |
| Chart.js + react-chartjs-2 | ~70KB gzipped | Wrapper | Popular, many chart types | Imperative API | Good alternative |
| @tanstack/charts | ~40KB gzipped | Native | Works with TanStack Query | New, fewer features | For future |

**Recommendation: Use Recharts**
- Declarative API matches Radix UI patterns
- Good TypeScript support
- Responsive by default
- Light/dark theme compatible via CSS variables

**Installation:**
```bash
npm install recharts
```

### 1.3 Notification/Alert Patterns

#### Existing Toast System
- `src/components/ui/toast.tsx` - Zustand-based toast notifications
- Types: `success`, `error`, `warning`, `info`
- Auto-dismiss after 5 seconds (configurable)
- Fixed position: bottom-right

#### Existing Dialog Components
- `src/components/ui/alert-dialog.tsx` - Radix AlertDialog wrapper
- For critical confirmations

#### Alert Center Requirements
The existing toast system is for transient notifications. Alert Center needs:
1. Persistent alert storage (Zustand store + localStorage persistence)
2. In-app bell icon with unread badge
3. Alert list view with filtering
4. Mark as read/dismiss functionality
5. Alert preferences/configuration

---

## Part 2: Epic C1 - Cost & Quota Dashboard Design

### 2.1 Feature Requirements

Based on `docs/plans/m1-architecture-contracts-v1.md`, Epic C1 needs:

1. **Cost visualization** by resource type (endpoint, agent, source_library)
2. **Quota progress bars** showing usage vs. limits
3. **Time-series charts** for trends (requests, tokens, errors)
4. **Resource breakdown** with drill-down capability
5. **Export functionality** for cost reports

### 2.2 Component Architecture

```
src/components/dashboard/ (new directory)
├── CostDashboardPage.tsx      # Main dashboard page
├── QuotaOverview.tsx          # Quota progress cards
├── CostTimeSeriesChart.tsx    # Time-series chart (Recharts)
├── ResourceCostBreakdown.tsx  # Bar/pie chart by resource
├── CostTable.tsx              # Detailed cost table
├── DashboardFilters.tsx       # Shared filter controls
└── __tests__/
    └── CostDashboardPage.test.tsx
```

### 2.3 Data Requirements

#### New API Endpoints Needed
```typescript
// GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/limits/summary
interface QuotaSummary {
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  resource_name: string;
  quota_used: number;
  quota_limit: number;
  quota_reset_at: string;  // ISO 8601
  percentage_used: number;
}

// GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/cost/timeseries
interface CostTimeSeriesRequest {
  start_time: string;
  end_time: string;
  group_by: 'day' | 'hour';
  resource_type?: string;
}

interface CostTimeSeriesDataPoint {
  time_bucket: string;
  requests: number;
  tokens: number;
  estimated_cost: number;  // USD
  errors: number;
}
```

### 2.4 UI/UX Specifications

#### Chart Components (Recharts)

**Time Series Chart:**
```tsx
<CostTimeSeriesChart
  data={timeSeriesData}
  metrics={['requests', 'tokens', 'errors']}
  timeRange="7d"
  onTimeRangeChange={setTimeRange}
/>
```

**Design Tokens:**
- Primary line: `--accent` (blue)
- Secondary line: `--success` (green)
- Error line: `--error` (red)
- Grid lines: `--border-subtle`
- Tooltip bg: `--bg-surface-high`

**Quota Progress Cards:**
```tsx
<QuotaCard
  title="API Endpoint Quota"
  used={85000}
  limit={100000}
  unit="tokens"
  resetAt="2026-02-28T00:00:00Z"
  trend={{ value: 12, direction: 'up' }}  // 12% increase
/>
```

**Progress Bar Styling:**
- 0-50% used: `--success` (green)
- 50-80% used: `--warning` (yellow/orange)
- 80-100% used: `--error` (red)
- Animated fill on load

### 2.5 Hook Design

```typescript
// src/lib/hooks/use-cost-dashboard.ts
export function useCostDashboard(
  workspaceId: string,
  projectId: string,
  timeRange: TimeRange
) {
  const quotaSummary = useQuery({
    queryKey: ['limits-summary'], workspaceId, projectId],
    queryFn: () => quotaAPI.getSummary(workspaceId, projectId),
    staleTime: 60000, // 1 minute
  });

  const timeSeries = useQuery({
    queryKey: ['cost-timeseries', workspaceId, projectId, timeRange],
    queryFn: () => costAPI.getTimeSeries(workspaceId, projectId, timeRange),
    staleTime: 60000,
  });

  return {
    quotaSummary: quotaSummary.data,
    timeSeries: timeSeries.data,
    isLoading: quotaSummary.isLoading || timeSeries.isLoading,
    error: quotaSummary.error || timeSeries.error,
  };
}
```

---

## Part 3: Epic C2 - Alert Center Design

### 3.1 Feature Requirements

Based on the architecture doc, Alert Center (Basic) needs:

1. **Alert bell icon** in top bar with unread badge count
2. **Alert list panel** showing recent alerts
3. **Filter by severity** (info, warning, error, critical)
4. **Alert types**: quota exceeded, rate limit exceeded, policy violation
5. **Mark as read/dismiss** actions
6. **Navigate to resource** from alert

### 3.2 Component Architecture

```
src/components/alerts/ (new directory)
├── AlertBell.tsx              # Bell icon in top bar
├── AlertCenterPanel.tsx       # Main alert list view
├── AlertItem.tsx              # Individual alert card
├── AlertFilters.tsx           # Severity/type filters
├── AlertPreferences.tsx       # User notification settings
└── __tests__/
    └── AlertCenter.test.tsx

src/lib/stores/alertStore.ts   # New Zustand store
src/lib/hooks/use-alerts.ts    # Alert hooks
```

### 3.3 Data Structure

```typescript
// src/lib/types/alerts.ts
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AlertType =
  | 'quota.exceeded'
  | 'rate_limit.exceeded'
  | 'policy.allow_list.denied'
  | 'endpoint.error'
  | 'system.maintenance';

export interface Alert {
  id: string;
  workspace_id: string;
  project_id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  resource_type?: string;
  resource_id?: string;
  resource_name?: string;  // For display
  metadata: Record<string, unknown>;
  created_at: string;  // ISO 8601
  read_at?: string;
  dismissed_at?: string;
  expires_at?: string;  // Auto-dismiss after
}

export interface AlertPreferences {
  email_notifications: boolean;
  push_notifications: boolean;
  severity_threshold: AlertSeverity;  // Minimum severity to notify
  alert_types: AlertType[];  // Enabled alert types
}
```

### 3.4 Store Design

```typescript
// src/lib/stores/alertStore.ts
interface AlertStore {
  // State
  alerts: Alert[];
  unreadCount: number;
  preferences: AlertPreferences;

  // Actions
  addAlert: (alert: Omit<Alert, 'id' | 'created_at'>) => void;
  markAsRead: (alertId: string) => void;
  dismissAlert: (alertId: string) => void;
  markAllAsRead: () => void;
  updatePreferences: (prefs: Partial<AlertPreferences>) => void;

  // Persistence
  _loadFromStorage: () => void;
  _saveToStorage: () => void;
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  alerts: [],
  unreadCount: 0,
  preferences: defaultPreferences,

  addAlert: (alertData) => {
    const alert: Alert = {
      ...alertData,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      created_at: new Date().toISOString(),
    };
    set((state) => ({
      alerts: [alert, ...state.alerts],
      unreadCount: state.unreadCount + 1,
    }));
    get()._saveToStorage();

    // Show toast for high-severity alerts
    if (alert.severity === 'error' || alert.severity === 'critical') {
      toast.error(alert.title);
    }
  },

  markAsRead: (alertId) => {
    set((state) => {
      const alerts = state.alerts.map((a) =>
        a.id === alertId ? { ...a, read_at: new Date().toISOString() } : a
      );
      return { alerts, unreadCount: alerts.filter((a) => !a.read_at).length };
    });
    get()._saveToStorage();
  },

  // ... other actions
}));
```

### 3.5 UI/UX Specifications

#### Alert Bell Component
- Position: Top bar, right side
- Unread badge: Red dot with count (>9 shows "9+")
- Click: Opens AlertCenterPanel as slide-over

#### Alert Item Component
```
┌─────────────────────────────────────────┐
│ [!]  Quota Exceeded        [2h ago]   │
│      Endpoint: gpt-4 has exceeded     │
│      daily token limit (85%)          │
│      [View Details] [Dismiss]         │
└─────────────────────────────────────────┘
```

**Severity Indicators:**
- Critical: Red dot + bold title
- Error: Red dot
- Warning: Yellow dot
- Info: Blue dot

### 3.6 Alert Generation Triggers

Alerts can be generated from:

1. **API Layer** - When quota/rate limit errors occur
2. **SSE Events** - Real-time backend alerts
3. **Client-side Polling** - Periodic quota check

```typescript
// Example: Hook to check quota and generate alerts
export function useQuotaAlerts(
  workspaceId: string,
  projectId: string
) {
  const { data: quotaSummary } = useCostDashboard(workspaceId, projectId);
  const addAlert = useAlertStore((s) => s.addAlert);

  useEffect(() => {
    if (!quotaSummary) return;

    quotaSummary.forEach((quota) => {
      const pct = quota.percentage_used;

      // Alert at 80% warning
      if (pct >= 80 && pct < 100) {
        addAlert({
          workspace_id: workspaceId,
          project_id: projectId,
          type: 'quota.exceeded',
          severity: 'warning',
          title: `Quota usage at ${pct}%`,
          message: `${quota.resource_name} has used ${quota.quota_used}/${quota.quota_limit} ${quota.unit}`,
          resource_type: quota.resource_type,
          resource_id: quota.resource_id,
          resource_name: quota.resource_name,
          metadata: { percentage: pct },
        });
      }

      // Alert at 100% critical
      if (pct >= 100) {
        addAlert({
          workspace_id: workspaceId,
          project_id: projectId,
          type: 'quota.exceeded',
          severity: 'critical',
          title: `Quota exceeded for ${quota.resource_name}`,
          message: `${quota.resource_name} has exceeded its ${quota.unit} limit`,
          resource_type: quota.resource_type,
          resource_id: quota.resource_id,
          resource_name: quota.resource_name,
          metadata: { exceeded_by: pct - 100 },
        });
      }
    });
  }, [quotaSummary, workspaceId, projectId, addAlert]);
}
```

---

## Part 4: Implementation Recommendations

### 4.1 Phase 1: Cost & Quota Dashboard (C1)

**Week 1:**
1. Install Recharts
2. Create `QuotaOverview.tsx` component
3. Implement `useLimitsSummary` hook
4. Mock quota data for development

**Week 2:**
1. Create `CostTimeSeriesChart.tsx` with Recharts
2. Implement time series API endpoint (backend)
3. Add dashboard filters and export

**Week 3:**
1. Create `ResourceCostBreakdown.tsx`
2. Integration testing
3. E2E tests for dashboard

### 4.2 Phase 2: Alert Center (C2)

**Week 1:**
1. Create `alertStore.ts` with persistence
2. Create `AlertBell.tsx` component for top bar
3. Implement `AlertCenterPanel.tsx` slide-over

**Week 2:**
1. Create `AlertItem.tsx` with actions
2. Implement alert generation from quota checks
3. Add `AlertPreferences.tsx` settings

**Week 3:**
1. SSE integration for real-time alerts
2. Integration testing
3. E2E tests for alert center

### 4.3 Dependencies

**Epic C1 depends on:**
- ✅ Epic A2: Resource Policy Execution (for quota data)
- ✅ Backend quota API endpoints

**Epic C2 depends on:**
- ✅ Epic C1: Cost Dashboard (for quota monitoring)
- ✅ Epic A2: Resource Policy Execution (for policy violation alerts)

---

## Part 5: Open Questions

1. **Cost Calculation**: What is the pricing model per token? Need to define `pricing_json` in Endpoint model.
2. **Alert Retention**: How long should alerts persist in localStorage?
3. **SSE vs Polling**: For real-time alerts, should we rely on SSE or fallback to polling?
4. **Backend Alert API**: Should alerts be stored server-side or client-only for MVP?

---

## Part 6: Testing Strategy

### 6.1 Unit Tests (Vitest)
- Chart component rendering
- Alert store actions
- Hook data fetching

### 6.2 E2E Tests (Playwright)
- Dashboard page loads with data
- Quota progress bars display correctly
- Alert bell shows unread count
- Mark as read/dismiss actions work

### 6.3 Visual Regression
- Chart snapshots for regression
- Alert panel UI consistency

---

## Appendix: File Structure Summary

```
src/
├── components/
│   ├── audit-usage/          # Existing
│   ├── dashboard/            # NEW for C1
│   │   ├── CostDashboardPage.tsx
│   │   ├── QuotaOverview.tsx
│   │   ├── CostTimeSeriesChart.tsx
│   │   └── ResourceCostBreakdown.tsx
│   └── alerts/               # NEW for C2
│       ├── AlertBell.tsx
│       ├── AlertCenterPanel.tsx
│       └── AlertItem.tsx
├── lib/
│   ├── api/
│   │   └── endpoints/
│   │       └── cost.ts      # NEW for C1
│   ├── hooks/
│   │   ├── use-cost-dashboard.ts  # NEW for C1
│   │   └── use-alerts.ts          # NEW for C2
│   ├── stores/
│   │   └── alertStore.ts          # NEW for C2
│   └── types/
│       └── alerts.ts              # NEW for C2
```

---

**Next Steps:**
1. Review and approve this design document
2. Create TDD test plans for C1 and C2
3. Begin Phase 1 implementation when M2 is complete
