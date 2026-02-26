/**
 * Metrics Formatting Utilities - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatPercent,
  formatDuration,
  formatBytes,
  formatCurrency,
} from '../format-metrics';

describe('formatNumber', () => {
  it('formats small numbers without suffix', () => {
    expect(formatNumber(123)).toBe('123');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(999999)).toBe('1000.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
    expect(formatNumber(1_234_567)).toBe('1.2M');
    expect(formatNumber(999_999_999)).toBe('1000.0M');
  });

  it('formats billions with B suffix', () => {
    expect(formatNumber(1_000_000_000)).toBe('1.0B');
    expect(formatNumber(1_234_567_890)).toBe('1.2B');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1.2K');
  });
});

describe('formatPercent', () => {
  it('formats percentages with default precision', () => {
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(0.56)).toBe('0.6%');
  });

  it('formats percentages with custom precision', () => {
    expect(formatPercent(12.34, 2)).toBe('12.34%');
    expect(formatPercent(12.34, 0)).toBe('12%');
  });

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('handles negative percentages', () => {
    expect(formatPercent(-5.67)).toBe('-5.7%');
  });

  it('handles percentages over 100', () => {
    expect(formatPercent(125.5)).toBe('125.5%');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(150000)).toBe('2.5m');
    expect(formatDuration(3599999)).toBe('60.0m');
  });

  it('formats hours', () => {
    expect(formatDuration(3600000)).toBe('1.0h');
    expect(formatDuration(7200000)).toBe('2.0h');
    expect(formatDuration(5400000)).toBe('1.5h');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });
});

describe('formatBytes', () => {
  it('formats bytes without suffix', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(1048575)).toBe('1024.0KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0MB');
    expect(formatBytes(2097152)).toBe('2.0MB');
    expect(formatBytes(5242880)).toBe('5.0MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0GB');
    expect(formatBytes(2147483648)).toBe('2.0GB');
  });

  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0B');
  });
});

describe('formatCurrency', () => {
  it('formats USD currency', () => {
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(1)).toBe('$1.00');
    expect(formatCurrency(12.34)).toBe('$12.34');
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats large amounts', () => {
    expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
  });

  it('handles negative amounts', () => {
    expect(formatCurrency(-12.34)).toBe('-$12.34');
  });

  it('handles cents correctly', () => {
    expect(formatCurrency(0.01)).toBe('$0.01');
    expect(formatCurrency(0.99)).toBe('$0.99');
  });
});
