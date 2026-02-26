# Epic C2: Alert Center (Basic Version) - TDD Test Plan

**Date:** 2026-02-27
**Owner:** dev-3
**Status:** Planning Phase (Blocked by M2)

---

## Overview

This document outlines the comprehensive test plan for the Alert Center (Basic Version) feature, following Test-Driven Development (TDD) principles.

**Requirements (from PRD):**
- Threshold alerts: requests/day, quota%, error-rate
- In-site alerts + webhook delivery
- Alert rule CRUD operations
- Debounce mechanism (prevent alert spam)
- Recovery notification (alert cleared when condition recovers)

**Acceptance Criteria:**
1. Alert rule CRUD available
2. Alert trigger has debounce and recovery notification

---

## Data Structures (API Contracts)

### 1. AlertRule

```typescript
interface AlertRule {
  id: string;
  project_id: string;
  workspace_id: string;

  // Basic info
  name: string;
  description?: string;
  enabled: boolean;

  // Trigger conditions
  trigger: {
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    window?: AlertWindow;  // For time-aggregated metrics
  };

  // Notification channels
  channels: {
    in_app: boolean;  // Show in UI notification center
    webhook?: {
      url: string;
      headers?: Record<string, string>;
    };
  };

  // Behavior
  behavior: {
    debounce_minutes: number;  // Minimum time between alerts
    notify_on_recovery: boolean;  // Send "resolved" notification
  };

  // Metadata
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  last_triggered_at?: string;
}

type AlertMetric =
  | 'requests_per_day'      // Total requests in 24h
  | 'requests_per_hour'     // Requests in last hour
  | 'quota_percent'         // Quota usage percentage
  | 'error_rate'            // Error rate (errors/total * 100)
  | 'token_usage'           // Token usage in window
  | 'response_time_p95';    // P95 response time

type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

type AlertWindow = '5m' | '15m' | '1h' | '24h' | '7d';
```

### 2. AlertNotification

```typescript
interface AlertNotification {
  id: string;
  rule_id: string;
  rule_name: string;

  // Status
  status: 'firing' | 'resolved' | 'silenced';

  // Trigger info
  triggered_at: string;
  resolved_at?: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  actual_value: number;

  // Context
  context: {
    resource_type?: string;
    resource_id?: string;
    resource_name?: string;
    end_user_id?: string;
  };

  // Delivery status
  delivery: {
    in_app_sent: boolean;
    in_app_seen_at?: string;
    webhook_sent: boolean;
    webhook_status?: number;
    webhook_error?: string;
  };
}
```

### 3. AlertRuleCreateRequest

```typescript
interface AlertRuleCreateRequest {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: {
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    window?: AlertWindow;
  };
  channels: {
    in_app: boolean;
    webhook?: {
      url: string;
      headers?: Record<string, string>;
    };
  };
  behavior: {
    debounce_minutes: number;
    notify_on_recovery: boolean;
  };
}
```

### 4. AlertRuleUpdateRequest

```typescript
interface AlertRuleUpdateRequest extends Partial<AlertRuleCreateRequest> {
  // All fields optional for PATCH
}
```

### 5. AlertHistoryListParams

```typescript
interface AlertHistoryListParams extends PaginationParams {
  rule_id?: string;
  status?: 'firing' | 'resolved' | 'silenced';
  start_time?: string;
  end_time?: string;
}
```

---

## API Endpoints

```
# List alert rules
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules
Response: PaginatedResponse<AlertRule>

# Create alert rule
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules
Body: AlertRuleCreateRequest
Response: AlertRule

# Get alert rule
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules/{ruleId}
Response: AlertRule

# Update alert rule
PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules/{ruleId}
Body: AlertRuleUpdateRequest
Response: AlertRule

# Delete alert rule
DELETE /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules/{ruleId}
Response: 204 No Content

# Test alert rule (dry run)
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-rules/{ruleId}/test
Response: { would_trigger: boolean; actual_value: number; details: string }

# List alert notifications
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-notifications
Query: AlertHistoryListParams
Response: PaginatedResponse<AlertNotification>

# Acknowledge notification
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-notifications/{notificationId}/acknowledge
Response: AlertNotification

# Silence notification
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/alert-notifications/{notificationId}/silence
Body: { duration_minutes?: number }
Response: AlertNotification
```

---

## Component Structure

```
src/components/alert-center/
├── AlertCenterPage.tsx            # Main page component
├── AlertRulesList.tsx             # List of alert rules
├── AlertRuleCard.tsx              # Single rule display
├── AlertRuleFormDialog.tsx        # Create/edit dialog
├── AlertNotificationsPanel.tsx    # Notification center
├── AlertNotificationItem.tsx      # Single notification display
├── AlertHistoryDrawer.tsx         # History drawer
├── WebhookConfigForm.tsx          # Webhook configuration
├── __tests__/
│   ├── AlertCenterPage.test.tsx
│   ├── AlertRulesList.test.tsx
│   ├── AlertRuleCard.test.tsx
│   ├── AlertRuleFormDialog.test.tsx
│   ├── AlertNotificationsPanel.test.tsx
│   ├── AlertNotificationItem.test.tsx
│   ├── AlertHistoryDrawer.test.tsx
│   └── WebhookConfigForm.test.tsx

src/lib/hooks/
├── use-alert-rules.ts             # React Query hooks for rules
├── use-alert-notifications.ts     # React Query hooks for notifications
└── __tests__/
    ├── use-alert-rules.test.ts
    └── use-alert-notifications.test.ts

src/lib/alerts/
├── evaluation.ts                  # Rule evaluation logic
├── debounce.ts                    # Debounce state management
├── delivery.ts                    # Notification delivery (webhook)
└── __tests__/
    ├── evaluation.test.ts
    ├── debounce.test.ts
    └── delivery.test.ts
```

---

## Unit Tests

### 1. evaluation.test.ts

```typescript
describe('AlertRuleEvaluation', () => {
  describe('evaluateRule', () => {
    it('triggers when requests_per_day > threshold', () => {
      // Test: 1000 requests > 500 threshold = trigger
    });

    it('triggers when quota_percent > threshold', () => {
      // Test: 85% quota > 80% threshold = trigger
    });

    it('triggers when error_rate > threshold', () => {
      // Test: 5.2% errors > 5% threshold = trigger
    });

    it('does not trigger when condition not met', () => {
      // Test: 300 requests < 500 threshold = no trigger
    });

    it('handles "gte" operator correctly', () => {
      // Test: 500 >= 500 = trigger (edge case)
    });

    it('handles "lt" operator correctly', () => {
      // Test: 30 < 50 = trigger for "below threshold" alert
    });

    it('evaluates time window correctly', () => {
      // Test: Last 15 minutes vs last hour
    });

    it('respects disabled rules', () => {
      // Test: Disabled rule never triggers
    });
  });

  describe('shouldRecover', () => {
    it('returns true when value returns to normal', () => {
      // Test: 500 -> 200 (below 500 threshold) = recovery
    });

    it('returns false when still above threshold', () => {
      // Test: 500 -> 450 (still near threshold) = no recovery
    });

    it('includes hysteresis to prevent flapping', () => {
      // Test: Use 20% hysteresis band
    });
  });
});
```

### 2. debounce.test.ts

```typescript
describe('AlertDebounce', () => {
  describe('shouldSendAlert', () => {
    it('allows first alert immediately', () => {
      // Test: No recent alerts = send
    });

    it('blocks alerts within debounce window', () => {
      // Test: Alert 5 min ago = block (debounce=10min)
    });

    it('allows alerts after debounce window', () => {
      // Test: Alert 15 min ago = send (debounce=10min)
    });

    it('respects per-rule debounce state', () => {
      // Test: Different rules have independent debounce
    });

    it('allows recovery notification immediately', () => {
      // Test: Recovery bypasses debounce
    });
  });

  describe('recordAlert', () => {
    it('stores alert timestamp for debounce', () => {
      // Test: Timestamp recorded
    });

    it('updates existing entry for same rule', () => {
      // Test: Overwrites previous timestamp
    });
  });
});
```

### 3. delivery.test.ts

```typescript
describe('AlertDelivery', () => {
  describe('sendInAppNotification', () => {
    it('creates notification record', () => {
      // Test: Notification saved to DB
    });

    it('marks notification as sent', () => {
      // Test: delivery.in_app_sent = true
    });
  });

  describe('sendWebhook', () => {
    it('sends POST request to webhook URL', async () => {
      // Test: HTTP POST with alert payload
    });

    it('includes custom headers', async () => {
      // Test: Authorization, Content-Type, etc.
    });

    it('retries on failure (3 attempts)', async () => {
      // Test: Exponential backoff retry
    });

    it('marks delivery as failed after retries', async () => {
      // Test: webhook_error set after final failure
    });

    it('handles timeout gracefully', async () => {
      // Test: 10 second timeout
    });

    it('validates webhook URL format', async () => {
      // Test: Must be HTTPS
    });
  });
});
```

### 4. AlertRulesList.test.tsx

```typescript
describe('AlertRulesList', () => {
  it('renders list of alert rules', () => {
    // Test: All rules displayed
  });

  it('shows empty state when no rules', () => {
    // Test: "No alert rules configured" message
  });

  it('displays rule status (enabled/disabled)', () => {
    // Test: Toggle switch shows current state
  });

  it('displays last triggered time', () => {
    // Test: "Last triggered: 2 hours ago"
  });

  it('handles enable/disable toggle', () => {
    // Test: Toggle updates rule
  });

  it('handles edit button click', () => {
    // Test: Opens edit dialog
  });

  it('handles delete button click', () => {
    // Test: Shows confirmation dialog
  });

  it('handles test button click', () => {
    // Test: Shows "would trigger" result
  });

  it('shows loading state during fetch', () => {
    // Test: Skeleton loaders
  });
});
```

### 5. AlertRuleCard.test.tsx

```typescript
describe('AlertRuleCard', () => {
  it('displays rule name and description', () => {
    // Test: Name visible, description optional
  });

  it('displays trigger condition', () => {
    // Test: "requests/day > 1000"
  });

  it('displays notification channels', () => {
    // Test: Icons for in-app, webhook
  });

  it('displays behavior settings', () => {
    // Test: "Debounce: 10 min", "Recovery: yes"
  });

  it('shows firing status when actively triggered', () => {
    // Test: Red/orange indicator for firing
  });

  it('shows toggle for enable/disable', () => {
    // Test: Switch control
  });
});
```

### 6. AlertRuleFormDialog.test.tsx

```typescript
describe('AlertRuleFormDialog', () => {
  it('renders form fields for create', () => {
    // Test: All required fields present
  });

  it('pre-fills data for edit mode', () => {
    // Test: Existing rule data loaded
  });

  it('validates required fields', () => {
    // Test: Name, metric, threshold required
  });

  it('validates threshold is positive number', () => {
    // Test: Negative threshold rejected
  });

  it('validates webhook URL format', () => {
    // Test: Must be valid HTTPS URL
  });

  it('shows operator options based on metric', () => {
    // Test: quota_percent shows % operators
  });

  it('shows window options for time-based metrics', () => {
    // Test: requests_per_hour shows window options
  });

  it('submits create request on submit', () => {
    // Test: Form data sent to API
  });

  it('submits update request on edit', () => {
    // Test: PATCH request with changed fields
  });

  it('resets form on cancel', () => {
    // Test: Form cleared after close
  });
});
```

### 7. AlertNotificationsPanel.test.tsx

```typescript
describe('AlertNotificationsPanel', () => {
  it('renders list of notifications', () => {
    // Test: All notifications shown
  });

  it('shows empty state when no notifications', () => {
    // Test: "No alerts" message
  });

  it('displays firing notifications with error color', () => {
    // Test: Red/orange for firing
  });

  it('displays resolved notifications with success color', () => {
    // Test: Green for resolved
  });

  it('groups by rule for multiple occurrences', () => {
    // Test: Collapsible group for same rule
  });

  it('shows timestamp relative to now', () => {
    // Test: "2 hours ago"
  });

  it('handles acknowledge click', () => {
    // Test: Mark as seen
  });

  it('handles silence click', () => {
    // Test: Stop notifications for duration
  });

  it('shows delivery status for webhook', () => {
    // Test: Checkmark or error icon
  });
});
```

### 8. AlertNotificationItem.test.tsx

```typescript
describe('AlertNotificationItem', () => {
  it('displays rule name', () => {
    // Test: Which rule triggered
  });

  it('displays metric value and threshold', () => {
    // Test: "1200 requests/day > 1000"
  });

  it('displays affected resource context', () => {
    // Test: "endpoint: GPT-4"
  });

  it('shows recovery notification when resolved', () => {
    // Test: "Resolved at 3:30 PM"
  });

  it('links to relevant resource', () => {
    // Test: Click goes to resource detail
  });
});
```

### 9. WebhookConfigForm.test.tsx

```typescript
describe('WebhookConfigForm', () => {
  it('renders URL input field', () => {
    // Test: URL text input
  });

  it('renders headers key-value editor', () => {
    // Test: Dynamic header rows
  });

  it('adds new header row', () => {
    // Test: "Add header" button
  });

  it('removes header row', () => {
    // Test: Delete button on row
  });

  it('validates HTTPS requirement', () => {
    // Test: http:// rejected, https:// allowed
  });

  it('tests webhook connection', () => {
    // Test: "Test connection" sends ping
  });

  it('shows connection test result', () => {
    // Test: Success/error message
  });
});
```

---

## Integration Tests

### 10. use-alert-rules.test.ts

```typescript
describe('useAlertRules', () => {
  it('fetches alert rules list', () => {
    // Test: GET /alert-rules called
  });

  it('creates new alert rule', () => {
    // Test: POST /alert-rules with form data
  });

  it('updates existing alert rule', () => {
    // Test: PATCH /alert-rules/{id}
  });

  it('deletes alert rule', () => {
    // Test: DELETE /alert-rules/{id}
  });

  it('tests alert rule', () => {
    // Test: POST /alert-rules/{id}/test
  });

  it('invalidates cache on mutation', () => {
    // Test: List refetched after create/update/delete
  });
});
```

### 11. use-alert-notifications.test.ts

```typescript
describe('useAlertNotifications', () => {
  it('fetches notifications list', () => {
    // Test: GET /alert-notifications
  });

  it('acknowledges notification', () => {
    // Test: POST /alert-notifications/{id}/acknowledge
  });

  it('silences notification', () => {
    // Test: POST /alert-notifications/{id}/silence
  });

  it('filters by status', () => {
    // Test: Query param filtering
  });

  it('auto-refetches for real-time updates', () => {
    // Test: Polling or SSE for new notifications
  });
});
```

### 12. AlertCenterPage.integration.test.tsx

```typescript
describe('AlertCenterPage Integration', () => {
  it('renders full page with rules and notifications', () => {
    // Test: Both panels visible
  });

  it('creates rule and shows in list', () => {
    // Test: Create flow updates list
  });

  it('edits rule and updates display', () => {
    // Test: Edit flow updates card
  });

  it('deletes rule and removes from list', () => {
    // Test: Delete removes item
  });

  it('shows new notification when rule triggers', () => {
    // Test: Real-time notification appears
  });
});
```

---

## E2E Tests

### 13. e2e/alert-center.spec.ts

```typescript
test.describe('Alert Center', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'alert-center');
  });

  test('page loads successfully', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible();
  });

  test('alert rules list displays', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('alert-center__rules-list')).toBeVisible();
  });

  test('notifications panel displays', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('alert-center__notifications')).toBeVisible();
  });

  test.describe('Alert Rule CRUD', () => {
    test('creates new alert rule', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /create alert/i }).click();

      // Fill form
      await authedPage.getByLabel(/name/i).fill('High requests alert');
      await authedPage.getByLabel(/metric/i).selectOption('requests_per_day');
      await authedPage.getByLabel(/operator/i).selectOption('gt');
      await authedPage.getByLabel(/threshold/i).fill('1000');

      await authedPage.getByRole('button', { name: /create/i }).click();

      // Verify rule created
      await expect(authedPage.getByText('High requests alert')).toBeVisible();
    });

    test('edits existing alert rule', async ({ authedPage }) => {
      const ruleCard = authedPage.getByTestId('alert-rule__card').first();
      await ruleCard.getByRole('button', { name: /edit/i }).click();

      await authedPage.getByLabel(/threshold/i).fill('2000');
      await authedPage.getByRole('button', { name: /save/i }).click();

      // Verify updated
      await expect(authedPage.getByText('2000')).toBeVisible();
    });

    test('deletes alert rule', async ({ authedPage }) => {
      const ruleCard = authedPage.getByTestId('alert-rule__card').first();
      await ruleCard.getByRole('button', { name: /delete/i }).click();

      await authedPage.getByRole('button', { name: /confirm/i }).click();

      // Verify removed
      await expect(authedPage.getByTestId('alert-rule__card').first()).not.toBeVisible();
    });

    test('toggles rule enabled state', async ({ authedPage }) => {
      const toggle = authedPage.getByTestId('alert-rule__toggle').first();
      await toggle.click();

      // Verify state changed (check for disabled badge)
      await expect(authedPage.getByText(/disabled/i)).toBeVisible();
    });

    test('tests rule with dry run', async ({ authedPage }) => {
      const ruleCard = authedPage.getByTestId('alert-rule__card').first();
      await ruleCard.getByRole('button', { name: /test/i }).click();

      // Verify test result
      await expect(authedPage.getByText(/would trigger/i)).toBeVisible();
    });
  });

  test.describe('Webhook Configuration', () => {
    test('configures webhook for rule', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /create alert/i }).click();

      await authedPage.getByLabel(/enable webhook/i).check();
      await authedPage.getByLabel(/webhook url/i).fill('https://example.com/webhook');

      await authedPage.getByRole('button', { name: /test connection/i }).click();

      // Verify connection test
      await expect(authedPage.getByText(/connection successful/i)).toBeVisible();
    });

    test('rejects non-HTTPS webhook URL', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /create alert/i }).click();

      await authedPage.getByLabel(/enable webhook/i).check();
      await authedPage.getByLabel(/webhook url/i).fill('http://example.com/webhook');

      await authedPage.getByRole('button', { name: /create/i }).click();

      // Verify error
      await expect(authedPage.getByText(/must use https/i)).toBeVisible();
    });
  });

  test.describe('Notifications', () => {
    test('displays firing alert', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('alert-notification__firing')).toBeVisible();
    });

    test('displays resolved alert', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('alert-notification__resolved')).toBeVisible();
    });

    test('acknowledges notification', async ({ authedPage }) => {
      const notification = authedPage.getByTestId('alert-notification__item').first();
      await notification.getByRole('button', { name: /acknowledge/i }).click();

      // Verify marked as seen
      await expect(notification).toHaveClass(/seen/);
    });

    test('silences notification', async ({ authedPage }) => {
      const notification = authedPage.getByTestId('alert-notification__item').first();
      await notification.getByRole('button', { name: /silence/i }).click();

      // Verify silenced
      await expect(authedPage.getByText(/silenced/i)).toBeVisible();
    });

    test('shows recovery notification', async ({ authedPage }) => {
      // Recovery notification should appear when condition clears
      await expect(authedPage.getByText(/resolved/i)).toBeVisible();
    });
  });

  test.describe('Debounce Behavior', () => {
    test('does not send duplicate alerts within debounce window', async ({ authedPage }) => {
      // This test would need special test data setup
      // Verify only one notification exists for repeated triggers
      const notifications = await authedPage.getByTestId('alert-notification__item').all();
      expect(notifications.length).toBe(1);
    });
  });
});
```

---

## Test Data Fixtures

### MSW Mock Data

```typescript
// src/mocks/fixtures/alert-rules.ts
export const mockAlertRules: AlertRule[] = [
  {
    id: 'rule_1',
    project_id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'High Requests Alert',
    description: 'Alert when daily requests exceed threshold',
    enabled: true,
    trigger: {
      metric: 'requests_per_day',
      operator: 'gt',
      threshold: 1000,
    },
    channels: {
      in_app: true,
      webhook: {
        url: 'https://example.com/webhook',
        headers: { Authorization: 'Bearer test123' },
      },
    },
    behavior: {
      debounce_minutes: 10,
      notify_on_recovery: true,
    },
    created_at: '2026-02-01T10:00:00Z',
    created_by: 'user_1',
    updated_at: '2026-02-01T10:00:00Z',
    updated_by: 'user_1',
    last_triggered_at: '2026-02-27T14:30:00Z',
  },
  {
    id: 'rule_2',
    project_id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Quota Warning',
    description: 'Alert when quota usage exceeds 80%',
    enabled: true,
    trigger: {
      metric: 'quota_percent',
      operator: 'gte',
      threshold: 80,
    },
    channels: {
      in_app: true,
    },
    behavior: {
      debounce_minutes: 30,
      notify_on_recovery: true,
    },
    created_at: '2026-02-01T10:00:00Z',
    created_by: 'user_1',
    updated_at: '2026-02-01T10:00:00Z',
    updated_by: 'user_1',
  },
  {
    id: 'rule_3',
    project_id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Error Rate Spike',
    description: 'Alert when error rate exceeds 5%',
    enabled: false,
    trigger: {
      metric: 'error_rate',
      operator: 'gt',
      threshold: 5,
    },
    channels: {
      in_app: true,
    },
    behavior: {
      debounce_minutes: 5,
      notify_on_recovery: true,
    },
    created_at: '2026-02-01T10:00:00Z',
    created_by: 'user_1',
    updated_at: '2026-02-01T10:00:00Z',
    updated_by: 'user_1',
  },
];

export const mockAlertNotifications: AlertNotification[] = [
  {
    id: 'notif_1',
    rule_id: 'rule_1',
    rule_name: 'High Requests Alert',
    status: 'firing',
    triggered_at: '2026-02-27T14:30:00Z',
    metric: 'requests_per_day',
    operator: 'gt',
    threshold: 1000,
    actual_value: 1250,
    context: {
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      resource_name: 'GPT-4',
    },
    delivery: {
      in_app_sent: true,
      webhook_sent: true,
      webhook_status: 200,
    },
  },
  {
    id: 'notif_2',
    rule_id: 'rule_2',
    rule_name: 'Quota Warning',
    status: 'resolved',
    triggered_at: '2026-02-27T12:00:00Z',
    resolved_at: '2026-02-27T14:00:00Z',
    metric: 'quota_percent',
    operator: 'gte',
    threshold: 80,
    actual_value: 85,
    context: {},
    delivery: {
      in_app_sent: true,
      in_app_seen_at: '2026-02-27T12:05:00Z',
      webhook_sent: true,
    },
  },
];
```

---

## Implementation Order (TDD Red-Green-Refactor)

### Phase 1: Core Logic (Week 1, Days 1-2)
1. Write tests for `evaluation.ts` → Watch fail → Implement
2. Write tests for `debounce.ts` → Watch fail → Implement
3. Write tests for `delivery.ts` → Watch fail → Implement

### Phase 2: Data Hooks (Week 1, Days 3-4)
1. Write tests for `use-alert-rules.ts` → Watch fail → Implement
2. Write tests for `use-alert-notifications.ts` → Watch fail → Implement
3. Add MSW handlers for alert endpoints

### Phase 3: Components (Week 2, Days 1-3)
1. Write tests for `AlertRuleCard` → Watch fail → Implement
2. Write tests for `AlertRulesList` → Watch fail → Implement
3. Write tests for `AlertRuleFormDialog` → Watch fail → Implement
4. Write tests for `WebhookConfigForm` → Watch fail → Implement
5. Write tests for `AlertNotificationItem` → Watch fail → Implement
6. Write tests for `AlertNotificationsPanel` → Watch fail → Implement

### Phase 4: Page Integration (Week 2, Days 4-5)
1. Write tests for `AlertCenterPage` → Watch fail → Implement
2. Write integration tests for full page flow
3. Create route layout and page component

### Phase 5: E2E Tests (Week 2, Day 5)
1. Write E2E tests for alert center page
2. Add to visual regression suite
3. Verify real-time notification flow

---

## Open Questions

1. **Real-time Delivery:** How to push notifications to UI?
   - Recommendation: Server-Sent Events (SSE) for MVP (reuses existing SSE infra)

2. **Webhook Retry Policy:** What retry strategy?
   - Recommendation: 3 attempts, exponential backoff (1s, 4s, 16s)

3. **Notification Retention:** How long to keep notifications?
   - Recommendation: 30 days auto-purge

4. **Silence Duration:** What options for silencing?
   - Recommendation: 1h, 4h, 24h, 7d, indefinite

5. **Rate Limits:** Any limits on webhook calls?
   - Recommendation: Max 100 webhook calls/min per rule

---

## Dependencies

- **Blocked by:** M2 (P0 Main Development) - Must complete first
- **Depends on:** SSE infrastructure (from Epic B1)
- **Related:** Epic C1 (Dashboard) - May show alert status on dashboard

---

## Sign-Off

**Test Plan Created By:** dev-3
**Date:** 2026-02-27
**Status:** ✅ Ready for Review

**Next Steps:**
1. Product-manager to review and approve test plan
2. M2 to complete (unblock development)
3. Begin TDD implementation following Red-Green-Refactor cycle
