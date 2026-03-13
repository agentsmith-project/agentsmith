import type { AlertMetric, AlertOperator, AlertWindow } from '@/lib/types/alerts';

export const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: 'requests_per_day', label: 'Requests Per Day' },
  { value: 'requests_per_hour', label: 'Requests Per Hour' },
  { value: 'spending_limit_percent', label: 'Limit Usage Percentage' },
  { value: 'error_rate', label: 'Error Rate' },
  { value: 'token_usage', label: 'Token Usage' },
  { value: 'response_time_p95', label: 'Response Time (P95)' },
];

export const OPERATOR_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: 'gt', label: 'Greater Than (>)' },
  { value: 'gte', label: 'Greater Than or Equal (>=)' },
  { value: 'lt', label: 'Less Than (<)' },
  { value: 'lte', label: 'Less Than or Equal (<=)' },
  { value: 'eq', label: 'Equal (=)' },
];

export const WINDOW_OPTIONS: { value: AlertWindow; label: string }[] = [
  { value: '5m', label: '5 Minutes' },
  { value: '15m', label: '15 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
];
