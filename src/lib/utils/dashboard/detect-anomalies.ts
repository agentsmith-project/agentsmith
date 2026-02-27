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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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
  const threshold = _options.threshold ?? 3;
  const windowSize = Math.max(3, _options.window_size ?? 7);

  if (data.length < windowSize + 1) return [];

  const results: AnomalyResult[] = [];

  for (let i = windowSize; i < data.length; i++) {
    const baseline = data.slice(i - windowSize, i).map((point) => point.value);
    const baselineMedian = median(baseline);
    const mad = calculateMAD(baseline);
    const current = data[i].value;

    let robustScore = 0;
    if (mad > 0) {
      robustScore = (0.6745 * Math.abs(current - baselineMedian)) / mad;
    } else if (current !== baselineMedian) {
      robustScore = Number.POSITIVE_INFINITY;
    }

    if (robustScore <= threshold) continue;

    const tolerance = mad > 0 ? (threshold * mad) / 0.6745 : Math.max(1, Math.abs(baselineMedian) * 0.2);
    const expectedMin = Math.max(0, baselineMedian - tolerance);
    const expectedMax = baselineMedian + tolerance;
    const delta = current - baselineMedian;
    const type: AnomalyResult['type'] = delta > 0
      ? 'requests_spike'
      : 'unusual_pattern';

    results.push({
      id: `anomaly-${i}`,
      timestamp: data[i].timestamp,
      severity: getSeverityForDeviation(robustScore),
      type,
      description: `Detected anomaly: ${current} vs baseline ${baselineMedian.toFixed(1)}`,
      value: current,
      expected_range: {
        min: Number(expectedMin.toFixed(2)),
        max: Number(expectedMax.toFixed(2)),
      },
    });
  }

  return results;
}

/**
 * Determines severity based on deviation from expected range
 */
export function getSeverityForDeviation(deviation: number): 'low' | 'medium' | 'high' {
  if (deviation < 2) return 'low';
  if (deviation < 5) return 'medium';
  return 'high';
}
