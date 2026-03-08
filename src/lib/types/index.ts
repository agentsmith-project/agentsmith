/**
 * Epic C Types Index
 *
 * Centralized exports for all Epic C (Operations) type definitions.
 * Import from this file for convenience:
 *
 * import { QuotaSummary, Alert, AlertPreferences } from '@/lib/types/epic-c';
 * import type { ChartConfig, LineChartConfig } from '@/lib/types/epic-c';
 */

// Cost & Limit Dashboard (Epic C1)
// Note: Quota* type names are kept for backward compatibility with API contracts.
export type {
  QuotaSummary,
  QuotaOverview,
  TimeRange,
  TimeGranularity,
  TimeRangePreset,
  MetricType,
  CostTimeSeriesDataPoint,
  ResourceCostBreakdown,
  CostChartData,
  QuotaSummaryRequest,
  CostTimeSeriesRequest,
  DashboardFilters,
  DashboardViewMode,
  ChartType as DashboardChartType,
  DashboardPreferences,
  ExportFormat,
  CostExportRequest,
  CostExportResponse,
} from './cost-dashboard';

// Alert Center (Epic C2)
export type {
  // Core alert types
  Alert,
  InAppAlert,
  InAppAlertType,
  AlertSeverity,
  AlertAction,

  // Alert rule types
  AlertRule,
  AlertTrigger,
  AlertOperator,
  AlertWindow,
  AlertMetric,
  AlertChannels,
  AlertBehavior,
  WebhookConfig,

  // Alert notification types
  AlertNotification,
  AlertStatus,
  AlertContext,
  AlertDelivery,

  // Filter and query types
  AlertFilters,
  AlertQuery,
  AlertSortBy,
  AlertSortOrder,
  AlertListResponse,

  // Store types
  AlertStore,
  AlertStoreState,
  AlertStoreActions,

  // Preferences
  AlertPreferences,

  // Trigger configurations
  QuotaAlertTrigger,
  CostAlertTrigger,
  RateLimitAlertTrigger,

  // API types
  AlertRuleCreateRequest,
  AlertRuleUpdateRequest,
  AlertRuleTestResponse,
  AlertHistoryListParams,
  SilenceNotificationRequest,
} from './alerts';

// Shared Chart Types
export type {
  // Data types
  ChartDataPoint,
  TimeSeriesDataPoint,
  CategoryDataPoint,
  MultiSeriesDataPoint,

  // Configuration types
  ChartType,
  ChartOrientation,
  AxisType,
  TickPosition,
  LegendPosition,
  TooltipTrigger,
  ChartColorScheme,

  // Style types
  ChartLineStyle,
  ChartMargin,
  ChartGridConfig,

  // Component props
  ChartConfig,
  LineChartConfig,
  BarChartConfig,
  PieChartConfig,
  ChartAxisConfig,
  ChartTooltipConfig,
  ChartLegendConfig,

  // Event handlers
  ChartClickHandler,
  ChartHoverHandler,

  // Utilities
  FormattedValue,
  ValueFormatter,

  // Recharts compatibility types
  RechartsCartesianProps,
  RechartsAreaProps,
  RechartsBarProps,
  RechartsLineProps,
  RechartsXAxisProps,
  RechartsYAxisProps,
  RechartsTooltipProps,
  RechartsLegendProps,
} from './charts';

// Constants
export { ValueFormatters } from './charts';
