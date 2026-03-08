/**
 * Epic C2: Alert Center Utilities
 *
 * Helper functions for the Alert Center feature.
 */

import type {
  Alert,
  AlertSeverity,
  InAppAlertType,
  AlertFilters,
  AlertSortBy,
  AlertSortOrder,
  QuotaAlertTrigger,
  CostAlertTrigger,
} from '../types/alerts';

// ============================================================================
// Alert Creation Utilities
// ============================================================================

/**
 * Generate a unique alert ID
 */
export function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a limit exceeded alert
 */
export function createLimitAlert(params: {
  workspace_id: string;
  project_id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  resource_name: string;
  quota_used: number;
  quota_limit: number;
  quota_unit: string;
  quota_reset_at: string;
}): Omit<Alert, 'id' | 'created_at' | 'status'> {
  const percentage = (params.quota_used / params.quota_limit) * 100;
  const severity: AlertSeverity = percentage >= 100 ? 'critical' : percentage >= 80 ? 'error' : 'warning';

  return {
    workspace_id: params.workspace_id,
    project_id: params.project_id,
    type: percentage >= 100 ? 'quota.exceeded' : 'quota.warning',
    severity,
    title: percentage >= 100
      ? `Limit exceeded for ${params.resource_name}`
      : `Limit usage at ${percentage.toFixed(0)}%`,
    message: `${params.resource_name} has used ${params.quota_used}/${params.quota_limit} ${params.quota_unit}`,
    resource_type: params.resource_type,
    resource_id: params.resource_id,
    resource_name: params.resource_name,
    metadata: {
      quota_used: params.quota_used,
      quota_limit: params.quota_limit,
      quota_reset_at: params.quota_reset_at,
      quota_unit: params.quota_unit,
      percentage,
    },
    actions: [
      {
        label: 'View Details',
        url: `/workspaces/${params.workspace_id}/projects/${params.project_id}/usage`,
      },
    ],
  };
}

/**
 * Create a rate limit exceeded alert
 */
export function createRateLimitAlert(params: {
  workspace_id: string;
  project_id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  resource_name: string;
  rate_limit: number;
  rate_window: string;
}): Omit<Alert, 'id' | 'created_at' | 'status'> {
  return {
    workspace_id: params.workspace_id,
    project_id: params.project_id,
    type: 'rate_limit.exceeded',
    severity: 'error',
    title: `Rate limit exceeded for ${params.resource_name}`,
    message: `Request rate exceeded ${params.rate_limit} requests/${params.rate_window}`,
    resource_type: params.resource_type,
    resource_id: params.resource_id,
    resource_name: params.resource_name,
    metadata: {
      rate_limit: params.rate_limit,
      rate_window: params.rate_window,
    },
  };
}

/**
 * Create a policy allow-list denied alert
 */
export function createPolicyDeniedAlert(params: {
  workspace_id: string;
  project_id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  resource_name: string;
  subject_type: 'user' | 'group';
  subject_id: string;
  subject_name?: string;
}): Omit<Alert, 'id' | 'created_at' | 'status'> {
  return {
    workspace_id: params.workspace_id,
    project_id: params.project_id,
    type: 'policy.allow_list.denied',
    severity: 'warning',
    title: `Access denied to ${params.resource_name}`,
    message: `${
      params.subject_name || params.subject_type
    } is not in the allow-list for this resource`,
    resource_type: params.resource_type,
    resource_id: params.resource_id,
    resource_name: params.resource_name,
    metadata: {
      subject_type: params.subject_type,
      subject_id: params.subject_id,
      subject_name: params.subject_name,
    },
    actions: [
      {
        label: 'View Policy',
        url: `/workspaces/${params.workspace_id}/projects/${params.project_id}/settings`,
      },
    ],
  };
}

/**
 * Create an endpoint error alert
 */
export function createEndpointErrorAlert(params: {
  workspace_id: string;
  project_id: string;
  endpoint_id: string;
  endpoint_name: string;
  error_code: string;
  error_message: string;
}): Omit<Alert, 'id' | 'created_at' | 'status'> {
  return {
    workspace_id: params.workspace_id,
    project_id: params.project_id,
    type: 'endpoint.error',
    severity: 'error',
    title: `Endpoint error: ${params.endpoint_name}`,
    message: params.error_message,
    resource_type: 'endpoint',
    resource_id: params.endpoint_id,
    resource_name: params.endpoint_name,
    metadata: {
      error_code: params.error_code,
      error_message: params.error_message,
    },
    actions: [
      {
        label: 'View Endpoint',
        url: `/workspaces/${params.workspace_id}/projects/${params.project_id}/endpoints/${params.endpoint_id}`,
      },
    ],
  };
}

// ============================================================================
// Alert Filtering Utilities
// ============================================================================

/**
 * Check if alert matches filters
 */
export function alertMatchesFilters(alert: Alert, filters: AlertFilters): boolean {
  // Severity filter
  if (filters.severity && filters.severity.length > 0) {
    if (!filters.severity.includes(alert.severity)) {
      return false;
    }
  }

  // Type filter
  if (filters.type && filters.type.length > 0) {
    if (!filters.type.includes(alert.type as InAppAlertType)) {
      return false;
    }
  }

  // Resource type filter
  if (filters.resource_type && filters.resource_type.length > 0) {
    if (!alert.resource_type || !filters.resource_type.includes(alert.resource_type)) {
      return false;
    }
  }

  // Status filter
  if (filters.status && filters.status.length > 0) {
    if (!filters.status.includes(alert.status)) {
      return false;
    }
  }

  // Date range filter
  const alertDate = new Date(alert.created_at);
  if (filters.date_from) {
    const fromDate = new Date(filters.date_from);
    if (alertDate < fromDate) {
      return false;
    }
  }
  if (filters.date_to) {
    const toDate = new Date(filters.date_to);
    if (alertDate > toDate) {
      return false;
    }
  }

  // Search filter
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const searchableText = [
      alert.title,
      alert.message,
      alert.resource_name,
    ].join(' ').toLowerCase();
    if (!searchableText.includes(searchLower)) {
      return false;
    }
  }

  return true;
}

/**
 * Sort alerts by criteria
 */
export function sortAlerts(
  alerts: Alert[],
  sortBy: AlertSortBy = 'created_at',
  sortOrder: AlertSortOrder = 'desc'
): Alert[] {
  return [...alerts].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'created_at':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case 'severity':
        const severityOrder = { critical: 4, error: 3, warning: 2, info: 1 };
        comparison = severityOrder[a.severity] - severityOrder[b.severity];
        break;
      case 'type':
        comparison = a.type.localeCompare(b.type);
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

/**
 * Filter and paginate alerts
 */
export function filterAlerts(
  alerts: Alert[],
  filters: AlertFilters,
  sortBy: AlertSortBy = 'created_at',
  sortOrder: AlertSortOrder = 'desc',
  page = 1,
  pageSize = 25
): {
  items: Alert[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
} {
  // Filter
  const filtered = alerts.filter((alert) => alertMatchesFilters(alert, filters));

  // Sort
  const sorted = sortAlerts(filtered, sortBy, sortOrder);

  // Paginate
  const startIndex = (page - 1) * pageSize;
  const items = sorted.slice(startIndex, startIndex + pageSize);

  return {
    items,
    total: filtered.length,
    page,
    pageSize,
    hasMore: startIndex + pageSize < filtered.length,
  };
}

// ============================================================================
// Alert Status Utilities
// ============================================================================

/**
 * Count unread alerts
 */
export function countUnreadAlerts(alerts: Alert[]): number {
  return alerts.filter((a) => a.status === 'unread').length;
}

/**
 * Mark alert as read
 */
export function markAlertAsRead(alert: Alert): Alert {
  if (alert.status === 'unread') {
    return {
      ...alert,
      status: 'read' as const,
      read_at: new Date().toISOString(),
    };
  }
  return alert;
}

/**
 * Mark alert as dismissed
 */
export function dismissAlert(alert: Alert): Alert {
  return {
    ...alert,
    status: 'dismissed' as const,
    dismissed_at: new Date().toISOString(),
  };
}

/**
 * Check if alert is expired
 */
export function isAlertExpired(alert: Alert): boolean {
  if (!alert.expires_at) return false;
  return new Date(alert.expires_at) < new Date();
}

/**
 * Clean up expired alerts
 */
export function cleanupExpiredAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => !isAlertExpired(a));
}

// ============================================================================
// Alert Severity Utilities
// ============================================================================

/**
 * Get severity color class
 */
export function getSeverityColorClass(severity: AlertSeverity): string {
  const colors = {
    critical: 'text-error',
    error: 'text-error',
    warning: 'text-warning',
    info: 'text-accent',
  };
  return colors[severity];
}

/**
 * Get severity background color class
 */
export function getSeverityBgColorClass(severity: AlertSeverity): string {
  const colors = {
    critical: 'bg-error/10',
    error: 'bg-error/10',
    warning: 'bg-warning/10',
    info: 'bg-accent/10',
  };
  return colors[severity];
}

/**
 * Get severity border color class
 */
export function getSeverityBorderColorClass(severity: AlertSeverity): string {
  const colors = {
    critical: 'border-error/70',
    error: 'border-error/70',
    warning: 'border-warning/70',
    info: 'border-accent/70',
  };
  return colors[severity];
}

/**
 * Get severity icon name (Lucide React)
 */
export function getSeverityIcon(severity: AlertSeverity): string {
  const icons = {
    critical: 'AlertCircle',
    error: 'XCircle',
    warning: 'AlertTriangle',
    info: 'Info',
  };
  return icons[severity];
}

// ============================================================================
// Alert Trigger Utilities
// ============================================================================

/**
 * Check if limit threshold is exceeded
 */
export function checkLimitThreshold(
  used: number,
  limit: number,
  trigger: QuotaAlertTrigger
): { shouldAlert: boolean; severity: AlertSeverity } {
  const percentage = (used / limit) * 100;

  if (percentage >= trigger.critical_threshold) {
    return { shouldAlert: true, severity: 'critical' };
  }
  if (percentage >= trigger.warning_threshold) {
    return { shouldAlert: true, severity: 'warning' };
  }
  return { shouldAlert: false, severity: 'info' };
}

// Backward compatible aliases for legacy imports
export const createQuotaAlert = createLimitAlert;
export const checkQuotaThreshold = checkLimitThreshold;

/**
 * Check if cost budget is exceeded
 */
export function checkCostBudget(
  spent: number,
  trigger: CostAlertTrigger
): { shouldAlert: boolean; severity: AlertSeverity; percentage: number } {
  const percentage = (spent / trigger.budget_limit) * 100;

  if (percentage >= 100) {
    return { shouldAlert: true, severity: 'critical', percentage };
  }
  if (percentage >= trigger.warning_threshold) {
    return { shouldAlert: true, severity: 'warning', percentage };
  }
  return { shouldAlert: false, severity: 'info', percentage };
}

// ============================================================================
// Alert Grouping Utilities
// ============================================================================

/**
 * Group alerts by resource
 */
export function groupAlertsByResource(alerts: Alert[]): Map<string, Alert[]> {
  const groups = new Map<string, Alert[]>();

  for (const alert of alerts) {
    const key = `${alert.resource_type}:${alert.resource_id}` || 'system';
    const existing = groups.get(key) || [];
    existing.push(alert);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * Group alerts by severity
 */
export function groupAlertsBySeverity(alerts: Alert[]): Record<AlertSeverity, Alert[]> {
  return {
    critical: alerts.filter((a) => a.severity === 'critical'),
    error: alerts.filter((a) => a.severity === 'error'),
    warning: alerts.filter((a) => a.severity === 'warning'),
    info: alerts.filter((a) => a.severity === 'info'),
  };
}

/**
 * Group alerts by type
 */
export function groupAlertsByType(alerts: Alert[]): Record<string, Alert[]> {
  const groups: Record<string, Alert[]> = {};

  for (const alert of alerts) {
    const type = alert.type;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(alert);
  }

  return groups;
}

// ============================================================================
// Time Utilities
// ============================================================================

/**
 * Format alert relative time (e.g., "2h ago")
 */
export function formatAlertRelativeTime(isoString: string): string {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString();
}

/**
 * Format alert absolute time
 */
export function formatAlertAbsoluteTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
