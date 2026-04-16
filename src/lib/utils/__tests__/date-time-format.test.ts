import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDisplayDateTime } from '../date-time-format';

describe('formatDisplayDateTime', () => {
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats backend ISO timestamps in the viewer local timezone by default', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolvedOptions(this: Intl.DateTimeFormat) {
      return {
        ...originalResolvedOptions.call(this),
        timeZone: 'America/Los_Angeles',
      };
    });

    expect(formatDisplayDateTime('2026-03-19T08:00:00.000Z', { locale: 'en-US' }))
      .toBe('Mar 19, 2026, 01:00 AM PDT');
  });

  it('supports explicit locale and timezone overrides without leaking raw ISO protocol text', () => {
    const formatted = formatDisplayDateTime('2026-03-19T08:00:00.000Z', {
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
    });

    expect(formatted).toContain('2026年3月19日');
    expect(formatted).toContain('GMT+8 16:00');
    expect(formatted).not.toContain('2026-03-19T08:00:00.000Z');
  });

  it('uses safe fallback text for empty or invalid values instead of echoing backend payloads', () => {
    expect(formatDisplayDateTime(null, { emptyText: 'Never refreshed' })).toBe('Never refreshed');
    expect(formatDisplayDateTime('not-a-date', { invalidText: 'Unknown refresh time' })).toBe('Unknown refresh time');
  });
});
