/**
 * Dashboard Type Definitions
 *
 * Type definitions for Epic C1: Cost & Limit Dashboard
 *
 * @module lib/types/dashboard
 */

// ============================================================
// Dashboard Data Types
// ============================================================

/**
 * Cost and limit dashboard data
 */
export interface CostDashboardData {
  time_range: {
    start: string; // ISO 8601
    end: string; // ISO 8601
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
  summary: DashboardSummary;
}

/**
 * Single trend data point
 */
export interface TrendDataPoint {
  timestamp: string; // ISO 8601
  value: number;
  change_percent?: number; // vs previous period
}

/**
 * Resource usage ranking
 */
export interface ResourceUsageRank {
  resource_id: string;
  resource_type: 'endpoint' | 'agent' | 'source_library';
  resource_name: string;
  requests: number;
  tokens?: number;
  errors: number;
  cost_usd?: number;
}

/**
 * User usage ranking
 */
export interface UserUsageRank {
  end_user_id: string;
  user_name?: string;
  requests: number;
  tokens?: number;
  errors: number;
  cost_usd?: number;
}

/**
 * Anomaly alert from dashboard analysis
 */
export interface AnomalyAlert {
  id: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
  type: 'requests_spike' | 'errors_spike' | 'cost_spike' | 'unusual_pattern';
  description: string;
  value: number;
  expected_range: { min: number; max: number };
  affected_resources: Array<{ type: string; id: string; name: string }>;
}

/**
 * Dashboard summary metrics
 */
export interface DashboardSummary {
  total_requests: number;
  total_tokens: number;
  total_errors: number;
  total_cost_usd?: number;
  avg_response_time_ms?: number;
}

// ============================================================
// Limit Data Types (legacy Quota* names kept for compatibility)
// ============================================================

/**
 * Limit usage data for a project.
 * Legacy naming: QuotaUsageData.
 */
export interface QuotaUsageData {
  project_id: string;
  time_range: {
    start: string;
    end: string;
  };

  // Overall limit status
  overall: QuotaOverallStatus;

  // Per-resource limits
  by_resource: ResourceQuotaUsage[];

  // Historical trend
  trend: QuotaTrendPoint[];
}

/**
 * Overall limit status.
 * Legacy naming: QuotaOverallStatus.
 */
export interface QuotaOverallStatus {
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
}

/**
 * Per-resource limit usage.
 * Legacy naming: ResourceQuotaUsage.
 */
export interface ResourceQuotaUsage {
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

/**
 * Limit trend over time.
 * Legacy naming: QuotaTrendPoint.
 */
export interface QuotaTrendPoint {
  date: string; // YYYY-MM-DD
  requests_percent: number; // 0-100
  tokens_percent?: number; // 0-100
}

// ============================================================
// Filter Types
// ============================================================

/**
 * Dashboard filter options
 */
export interface DashboardFilters {
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
  granularity: 'day' | 'week' | 'month';
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
}

// ============================================================
// API Request/Response Types
// ============================================================

/**
 * Request params for cost dashboard API
 */
export interface CostDashboardRequest {
  start_time: string;
  end_time: string;
  granularity: 'day' | 'week' | 'month';
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
}

/**
 * Request params for limit usage API.
 * Legacy naming: QuotaUsageRequest.
 */
export interface QuotaUsageRequest {
  start_time?: string;
  end_time?: string;
}
