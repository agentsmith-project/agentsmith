/**
 * Trend Aggregation Utilities
 *
 * Aggregates time-series data by day, week, or month.
 *
 * @module lib/utils/dashboard/aggregate-trends
 */

export interface DataPoint {
  timestamp: string;
  value: number;
}

export interface AggregationOptions {
  granularity: 'day' | 'week' | 'month';
  timezone?: string;
}

/**
 * Gets the date key for a given timestamp
 */
function _getDateKey(timestamp: string, granularity: 'day' | 'week' | 'month'): string {
  const date = new Date(timestamp);

  switch (granularity) {
    case 'day':
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    case 'week': {
      // Get Monday of the week in UTC to avoid local timezone skew.
      const d = new Date(date);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      d.setUTCDate(diff);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().split('T')[0];
    }
    case 'month':
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
}

/**
 * Aggregates data points by a date key function
 */
function aggregateByDateKey(data: DataPoint[], keyFn: (ts: string) => string): DataPoint[] {
  const map = new Map<string, number>();

  // Sum values by date key
  for (const point of data) {
    const key = keyFn(point.timestamp);
    map.set(key, (map.get(key) || 0) + point.value);
  }

  // Convert back to array (strip milliseconds from ISO string)
  return Array.from(map.entries(), ([timestamp, value]) => ({
    timestamp: new Date(timestamp).toISOString().replace('.000', ''),
    value,
  })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Fills missing dates between min and max with zeros
 */
function fillMissingDates(data: DataPoint[], keyFn: (ts: string) => string): DataPoint[] {
  if (data.length === 0) return data;

  const timestamps = data.map(d => keyFn(d.timestamp));
  const minDate = new Date(Math.min(...timestamps.map(ts => new Date(ts).getTime())));
  const maxDate = new Date(Math.max(...timestamps.map(ts => new Date(ts).getTime())));

  const result = new Map<string, DataPoint>();
  for (const point of data) {
    const key = keyFn(point.timestamp);
    result.set(key, point);
  }

  // Determine the date increment based on the key pattern
  const firstKey = keyFn(data[0].timestamp);
  let incrementMs: number;
  let current = new Date(minDate);

  if (firstKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Daily granularity
    incrementMs = 24 * 60 * 60 * 1000;
  } else if (firstKey.match(/^\d{4}-\d{2}-01$/)) {
    // Monthly granularity
    incrementMs = 30 * 24 * 60 * 60 * 1000; // Approximate, will be adjusted
  } else {
    // Weekly granularity
    incrementMs = 7 * 24 * 60 * 60 * 1000;
  }

  const filled: DataPoint[] = [];

  // For daily aggregation, fill missing days
  if (incrementMs === 24 * 60 * 60 * 1000) {
    while (current <= maxDate) {
      const key = current.toISOString().split('T')[0];
      const existing = result.get(key);
      filled.push({
        timestamp: current.toISOString().replace('.000', ''),
        value: existing ? existing.value : 0,
      });
      current = new Date(current.getTime() + incrementMs);
    }
  } else {
    // For weekly/monthly, don't fill gaps (too complex for MVP)
    return data;
  }

  return filled;
}

/**
 * Aggregates hourly data to daily buckets
 */
export function aggregateByDay(data: DataPoint[]): DataPoint[] {
  if (data.length === 0) return [];

  const aggregated = aggregateByDateKey(data, (ts) => {
    const date = new Date(ts);
    return date.toISOString().split('T')[0];
  });

  return fillMissingDates(aggregated, (ts) => new Date(ts).toISOString().split('T')[0]);
}

/**
 * Aggregates daily data to weekly buckets (Monday start)
 */
export function aggregateByWeek(data: DataPoint[]): DataPoint[] {
  if (data.length === 0) return [];

  return aggregateByDateKey(data, (ts) => {
    const date = new Date(ts);
    const day = date.getUTCDay();
    const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday in UTC
    const monday = new Date(date);
    monday.setUTCDate(diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
  });
}

/**
 * Aggregates daily data to monthly buckets
 */
export function aggregateByMonth(data: DataPoint[]): DataPoint[] {
  if (data.length === 0) return [];

  return aggregateByDateKey(data, (ts) => {
    const date = new Date(ts);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

/**
 * Main aggregation function
 */
export function aggregateTrends(data: DataPoint[], options: AggregationOptions): DataPoint[] {
  switch (options.granularity) {
    case 'day':
      return aggregateByDay(data);
    case 'week':
      return aggregateByWeek(data);
    case 'month':
      return aggregateByMonth(data);
    default:
      return data;
  }
}

/**
 * Calculates percentage change vs previous period
 */
export function calculateChangePercent(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
