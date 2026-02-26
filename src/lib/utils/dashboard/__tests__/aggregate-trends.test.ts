/**
 * Trend Aggregation Utilities - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateByDay,
  aggregateByWeek,
  aggregateByMonth,
  aggregateTrends,
  calculateChangePercent,
} from '../aggregate-trends';
import type { DataPoint } from '../aggregate-trends';

describe('aggregateByDay', () => {
  it('aggregates hourly data to daily buckets', () => {
    const hourlyData: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-01T01:00:00Z', value: 150 },
      { timestamp: '2026-02-01T02:00:00Z', value: 200 },
      { timestamp: '2026-02-02T00:00:00Z', value: 300 },
      { timestamp: '2026-02-02T01:00:00Z', value: 350 },
    ];

    const result = aggregateByDay(hourlyData);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      timestamp: '2026-02-01T00:00:00Z',
      value: 450, // 100 + 150 + 200
    });
    expect(result[1]).toEqual({
      timestamp: '2026-02-02T00:00:00Z',
      value: 650, // 300 + 350
    });
  });

  it('handles empty data', () => {
    expect(aggregateByDay([])).toEqual([]);
  });

  it('handles single data point', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
    ];

    const result = aggregateByDay(data);

    expect(result).toEqual([
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
    ]);
  });

  it('fills missing days with zeros', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-03T00:00:00Z', value: 200 },
    ];

    const result = aggregateByDay(data);

    // Should have 3 days: Feb 1, Feb 2 (zero), Feb 3
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      timestamp: '2026-02-02T00:00:00Z',
      value: 0,
    });
  });
});

describe('aggregateByWeek', () => {
  it('aggregates daily data to weekly buckets (Monday start)', () => {
    const dailyData: DataPoint[] = [
      { timestamp: '2026-02-02T00:00:00Z', value: 100 }, // Monday
      { timestamp: '2026-02-03T00:00:00Z', value: 150 },
      { timestamp: '2026-02-04T00:00:00Z', value: 200 },
      { timestamp: '2026-02-09T00:00:00Z', value: 300 }, // Next Monday
    ];

    const result = aggregateByWeek(dailyData);

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(450); // Sum of first week
    expect(result[1].value).toBe(300); // Second week
  });

  it('handles empty data', () => {
    expect(aggregateByWeek([])).toEqual([]);
  });

  it('handles data spanning multiple weeks', () => {
    const dailyData: DataPoint[] = [
      { timestamp: '2026-02-02T00:00:00Z', value: 100 },
      { timestamp: '2026-02-03T00:00:00Z', value: 100 },
      { timestamp: '2026-02-04T00:00:00Z', value: 100 },
      { timestamp: '2026-02-05T00:00:00Z', value: 100 },
      { timestamp: '2026-02-06T00:00:00Z', value: 100 },
      { timestamp: '2026-02-07T00:00:00Z', value: 100 },
      { timestamp: '2026-02-08T00:00:00Z', value: 100 },
      { timestamp: '2026-02-09T00:00:00Z', value: 200 }, // Next week
    ];

    const result = aggregateByWeek(dailyData);

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(700); // 7 days * 100
    expect(result[1].value).toBe(200); // Next week
  });
});

describe('aggregateByMonth', () => {
  it('aggregates daily data to monthly buckets', () => {
    const dailyData: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-15T00:00:00Z', value: 150 },
      { timestamp: '2026-03-01T00:00:00Z', value: 200 },
      { timestamp: '2026-03-15T00:00:00Z', value: 250 },
    ];

    const result = aggregateByMonth(dailyData);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      timestamp: '2026-02-01T00:00:00Z',
      value: 250, // Feb sum
    });
    expect(result[1]).toEqual({
      timestamp: '2026-03-01T00:00:00Z',
      value: 450, // Mar sum
    });
  });

  it('handles empty data', () => {
    expect(aggregateByMonth([])).toEqual([]);
  });

  it('handles single month data', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-28T00:00:00Z', value: 200 },
    ];

    const result = aggregateByMonth(data);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(300);
  });
});

describe('aggregateTrends', () => {
  it('delegates to aggregateByDay for day granularity', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-01T01:00:00Z', value: 200 },
    ];

    const result = aggregateTrends(data, { granularity: 'day' });

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(300);
  });

  it('delegates to aggregateByWeek for week granularity', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-02T00:00:00Z', value: 100 },
      { timestamp: '2026-02-09T00:00:00Z', value: 200 },
    ];

    const result = aggregateTrends(data, { granularity: 'week' });

    expect(result).toHaveLength(2);
  });

  it('delegates to aggregateByMonth for month granularity', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-03-01T00:00:00Z', value: 200 },
    ];

    const result = aggregateTrends(data, { granularity: 'month' });

    expect(result).toHaveLength(2);
  });
});

describe('calculateChangePercent', () => {
  it('calculates positive change', () => {
    expect(calculateChangePercent(150, 100)).toBe(50); // 50% increase
  });

  it('calculates negative change', () => {
    expect(calculateChangePercent(80, 100)).toBe(-20); // 20% decrease
  });

  it('returns null when previous is null', () => {
    expect(calculateChangePercent(100, null)).toBeNull();
  });

  it('returns null when previous is zero', () => {
    expect(calculateChangePercent(100, 0)).toBeNull();
  });

  it('handles zero current value', () => {
    expect(calculateChangePercent(0, 100)).toBe(-100); // 100% decrease
  });

  it('handles equal values', () => {
    expect(calculateChangePercent(100, 100)).toBe(0); // No change
  });
});
