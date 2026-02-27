import { describe, expect, it } from 'vitest';
import { calculateMAD, detectAnomalies, getSeverityForDeviation } from '../detect-anomalies';

describe('calculateMAD', () => {
  it('returns zero for empty values', () => {
    expect(calculateMAD([])).toBe(0);
  });

  it('calculates MAD for numeric series', () => {
    expect(calculateMAD([10, 11, 10, 12, 10])).toBe(0);
    expect(calculateMAD([10, 10, 12, 14, 16])).toBe(2);
  });
});

describe('getSeverityForDeviation', () => {
  it('maps deviation ranges to severity', () => {
    expect(getSeverityForDeviation(1.5)).toBe('low');
    expect(getSeverityForDeviation(3)).toBe('medium');
    expect(getSeverityForDeviation(6)).toBe('high');
  });
});

describe('detectAnomalies', () => {
  it('returns empty when data is too short', () => {
    const data = [
      { timestamp: '2026-02-01T00:00:00Z', value: 10 },
      { timestamp: '2026-02-02T00:00:00Z', value: 12 },
      { timestamp: '2026-02-03T00:00:00Z', value: 11 },
    ];
    expect(detectAnomalies(data, { window_size: 5 })).toEqual([]);
  });

  it('detects a spike anomaly with expected range', () => {
    const data = [
      { timestamp: '2026-02-01T00:00:00Z', value: 100 },
      { timestamp: '2026-02-02T00:00:00Z', value: 102 },
      { timestamp: '2026-02-03T00:00:00Z', value: 98 },
      { timestamp: '2026-02-04T00:00:00Z', value: 101 },
      { timestamp: '2026-02-05T00:00:00Z', value: 99 },
      { timestamp: '2026-02-06T00:00:00Z', value: 100 },
      { timestamp: '2026-02-07T00:00:00Z', value: 240 },
    ];

    const result = detectAnomalies(data, { window_size: 6, threshold: 3 });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('requests_spike');
    expect(result[0].severity).toBe('high');
    expect(result[0].timestamp).toBe('2026-02-07T00:00:00Z');
    expect(result[0].expected_range.max).toBeGreaterThan(0);
  });

  it('detects a drop anomaly as unusual pattern', () => {
    const data = [
      { timestamp: '2026-02-01T00:00:00Z', value: 120 },
      { timestamp: '2026-02-02T00:00:00Z', value: 121 },
      { timestamp: '2026-02-03T00:00:00Z', value: 119 },
      { timestamp: '2026-02-04T00:00:00Z', value: 120 },
      { timestamp: '2026-02-05T00:00:00Z', value: 122 },
      { timestamp: '2026-02-06T00:00:00Z', value: 121 },
      { timestamp: '2026-02-07T00:00:00Z', value: 20 },
    ];

    const result = detectAnomalies(data, { window_size: 6, threshold: 3 });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('unusual_pattern');
    expect(result[0].value).toBe(20);
  });
});
