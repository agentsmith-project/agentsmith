/**
 * Anomaly Detection Utilities
 *
 * Detects anomalies in time-series data using Median Absolute Deviation (MAD).
 *
 * @module lib/utils/dashboard/detect-anomalies
 */

export interface DataPoint {
  timestamp: string;
  value: number;
}

export interface AnomalyResult {
  id: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
  type: 'requests_spike' | 'errors_spike' | 'cost_spike' | 'unusual_pattern';
  description: string;
  value: number;
  expected_range: { min: number; max: number };
}

export interface AnomalyDetectionOptions {
  threshold?: number; // MAD multiplier (default: 3)
  window_size?: number; // Number of data points for baseline
}

/**
 * Calculates Median Absolute Deviation (MAD)
 * MAD = median(|xi - median(x)|)
 */
export function calculateMAD(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  const deviations = sorted.map(v => Math.abs(v - median));
  const sortedDeviations = deviations.sort((a, b) => a - b);
  const madMid = Math.floor(sortedDeviations.length / 2);
  return sortedDeviations.length % 2 === 0
    ? (sortedDeviations[madMid - 1] + sortedDeviations[madMid]) / 2
    : sortedDeviations[madMid];
}

/**
 * Detects anomalies using MAD method
 */
export function detectAnomalies(data: DataPoint[], _options: AnomalyDetectionOptions = {}): AnomalyResult[] {
  // TODO: Implement with TDD approach
  return [];
}

/**
 * Determines severity based on deviation from expected range
 */
export function getSeverityForDeviation(deviation: number): 'low' | 'medium' | 'high' {
  if (deviation < 2) return 'low';
  if (deviation < 5) return 'medium';
  return 'high';
}
