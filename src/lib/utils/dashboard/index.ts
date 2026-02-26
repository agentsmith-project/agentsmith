/**
 * Dashboard Utilities - Barrel Export
 */

export {
  aggregateTrends,
  aggregateByDay,
  aggregateByWeek,
  aggregateByMonth,
  calculateChangePercent,
} from './aggregate-trends';
export type { DataPoint as TrendDataPoint, AggregationOptions } from './aggregate-trends';

export { detectAnomalies, calculateMAD, getSeverityForDeviation } from './detect-anomalies';
export type { AnomalyResult, AnomalyDetectionOptions } from './detect-anomalies';

export {
  formatNumber,
  formatPercent,
  formatDuration,
  formatBytes,
  formatCurrency,
  formatRelativeTime,
} from './format-metrics';
