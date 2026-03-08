/**
 * Epic C1: Cost & Limit Dashboard Type Definitions
 *
 * This file contains all TypeScript interfaces for the Cost & Limit Dashboard feature.
 * These types align with the OpenAPI spec and backend API contracts.
 * Note: Limit* is the primary terminology.
 */

// ============================================================================
// Limit Types
// ============================================================================

/**
 * Limit summary for a specific resource.
 */
export interface LimitRuleSnapshot {
  kind: 'rate_limit' | 'spending_limit';
  window: 'minute' | '5h' | 'day' | 'current';
  metric: 'requests' | 'usd';
  policy_key: string;
  used: number;
  max: number;
  remaining: number;
  usage_pct: number;
  reset_at: string; // ISO 8601
}

export interface EndpointLimitSummary {
  endpoint_id: string;
  endpoint_name: string;
  limits: LimitRuleSnapshot[];
}

export interface ProjectLimitSummary {
  project_used: number;
  project_max: number;
  project_remaining: number;
  project_usage_pct: number;
}

export interface LimitOverview {
  endpoints?: EndpointLimitSummary[];
  project_summary: ProjectLimitSummary;
}

// ============================================================================
// Cost/Usage Time Series Types
// ============================================================================

/**
 * Time granularity for aggregation
 */
export type TimeGranularity = 'hour' | 'day' | 'week' | 'month';

/**
 * Time range preset for quick selection
 */
export type TimeRangePreset =
  | '1h'
  | '24h'
  | '7d'
  | '30d'
  | '90d'
  | 'custom';

/**
 * Time range definition
 */
export interface TimeRange {
  start: string; // ISO 8601
  end: string; // ISO 8601
  preset?: TimeRangePreset;
  granularity?: TimeGranularity;
}

/**
 * Metric types for cost/usage charts
 */
export type MetricType =
  | 'requests'
  | 'tokens'
  | 'errors'
  | 'cost'
  | 'bytes_in'
  | 'bytes_out'
  | 'duration_p95';

/**
 * Single data point in time series
 */
export interface CostTimeSeriesDataPoint {
  time_bucket: string; // ISO 8601 or formatted date
  requests: number;
  tokens?: number;
  errors: number;
  estimated_cost?: number; // USD
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
}

/**
 * Resource-specific cost breakdown
 */
export interface ResourceCostBreakdown {
  resource_type: string;
  resource_id: string;
  resource_name: string;
  requests: number;
  tokens?: number;
  estimated_cost: number; // USD
  percentage_of_total: number;
}

/**
 * Cost/usage chart data
 */
export interface CostChartData {
  time_range: TimeRange;
  metrics: MetricType[];
  data_points: CostTimeSeriesDataPoint[];
  resource_breakdown?: ResourceCostBreakdown[];
  total_cost?: number;
}

// ============================================================================
// Cost Dashboard Request/Response Types (API alignment)
// ============================================================================

/**
 * Request parameters for limit summary API.
 */
export interface LimitSummaryRequest {
  workspace_id: string;
  project_id: string;
  resource_type?: 'endpoint' | 'source_library' | 'agent';
}

/**
 * Request parameters for cost time series API
 */
export interface CostTimeSeriesRequest {
  workspace_id: string;
  project_id: string;
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
  group_by?: 'hour' | 'day';
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
}

// ============================================================================
// Dashboard State Types
// ============================================================================

/**
 * Dashboard filter state
 */
export interface DashboardFilters {
  timeRange: TimeRange;
  resourceTypes: Array<'endpoint' | 'source_library' | 'agent'>;
  selectedResources: Array<{ type: string; id: string }>;
  endUserId?: string;
}

/**
 * Dashboard view mode
 */
export type DashboardViewMode = 'overview' | 'detailed' | 'comparison';

/**
 * Chart type preference
 */
export type ChartType = 'line' | 'bar' | 'area' | 'stacked';

/**
 * Dashboard user preferences
 */
export interface DashboardPreferences {
  defaultTimeRange: TimeRangePreset;
  defaultChartType: ChartType;
  pinnedMetrics: MetricType[];
  showCostEstimates: boolean;
  currency: string; // 'USD', 'EUR', etc.
}

// ============================================================================
// Export Types
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'csv' | 'json' | 'xlsx';

/**
 * Cost report export request
 */
export interface CostExportRequest {
  workspace_id: string;
  project_id: string;
  start_time: string;
  end_time: string;
  format: ExportFormat;
  include_cost_breakdown: boolean;
  include_time_series: boolean;
}

/**
 * Cost report export response
 */
export interface CostExportResponse {
  export_id: string;
  generated_at: string;
  download_url?: string;
  expires_at?: string;
}
