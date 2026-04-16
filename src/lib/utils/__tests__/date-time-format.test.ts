import { describe, expect, it } from 'vitest';

import { formatDisplayDateTime } from '../date-time-format';

describe('formatDisplayDateTime', () => {
  it('formats backend ISO timestamps as user-readable UTC display text', () => {
    expect(formatDisplayDateTime('2026-03-19T08:00:00.000Z', { locale: 'en-US' }))
      .toBe('Mar 19, 2026, 08:00 AM UTC');
  });

  it('localizes display text without leaking the raw ISO protocol format', () => {
    const formatted = formatDisplayDateTime('2026-03-19T08:00:00.000Z', { locale: 'zh-CN' });

    expect(formatted).toContain('2026年3月19日');
    expect(formatted).toContain('UTC 08:00');
    expect(formatted).not.toContain('2026-03-19T08:00:00.000Z');
  });

  it('uses safe fallback text for empty or invalid values instead of echoing backend payloads', () => {
    expect(formatDisplayDateTime(null, { emptyText: 'Never refreshed' })).toBe('Never refreshed');
    expect(formatDisplayDateTime('not-a-date', { invalidText: 'Unknown refresh time' })).toBe('Unknown refresh time');
  });
});
