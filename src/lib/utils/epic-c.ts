/**
 * Epic C Utilities Index
 *
 * Centralized exports for all Epic C (Operations) utility functions.
 * Import from this file for convenience:
 *
 * import { calculatePercentageUsed, formatAlertRelativeTime } from '@/lib/utils/epic-c';
 */

// Cost Dashboard Utilities (Epic C1)
export {
  // Limit utilities
  calculatePercentageUsed,
  getLimitStatusColor,
  getLimitStatusLevel,
  formatLimitValue,
  // Legacy aliases
  getQuotaStatusColor,
  getQuotaStatusLevel,
  formatQuotaValue,
  getTimeUntilReset,

  // Time series utilities
  aggregateTimeSeriesByBucket,
  calculateTrend,
  getTrendIcon,
  getTrendColor,

  // Cost breakdown utilities
  calculateCostBreakdownPercentages,
  sortCostBreakdown,

  // Time range utilities
  getTimeRangeFromPreset,
  getGranularityForTimeRange,
  formatTimeBucket,

  // Formatting utilities
  formatNumber,
  formatBytes,
  formatDuration,
  formatCurrency,
  formatPercentage,

  // Chart data preparation
  prepareTimeSeriesChartData,
  prepareCostBreakdownChartData,
  getMetricDisplayName,
  getMetricColor,
} from './cost-dashboard';

// Alert Center Utilities (Epic C2)
export {
  // Alert creation
  generateAlertId,
  createLimitAlert,
  // Legacy alias
  createQuotaAlert,
  createRateLimitAlert,
  createPolicyDeniedAlert,
  createEndpointErrorAlert,

  // Alert filtering
  alertMatchesFilters,
  sortAlerts,
  filterAlerts,

  // Alert status
  countUnreadAlerts,
  markAlertAsRead,
  dismissAlert,
  isAlertExpired,
  cleanupExpiredAlerts,

  // Severity utilities
  getSeverityColorClass,
  getSeverityBgColorClass,
  getSeverityBorderColorClass,
  getSeverityIcon,

  // Trigger checks
  checkLimitThreshold,
  // Legacy alias
  checkQuotaThreshold,
  checkCostBudget,

  // Alert grouping
  groupAlertsByResource,
  groupAlertsBySeverity,
  groupAlertsByType,

  // Time formatting
  formatAlertRelativeTime,
  formatAlertAbsoluteTime,
} from './alerts';
