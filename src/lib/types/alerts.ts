/**
 * Alert Type Definitions
 *
 * Type definitions for Epic C2: Alert Center
 *
 * @module lib/types/alerts
 */

// ============================================================
// Alert Rule Types
// ============================================================

/**
 * Alert rule configuration
 */
export interface AlertRule {
  id: string;
  project_id: string;
  workspace_id: string;

  // Basic info
  name: string;
  description?: string;
  enabled: boolean;

  // Trigger conditions
  trigger: AlertTrigger;

  // Notification channels
  channels: AlertChannels;

  // Behavior settings
  behavior: AlertBehavior;

  // Metadata
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
  last_triggered_at?: string;
}

/**
 * Alert trigger conditions
 */
export interface AlertTrigger {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  window?: AlertWindow; // For time-aggregated metrics
}

/**
 * Alert notification channels
 */
export interface AlertChannels {
  in_app: boolean; // Show in UI notification center
  webhook?: WebhookConfig;
}

/**
 * Alert behavior settings
 */
export interface AlertBehavior {
  debounce_minutes: number; // Minimum time between alerts
  notify_on_recovery: boolean; // Send "resolved" notification
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

// ============================================================
// Alert Metric & Operator Types
// ============================================================

/**
 * Supported alert metrics
 */
export type AlertMetric =
  | 'requests_per_day' // Total requests in 24h
  | 'requests_per_hour' // Requests in last hour
  | 'spending_limit_percent' // Limit usage percentage (historical metric key)
  | 'error_rate' // Error rate (errors/total * 100)
  | 'token_usage' // Token usage in window
  | 'response_time_p95'; // P95 response time

/**
 * Alert comparison operators
 */
export type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

/**
 * Time windows for aggregation
 */
export type AlertWindow = '5m' | '15m' | '1h' | '24h' | '7d';

// ============================================================
// Alert Notification Types
// ============================================================

/**
 * Alert notification (triggered alert instance)
 */
export interface AlertNotification {
  id: string;
  rule_id: string;
  rule_name: string;

  // Status
  status: AlertStatus;

  // Trigger info
  triggered_at: string;
  resolved_at?: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  actual_value: number;

  // Context
  context: AlertContext;

  // Delivery status
  delivery: AlertDelivery;
}

/**
 * Alert notification status
 */
export type AlertStatus = 'firing' | 'resolved' | 'silenced';

/**
 * Alert context information
 */
export interface AlertContext {
  resource_type?: string;
  resource_id?: string;
  resource_name?: string;
  end_user_id?: string;
}

/**
 * Alert delivery status
 */
export interface AlertDelivery {
  in_app_sent: boolean;
  in_app_seen_at?: string;
  webhook_sent: boolean;
  webhook_status?: number;
  webhook_error?: string;
}

// ============================================================
// In-App Alert Types (from alertStore)
// ============================================================

/**
 * In-app alert (client-side storage)
 */
export interface InAppAlert {
  id: string;
  workspace_id: string;
  project_id: string;
  type: InAppAlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  resource_type?: string;
  resource_id?: string;
  resource_name?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at?: string;
  dismissed_at?: string;
  expires_at?: string;
}

/**
 * In-app alert types
 */
export type InAppAlertType =
  // Limit alerts (spending limit event names)
  | 'spending_limit.exceeded'
  | 'spending_limit.warning'
  | 'spending_limit.reset'
  // Rate limit alerts
  | 'rate_limit.exceeded'
  | 'rate_limit.warning'
  // Policy alerts
  | 'policy.allow_list.denied'
  | 'policy.violation'
  | 'policy.updated'
  // System alerts
  | 'endpoint.error'
  | 'endpoint.unhealthy'
  | 'system.maintenance'
  | 'system.security'
  // Cost alerts
  | 'cost.budget_exceeded'
  | 'cost.unusual_spend';

/**
 * Alias for InAppAlertType as AlertType for convenience
 */
export type AlertType = InAppAlertType;

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

// ============================================================
// Alert Preferences Types
// ============================================================

/**
 * User alert preferences
 */
export interface AlertPreferences {
  in_app_enabled: boolean;
  severity_threshold: AlertSeverity; // Minimum severity to notify
  alert_types: InAppAlertType[]; // Enabled alert types
}

// ============================================================
// API Request/Response Types
// ============================================================

/**
 * Create alert rule request
 */
export interface AlertRuleCreateRequest {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AlertTrigger;
  channels: AlertChannels;
  behavior: AlertBehavior;
}

/**
 * Update alert rule request (all fields optional)
 */
export interface AlertRuleUpdateRequest {
  name?: string;
  description?: string;
  enabled?: boolean;
  trigger?: AlertTrigger;
  channels?: AlertChannels;
  behavior?: AlertBehavior;
}

/**
 * Alert rule test response
 */
export interface AlertRuleTestResponse {
  would_trigger: boolean;
  actual_value: number;
  details: string;
}

/**
 * Alert history list params
 */
export interface AlertHistoryListParams {
  rule_id?: string;
  status?: AlertStatus;
  start_time?: string;
  end_time?: string;
  page?: number;
  page_size?: number;
}

/**
 * Silence notification request
 */
export interface SilenceNotificationRequest {
  duration_minutes?: number; // If omitted, silence indefinitely
}

// ============================================================
// Epic C2: Alert Center Additional Types
// ============================================================

/**
 * Extended in-app alert with status field (MVP enhancement)
 */
export interface Alert extends InAppAlert {
  status: 'unread' | 'read' | 'dismissed';
  actions?: AlertAction[];
}

/**
 * Action that can be taken from an alert
 */
export interface AlertAction {
  label: string;
  url?: string;
  handler?: string; // Function name to call
  primary?: boolean; // Primary action button
}

/**
 * Alert filter criteria
 */
export interface AlertFilters {
  severity?: AlertSeverity[];
  type?: InAppAlertType[];
  resource_type?: string[];
  status?: Array<'unread' | 'read' | 'dismissed'>;
  date_from?: string; // ISO 8601
  date_to?: string; // ISO 8601
  search?: string; // Text search in title/message
}

/**
 * Alert sort options
 */
export type AlertSortBy = 'created_at' | 'severity' | 'type';
export type AlertSortOrder = 'asc' | 'desc';

/**
 * Alert query parameters
 */
export interface AlertQuery {
  filters: AlertFilters;
  sort_by?: AlertSortBy;
  sort_order?: AlertSortOrder;
  page?: number;
  page_size?: number;
}

/**
 * Paginated alert list response
 */
export interface AlertListResponse {
  items: Alert[];
  total: number;
  unread_count: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * Alert store state (Zustand)
 */
export interface AlertStoreState {
  alerts: Alert[];
  preferences: AlertPreferences;
  unread_count: number;
  last_sync_at?: string;
}

/**
 * Alert store actions (Zustand)
 */
export interface AlertStoreActions {
  // Alert management
  addAlert: (alert: Omit<Alert, 'id' | 'created_at' | 'status'>) => void;
  markAsRead: (alertId: string) => void;
  markMultipleAsRead: (alertIds: string[]) => void;
  markAllAsRead: () => void;
  dismissAlert: (alertId: string) => void;
  dismissMultiple: (alertIds: string[]) => void;
  clearDismissed: (beforeDate?: string) => void;

  // Preferences
  updatePreferences: (prefs: Partial<AlertPreferences>) => void;

  // Sync
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

/**
 * Combined alert store interface
 */
export interface AlertStore extends AlertStoreState, AlertStoreActions {}

/**
 * Limit alert trigger configuration.
 * Legacy naming: SpendingLimitAlertTrigger.
 */
export interface SpendingLimitAlertTrigger {
  warning_threshold: number; // Percentage (e.g., 80)
  critical_threshold: number; // Percentage (e.g., 100)
  check_interval_ms: number;
}

/**
 * Cost alert trigger configuration
 */
export interface CostAlertTrigger {
  budget_limit: number; // USD
  warning_threshold: number; // Percentage
  billing_period: 'daily' | 'weekly' | 'monthly';
}

/**
 * Rate limit alert trigger configuration
 */
export interface RateLimitAlertTrigger {
  threshold_percentage: number;
  window_minutes: number;
}
